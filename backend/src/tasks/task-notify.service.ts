import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../auth/user.entity';
import { WorkerRuntime } from '../common/enums';
import { FeishuBotApprovalCard } from '../feishu-bot/feishu-bot-approval-card.entity';
import { FeishuBotClientService } from '../feishu-bot/feishu-bot-client.service';
import { FeishuBotConfigService } from '../feishu-bot/feishu-bot-config.service';
import { FeishuBotIdentityService } from '../feishu-bot/feishu-bot-identity.service';
import { Worker } from '../workers/worker.entity';
import { WorkersService } from '../workers/workers.service';
import { Task } from './task.entity';

export type TaskNotifyKind = 'feedback' | 'accept' | 'notice';

export interface TaskNotifyResult {
  /** 是否成功发送（找不到负责人或飞书失败均为 false） */
  sent: boolean;
  /** 接收人姓名（找到负责人时返回，便于事件记录） */
  ownerName?: string;
}

export interface TaskRequesterNotifyOptions {
  /**
   * 普通 AI 机器人需求方没有绑定用户时，是否回退通知其负责人。
   * 仅用于自动处理失败、人工介入等升级场景；正常待验收/待反馈不打扰负责人。
   */
  fallbackToRequesterOwner?: boolean;
}

export interface ApprovalTaskNotifyInput {
  task: Task;
  ticket: { id: number; code: string; title: string };
  nodeName: string;
  /** 工单关键正文（起始节点结构化输入摘要，逐行 Markdown） */
  summaryLines: string[];
  initiatorName?: string | null;
}

/** 通知接收人：openId 为兜底值，userId 用于优先解析官方机器人应用下的 open_id */
interface NotifyReceiver {
  openId: string;
  ownerName: string;
  userId?: number | null;
}

/**
 * 任务通知：
 * - 统一以平台配置的「平台官方机器人」身份发送；未配置或发送失败不回退旧应用通道；
 * - 待反馈优先通知历史调度机器人负责人，其次处理机器人负责人；
 * - 待验收通知真实需求方（人、真人机器人绑定用户或个人 AGENT 主人）；
 *   普通 AI 机器人需求方由收件箱/自动验收驱动，正常通知不打扰其负责人；
 * - 未找到有效需求方时回退执行机器人负责人，避免异常提醒完全丢失；
 * - 审批类型任务发送审批卡片（工单链接 + 关键正文 + 通过/驳回/查看按钮）。
 */
@Injectable()
export class TaskNotifyService {
  private readonly logger = new Logger(TaskNotifyService.name);
  private readonly appUrl: string;

  constructor(
    @InjectRepository(Worker)
    private readonly workers: Repository<Worker>,
    @InjectRepository(Task)
    private readonly tasks: Repository<Task>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(FeishuBotApprovalCard)
    private readonly approvalCards: Repository<FeishuBotApprovalCard>,
    private readonly workersService: WorkersService,
    @Inject(forwardRef(() => FeishuBotConfigService))
    private readonly feishuBotConfig: FeishuBotConfigService,
    @Inject(forwardRef(() => FeishuBotClientService))
    private readonly feishuBotClient: FeishuBotClientService,
    @Inject(forwardRef(() => FeishuBotIdentityService))
    private readonly feishuBotIdentities: FeishuBotIdentityService,
    config: ConfigService,
  ) {
    this.appUrl = (
      config.get<string>('APP_URL') ?? 'http://localhost:5273'
    ).replace(/\/$/, '');
  }

  async notifyTaskOwner(
    task: Task,
    kind: TaskNotifyKind,
    title: string,
    description: string,
  ): Promise<TaskNotifyResult> {
    const receiver = await this.resolveReceiver(task, kind);
    if (!receiver) {
      this.logger.warn(
        `任务 ${task.code} 待处理提醒未发送：未找到机器人/调度机器人负责人`,
      );
      return { sent: false };
    }
    return this.sendCard(task, receiver, kind, title, description, '负责人');
  }

