import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron } from '@nestjs/schedule';
import { FindOptionsWhere, LessThan, Repository } from 'typeorm';
import type { User } from '../auth/user.entity';
import { WorkerRuntime } from '../common/enums';
import { Worker } from '../workers/worker.entity';
import {
  WorkerDebugService,
  type DebugStreamPayload,
} from '../workers/worker-debug.service';
import {
  currentRunText,
  diffRunProgress,
  initialRunState,
  interruptedResultFrom,
  pendingQuestionsOf,
  settleRunResult,
} from '../mcp/mcp-bot-runner';
import type { McpBotQuestionGroup } from '../mcp/mcp.types';
import type { FeishuBotCardQuestion } from './feishu-bot-card.entity';
import { FeishuBotCard } from './feishu-bot-card.entity';
import type {
  FeishuBotConfig,
  FeishuBotSecrets,
} from './feishu-bot-config.entity';
import { FeishuBotConfigService } from './feishu-bot-config.service';
import {
  FeishuBotGroup,
  isFeishuBotGroupPolicy,
  type FeishuBotGroupPolicy,
} from './feishu-bot-group.entity';
import {
  FEISHU_BOT_GROUP_RECORD_CONTENT_LIMIT,
  FeishuBotGroupRecord,
  type FeishuBotGroupRecordDecision,
  type FeishuBotGroupRecordKind,
} from './feishu-bot-group-record.entity';
import {
  FeishuBotMessageService,
  mapTextAnswer,
} from './feishu-bot-message.service';
import type { FeishuInboundMessage } from './feishu-bot-p2p.service';
import { TYPING_EMOJI } from './feishu-bot-p2p.service';
import { FeishuBotProjectChat } from './feishu-bot-project-chat.entity';
import type { FeishuSenderId } from './feishu-bot-identity.service';
import { FeishuBotIdentityService } from './feishu-bot-identity.service';
import { FeishuBotTaskChat } from './feishu-bot-task-chat.entity';
import { FeishuBotClientService } from './feishu-bot-client.service';

/** 群会话 scope 前缀（scope = feishu:group:{chatId}） */
export const FEISHU_GROUP_SCOPE_PREFIX = 'feishu:group:';

/** 群会话固定虚拟属主：负数，与真人调试会话隔离 */
export const FEISHU_GROUP_SESSION_OWNER_ID = -1;

/** 智能模式下「无需回复」标记（AI 只输出该标记时不发群消息） */
export const FEISHU_GROUP_SILENT_MARKERS = [
  '[不回复]',
  '【不回复】',
  '[静默]',
  '【静默】',
];

/** 智能模式追加的提示词：允许 AI 选择不回复 */
const SMART_MODE_PROMPT =
  '群聊模式：先判断这条消息是否需要你回应。不需要回应时只输出 [不回复]，不要输出其他内容；需要回应时直接给出回复。';

/** 群聊会话首轮角色说明 */
const GROUP_FIRST_PROMPT = [
  '# 飞书群聊',
  '',
  '你正在飞书群里作为机器人参与对话，群成员的消息以「【成员名】内容」的格式发给你。',
  '你的回复会直接发送到群里，默认直接回答当前消息，保持简洁清晰；引用文件/图片时给出平台链接即可。',
].join('\n');

/** 单轮执行最长等待（超时中断并回执） */
const RUN_TIMEOUT_MS = 6 * 60 * 60 * 1000;

/** 群记录保留天数 */
const RECORD_RETENTION_DAYS = 30;

/** 群名长度上限 */
const CHAT_NAME_LIMIT = 200;

/** 进行中的一轮群会话 */
interface GroupRun {
  configId: number;
  groupId: number;
  chatId: string;
  workerId: number;
  scope: string;
  /** 本轮生效策略（决定静默标记语义） */
  policy: FeishuBotGroupPolicy;
  /** 触发本轮讨论的入站消息记录 id（用于回写处理结果） */
  recordId: number;
  incomingMessageId: string;
  reactionId: string | null;
  cards: Map<string, number>;
  pendingQuestion: McpBotQuestionGroup | null;
  settled: boolean;
  subscription?: { unsubscribe: () => void };
  timeout?: NodeJS.Timeout;
}

/** 群列表视图（管理页） */
export interface FeishuBotGroupView {
  id: number;
  chatId: string;
  name: string | null;
  /** 单群策略；null = 跟随默认 */
  policy: FeishuBotGroupPolicy | null;
  /** 实际生效策略 */
  effectivePolicy: FeishuBotGroupPolicy;
  joinedAt: string;
  leftAt: string | null;
  lastMessageAt: string | null;
  messageCount: number;
}

