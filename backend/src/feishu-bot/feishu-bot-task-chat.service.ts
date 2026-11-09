import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron } from '@nestjs/schedule';
import { In, Repository } from 'typeorm';
import { User } from '../auth/user.entity';
import { TaskStatus, TaskSubStatus, WorkerRuntime } from '../common/enums';
import { Task } from '../tasks/task.entity';
import { TaskDeliveryService } from '../tasks/task-delivery.service';
import { SYSTEM_PROJECT_DELIVERY_TASK_TEMPLATE_ID } from '../tasks/system-task-templates';
import { Worker } from '../workers/worker.entity';
import { FeishuBotClientService } from './feishu-bot-client.service';
import type {
  FeishuBotConfig,
  FeishuBotSecrets,
} from './feishu-bot-config.entity';
import { FeishuBotConfigService } from './feishu-bot-config.service';
import {
  FeishuBotIdentityService,
  type FeishuSenderId,
} from './feishu-bot-identity.service';
import { markdownCard } from './feishu-bot-message.service';
import type { FeishuInboundMessage } from './feishu-bot-p2p.service';
import { FeishuBotTaskChat } from './feishu-bot-task-chat.entity';

/** 任务终态到解散群的延时 */
const DESTROY_DELAY_MS = 24 * 60 * 60 * 1000;

/** 建群失败重试上限（每分钟一轮，30 次约半小时） */
const CREATE_MAX_ATTEMPTS = 30;

/** 解散失败重试上限 */
const DESTROY_MAX_ATTEMPTS = 20;

/** 单次对账扫描的候选任务数上限 */
const CANDIDATE_LIMIT = 100;

/** 群名长度上限 */
const CHAT_NAME_LIMIT = 80;

/** 群内一方参与者解析结果 */
interface TaskParties {
  humanUser: User;
  aiWorker: Worker;
  /** AI 位于需求侧（requester）还是执行侧（agent） */
  aiSide: 'requester' | 'agent';
}

/**
 * 任务群（任务 = 飞书群）：
 * - 仅「一个真人 + 一个 AI 机器人」的根任务自动建群（第一期，两方都是机器人暂不支持）；
 * - 平台官方机器人建群并代理任务 AI，真人参与者经 open_id 拉入群；
 * - 任务进入终态后发送结果卡片，24 小时后自动解散；
 * - 群内 @官方机器人 的文本经 TaskDeliveryService 走任务中心（不绕过任务状态机）。
 * 定时对账（60s）保证进程重启/建群失败可恢复。
 */
@Injectable()
export class FeishuBotTaskChatService {
  private readonly logger = new Logger(FeishuBotTaskChatService.name);
  /** 对账互斥：上一轮未结束不重入 */
  private reconciling = false;

  constructor(
    private readonly configs: FeishuBotConfigService,
    private readonly client: FeishuBotClientService,
    private readonly identities: FeishuBotIdentityService,
    private readonly delivery: TaskDeliveryService,
    @InjectRepository(FeishuBotTaskChat)
    private readonly chats: Repository<FeishuBotTaskChat>,
    @InjectRepository(Task)
    private readonly tasks: Repository<Task>,
    @InjectRepository(Worker)
    private readonly workers: Repository<Worker>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
  ) {}

  /** 每分钟对账：建群 / 结果卡片 / 到期解散 */
  @Cron('0 * * * * *')
  async reconcile(): Promise<void> {
    if (this.reconciling) return;
    this.reconciling = true;
    try {
      await this.reconcileOnce();
    } catch (error) {
      this.logger.warn(`任务群对账失败: ${(error as Error).message}`);
    } finally {
      this.reconciling = false;
    }
  }