  /**
   * 需求方通知：优先任务创建用户，子任务回退根任务创建用户。
   * 真人机器人需求方通知其绑定用户；普通 AI 机器人需求方由收件箱与自动验收驱动，
   * 正常通知不打扰负责人，只有显式的人工兜底场景才回退通知其负责人。
   */
  async notifyTaskRequester(
    task: Task,
    kind: TaskNotifyKind,
    title: string,
    description: string,
    options?: TaskRequesterNotifyOptions,
  ): Promise<TaskNotifyResult> {
    // 真人机器人需求方仍由其绑定用户在操作台处理；AI 机器人需求方由收件箱和 LOOP 唤醒。
    if (task.requesterType === 'worker' && task.requesterId) {
      const requesterWorker = await this.workers.findOne({
        where: { id: task.requesterId },
        select: {
          id: true,
          name: true,
          humanUserId: true,
          personalAgentUserId: true,
          runtime: true,
          ownerUserId: true,
          ownerName: true,
        },
      });
      const boundUserId =
        requesterWorker?.runtime === WorkerRuntime.HUMAN
          ? requesterWorker.humanUserId
          : (requesterWorker?.personalAgentUserId ?? null);
      if (!boundUserId) {
        // 普通 AI 机器人需求方没有绑定用户，默认不发飞书；
        // 仅自动验收/自动回复失败等升级场景回退通知负责人，且不能标成需求方。
        if (options?.fallbackToRequesterOwner && requesterWorker) {
          const openId = await this.workersService.ownerOpenId(requesterWorker);
          if (openId) {
            return this.sendCard(
              task,
              {
                openId,
                ownerName: requesterWorker.ownerName ?? requesterWorker.name,
                userId: requesterWorker.ownerUserId,
              },
              kind,
              title,
              description,
              '负责人',
            );
          }
        }
        return { sent: false };
      }
      const user = await this.users.findOne({
        where: { id: boundUserId },
        select: { id: true, name: true, feishuOpenId: true },
      });
      if (user?.feishuOpenId) {
        return this.sendCard(
          task,
          { openId: user.feishuOpenId, ownerName: user.name, userId: user.id },
          kind,
          title,
          description,
          '需求方',
        );
      }
      return { sent: false };
    }
    const requesterId = await this.resolveRequesterUserId(task);
    if (requesterId) {
      const user = await this.users.findOne({
        where: { id: requesterId },
        select: { id: true, name: true, feishuOpenId: true },
      });
      if (user?.feishuOpenId) {
        return this.sendCard(
          task,
          { openId: user.feishuOpenId, ownerName: user.name, userId: user.id },
          kind,
          title,
          description,
          '需求方',
        );
      }
    }
    return this.notifyTaskOwner(task, kind, title, description);
  }

  /**
   * 新任务首次分配到真人执行机器人时，通知绑定的真实用户前往工作台处理。
   * 非真人机器人、未绑定用户或缺少飞书 openId 时静默跳过。
   */
  async notifyTaskHumanAssignee(
    task: Task,
    kind: TaskNotifyKind,
    title: string,
    description: string,
  ): Promise<TaskNotifyResult> {
    const receiver = await this.resolveHumanAssignee(task);
    if (!receiver) return { sent: false };
    return this.sendCard(task, receiver, kind, title, description, '执行人', {
      workbench: true,
      actionLabel: '打开工作台',
    });
  }

  /** 通知当前执行机器人配置的负责人（不按调度机器人优先）。 */
  async notifyTaskAgentOwner(
    task: Task,
    kind: TaskNotifyKind,
    title: string,
    description: string,
  ): Promise<TaskNotifyResult> {
    if (!task.agentId) return { sent: false };
    const worker = await this.workers.findOne({ where: { id: task.agentId } });
    if (!worker) return { sent: false };
    const openId = await this.workersService.ownerOpenId(worker);
    if (!openId) return { sent: false };
    return this.sendCard(
      task,
      {
        openId,
        ownerName: worker.ownerName ?? worker.name,
        userId: worker.ownerUserId,
      },
      kind,
      title,
      description,
      '负责人',
    );
  }