/** 群时间线记录视图（管理页） */
export interface FeishuBotGroupRecordView {
  id: number;
  kind: FeishuBotGroupRecordKind;
  messageId: string | null;
  senderOpenId: string | null;
  senderName: string | null;
  senderUserId: number | null;
  messageType: string | null;
  content: string | null;
  decision: FeishuBotGroupRecordDecision | null;
  error: string | null;
  createdAt: string;
}

/** 是否群策略 scope */
export function isFeishuGroupScope(scope: string): boolean {
  return scope.startsWith(FEISHU_GROUP_SCOPE_PREFIX);
}

/** 群会话 scope */
export function groupScopeOf(chatId: string): string {
  return `${FEISHU_GROUP_SCOPE_PREFIX}${chatId}`;
}

/** 实际生效策略：单群策略优先，否则跟随默认 */
export function resolveGroupPolicy(
  groupPolicy: FeishuBotGroupPolicy | null,
  defaultPolicy: FeishuBotGroupPolicy,
): FeishuBotGroupPolicy {
  return groupPolicy ?? defaultPolicy;
}

/** 是否 @ 了机器人（按机器人自身 open_id 匹配 mentions） */
export function groupBotMentioned(
  mentions: FeishuInboundMessage['mentions'],
  botOpenId: string | null,
): boolean {
  if (!botOpenId || !mentions?.length) return false;
  return mentions.some((mention) => mention.openId === botOpenId);
}

/** 智能模式静默标记：整段回复只包含标记（或为空）时不发群消息 */
export function isSilentReply(content: string): boolean {
  const text = (content ?? '').trim();
  if (!text) return true;
  return FEISHU_GROUP_SILENT_MARKERS.some(
    (marker) =>
      text === marker ||
      text.startsWith(`${marker}\n`) ||
      text.startsWith(`${marker} `),
  );
}

/** 抽取群消息文本（text/post）；其他消息类型标记为不支持 */
export function extractGroupMessageText(
  messageType: string,
  content: string,
): { text: string; supported: boolean } {
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(content || '{}') as Record<string, unknown>;
  } catch {
    payload = {};
  }
  const strip = (value: string): string =>
    value.replace(/@_user_\d+/g, '').trim();
  if (messageType === 'text') {
    return { text: strip(asString(payload.text)), supported: true };
  }
  if (messageType === 'post') {
    const segments = Array.isArray(payload.content)
      ? (payload.content as unknown[])
      : [];
    const parts: string[] = [];
    for (const paragraph of segments) {
      if (!Array.isArray(paragraph)) continue;
      for (const node of paragraph as Record<string, unknown>[]) {
        if (typeof node.text === 'string') parts.push(node.text);
      }
    }
    return { text: strip(parts.join('')), supported: true };
  }
  return { text: '', supported: false };
}

/** 发送给机器人的群消息内容：带发送者前缀，便于 AI 区分群成员 */
export function formatGroupMessageContent(
  senderName: string,
  text: string,
): string {
  return `【${senderName}】${text}`;
}

/**
 * 机器人绑定应用的外部群：
 * - 记录机器人被拉入/移出群；
 * - 按「单群策略 ?? 默认策略」处理群消息（智能回复 / 仅被 @ / 仅记录）；
 * - 复用 WorkerDebugService（scope=feishu:group:{chatId}，固定虚拟属主）实现每群共享会话；
 * - 平台自建的任务群/项目沟通群不在策略范围内。
 */
@Injectable()
export class FeishuBotGroupChatService {
  private readonly logger = new Logger(FeishuBotGroupChatService.name);
  /** 进行中的一轮群会话：configId:chatId → run */
  private readonly runs = new Map<string, GroupRun>();

  constructor(
    private readonly configs: FeishuBotConfigService,
    private readonly client: FeishuBotClientService,
    private readonly messages: FeishuBotMessageService,
    private readonly identities: FeishuBotIdentityService,
    private readonly debug: WorkerDebugService,
    @InjectRepository(FeishuBotGroup)
    private readonly groups: Repository<FeishuBotGroup>,
    @InjectRepository(FeishuBotGroupRecord)
    private readonly records: Repository<FeishuBotGroupRecord>,
    @InjectRepository(FeishuBotCard)
    private readonly cards: Repository<FeishuBotCard>,
    @InjectRepository(FeishuBotTaskChat)
    private readonly taskChats: Repository<FeishuBotTaskChat>,
    @InjectRepository(FeishuBotProjectChat)
    private readonly projectChats: Repository<FeishuBotProjectChat>,
    @InjectRepository(Worker)
    private readonly workers: Repository<Worker>,
  ) {}

  // ==== 进群 / 出群 ====