  private async reconcileOnce(): Promise<void> {
    const official = await this.configs.loadEnabledOfficial();
    const rows = await this.chats.find();
    const taskIds = rows.map((row) => row.taskId);
    const taskMap = new Map<number, Task>();
    if (taskIds.length > 0) {
      const found = await this.tasks.find({ where: { id: In(taskIds) } });
      for (const task of found) taskMap.set(task.id, task);
    }

    for (const row of rows) {
      const secrets =
        official && official.id === row.officialConfigId
          ? this.configs.secretsOf(official)
          : null;
      const task = taskMap.get(row.taskId);
      if (!task) {
        // 任务已删除：立即解散，删除失败则标记销毁终态
        if (row.chatId && secrets && row.state !== 'destroyed') {
          await this.dissolve(row, secrets);
        } else if (row.state !== 'destroyed') {
          await this.chats.update(row.id, {
            state: 'destroyed',
            lastError: '任务已删除',
          });
        }
        continue;
      }
      if (task.templateId === SYSTEM_PROJECT_DELIVERY_TASK_TEMPLATE_ID) {
        // 存量项目交付任务的双人群迁移到项目沟通群，避免同一任务出现两个群。
        if (row.chatId && secrets && row.state !== 'destroyed') {
          await this.dissolve(row, secrets);
        } else if (!row.chatId && row.state !== 'destroyed') {
          await this.chats.update(row.id, {
            state: 'destroyed',
            lastError: '项目交付任务已改用项目沟通群',
          });
        }
        continue;
      }
      if (task.status === TaskStatus.FINISHED) {
        if (!row.finishedAt) {
          const finishedAt = task.acceptedAt ?? task.updatedAt;
          await this.chats.update(row.id, {
            finishedAt,
            destroyAfter: new Date(finishedAt.getTime() + DESTROY_DELAY_MS),
          });
          row.finishedAt = finishedAt;
          row.destroyAfter = new Date(finishedAt.getTime() + DESTROY_DELAY_MS);
        }
        if (
          !row.finishedNotified &&
          row.state === 'active' &&
          row.chatId &&
          secrets
        ) {
          await this.sendFinishCard(row, task, secrets);
        }
        if (
          row.destroyAfter &&
          row.destroyAfter.getTime() <= Date.now() &&
          row.state !== 'destroyed'
        ) {
          if (secrets) {
            await this.dissolve(row, secrets);
          } else {
            await this.chats.update(row.id, { state: 'destroyed' });
          }
        }
      }
    }

    if (!official) return;
    const secrets = this.configs.secretsOf(official);
    const bound = new Set(rows.map((row) => row.taskId));
    const candidates = await this.tasks.find({
      where: { status: TaskStatus.RUNNING, subStatus: TaskSubStatus.EXECUTING },
      take: CANDIDATE_LIMIT,
    });
    for (const task of candidates) {
      if (bound.has(task.id)) continue;
      if (task.parentId !== null) continue;
      // 项目交付任务使用 ProjectChat 多人沟通群，不再创建双人任务群。
      if (task.templateId === SYSTEM_PROJECT_DELIVERY_TASK_TEMPLATE_ID)
        continue;
      const existing = rows.find((row) => row.taskId === task.id);
      if (
        existing &&
        existing.officialConfigId === official.id &&
        !existing.chatId &&
        (existing.state === 'creating' || existing.state === 'error') &&
        existing.attempts < CREATE_MAX_ATTEMPTS
      ) {
        // 建群失败重试
        await this.createGroupChat(official, secrets, task, existing);
        continue;
      }
      if (existing) continue;
      const parties = await this.resolveParties(task);
      if (!parties) continue;
      await this.createGroupChat(official, secrets, task, null, parties);
    }
  }

  /**
   * 解析任务的「真人 + AI」参与方：
   * - 需求方真人 + 执行 AI；
   * - 需求 AI + 真人执行。
   * 两方都是 AI（个人 AGENT 需求方视为 AI）或找不到真人飞书身份时返回 null。
   */
  private async resolveParties(task: Task): Promise<TaskParties | null> {
    const requesterWorker =
      task.requesterType === 'worker' && task.requesterId
        ? await this.workers.findOne({ where: { id: task.requesterId } })
        : null;
    const agentWorker = task.agentId
      ? await this.workers.findOne({ where: { id: task.agentId } })
      : null;
    if (!agentWorker) return null;

    const isAiWorker = (worker: Worker): boolean =>
      worker.runtime === WorkerRuntime.OPENCODE && !worker.personalAgentUserId;
    const requesterHumanId =
      task.requesterType === 'user'
        ? task.requesterId
        : (requesterWorker?.humanUserId ?? null);
    const agentHumanId =
      agentWorker.runtime === WorkerRuntime.HUMAN
        ? agentWorker.humanUserId
        : null;
    const requesterAi = requesterWorker !== null && isAiWorker(requesterWorker);
    const agentAi = isAiWorker(agentWorker);

    let humanUserId: number | null = null;
    let aiWorker: Worker | null = null;
    let aiSide: 'requester' | 'agent' | null = null;
    if (requesterHumanId && agentAi) {
      humanUserId = requesterHumanId;
      aiWorker = agentWorker;
      aiSide = 'agent';
    } else if (requesterAi && requesterWorker && agentHumanId) {
      humanUserId = agentHumanId;
      aiWorker = requesterWorker;
      aiSide = 'requester';
    }
    if (!humanUserId || !aiWorker || !aiSide) return null;
    const user = await this.users.findOne({ where: { id: humanUserId } });
    // 真人没有飞书身份时由 createGroupChat 记录错误并等待重试
    if (!user) return null;
    return { humanUser: user, aiWorker, aiSide };
  }