  /**
   * 审批类型任务：发送审批卡片（工单链接 + 关键正文，按钮 通过/驳回/查看）。
   * 通过按钮直接走卡片回调完成审批；驳回按钮跳转工单页填写必填反馈意见。
   * 仅通知真人执行人；未配置官方机器人或发送失败时不回退旧通道。
   */
  async notifyApprovalTask(
    input: ApprovalTaskNotifyInput,
  ): Promise<TaskNotifyResult> {
    const { task, ticket } = input;
    const receiver = await this.resolveHumanAssignee(task);
    if (!receiver) return { sent: false };
    const config = await this.feishuBotConfig.loadEnabledOfficial();
    if (!config) {
      this.logger.warn(
        `审批任务 ${task.code} 飞书通知未发送：平台官方机器人未配置或未启用`,
      );
      return { sent: false, ownerName: receiver.ownerName };
    }
    const ticketUrl = `${this.appUrl}/tickets/${ticket.id}`;
    const summary = input.summaryLines.length
      ? input.summaryLines.join('\n')
      : '- 无结构化输入';
    const card = {
      config: { wide_screen_mode: true },
      header: {
        title: {
          tag: 'plain_text',
          content: `审批待处理：${ticket.code} ${ticket.title}`.slice(0, 80),
        },
        template: 'orange',
      },
      elements: [
        {
          tag: 'div',
          text: {
            tag: 'lark_md',
            content: [
              `**工单**：[${ticket.code} ${ticket.title}](${ticketUrl})`,
              `**审批节点**：${input.nodeName}`,
              `**任务**：${task.code} ${task.title}`,
              ...(input.initiatorName
                ? [`**发起人**：${input.initiatorName}`]
                : []),
              '',
              '**工单内容**',
              summary,
              '',
              '通过可直接在本卡片完成；驳回请打开工单填写反馈意见（必填）。',
            ].join('\n'),
          },
        },
        {
          tag: 'action',
          actions: [
            {
              tag: 'button',
              text: { tag: 'plain_text', content: '通过' },
              type: 'primary',
              value: { k: 'approval', a: 'approve', t: task.id },
            },
            {
              tag: 'button',
              text: { tag: 'plain_text', content: '驳回' },
              type: 'danger',
              url: `${ticketUrl}?approval=reject`,
            },
            {
              tag: 'button',
              text: { tag: 'plain_text', content: '查看' },
              type: 'default',
              url: ticketUrl,
            },
          ],
        },
      ],
    };
    try {
      const secrets = this.feishuBotConfig.secretsOf(config);
      const receiveId =
        (await this.resolveBotOpenId(config.id, receiver)) ?? receiver.openId;
      const result = await this.feishuBotClient.sendCard(
        config.id,
        secrets,
        'open_id',
        receiveId,
        card,
      );
      if (result.messageId) {
        await this.approvalCards
          .save(
            this.approvalCards.create({
              configId: config.id,
              ticketId: ticket.id,
              taskId: task.id,
              messageId: result.messageId,
              state: 'pending',
            }),
          )
          .catch((error: Error) =>
            this.logger.warn(
              `审批卡片登记失败（${task.code}）：${error.message}`,
            ),
          );
      }
      return { sent: true, ownerName: receiver.ownerName };
    } catch (e) {
      this.logger.warn(
        `审批任务 ${task.code} 飞书通知失败（${receiver.ownerName}）: ${(e as Error).message}`,
      );
      return { sent: false, ownerName: receiver.ownerName };
    }
  }

  /** 需求方用户 id：当前任务创建人优先，子任务回退根任务创建人 */
  async resolveRequesterUserId(task: Task): Promise<number | null> {
    if (task.requesterType) {
      return task.requesterType === 'user' ? task.requesterId : null;
    }
    if (task.createdById && task.createdById > 0) return task.createdById;
    if (!task.rootId || task.rootId === task.id) return null;
    const root = await this.tasks.findOne({
      where: { id: task.rootId },
      select: { id: true, createdById: true },
    });
    return root?.createdById && root.createdById > 0 ? root.createdById : null;
  }