  /** 机器人被拉入群：登记群、拉取群名并记录事件 */
  async handleBotAdded(
    config: FeishuBotConfig,
    secrets: FeishuBotSecrets,
    event: Record<string, unknown>,
  ): Promise<void> {
    const chatId = asString(event.chat_id);
    if (!chatId || (await this.isSystemChat(chatId))) return;
    const group = await this.ensureGroup(config.id, chatId);
    const operator = operatorOf(event);
    const user = operator.openId
      ? await this.identities.resolve(config, operator).catch(() => null)
      : null;
    await this.refreshGroupName(config, secrets, group);
    await this.groups.update({ id: group.id }, { leftAt: null });
    await this.writeRecord({
      configId: config.id,
      groupId: group.id,
      kind: 'bot_added',
      senderOpenId: operator.openId || null,
      senderName: user?.name ?? null,
      senderUserId: user?.id ?? null,
    });
    this.logger.log(
      `机器人被拉入群：config#${config.id} chat=${chatId}（${group.name ?? '未命名'}）`,
    );
  }

  /** 机器人被移出群：记为已退出，保留群记录与策略 */
  async handleBotRemoved(
    config: FeishuBotConfig,
    event: Record<string, unknown>,
  ): Promise<void> {
    const chatId = asString(event.chat_id);
    if (!chatId || (await this.isSystemChat(chatId))) return;
    const group = await this.ensureGroup(config.id, chatId);
    const operator = operatorOf(event);
    const user = operator.openId
      ? await this.identities.resolve(config, operator).catch(() => null)
      : null;
    await this.groups.update({ id: group.id }, { leftAt: new Date() });
    await this.writeRecord({
      configId: config.id,
      groupId: group.id,
      kind: 'bot_removed',
      senderOpenId: operator.openId || null,
      senderName: user?.name ?? null,
      senderUserId: user?.id ?? null,
    });
    this.logger.log(
      `机器人被移出群：config#${config.id} chat=${chatId}（${group.name ?? '未命名'}）`,
    );
  }

  // ==== 群消息 ====

  /**
   * 处理绑定应用收到的一条外部群消息：
   * 先入库，再按策略决定是否交给 AI；平台自建群交给任务群/项目群逻辑，不在此处理。
   */
  async handleGroupMessage(
    config: FeishuBotConfig,
    secrets: FeishuBotSecrets,
    sender: FeishuSenderId,
    message: FeishuInboundMessage,
  ): Promise<void> {
    if (await this.isSystemChat(message.chatId)) return;
    const group = await this.ensureGroup(config.id, message.chatId);
    if (!group.name) await this.refreshGroupName(config, secrets, group);
    const user = await this.identities.resolve(config, sender);
    const extracted = extractGroupMessageText(
      message.messageType,
      message.content,
    );
    const record = await this.recordInbound(
      config,
      group,
      sender,
      message,
      user,
      {
        text: extracted.text,
      },
    );

    if (config.kind !== 'worker' || !config.workerId) {
      await this.markDecision(record.id, 'record_only');
      return;
    }
    if (group.leftAt) {
      await this.markDecision(record.id, 'record_only');
      return;
    }
    const worker = await this.workers.findOne({
      where: { id: config.workerId },
    });
    if (
      !worker ||
      !worker.enabled ||
      worker.runtime !== WorkerRuntime.OPENCODE
    ) {
      await this.markDecision(
        record.id,
        'error',
        '机器人不可用（未启用或非 AI 运行时）',
      );
      return;
    }

    const defaultPolicy = await this.configs.groupDefaultPolicy(config.id);
    const policy = resolveGroupPolicy(group.policy, defaultPolicy);
    if (policy === 'record') {
      await this.markDecision(record.id, 'record_only');
      return;
    }

    const runKey = `${config.id}:${message.chatId}`;
    const active = this.runs.get(runKey);

    const botOpenId = await this.ensureBotOpenId(config, secrets);
    const mentioned = groupBotMentioned(message.mentions, botOpenId);
    if (policy === 'at' && !mentioned) {
      await this.markDecision(record.id, 'not_mentioned');
      return;
    }

    // 有待回答提问时，文本优先作为答案（@ 模式仅响应对机器人的 @）
    if (active?.pendingQuestion) {
      await this.answerPendingByText(config, secrets, active, extracted.text);
      return;
    }

    if (!extracted.supported || !extracted.text) {
      if (policy === 'at' && mentioned) {
        await this.client
          .sendText(
            config.id,
            secrets,
            'chat_id',
            message.chatId,
            '群聊暂只支持文本消息；图片/文件请到平台页面处理。',
          )
          .catch(() => {});
      }
      await this.markDecision(record.id, 'record_only');
      return;
    }

    // 服务重启后遗留的待回答提问：先恢复会话再按文本作答
    if (!active) {
      const recovered = await this.recoverPendingRun(
        config,
        group,
        message.chatId,
      );
      if (recovered) {
        this.runs.set(runKey, recovered);
        await this.answerPendingByText(
          config,
          secrets,
          recovered,
          extracted.text,
        );
        this.waitForRun(recovered, secrets, runKey);
        return;
      }
    }

    if (active) {
      // 同群上一轮仍在处理：@ 模式提示稍候，智能模式静默跳过
      if (policy === 'at') {
        await this.client
          .sendText(
            config.id,
            secrets,
            'chat_id',
            message.chatId,
            '正在处理上一条消息，请稍候。',
          )
          .catch(() => {});
      }
      await this.markDecision(record.id, 'busy');
      return;
    }

    const senderName = user?.name ?? '群成员';
    const content = formatGroupMessageContent(senderName, extracted.text);
    // 仅被 @ 策略给触发消息加「敲键盘」表情；智能模式不给每条消息加回应，避免刷屏
    const reaction =
      policy === 'at'
        ? await this.client.react(
            config.id,
            secrets,
            message.messageId,
            typeof config.policy?.typingEmoji === 'string'
              ? config.policy.typingEmoji
              : TYPING_EMOJI,
          )
        : { reactionId: null };

    const run: GroupRun = {
      configId: config.id,
      groupId: group.id,
      chatId: message.chatId,
      workerId: worker.id,
      scope: groupScopeOf(message.chatId),
      policy,
      recordId: record.id,
      incomingMessageId: message.messageId,
      reactionId: reaction.reactionId,
      cards: new Map(),
      pendingQuestion: null,
      settled: false,
    };
    this.runs.set(runKey, run);

    try {
      await this.debug.send(FEISHU_GROUP_SESSION_OWNER_ID, worker.id, content, {
        scope: run.scope,
        firstPrompt: GROUP_FIRST_PROMPT,
        ...(policy === 'smart' ? { promptPrefix: SMART_MODE_PROMPT } : {}),
      });
    } catch (error) {
      this.runs.delete(runKey);
      if (reaction.reactionId) {
        await this.client.unreact(
          config.id,
          secrets,
          message.messageId,
          reaction.reactionId,
        );
      }
      const hint =
        error instanceof ConflictException
          ? '上一条消息仍在处理中，请稍候再发送。'
          : `消息处理失败：${(error as Error).message}`;
      await this.client
        .sendText(config.id, secrets, 'chat_id', message.chatId, hint)
        .catch(() => {});
      await this.markDecision(record.id, 'error', (error as Error).message);
      return;
    }
    this.waitForRun(run, secrets, runKey);
  }