  /** 建群并写入绑定（幂等：unique taskId + orIgnore） */
  private async createGroupChat(
    official: FeishuBotConfig,
    secrets: FeishuBotSecrets,
    task: Task,
    existing: FeishuBotTaskChat | null,
    parties?: TaskParties,
  ): Promise<void> {
    let row = existing;
    if (!row) {
      if (!parties) return;
      const inserted = await this.chats
        .createQueryBuilder()
        .insert()
        .into(FeishuBotTaskChat)
        .values({
          taskId: task.id,
          officialConfigId: official.id,
          state: 'creating',
          aiSide: parties.aiSide,
          humanUserId: parties.humanUser.id,
          humanName: parties.humanUser.name,
          aiWorkerId: parties.aiWorker.id,
          aiWorkerName: parties.aiWorker.name,
          taskCode: task.code,
          taskTitle: task.title.slice(0, 220),
        })
        .orIgnore()
        .execute();
      if (!inserted.identifiers?.length) return;
      row = (await this.chats.findOne({ where: { taskId: task.id } })) ?? null;
      if (!row) return;
    }
    // 重试路径没有 parties：按绑定行重新解析真人飞书身份
    const humanUser =
      parties?.humanUser ??
      (await this.users.findOne({ where: { id: row.humanUserId } }));
    const openId = humanUser
      ? ((await this.identities.openIdFor(
          row.officialConfigId,
          humanUser.id,
        )) ?? humanUser.feishuOpenId)
      : null;
    if (!humanUser || !openId) {
      await this.chats.update(row.id, {
        state: 'error',
        lastError: `真人「${row.humanName}」没有飞书身份（未登录过平台）`,
      });
      return;
    }
    try {
      const requesterName =
        row.aiSide === 'agent' ? row.humanName : `${row.aiWorkerName}（AI）`;
      const executorName =
        row.aiSide === 'agent' ? `${row.aiWorkerName}（AI）` : row.humanName;
      const chatId = await this.client.createChat(
        official.id,
        secrets,
        `[${row.taskCode}] ${row.taskTitle}`.slice(0, CHAT_NAME_LIMIT),
        `平台任务 ${row.taskCode}`,
        [openId],
      );
      await this.chats.update(row.id, {
        chatId,
        state: 'active',
        lastError: null,
      });
      const card = markdownCard(
        [
          `**[任务群已创建]** ${row.taskCode}`,
          '',
          `- **标题**：${row.taskTitle}`,
          `- **需求方**：${requesterName}`,
          `- **执行方**：${executorName}`,
          `- **状态**：${task.status}-${task.subStatus}`,
          `- **任务链接**：${this.client.appUrl}/tasks/${task.id}`,
          '',
          '在群里 @官方机器人 发送消息，会转达给任务 AI（走任务中心，保留完整状态流转）。',
        ].join('\n'),
      );
      await this.client.sendCard(official.id, secrets, 'chat_id', chatId, card);
      this.logger.log(
        `任务群已创建：${row.taskCode} → chat ${chatId}（真人 ${row.humanName} + AI ${row.aiWorkerName}）`,
      );
    } catch (error) {
      const message = (error as Error).message;
      await this.chats.increment({ id: row.id }, 'attempts', 1);
      await this.chats.update(row.id, { state: 'error', lastError: message });
      this.logger.warn(`任务群创建失败（${row.taskCode}）: ${message}`);
    }
  }

  /** 任务终态：发送结果卡片（成功/失败/取消/拒绝统一文案 + 24h 解散预告） */
  private async sendFinishCard(
    row: FeishuBotTaskChat,
    task: Task,
    secrets: FeishuBotSecrets,
  ): Promise<void> {
    try {
      const result = (task.result ?? '').trim();
      const summary = result
        ? `\n\n${result.slice(0, 1200)}${result.length > 1200 ? '\n…（完整内容见任务详情）' : ''}`
        : '';
      const card = markdownCard(
        [
          `**[任务已结束]** ${row.taskCode} ${task.subStatus}`,
          `- **标题**：${row.taskTitle}`,
          `- **状态**：${task.status}-${task.subStatus}`,
          `- **任务链接**：${this.client.appUrl}/tasks/${task.id}`,
          summary,
          '',
          '该群将于 **24 小时后**自动解散，任务记录与交付文档不受影响。',
        ]
          .filter((line) => line !== undefined)
          .join('\n'),
      );
      await this.client.sendCard(
        row.officialConfigId,
        secrets,
        'chat_id',
        row.chatId!,
        card,
      );
      await this.chats.update(row.id, { finishedNotified: true });
    } catch (error) {
      this.logger.warn(
        `任务完成卡片发送失败（${row.taskCode}）: ${(error as Error).message}`,
      );
    }
  }