  /** 真人执行机器人绑定的用户（审批卡片与工作台提醒的接收人） */
  private async resolveHumanAssignee(
    task: Task,
  ): Promise<NotifyReceiver | null> {
    if (!task.agentId) return null;
    const worker = await this.workers.findOne({
      where: { id: task.agentId },
      select: { id: true, name: true, humanUserId: true, runtime: true },
    });
    if (worker?.runtime !== WorkerRuntime.HUMAN || !worker.humanUserId) {
      return null;
    }
    const user = await this.users.findOne({
      where: { id: worker.humanUserId },
      select: { id: true, name: true, feishuOpenId: true },
    });
    if (!user?.feishuOpenId) return null;
    return { openId: user.feishuOpenId, ownerName: user.name, userId: user.id };
  }

  /** 官方机器人应用下的 open_id 优先（已知映射时更可靠），否则回退登录 open_id */
  private async resolveBotOpenId(
    configId: number,
    receiver: NotifyReceiver,
  ): Promise<string | null> {
    if (!receiver.userId) return null;
    return this.feishuBotIdentities
      .openIdFor(configId, receiver.userId)
      .catch(() => null);
  }

  private async sendCard(
    task: Task,
    receiver: NotifyReceiver,
    kind: TaskNotifyKind,
    title: string,
    description: string,
    receiverLabel: '负责人' | '需求方' | '执行人',
    options?: { workbench?: boolean; actionLabel?: string },
  ): Promise<TaskNotifyResult> {
    const template = kind === 'accept' ? 'green' : 'orange';
    const taskUrl =
      options?.workbench || kind === 'accept'
        ? `${this.appUrl}/workbench/tasks/${task.id}`
        : `${this.appUrl}/tasks/${task.id}`;

    // 部分调用方只查了任务的部分字段（如对账兜底只取 id/code/title），
    // 缺状态时不要拼出 "undefined-undefined"。
    const statusLabel =
      [task.status, task.subStatus].filter(Boolean).join('-') || '未知';
    const config = await this.feishuBotConfig.loadEnabledOfficial();
    if (!config) {
      this.logger.warn(
        `任务 ${task.code} ${receiverLabel}通知未发送：平台官方机器人未配置或未启用`,
      );
      return { sent: false, ownerName: receiver.ownerName };
    }
    try {
      const secrets = this.feishuBotConfig.secretsOf(config);
      const receiveId =
        (await this.resolveBotOpenId(config.id, receiver)) ?? receiver.openId;
      await this.feishuBotClient.sendCard(
        config.id,
        secrets,
        'open_id',
        receiveId,
        {
          config: { wide_screen_mode: true },
          header: {
            // 飞书卡片标题不宜过长，任务全名在正文中完整展示
            title: { tag: 'plain_text', content: title.slice(0, 80) },
            template,
          },
          elements: [
            {
              tag: 'div',
              text: {
                tag: 'lark_md',
                content: [
                  `**任务**：${task.code} ${task.title}`,
                  `**状态**：${statusLabel}`,
                  `**${receiverLabel}**：${receiver.ownerName}`,
                  `**说明**：${description}`,
                ].join('\n'),
              },
            },
            {
              tag: 'action',
              actions: [
                {
                  tag: 'button',
                  text: {
                    tag: 'plain_text',
                    content: options?.actionLabel ?? '打开任务详情',
                  },
                  type: 'primary',
                  url: taskUrl,
                },
              ],
            },
          ],
        },
      );
      return { sent: true, ownerName: receiver.ownerName };
    } catch (e) {
      this.logger.warn(
        `任务 ${task.code} ${receiverLabel}通知失败（${receiver.ownerName}）: ${(e as Error).message}`,
      );
      return { sent: false, ownerName: receiver.ownerName };
    }
  }

  /** 收件人解析：按通知场景决定 机器人/调度机器人 负责人优先级 */
  private async resolveReceiver(
    task: Task,
    kind: TaskNotifyKind,
  ): Promise<NotifyReceiver | null> {
    const agentFirst = kind !== 'feedback';
    const candidates = agentFirst
      ? [task.agentId, task.schedulerId]
      : [task.schedulerId, task.agentId];
    const seen = new Set<number>();
    for (const id of candidates) {
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const worker = await this.workers.findOne({ where: { id } });
      if (!worker) continue;
      const openId = await this.workersService.ownerOpenId(worker);
      if (openId) {
        return {
          openId,
          ownerName: worker.ownerName ?? worker.name,
          userId: worker.ownerUserId,
        };
      }
    }
    return null;
  }
}