  // ==== 卡片作答 ====

  /** 群内提问卡片作答：任意可解析平台账号的群成员均可提交 */
  async answerByCardButton(
    config: FeishuBotConfig,
    cardId: number,
    labels: string[],
    operatorUserId: number,
  ): Promise<{ toast: { type: 'success' | 'error'; content: string } }> {
    const card = await this.cards.findOne({ where: { id: cardId } });
    if (
      !card ||
      card.configId !== config.id ||
      !isFeishuGroupScope(card.scope)
    ) {
      return { toast: { type: 'error', content: '提问卡片不存在' } };
    }
    if (!operatorUserId) {
      return { toast: { type: 'error', content: '未识别平台账号，无法提交' } };
    }
    if (card.state !== 'pending') {
      return { toast: { type: 'success', content: '该提问已处理' } };
    }
    if (card.questions.length !== 1) {
      return {
        toast: { type: 'error', content: '多问题提问请按顺序回复文字作答' },
      };
    }
    try {
      await this.debug.replyQuestion(
        FEISHU_GROUP_SESSION_OWNER_ID,
        card.workerId,
        card.questionId,
        { answers: [labels] },
        card.scope,
      );
    } catch (error) {
      return {
        toast: {
          type: 'error',
          content: `提交失败：${(error as Error).message}`,
        },
      };
    }
    await this.cards.update({ id: card.id }, { state: 'answered' });
    const run = card.chatId
      ? this.runs.get(`${config.id}:${card.chatId}`)
      : undefined;
    if (run) run.pendingQuestion = null;
    return { toast: { type: 'success', content: '已提交' } };
  }

  // ==== 管理页查询 ====

  /** 群列表：按最近消息倒序，附带实际生效策略 */
  async listGroups(
    configId: number,
    defaultPolicy: FeishuBotGroupPolicy,
  ): Promise<FeishuBotGroupView[]> {
    const rows = await this.groups
      .createQueryBuilder('group')
      .where('group.configId = :configId', { configId })
      .orderBy('group.lastMessageAt', 'DESC', 'NULLS LAST')
      .addOrderBy('group.id', 'DESC')
      .getMany();
    return rows.map((row) => ({
      id: row.id,
      chatId: row.chatId,
      name: row.name,
      policy: row.policy,
      effectivePolicy: resolveGroupPolicy(row.policy, defaultPolicy),
      joinedAt: row.joinedAt.toISOString(),
      leftAt: row.leftAt?.toISOString() ?? null,
      lastMessageAt: row.lastMessageAt?.toISOString() ?? null,
      messageCount: row.messageCount,
    }));
  }

