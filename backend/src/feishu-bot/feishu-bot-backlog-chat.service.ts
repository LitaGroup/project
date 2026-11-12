import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron } from '@nestjs/schedule';
import { In, Repository } from 'typeorm';
import { User } from '../auth/user.entity';
import { BacklogStatus } from '../common/enums';
import { Backlog } from '../iterations/backlog.entity';
import { Worker } from '../workers/worker.entity';
import { FeishuBotClientService } from './feishu-bot-client.service';
import type {
  FeishuBotConfig,
  FeishuBotSecrets,
} from './feishu-bot-config.entity';
import { FeishuBotConfigService } from './feishu-bot-config.service';
import { FeishuBotIdentityService } from './feishu-bot-identity.service';
import { markdownCard } from './feishu-bot-message.service';
import { FeishuBotBacklogChat } from './feishu-bot-backlog-chat.entity';

/** backlog 终态后保留沟通群的时间 */
const DISSOLVE_DELAY_MS = 7 * 24 * 60 * 60 * 1000;

/** 建群失败重试上限（每分钟一轮） */
const CREATE_MAX_ATTEMPTS = 30;

/** 单次对账补检的无绑定 backlog 数上限 */
const CANDIDATE_LIMIT = 100;

/** 飞书建群单次最多邀请的用户数 */
const MAX_CHAT_MEMBERS = 50;

/** 群名总长度上限 */
const CHAT_NAME_LIMIT = 80;

/** 终态：完成 / 取消 */
export function isBacklogTerminal(status: BacklogStatus): boolean {
  return (
    status === BacklogStatus.COMPLETED || status === BacklogStatus.CANCELED
  );
}

/** backlog 沟通群名称：保留固定前后缀，仅截断标题 */
export function backlogChatName(title: string): string {
  const prefix = 'LitaWork-迭代-';
  const suffix = ' 沟通群';
  const name = title.trim() || '未命名迭代项';
  const available = Math.max(
    1,
    CHAT_NAME_LIMIT - prefix.length - suffix.length,
  );
  return `${prefix}${name.slice(0, available)}${suffix}`;
}

interface ResolvedMembers {
  users: User[];
  openIds: string[];
  missingNames: string[];
}

/**
 * 迭代项（Backlog）沟通群：backlog 创建后建立飞书群。
 * - 拉入 backlog 成员（产品/业务/项目/技术）与负责人机器人绑定的飞书应用；
 * - 无法匹配平台用户/未登录过平台的成员跳过并在建群卡片标注；
 * - 状态变化推送卡片，完成/取消后保留 7 天自动解散；
 * - 定时对账补建/补拉/补偿终态，建群失败不阻断 backlog 创建。
 */