  /** 解散群（失败重试，超限放弃并标记 destroyed） */
  private async dissolve(
    row: FeishuBotTaskChat,
    secrets: FeishuBotSecrets,
  ): Promise<void> {
    if (!row.chatId) {
      await this.chats.update(row.id, { state: 'destroyed' });
      return;
    }
    try {
      await this.client.dissolveChat(row.officialConfigId, secrets, row.chatId);
      await this.chats.update(row.id, { state: 'destroyed', lastError: null });
      this.logger.log(`任务群已解散：${row.taskCode}（chat ${row.chatId}）`);
    } catch (error) {
      const message = (error as Error).message;
      await this.chats.increment({ id: row.id }, 'attempts', 1);
      const fresh = await this.chats.findOne({ where: { id: row.id } });
      if ((fresh?.attempts ?? 0) >= DESTROY_MAX_ATTEMPTS) {
        await this.chats.update(row.id, {
          state: 'destroyed',
          lastError: message,
        });
        this.logger.warn(
          `任务群解散重试超限，放弃（${row.taskCode}）: ${message}`,
        );
        return;
      }
      await this.chats.update(row.id, { lastError: message });
      this.logger.warn(`任务群解散失败（${row.taskCode}）: ${message}`);
    }
  }

  // ==== 群消息 ====

  /**
   * 群内消息：仅处理绑定任务群的 chat_id。
   * 发送者必须是群内绑定的真人；文本经 TaskDeliveryService 投递任务中心，
   * AI 在需求侧时按执行方身份（responsible）、AI 在执行侧时按需求方身份（requester）。
   */
  async handleGroupMessage(
    config: FeishuBotConfig,
    secrets: FeishuBotSecrets,
    sender: FeishuSenderId,
    message: FeishuInboundMessage,
  ): Promise<void> {
    const row = message.chatId
      ? await this.chats.findOne({ where: { chatId: message.chatId } })
      : null;
    if (
      !row ||
      row.officialConfigId !== config.id ||
      row.state === 'destroyed'
    ) {
      return;
    }
    if (message.messageType !== 'text') {
      await this.client
        .sendText(
          config.id,
          secrets,
          'chat_id',
          message.chatId,
          '任务群暂只支持文本消息（图片/文件请到任务详情页上传）。',
        )
        .catch(() => {});
      return;
    }
    const user = await this.identities.resolve(config, sender);
    if (!user) {
      await this.client
        .sendText(
          config.id,
          secrets,
          'chat_id',
          message.chatId,
          '未识别平台账号：请先用当前飞书账号登录平台一次后重试。',
        )
        .catch(() => {});
      return;
    }
    if (user.id !== row.humanUserId) {
      await this.client
        .sendText(
          config.id,
          secrets,
          'chat_id',
          message.chatId,
          '仅任务参与人可与任务 AI 对话。',
        )
        .catch(() => {});
      return;
    }
    let text = '';
    try {
      const payload = JSON.parse(message.content || '{}') as { text?: string };
      text = String(payload.text ?? '')
        .replace(/@_user_\d+/g, '')
        .trim();
    } catch {
      text = '';
    }
    if (!text) return;
    const perspective = row.aiSide === 'agent' ? 'responsible' : 'requester';
    try {
      const task = await this.delivery.sendMessage(
        row.taskId,
        user,
        text,
        perspective,
      );
      await this.client.sendCard(
        config.id,
        secrets,
        'chat_id',
        message.chatId,
        markdownCard(
          [
            `**已转达给任务 AI**（${row.taskCode}，状态：${task.status}-${task.subStatus}）`,
            `> ${text.slice(0, 500)}${text.length > 500 ? '\n…' : ''}`,
          ].join('\n'),
        ),
      );
    } catch (error) {
      await this.client
        .sendText(
          config.id,
          secrets,
          'chat_id',
          message.chatId,
          `消息转达失败：${(error as Error).message}`,
        )
        .catch(() => {});
    }
  }
}