  /** 修改单群策略（null = 跟随默认） */
  async setGroupPolicy(
    configId: number,
    groupId: number,
    policy: FeishuBotGroupPolicy | null,
  ): Promise<void> {
    if (policy !== null && !isFeishuBotGroupPolicy(policy)) {
      throw new BadRequestException('未知的群聊答复策略');
    }
    const group = await this.groups.findOne({
      where: { id: groupId, configId },
    });
    if (!group) throw new NotFoundException('群不存在');
    await this.groups.update({ id: group.id }, { policy });
  }

  /** 群时间线记录（分页，倒序） */
  async listRecords(
    configId: number,
    groupId: number,
    page: number,
    pageSize: number,
    kind?: FeishuBotGroupRecordKind,
  ): Promise<{
    items: FeishuBotGroupRecordView[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const group = await this.groups.findOne({
      where: { id: groupId, configId },
    });
    if (!group) throw new NotFoundException('群不存在');
    const safePage = Math.max(1, Math.floor(page) || 1);
    const safeSize = Math.min(100, Math.max(1, Math.floor(pageSize) || 50));
    const where: FindOptionsWhere<FeishuBotGroupRecord> = {
      groupId: group.id,
    };
    if (kind) where.kind = kind;
    const [rows, total] = await this.records.findAndCount({
      where,
      order: { id: 'DESC' },
      skip: (safePage - 1) * safeSize,
      take: safeSize,
    });
    return {
      items: rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        messageId: row.messageId,
        senderOpenId: row.senderOpenId,
        senderName: row.senderName,
        senderUserId: row.senderUserId,
        messageType: row.messageType,
        content: row.content,
        decision: row.decision,
        error: row.error,
        createdAt: row.createdAt.toISOString(),
      })),
      total,
      page: safePage,
      pageSize: safeSize,
    };
  }

  /** 每日清理过期群记录（保留 30 天） */
  @Cron('30 4 * * *')
  async cleanupRecords(): Promise<void> {
    try {
      const cutoff = new Date(
        Date.now() - RECORD_RETENTION_DAYS * 24 * 60 * 60 * 1000,
      );
      await this.records.delete({ createdAt: LessThan(cutoff) });
    } catch (error) {
      this.logger.warn(`飞书群记录清理失败: ${(error as Error).message}`);
    }
  }

  // ==== 内部：群绑定 ====

  /** 平台自建群（任务群 / 项目沟通群）不纳入外部群策略 */
  private async isSystemChat(chatId: string): Promise<boolean> {
    const [taskCount, projectCount] = await Promise.all([
      this.taskChats.count({ where: { chatId } }),
      this.projectChats.count({ where: { chatId } }),
    ]);
    return taskCount > 0 || projectCount > 0;
  }

  /** 按 (configId, chatId) 懒创建并返回群绑定 */
  private async ensureGroup(
    configId: number,
    chatId: string,
  ): Promise<FeishuBotGroup> {
    const existing = await this.groups.findOne({ where: { configId, chatId } });
    if (existing) return existing;
    await this.groups
      .createQueryBuilder()
      .insert()
      .into(FeishuBotGroup)
      .values({
        configId,
        chatId,
        name: null,
        policy: null,
        joinedAt: new Date(),
        leftAt: null,
        lastMessageAt: null,
        messageCount: 0,
      })
      .orIgnore()
      .execute();
    const row = await this.groups.findOne({ where: { configId, chatId } });
    if (!row) throw new Error('群绑定写入失败');
    return row;
  }

  /** 补拉群名（失败仅告警，不阻断消息处理） */
  private async refreshGroupName(
    config: FeishuBotConfig,
    secrets: FeishuBotSecrets,
    group: FeishuBotGroup,
  ): Promise<void> {
    try {
      const info = await this.client.getChatInfo(
        config.id,
        secrets,
        group.chatId,
      );
      if (!info.name) return;
      const name = info.name.slice(0, CHAT_NAME_LIMIT);
      await this.groups.update({ id: group.id }, { name });
      group.name = name;
    } catch (error) {
      this.logger.warn(
        `飞书群信息读取失败（config#${config.id}, ${group.chatId}）: ${(error as Error).message}`,
      );
    }
  }

  /** 机器人自身 open_id 缺失时从 /bot/v3/info 补取并落库 */
  private async ensureBotOpenId(
    config: FeishuBotConfig,
    secrets: FeishuBotSecrets,
  ): Promise<string | null> {
    if (config.botOpenId) return config.botOpenId;
    const bot = await this.client.verify(secrets).catch(() => null);
    if (!bot?.openId) return null;
    config.botOpenId = bot.openId;
    await this.configs.saveBotOpenId(config.id, bot.openId).catch(() => {});
    return bot.openId;
  }

  // ==== 内部：记录 ====

  /** 入站消息入库并更新群统计 */
  private async recordInbound(
    config: FeishuBotConfig,
    group: FeishuBotGroup,
    sender: FeishuSenderId,
    message: FeishuInboundMessage,
    user: User | null,
    content: { text: string },
  ): Promise<FeishuBotGroupRecord> {
    const now = new Date();
    await this.groups.update({ id: group.id }, { lastMessageAt: now });
    await this.groups.increment({ id: group.id }, 'messageCount', 1);
    const saved = await this.records.save(
      this.records.create({
        configId: config.id,
        groupId: group.id,
        kind: 'message',
        messageId: message.messageId,
        senderOpenId: sender.openId || null,
        senderName: user?.name ?? null,
        senderUserId: user?.id ?? null,
        messageType: message.messageType,
        content: truncateContent(content.text),
        decision: null,
        error: null,
      }),
    );
    return saved;
  }

  /** 写入一条非消息类记录（进/出群事件、机器人回复等） */
  private async writeRecord(input: {
    configId: number;
    groupId: number;
    kind: FeishuBotGroupRecordKind;
    messageId?: string | null;
    senderOpenId?: string | null;
    senderName?: string | null;
    senderUserId?: number | null;
    messageType?: string | null;
    content?: string | null;
    decision?: FeishuBotGroupRecordDecision | null;
    error?: string | null;
  }): Promise<FeishuBotGroupRecord> {
    return this.records.save(
      this.records.create({
        configId: input.configId,
        groupId: input.groupId,
        kind: input.kind,
        messageId: input.messageId ?? null,
        senderOpenId: input.senderOpenId ?? null,
        senderName: input.senderName ?? null,
        senderUserId: input.senderUserId ?? null,
        messageType: input.messageType ?? null,
        content: truncateContent(input.content ?? null),
        decision: input.decision ?? null,
        error: input.error?.slice(0, 2000) ?? null,
      }),
    );
  }

  /** 更新入站消息的处理结果 */
  private async markDecision(
    recordId: number,
    decision: FeishuBotGroupRecordDecision,
    error?: string,
  ): Promise<void> {
    await this.records
      .update(
        { id: recordId },
        { decision, ...(error ? { error: error.slice(0, 2000) } : {}) },
      )
      .catch((updateError: Error) => {
        this.logger.warn(`飞书群记录更新失败: ${updateError.message}`);
      });
  }

  // ==== 内部：会话执行 ====

  /** 恢复服务重启前遗留的待回答卡片（按群内最近一张 pending 卡片） */
  private async recoverPendingRun(
    config: FeishuBotConfig,
    group: FeishuBotGroup,
    chatId: string,
  ): Promise<GroupRun | null> {
    const card = await this.cards.findOne({
      where: { configId: config.id, chatId, state: 'pending' },
      order: { id: 'DESC' },
    });
    if (!card || !isFeishuGroupScope(card.scope)) return null;
    const defaultPolicy = await this.configs.groupDefaultPolicy(config.id);
    return {
      configId: config.id,
      groupId: group.id,
      chatId,
      workerId: card.workerId,
      scope: card.scope,
      policy: resolveGroupPolicy(group.policy, defaultPolicy),
      recordId: 0,
      incomingMessageId: '',
      reactionId: null,
      cards: new Map([[card.questionId, card.id]]),
      pendingQuestion: {
        id: card.questionId,
        questions: card.questions.map((question) => ({
          question: question.question,
          header: question.header || question.question,
          ...(question.options?.length
            ? {
                options: question.options.map((option) => ({
                  label: option.label,
                  ...(option.description
                    ? { description: option.description }
                    : {}),
                })),
              }
            : {}),
          ...(question.multiple ? { multiple: true } : {}),
          custom: question.custom !== false,
        })),
      },
      settled: false,
    };
  }

  /** 文本作答：跳过 / 单问题映射 / 多问题按行映射 */
  private async answerPendingByText(
    config: FeishuBotConfig,
    secrets: FeishuBotSecrets,
    run: GroupRun,
    text: string,
  ): Promise<void> {
    const question = run.pendingQuestion;
    if (!question) return;
    const cardId = run.cards.get(question.id);
    const card = cardId
      ? await this.cards.findOne({ where: { id: cardId } })
      : null;
    if (!card || card.state !== 'pending') {
      run.pendingQuestion = null;
      return;
    }
    const normalized = text.trim();
    if (!normalized) {
      await this.client
        .sendText(
          config.id,
          secrets,
          'chat_id',
          run.chatId,
          '请输入答案，或回复「跳过」跳过提问。',
        )
        .catch(() => {});
      return;
    }
    try {
      if (normalized === '跳过') {
        await this.debug.replyQuestion(
          FEISHU_GROUP_SESSION_OWNER_ID,
          run.workerId,
          question.id,
          { reject: true },
          run.scope,
        );
        await this.cards.update({ id: card.id }, { state: 'rejected' });
        run.pendingQuestion = null;
        return;
      }
      const questions = card.questions;
      let answers: string[][] | null = null;
      if (questions.length === 1) {
        const mapped = mapTextAnswer(normalized, questions[0]);
        if (!mapped) {
          await this.client
            .sendText(
              config.id,
              secrets,
              'chat_id',
              run.chatId,
              '无法识别答案，请点击卡片选项，或直接输入有效内容；回复「跳过」可跳过。',
            )
            .catch(() => {});
          return;
        }
        answers = [mapped];
      } else {
        const lines = normalized
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
        if (lines.length !== questions.length) {
          await this.client
            .sendText(
              config.id,
              secrets,
              'chat_id',
              run.chatId,
              `该组提问共 ${questions.length} 个问题，请按顺序每行一个答案回复。`,
            )
            .catch(() => {});
          return;
        }
        const mappedLines: string[][] = [];
        for (const [index, line] of lines.entries()) {
          const mapped = mapTextAnswer(line, questions[index]);
          if (!mapped) {
            await this.client
              .sendText(
                config.id,
                secrets,
                'chat_id',
                run.chatId,
                `第 ${index + 1} 行无法识别为有效答案，请调整后重新回复。`,
              )
              .catch(() => {});
            return;
          }
          mappedLines.push(mapped);
        }
        answers = mappedLines;
      }
      await this.debug.replyQuestion(
        FEISHU_GROUP_SESSION_OWNER_ID,
        run.workerId,
        question.id,
        { answers },
        run.scope,
      );
      await this.cards.update({ id: card.id }, { state: 'answered' });
      run.pendingQuestion = null;
    } catch (error) {
      await this.client
        .sendText(
          config.id,
          secrets,
          'chat_id',
          run.chatId,
          `提交答案失败：${(error as Error).message}`,
        )
        .catch(() => {});
    }
  }

  /**
   * 订阅会话快照等待本轮终态：
   * - 出现待回答提问 → 发飞书卡片并保持等待；
   * - 完成/出错 → 静默标记判断后回执群消息；
   * - 超时（有待回答提问则不中断，只结束本进程内的等待）。
   */
  private waitForRun(
    run: GroupRun,
    secrets: FeishuBotSecrets,
    runKey: string,
  ): void {
    const state = initialRunState();
    const sentQuestionIds = new Set<string>();
    const subscription = this.debug
      .stream(FEISHU_GROUP_SESSION_OWNER_ID, run.workerId, run.scope)
      .subscribe({
        next: ({ data }: { data: DebugStreamPayload }) => {
          if (run.settled || data.type !== 'snapshot' || !data.snapshot) return;
          const snapshot = data.snapshot;
          const questions = pendingQuestionsOf(snapshot.messages);
          if (questions.length > 0) {
            void this.ensureQuestionCards(
              run,
              secrets,
              questions,
              sentQuestionIds,
            );
            run.pendingQuestion = questions[0];
            state.textLen = currentRunText(snapshot).length;
            return;
          }
          if (run.pendingQuestion) run.pendingQuestion = null;
          const step = diffRunProgress(state, snapshot);
          // 群聊不逐条回传过程文本，只等终态（过程可在平台网页查看）
          void step;
          if (snapshot.status === 'idle') {
            const settled = settleRunResult(snapshot);
            if (settled && settled.status !== 'question') {
              this.finishRun(
                run,
                secrets,
                runKey,
                settled.content,
                settled.error,
              );
            }
          }
        },
        error: (error: Error) =>
          this.finishRun(run, secrets, runKey, '', error.message),
      });

    const timeout = setTimeout(() => {
      if (run.settled) return;
      if (run.pendingQuestion) {
        this.cleanup(run, runKey, subscription);
        return;
      }
      this.debug
        .interrupt(FEISHU_GROUP_SESSION_OWNER_ID, run.workerId, run.scope)
        .then((snapshot) => {
          const artifacts = interruptedResultFrom(snapshot);
          this.finishRun(
            run,
            secrets,
            runKey,
            artifacts.content,
            '回复超时已中断',
          );
        })
        .catch(() =>
          this.finishRun(run, secrets, runKey, '', '回复超时且中断失败'),
        );
    }, RUN_TIMEOUT_MS);
    timeout.unref?.();
    run.subscription = subscription;
    run.timeout = timeout;
  }

  /** 出现新的待回答提问时补发卡片（幂等） */
  private async ensureQuestionCards(
    run: GroupRun,
    secrets: FeishuBotSecrets,
    groups: McpBotQuestionGroup[],
    sentQuestionIds: Set<string>,
  ): Promise<void> {
    for (const group of groups) {
      if (sentQuestionIds.has(group.id)) continue;
      sentQuestionIds.add(group.id);
      const questions: FeishuBotCardQuestion[] = group.questions.map((q) => ({
        question: q.question,
        ...(q.header ? { header: q.header } : {}),
        ...(q.options?.length
          ? { options: q.options.map((o) => ({ label: o.label })) }
          : {}),
        ...(q.multiple ? { multiple: true } : {}),
        custom: q.custom !== false,
      }));
      const card = await this.cards.save(
        this.cards.create({
          configId: run.configId,
          userId: FEISHU_GROUP_SESSION_OWNER_ID,
          workerId: run.workerId,
          scope: run.scope,
          chatId: run.chatId,
          questionId: group.id,
          state: 'pending',
          questions,
        }),
      );
      try {
        const result = await this.messages.sendQuestionCard(
          run.configId,
          secrets,
          'chat_id',
          run.chatId,
          card.id,
          group.id,
          questions,
        );
        await this.cards.update(
          { id: card.id },
          { messageId: result.messageId },
        );
      } catch (error) {
        await this.cards.update({ id: card.id }, { state: 'expired' });
        this.logger.warn(
          `飞书群提问卡片发送失败（chat=${run.chatId}）: ${(error as Error).message}`,
        );
        continue;
      }
      run.cards.set(group.id, card.id);
    }
  }

  /** 本轮终态：智能模式静默标记不外发；其余发送 Markdown 回执并记录 */
  private finishRun(
    run: GroupRun,
    secrets: FeishuBotSecrets,
    runKey: string,
    content: string,
    error?: string,
  ): void {
    if (run.settled) return;
    run.settled = true;
    this.cleanup(run, runKey);
    void (async () => {
      if (run.reactionId) {
        await this.client.unreact(
          run.configId,
          secrets,
          run.incomingMessageId,
          run.reactionId,
        );
      }
      // 智能模式且无错误、回复仅为静默标记：不发群消息，记为 AI 静默
      if (!error && run.policy === 'smart' && isSilentReply(content)) {
        if (run.recordId) {
          await this.markDecision(run.recordId, 'silent');
        }
        return;
      }
      const body = error
        ? `${content ? `${content}\n\n` : ''}⚠️ ${error}`
        : content || '（本轮没有产生回复）';
      try {
        await this.messages.sendMarkdown(
          run.configId,
          secrets,
          'chat_id',
          run.chatId,
          body,
        );
      } catch (cardError) {
        // 卡片失败降级为纯文本
        await this.client
          .sendText(
            run.configId,
            secrets,
            'chat_id',
            run.chatId,
            body.slice(0, 3000),
          )
          .catch(() => {});
        this.logger.warn(
          `飞书群回复卡片发送失败（已降级文本）: ${(cardError as Error).message}`,
        );
      }
      if (run.recordId) {
        await this.markDecision(
          run.recordId,
          error ? 'error' : 'replied',
          error,
        );
      }
      await this.writeRecord({
        configId: run.configId,
        groupId: run.groupId,
        kind: 'reply',
        content: body,
        error,
      }).catch((recordError: Error) => {
        this.logger.warn(`飞书群回复记录写入失败: ${recordError.message}`);
      });
    })();
  }

  /** 退订流与定时器，并从运行表移除 */
  private cleanup(
    run: GroupRun,
    runKey: string,
    subscription?: { unsubscribe: () => void },
  ): void {
    (subscription ?? run.subscription)?.unsubscribe();
    if (run.timeout) clearTimeout(run.timeout);
    this.runs.delete(runKey);
  }
}

/** 消息字段安全转字符串（仅接受 string，避免对象被模板字符串意外序列化） */
function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** 事件中的操作者 open_id/union_id */
function operatorOf(event: Record<string, unknown>): FeishuSenderId {
  const operator = (event.operator_id ?? {}) as Record<string, unknown>;
  return {
    openId: asString(operator.open_id),
    unionId: asString(operator.union_id) || null,
  };
}

/** 记录内容截断 */
function truncateContent(content: string | null): string | null {
  if (!content) return null;
  return content.length > FEISHU_BOT_GROUP_RECORD_CONTENT_LIMIT
    ? content.slice(0, FEISHU_BOT_GROUP_RECORD_CONTENT_LIMIT)
    : content;
}