@Injectable()
export class FeishuBotBacklogChatService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(FeishuBotBacklogChatService.name);
  private readonly locks = new Map<string, Promise<void>>();
  private reconciling = false;

  constructor(
    private readonly configs: FeishuBotConfigService,
    private readonly client: FeishuBotClientService,
    private readonly identities: FeishuBotIdentityService,
    @InjectRepository(FeishuBotBacklogChat)
    private readonly chats: Repository<FeishuBotBacklogChat>,
    @InjectRepository(Backlog)
    private readonly backlogs: Repository<Backlog>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(Worker)
    private readonly workers: Repository<Worker>,
  ) {}

  onModuleInit(): void {
    // 启动后补建一次，避免重启期间错过的建群/终态补偿
    void this.reconcile().catch((error: Error) => {
      this.logger.warn(`迭代沟通群启动对账失败: ${error.message}`);
    });
  }

  onModuleDestroy(): void {
    this.locks.clear();
  }

  /** backlog 创建/更新后调用：幂等绑定并立即尝试建群（失败保留绑定等待对账） */
  async ensureForBacklog(backlogId: number): Promise<void> {
    const [backlog, official] = await Promise.all([
      this.backlogs.findOne({ where: { id: backlogId } }),
      this.configs.loadEnabledOfficial(),
    ]);
    if (!backlog || !official) return;

    let row = await this.chats.findOne({ where: { backlogId } });
    if (!row) {
      await this.chats
        .createQueryBuilder()
        .insert()
        .into(FeishuBotBacklogChat)
        .values({
          backlogId,
          officialConfigId: official.id,
          state: 'creating',
          name: backlogChatName(backlog.title),
          backlogTitle: backlog.title,
          memberUserIds: [],
          memberNames: [],
          botIds: [],
          lastStatus: null,
          finishedAt: null,
          finishedNotified: false,
          destroyAfter: null,
          attempts: 0,
          lastError: null,
        })
        .orIgnore()
        .execute();
      row = await this.chats.findOne({ where: { backlogId } });
    }
    if (!row || row.state === 'destroyed') return;
    await this.withLock(`backlog-chat:${row.id}`, async () => {
      const fresh = await this.chats.findOne({ where: { id: row.id } });
      if (!fresh || fresh.state === 'destroyed') return;
      if (!fresh.chatId && fresh.attempts < CREATE_MAX_ATTEMPTS) {
        const secrets = this.configs.secretsOf(official);
        await this.createGroupChat(fresh, official, secrets, backlog);
      }
    });
  }

  /** backlog 状态变化后调用：终态发结果卡片 + 计时解散；其余发状态卡片 */
  async notifyBacklog(backlogId: number): Promise<void> {
    const backlog = await this.backlogs.findOne({ where: { id: backlogId } });
    if (!backlog) return;
    const row = await this.chats.findOne({ where: { backlogId } });
    if (!row || row.state !== 'active' || !row.chatId) return;
    if (row.lastStatus === backlog.status) return;
    const official = await this.configs.loadEnabledWithSecrets(
      row.officialConfigId,
    );
    if (!official) return;
    const secrets = this.configs.secretsOf(official);
    await this.withLock(`backlog-chat:${row.id}`, async () => {
      const fresh = await this.chats.findOne({ where: { id: row.id } });
      if (!fresh || fresh.state !== 'active' || !fresh.chatId) return;
      if (fresh.lastStatus === backlog.status) return;
      await this.sendStatusCard(fresh, backlog, official, secrets);
    });
  }

  /** 每分钟对账：补建群 / 补拉机器人 / 终态计时 / 到期解散 / 补检无绑定 backlog */
  @Cron('25 * * * * *')
  async reconcile(): Promise<void> {
    if (this.reconciling) return;
    this.reconciling = true;
    try {
      await this.reconcileOnce();
    } catch (error) {
      this.logger.warn(`迭代沟通群对账失败: ${(error as Error).message}`);
    } finally {
      this.reconciling = false;
    }
  }

  private async reconcileOnce(): Promise<void> {
    const official = await this.configs.loadEnabledOfficial();
    const rows = await this.chats.find();
    const backlogIds = rows.map((row) => row.backlogId);
    const backlogs = backlogIds.length
      ? await this.backlogs.find({ where: { id: In(backlogIds) } })
      : ([] as Backlog[]);
    const backlogMap = new Map(backlogs.map((b) => [b.id, b]));

    for (const row of rows) {
      if (row.state === 'destroyed') continue;
      const backlog = backlogMap.get(row.backlogId);
      if (!backlog) {
        await this.destroyMissingGroup(row);
        continue;
      }
      if (!official || official.id !== row.officialConfigId) continue;
      const secrets = this.configs.secretsOf(official);

      await this.withLock(`backlog-chat:${row.id}`, async () => {
        const fresh = await this.chats.findOne({ where: { id: row.id } });
        if (!fresh || fresh.state === 'destroyed') return;
        if (
          (!fresh.chatId ||
            fresh.state === 'creating' ||
            fresh.state === 'error') &&
          fresh.attempts < CREATE_MAX_ATTEMPTS
        ) {
          await this.createGroupChat(fresh, official, secrets, backlog);
          return;
        }
        if (fresh.state !== 'active' || !fresh.chatId) return;

        await this.syncOwnerBot(fresh, backlog, official, secrets);
        await this.markFinished(fresh, backlog);
        if (fresh.lastStatus !== backlog.status) {
          await this.sendStatusCard(fresh, backlog, official, secrets);
        }
        if (fresh.destroyAfter && fresh.destroyAfter.getTime() <= Date.now()) {
          await this.dissolve(fresh, secrets);
        }
      });
    }

    if (!official) return;
    const bound = new Set(rows.map((row) => row.backlogId));
    const candidates = await this.backlogs.find({
      where: { status: In([BacklogStatus.WAITING, BacklogStatus.EXECUTING]) },
      order: { id: 'DESC' },
      take: CANDIDATE_LIMIT,
    });
    for (const backlog of candidates) {
      if (bound.has(backlog.id)) continue;
      await this.ensureForBacklog(backlog.id);
    }
  }

  /** 建群：成员 + 负责人机器人；机器人拉入失败时降级为仅拉用户 */
  private async createGroupChat(
    row: FeishuBotBacklogChat,
    official: FeishuBotConfig,
    secrets: FeishuBotSecrets,
    backlog: Backlog,
  ): Promise<void> {
    const members = await this.resolveMembers(official, backlog);
    const botIds = await this.resolveBotIds(backlog, official);
    try {
      let chatId: string;
      let addedBotIds = botIds;
      try {
        chatId = await this.client.createChat(
          official.id,
          secrets,
          row.name,
          `迭代项沟通群（${backlog.code}，需求 #${backlog.projectId}）`,
          members.openIds,
          { botIds, idempotencyKey: `backlog-chat-${row.id}` },
        );
      } catch (error) {
        if (botIds.length === 0) throw error;
        this.logger.warn(
          `迭代沟通群拉入机器人失败，降级为仅拉用户（${backlog.code}）: ${(error as Error).message}`,
        );
        addedBotIds = [];
        chatId = await this.client.createChat(
          official.id,
          secrets,
          row.name,
          `迭代项沟通群（${backlog.code}，需求 #${backlog.projectId}）`,
          members.openIds,
          { idempotencyKey: `backlog-chat-${row.id}` },
        );
      }
      await this.chats.update(row.id, {
        chatId,
        state: 'active',
        officialConfigId: official.id,
        memberUserIds: members.users.map((user) => user.id),
        memberNames: members.users.map((user) => user.name),
        botIds: addedBotIds,
        lastStatus: backlog.status,
        lastError: null,
      });
      Object.assign(row, {
        chatId,
        state: 'active',
        memberUserIds: members.users.map((user) => user.id),
        memberNames: members.users.map((user) => user.name),
        botIds: addedBotIds,
        lastStatus: backlog.status,
      });
      try {
        await this.client.sendCard(
          official.id,
          secrets,
          'chat_id',
          chatId,
          markdownCard(
            [
              '**[迭代沟通群已创建]**',
              '',
              `- **迭代项**：${backlog.code} ${backlog.title}`,
              `- **需求**：#${backlog.projectId}`,
              `- **负责人**：${backlog.ownerName ?? '未指定'}`,
              `- **状态**：${backlog.status}`,
              `- **成员**：${
                row.memberNames.length ? row.memberNames.join('、') : '暂无'
              }`,
              ...(members.missingNames.length
                ? [
                    `- **未加入**：${members.missingNames.join('、')}（未匹配平台用户或未登录过平台）`,
                  ]
                : []),
              `- **迭代项链接**：${this.client.appUrl}/backlogs/${backlog.id}`,
              '',
              '本群会自动同步迭代项状态；完成或取消后保留 7 天并自动解散。',
            ].join('\n'),
          ),
        );
      } catch (error) {
        this.logger.warn(
          `迭代沟通群创建卡片发送失败（${backlog.code}）: ${(error as Error).message}`,
        );
      }
      this.logger.log(
        `迭代沟通群已创建：${backlog.code} → chat ${chatId}（${members.users.length} 人，${addedBotIds.length} 个机器人）`,
      );
    } catch (error) {
      const message = (error as Error).message;
      await this.chats.increment({ id: row.id }, 'attempts', 1);
      await this.chats.update(row.id, { state: 'error', lastError: message });
      this.logger.warn(`迭代沟通群创建失败（${backlog.code}）: ${message}`);
    }
  }

  /** backlog 成员（已存 userId）解析为平台用户与飞书 open_id */
  private async resolveMembers(
    official: FeishuBotConfig,
    backlog: Backlog,
  ): Promise<ResolvedMembers> {
    const members = backlog.members ?? [];
    if (members.length === 0)
      return { users: [], openIds: [], missingNames: [] };
    const userIds = [...new Set(members.map((m) => m.userId))];
    const found = await this.users.find({ where: { id: In(userIds) } });
    const byId = new Map(found.map((user) => [user.id, user]));
    const users: User[] = [];
    const openIds: string[] = [];
    const missingNames: string[] = [];
    const seenOpenIds = new Set<string>();
    const seenUserIds = new Set<number>();
    for (const member of members) {
      const user = byId.get(member.userId);
      if (!user || seenUserIds.has(user.id)) {
        if (!user) missingNames.push(member.name);
        continue;
      }
      seenUserIds.add(user.id);
      const openId =
        (await this.identities.openIdFor(official.id, user.id)) ??
        user.feishuOpenId;
      if (!openId || seenOpenIds.has(openId)) {
        missingNames.push(member.name);
        continue;
      }
      seenOpenIds.add(openId);
      users.push(user);
      if (openIds.length < MAX_CHAT_MEMBERS) openIds.push(openId);
    }
    return { users, openIds, missingNames };
  }

  /** 负责人机器人绑定了独立飞书应用时一并拉入群（排除官方机器人自身） */
  private async resolveBotIds(
    backlog: Backlog,
    official: FeishuBotConfig,
  ): Promise<string[]> {
    if (!backlog.ownerWorkerId) return [];
    const config = await this.configs.findEnabledWorkerConfig(
      backlog.ownerWorkerId,
    );
    if (!config || config.appId === official.appId) return [];
    return [config.appId];
  }

  /** 负责人机器人可能在建群后才绑定飞书应用，对账时补拉 */
  private async syncOwnerBot(
    row: FeishuBotBacklogChat,
    backlog: Backlog,
    official: FeishuBotConfig,
    secrets: FeishuBotSecrets,
  ): Promise<void> {
    if (!row.chatId) return;
    const [botId] = await this.resolveBotIds(backlog, official);
    if (!botId || row.botIds.includes(botId)) return;
    try {
      await this.client.addChatMembers(
        row.officialConfigId,
        secrets,
        row.chatId,
        [botId],
      );
      const botIds = [...row.botIds, botId];
      await this.chats.update(row.id, { botIds });
      row.botIds = botIds;
    } catch (error) {
      this.logger.warn(
        `迭代沟通群补拉负责人机器人失败（${backlog.code}, ${botId}）: ${(error as Error).message}`,
      );
    }
  }

  /** 终态固定解散时间，所有终态统一保留 7 天 */
  private async markFinished(
    row: FeishuBotBacklogChat,
    backlog: Backlog,
  ): Promise<void> {
    if (!isBacklogTerminal(backlog.status) || row.finishedAt) return;
    const finishedAt =
      backlog.completedAt ?? backlog.canceledAt ?? backlog.updatedAt;
    const destroyAfter = new Date(finishedAt.getTime() + DISSOLVE_DELAY_MS);
    await this.chats.update(row.id, { finishedAt, destroyAfter });
    row.finishedAt = finishedAt;
    row.destroyAfter = destroyAfter;
  }

  private async sendStatusCard(
    row: FeishuBotBacklogChat,
    backlog: Backlog,
    official: FeishuBotConfig,
    secrets: FeishuBotSecrets,
  ): Promise<void> {
    if (!row.chatId || row.state !== 'active') return;
    const terminal = isBacklogTerminal(backlog.status);
    if (terminal && row.finishedNotified) return;
    try {
      await this.client.sendCard(
        row.officialConfigId,
        secrets,
        'chat_id',
        row.chatId,
        markdownCard(
          terminal
            ? [
                `**[迭代项已${backlog.status}]** ${backlog.code}`,
                `- **迭代项**：${backlog.title}`,
                `- **需求**：#${backlog.projectId}`,
                `- **负责人**：${backlog.ownerName ?? '未指定'}`,
                `- **状态**：${
                  row.lastStatus ? `${row.lastStatus} → ` : ''
                }${backlog.status}`,
                `- **迭代项链接**：${this.client.appUrl}/backlogs/${backlog.id}`,
                '',
                row.destroyAfter
                  ? `该群将于 **${formatBeijing(row.destroyAfter)}** 自动解散，迭代项记录与交付文档不受影响。`
                  : '该群将在终态后 7 天自动解散，迭代项记录与交付文档不受影响。',
              ].join('\n')
            : [
                `**[迭代项状态更新]** ${backlog.code}`,
                `- **迭代项**：${backlog.title}`,
                `- **需求**：#${backlog.projectId}`,
                `- **状态**：${
                  row.lastStatus ? `${row.lastStatus} → ` : ''
                }${backlog.status}`,
                `- **负责人**：${backlog.ownerName ?? '未指定'}`,
                `- **迭代项链接**：${this.client.appUrl}/backlogs/${backlog.id}`,
              ].join('\n'),
        ),
      );
      await this.chats.update(row.id, {
        lastStatus: backlog.status,
        finishedNotified: terminal ? true : row.finishedNotified,
        lastError: null,
      });
      row.lastStatus = backlog.status;
      if (terminal) row.finishedNotified = true;
    } catch (error) {
      const message = (error as Error).message;
      await this.chats.update(row.id, { lastError: message });
      this.logger.warn(`迭代沟通群状态推送失败（${backlog.code}）: ${message}`);
    }
  }

  /** backlog 删除后尽力解散；官方机器人不可用时保留绑定等待恢复后重试 */
  private async destroyMissingGroup(row: FeishuBotBacklogChat): Promise<void> {
    if (row.state === 'destroyed') return;
    await this.withLock(`backlog-chat:${row.id}`, async () => {
      const fresh = await this.chats.findOne({ where: { id: row.id } });
      if (!fresh || fresh.state === 'destroyed') return;
      if (!fresh.chatId) {
        await this.chats.update(fresh.id, {
          state: 'destroyed',
          lastError: '迭代项已删除',
        });
        return;
      }
      const official = await this.configs.loadEnabledWithSecrets(
        fresh.officialConfigId,
      );
      if (!official) {
        await this.chats.update(fresh.id, {
          lastError: '迭代项已删除，但官方机器人不可用，暂无法解散群',
        });
        return;
      }
      await this.dissolve(fresh, this.configs.secretsOf(official));
    });
  }

  private async dissolve(
    row: FeishuBotBacklogChat,
    secrets: FeishuBotSecrets,
  ): Promise<void> {
    if (!row.chatId) {
      await this.chats.update(row.id, { state: 'destroyed' });
      return;
    }
    try {
      await this.client.dissolveChat(row.officialConfigId, secrets, row.chatId);
      await this.chats.update(row.id, {
        state: 'destroyed',
        lastError: null,
      });
      this.logger.log(`迭代沟通群已解散：chat ${row.chatId}`);
    } catch (error) {
      const message = (error as Error).message;
      await this.chats.update(row.id, { lastError: message });
      this.logger.warn(`迭代沟通群解散失败（chat ${row.chatId}）: ${message}`);
    }
  }

  /** 同一群串行处理，避免重复卡片和重复建群 */
  private async withLock(key: string, run: () => Promise<void>): Promise<void> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.locks.set(key, tail);
    await previous;
    try {
      await run();
    } finally {
      release();
      if (this.locks.get(key) === tail) this.locks.delete(key);
    }
  }
}

function formatBeijing(value: Date): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(value);
}
