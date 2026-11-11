import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron } from '@nestjs/schedule';
import { mkdir, writeFile } from 'fs/promises';
import { dirname } from 'path';
import { FindOptionsWhere, In, LessThan, Repository } from 'typeorm';
import type { User } from '../auth/user.entity';
import { WorkerRuntime } from '../common/enums';
import { fileWebroot } from '../common/paths';
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
  FEISHU_BOT_FEEDBACK_GROUP_POLICY,
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
  FeishuBotFeedbackService,
  type CollectedTopicFeedback,
} from './feishu-bot-feedback.service';
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
import {
  FeishuBotClientService,
  feishuAttachmentPath,
  type FeishuHistoryMessage,
} from './feishu-bot-client.service';

/** 群会话 scope 前缀（scope = feishu:group:{chatId}，话题消息追加 :t:{threadId}） */
export const FEISHU_GROUP_SCOPE_PREFIX = 'feishu:group:';

/** 群会话固定虚拟属主：负数，与真人调试会话隔离 */
export const FEISHU_GROUP_SESSION_OWNER_ID = -1;

/** 话题会话 scope 分隔标记（feishu:group:{chatId}:t:{threadId}） */
const GROUP_SCOPE_THREAD_MARKER = ':t:';

/** 拼接上文时最多引用的历史消息条数 */
const HISTORY_LIMIT = 20;

/** 上文单条消息的字符上限 */
const HISTORY_ITEM_LIMIT = 500;

/** 智能模式批量窗口：首条消息后最多等待（毫秒） */
const SMART_BATCH_WINDOW_MS = 5_000;

/** 智能模式单批最大消息条数（达到立即处理） */
export const SMART_BATCH_MAX_MESSAGES = 10;

/** 智能模式批量消息单条字符上限 */
const SMART_BATCH_ITEM_LIMIT = 2_000;

/** 同群上一轮未结束时的批量重试间隔（毫秒） */
const SMART_BATCH_RETRY_MS = 2_000;

/** 可进入智能模式批次的消息类型（非文本给占位/图片带地址） */
const SMART_BATCH_MEDIA_TYPES = new Set([
  'image',
  'file',
  'media',
  'audio',
  'sticker',
  'interactive',
  'share_chat',
  'share_user',
]);

/** 智能模式下「无需回复」标记（AI 只输出该标记时不发群消息） */
export const FEISHU_GROUP_SILENT_MARKERS = [
  '[不回复]',
  '【不回复】',
  '[静默]',
  '【静默】',
];

/** 智能模式追加的提示词：允许 AI 选择不回复 */
const SMART_MODE_PROMPT =
  '群聊模式：先判断这批消息是否需要你回应。不需要回应时只输出 [不回复]，不要输出其他内容；需要回应时按下方回复方式输出。';

/** 反馈采集模式追加的提示词：收录由平台完成，AI 只判断分发 */
const FEEDBACK_MODE_PROMPT =
  '反馈采集模式：这批消息已由平台自动收录进对应反馈，你只需判断是否需要分发动作或回复。' +
  '无需任何动作与回复时只输出 [不回复]，不要输出其他内容；需要回应时按下方回复方式输出。';

/** 群聊会话首轮上下文：通道、场景（群聊/话题）、群与回复方式 */
export function buildGroupFirstPrompt(input: {
  chatName: string | null;
  chatId: string;
  threadId: string | null;
  policy: FeishuBotGroupPolicy;
}): string {
  const scene = input.threadId
    ? `群聊话题（话题 ID：${input.threadId}）`
    : '群聊';
  const policyLabel =
    input.policy === 'smart'
      ? '智能反馈（批量接收消息，可选择回复或不回复）'
      : input.policy === 'at'
        ? '仅被 @ 后反馈'
        : input.policy === 'feedback'
          ? '反馈采集（一个话题一条反馈，消息由平台自动收录，你判断分发）'
          : '仅记录';
  const chat = input.chatName
    ? `${input.chatName}（chat_id：${input.chatId}）`
    : `chat_id：${input.chatId}`;
  const replyRules =
    input.policy === 'smart' || input.policy === 'feedback'
      ? [
          '# 回复方式',
          '',
          '消息会按批次提供，每条格式为「[发送者|消息ID] 内容」，多条之间用 --- 分隔。',
          '需要回复某条消息时，用一行「>>> 消息ID」开始该条回复，之后的内容会发送到对应消息（可多行）；',
          '没有 >>> 标记的内容作为普通回复发送到群里；',
          '不需要回复任何消息时，只输出 [不回复]，不要输出其他内容。',
          '引用文件/图片时给出平台链接即可。',
        ]
      : [
          '# 回复方式',
          '',
          '群成员 @ 你时才会收到消息，消息格式为「【成员名】内容」。',
          '你的回复会直接发送到群里，话题内会落回原话题；引用文件/图片时给出平台链接即可。',
        ];
  return [
    '# 飞书群聊上下文',
    '',
    '- 通道：飞书',
    `- 场景：${scene}`,
    `- 群：${chat}`,
    `- 策略：${policyLabel}`,
    '',
    ...replyRules,
  ].join('\n');
}

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
  /** 入站消息所属话题 id（非话题消息为 null） */
  threadId: string | null;
  /** 回执回复目标消息 id（话题/引用消息为触发消息，普通消息为 null=群发） */
  replyToMessageId: string | null;
  /** 本轮生效策略（决定静默标记语义） */
  policy: FeishuBotGroupPolicy;
  /** 触发本轮讨论的入站消息记录 id（用于回写处理结果） */
  recordId: number;
  /** 智能模式批次包含的入站记录 id（at 模式为空） */
  recordIds?: number[];
  incomingMessageId: string;
  reactionId: string | null;
  cards: Map<string, number>;
  pendingQuestion: McpBotQuestionGroup | null;
  settled: boolean;
  subscription?: { unsubscribe: () => void };
  timeout?: NodeJS.Timeout;
}

/** 智能模式缓冲中的一条群消息 */
interface PendingGroupMessage {
  recordId: number;
  messageId: string;
  messageType: string;
  content: string;
  /** 抽取出的文本（非文本消息为空） */
  text: string;
  senderName: string;
  replyToMessageId: string | null;
}

/** 智能/反馈模式待处理批次（按群 + 话题缓冲） */
interface GroupBatch {
  config: FeishuBotConfig;
  secrets: FeishuBotSecrets;
  group: FeishuBotGroup;
  chatId: string;
  threadId: string | null;
  scope: string;
  /** 批次生效策略（决定投递提示词与静默语义） */
  policy: FeishuBotGroupPolicy;
  /** 反馈采集批次对应的平台反馈 ID（智能批次为 null） */
  feedbackId: number | null;
  messages: PendingGroupMessage[];
  timer: NodeJS.Timeout | null;
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
  /** 话题 id（thread_id）；非话题消息为空 */
  threadId: string | null;
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

/**
 * 群会话 scope：话题消息按话题隔离，避免不同话题的上下文互相污染；
 * 普通消息保持群级共享会话。
 */
export function groupScopeOf(chatId: string, threadId?: string | null): string {
  const base = `${FEISHU_GROUP_SCOPE_PREFIX}${chatId}`;
  return threadId ? `${base}${GROUP_SCOPE_THREAD_MARKER}${threadId}` : base;
}

/** 从话题群会话 scope 解析话题 id（普通群会话返回 null） */
export function threadIdOfGroupScope(scope: string): string | null {
  const index = scope.lastIndexOf(GROUP_SCOPE_THREAD_MARKER);
  return index >= 0
    ? scope.slice(index + GROUP_SCOPE_THREAD_MARKER.length)
    : null;
}

/**
 * 机器人回执的回复目标：话题消息 / 引用回复消息回给触发消息本身
 * （飞书会自动落入该消息所在话题），普通消息返回 null 走群发。
 */
export function replyTargetOf(message: FeishuInboundMessage): string | null {
  if (message.threadId || message.rootId || message.parentId) {
    return message.messageId;
  }
  return null;
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

/** 历史单条消息转可读文本：片段截断，非文本类型给占位 */
export function historyMessageText(
  messageType: string,
  content: string,
): string {
  const extracted = extractGroupMessageText(messageType, content);
  if (extracted.supported) {
    return extracted.text.slice(0, HISTORY_ITEM_LIMIT);
  }
  switch (messageType) {
    case 'image':
      return '[图片]';
    case 'file':
      return '[文件]';
    case 'media':
      return '[视频]';
    case 'audio':
      return '[语音]';
    case 'sticker':
      return '[表情]';
    case 'interactive':
      return '[卡片]';
    case 'share_chat':
      return '[群名片]';
    case 'share_user':
      return '[个人名片]';
    default:
      return messageType ? `[${messageType}]` : '';
  }
}

/**
 * 历史消息提示词：标题区分话题/群聊，把最近消息拼在触发消息前，
 * 让「仅被 @」策略下的机器人也能理解上下文；无历史返回空串。
 */
export function formatHistoryPrompt(
  title: string,
  entries: { senderName: string; text: string }[],
): string {
  if (entries.length === 0) return '';
  const lines = entries.map((entry) => `${entry.senderName}：${entry.text}`);
  return [title, ...lines, '【当前消息】'].join('\n');
}

/**
 * 只保留机器人最后一次回复之后的消息，避免与已有会话上下文重复；
 * 机器人从未回复时保留全部（首次触发需要尽量多的前文）。
 */
export function historySinceBotReply(
  rows: FeishuHistoryMessage[],
  appId: string,
): FeishuHistoryMessage[] {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (row.senderType === 'app' && row.senderOpenId === appId) {
      return rows.slice(index + 1);
    }
  }
  return rows;
}

/** 一条智能模式回复：targetMessageId 为空表示普通回复 */
export interface BatchReplySegment {
  targetMessageId: string | null;
  content: string;
}

/**
 * 解析智能模式批量回复：
 * - 行首「>>> om_xxx」开启一条定向回复（同一行后续内容也算该条回复）；
 * - 没有标记的内容作为普通回复段；
 * - 空段丢弃。
 */
export function parseBatchReplySegments(content: string): BatchReplySegment[] {
  const lines = (content ?? '').split(/\r?\n/);
  const segments: BatchReplySegment[] = [];
  let target: string | null = null;
  let buffer: string[] = [];
  const push = (): void => {
    const text = buffer.join('\n').trim();
    if (text) segments.push({ targetMessageId: target, content: text });
    buffer = [];
  };
  for (const line of lines) {
    const match = /^\s*>>>\s*(om_[A-Za-z0-9_-]+)\s*(.*)$/.exec(line);
    if (match) {
      push();
      target = match[1];
      if (match[2].trim()) buffer.push(match[2]);
      continue;
    }
    buffer.push(line);
  }
  push();
  return segments;
}

/**
 * 机器人绑定应用的外部群：
 * - 记录机器人被拉入/移出群；
 * - 按「单群策略 ?? 默认策略」处理群消息（智能回复 / 仅被 @ / 仅记录）；
 * - 复用 WorkerDebugService（scope=feishu:group:{chatId}，话题消息追加 :t:{threadId}，
 *   固定虚拟属主）实现每群/每话题会话；
 * - 话题消息回执走 reply 接口落回原话题，仅被 @ 策略触发时补拉话题/群聊上文；
 * - 平台自建的任务群/项目沟通群不在策略范围内。
 */
@Injectable()
export class FeishuBotGroupChatService {
  private readonly logger = new Logger(FeishuBotGroupChatService.name);
  /** 进行中的一轮群会话：configId:chatId → run */
  private readonly runs = new Map<string, GroupRun>();
  /** 智能模式缓冲：configId:chatId:threadId → batch */
  private readonly batches = new Map<string, GroupBatch>();
  /** 正在构建批次的群（避免同群并发 flush） */
  private readonly flushingChats = new Set<string>();

  constructor(
    private readonly configs: FeishuBotConfigService,
    private readonly client: FeishuBotClientService,
    private readonly messages: FeishuBotMessageService,
    private readonly identities: FeishuBotIdentityService,
    private readonly feedback: FeishuBotFeedbackService,
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
    const threadId = message.threadId?.trim() || null;
    const replyToMessageId = replyTargetOf(message);
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

    // 反馈采集模式：话题消息先由平台确定性收录（首帖建反馈并回执编号），再按批次交给机器人
    if (policy === 'feedback') {
      await this.handleFeedbackMessage(
        config,
        secrets,
        group,
        sender,
        message,
        threadId,
        replyToMessageId,
        user,
        extracted,
        record,
      );
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

    // 有待回答提问时，文本优先作为答案（仅限同一话题；@ 模式仅响应对机器人的 @）
    if (active?.pendingQuestion && active.threadId === threadId) {
      await this.answerPendingByText(
        config,
        secrets,
        active,
        extracted.text,
        replyToMessageId,
      );
      return;
    }

    // 智能模式：消息进入批量缓冲，按时间片/条数统一处理（不再 busy 丢弃）
    if (policy === 'smart') {
      await this.enqueueSmartMessage(
        config,
        secrets,
        group,
        message,
        threadId,
        replyToMessageId,
        user,
        extracted,
        record,
      );
      return;
    }

    if (!extracted.supported || !extracted.text) {
      if (policy === 'at' && mentioned) {
        await this.sendTextTo(
          config.id,
          secrets,
          message.chatId,
          replyToMessageId,
          '群聊暂只支持文本消息；图片/文件请到平台页面处理。',
        );
      }
      await this.markDecision(record.id, 'record_only');
      return;
    }

    // 服务重启后遗留的待回答提问：先恢复会话再按文本作答（须在同一话题内）
    if (!active) {
      const recovered = await this.recoverPendingRun(
        config,
        group,
        message.chatId,
        threadId,
      );
      if (recovered) {
        this.runs.set(runKey, recovered);
        if (recovered.threadId === threadId) {
          await this.answerPendingByText(
            config,
            secrets,
            recovered,
            extracted.text,
            replyToMessageId,
          );
          this.waitForRun(recovered, secrets, runKey);
          return;
        }
        if (policy === 'at') {
          await this.sendTextTo(
            config.id,
            secrets,
            message.chatId,
            replyToMessageId,
            '请先在原话题中回答待处理提问。',
          );
        }
        await this.markDecision(record.id, 'busy');
        return;
      }
    }

    if (active) {
      // 同群上一轮仍在处理：@ 模式提示稍候，智能模式静默跳过
      if (policy === 'at') {
        await this.sendTextTo(
          config.id,
          secrets,
          message.chatId,
          replyToMessageId,
          '正在处理上一条消息，请稍候。',
        );
      }
      await this.markDecision(record.id, 'busy');
      return;
    }

    const senderName = user?.name ?? '群成员';
    let content = formatGroupMessageContent(senderName, extracted.text);
    // 仅被 @ 策略下未 @ 的消息不会进入会话：话题拉话题上文，普通群拉群聊上文
    if (policy === 'at') {
      const history = await this.historyPrompt(
        config,
        secrets,
        message.chatId,
        threadId,
        message.messageId,
      );
      if (history) content = `${history}\n${content}`;
    }
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
      scope: groupScopeOf(message.chatId, threadId),
      threadId,
      replyToMessageId,
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
        firstPrompt: buildGroupFirstPrompt({
          chatName: group.name,
          chatId: message.chatId,
          threadId,
          policy,
        }),
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
      await this.sendTextTo(
        config.id,
        secrets,
        message.chatId,
        replyToMessageId,
        hint,
      );
      await this.markDecision(record.id, 'error', (error as Error).message);
      return;
    }
    this.waitForRun(run, secrets, runKey);
  }

  // ==== 反馈采集模式 ====

  /**
   * 处理反馈采集群的一条消息：
   * - 非话题消息仅记录，不收录；
   * - 话题消息先由平台收录（首帖创建反馈并在话题内回执编号；后续消息写跟帖）；
   * - 收录成功后进入批次：首帖立即 flush 唤起分发判断，跟帖按窗口汇总。
   */
  private async handleFeedbackMessage(
    config: FeishuBotConfig,
    secrets: FeishuBotSecrets,
    group: FeishuBotGroup,
    sender: FeishuSenderId,
    message: FeishuInboundMessage,
    threadId: string | null,
    replyToMessageId: string | null,
    user: User | null,
    extracted: { text: string; supported: boolean },
    record: FeishuBotGroupRecord,
  ): Promise<void> {
    if (!threadId) {
      await this.markDecision(record.id, 'record_only');
      return;
    }
    let collected: CollectedTopicFeedback;
    try {
      collected = await this.feedback.collect({
        config,
        secrets,
        group,
        message,
        threadId,
        user,
        senderOpenId: sender.openId || null,
        text: extracted.text,
      });
    } catch (error) {
      await this.markDecision(record.id, 'error', (error as Error).message);
      return;
    }
    if (collected.duplicated) {
      // 事件重复投递：消息已收录过，不再唤起机器人
      await this.markDecision(record.id, 'record_only');
      return;
    }
    if (collected.isNew) {
      const receipt = this.feedback.receiptText(collected.feedback);
      await this.sendTextTo(
        config.id,
        secrets,
        message.chatId,
        replyToMessageId,
        receipt,
      );
      await this.writeRecord({
        configId: config.id,
        groupId: group.id,
        kind: 'reply',
        threadId,
        content: receipt,
      }).catch(() => {});
    }
    // 话题内有待回答提问时，文本优先作为答案（与智能模式一致）
    const active = this.runs.get(`${config.id}:${message.chatId}`);
    if (active?.pendingQuestion && active.threadId === threadId) {
      await this.answerPendingByText(
        config,
        secrets,
        active,
        extracted.text,
        replyToMessageId,
      );
      return;
    }
    await this.enqueueSmartMessage(
      config,
      secrets,
      group,
      message,
      threadId,
      replyToMessageId,
      user,
      extracted,
      record,
      {
        policy: 'feedback',
        feedbackId: collected.feedback.id,
        flushNow: collected.isNew,
      },
    );
  }

  // ==== 智能模式批量缓冲 ====

  /** 智能/反馈模式入队：文本/媒体进入批次，按 5 秒窗口或 10 条上限触发处理；反馈首帖立即 flush */
  private async enqueueSmartMessage(
    config: FeishuBotConfig,
    secrets: FeishuBotSecrets,
    group: FeishuBotGroup,
    message: FeishuInboundMessage,
    threadId: string | null,
    replyToMessageId: string | null,
    user: User | null,
    extracted: { text: string; supported: boolean },
    record: FeishuBotGroupRecord,
    options?: {
      /** 批次策略：默认 smart；反馈采集群传 feedback */
      policy?: FeishuBotGroupPolicy;
      /** 反馈采集批次对应的反馈 ID */
      feedbackId?: number;
      /** 立即 flush（反馈首帖：收录后马上唤起分发判断，不等窗口） */
      flushNow?: boolean;
    },
  ): Promise<void> {
    const policy = options?.policy ?? 'smart';
    const isFeedback = policy === 'feedback';
    if (
      !isFeedback &&
      !extracted.supported &&
      !SMART_BATCH_MEDIA_TYPES.has(message.messageType)
    ) {
      await this.markDecision(record.id, 'record_only');
      return;
    }
    if (!isFeedback && message.messageType === 'text' && !extracted.text) {
      await this.markDecision(record.id, 'record_only');
      return;
    }
    if (isFeedback && message.messageType === 'text' && !extracted.text) {
      // 反馈群空文本消息已被平台收录，无需再唤起机器人
      await this.markDecision(record.id, 'record_only');
      return;
    }
    const key = batchKeyOf(config.id, message.chatId, threadId);
    let batch = this.batches.get(key);
    if (!batch) {
      batch = {
        config,
        secrets,
        group,
        chatId: message.chatId,
        threadId,
        scope: groupScopeOf(message.chatId, threadId),
        policy,
        feedbackId: options?.feedbackId ?? null,
        messages: [],
        timer: null,
      };
      this.batches.set(key, batch);
    }
    if (options?.feedbackId !== undefined) {
      batch.feedbackId = options.feedbackId;
    }
    batch.messages.push({
      recordId: record.id,
      messageId: message.messageId,
      messageType: message.messageType,
      content: message.content,
      text: extracted.supported ? extracted.text : '',
      senderName: user?.name ?? '群成员',
      replyToMessageId,
    });
    if (
      options?.flushNow ||
      batch.messages.length >= SMART_BATCH_MAX_MESSAGES
    ) {
      this.clearBatchTimer(batch);
      await this.flushBatch(key);
      return;
    }
    this.scheduleBatchFlush(key, batch, SMART_BATCH_WINDOW_MS);
  }

  /** 定时触发批次处理（已有定时器时不重复设置） */
  private scheduleBatchFlush(
    key: string,
    batch: GroupBatch,
    delay: number,
  ): void {
    if (batch.timer) return;
    batch.timer = setTimeout(() => {
      batch.timer = null;
      void this.flushBatch(key);
    }, delay);
    batch.timer.unref?.();
  }

  private clearBatchTimer(batch: GroupBatch): void {
    if (!batch.timer) return;
    clearTimeout(batch.timer);
    batch.timer = null;
  }

  /**
   * 处理一个批次：同群有运行中的轮次时等待（结束后会再次触发），
   * 否则把批次消息拼成一条提示词投递给执行器。
   */
  private async flushBatch(key: string): Promise<void> {
    const batch = this.batches.get(key);
    if (!batch || batch.messages.length === 0) {
      this.batches.delete(key);
      return;
    }
    const runKey = `${batch.config.id}:${batch.chatId}`;
    if (this.runs.has(runKey) || this.flushingChats.has(runKey)) {
      this.clearBatchTimer(batch);
      this.scheduleBatchFlush(key, batch, SMART_BATCH_RETRY_MS);
      return;
    }
    this.flushingChats.add(runKey);
    this.clearBatchTimer(batch);
    const messages = batch.messages.splice(0, batch.messages.length);
    this.batches.delete(key);
    try {
      const worker = await this.workers.findOne({
        where: { id: batch.config.workerId ?? 0 },
      });
      if (
        !worker ||
        !worker.enabled ||
        worker.runtime !== WorkerRuntime.OPENCODE
      ) {
        for (const item of messages) {
          await this.markDecision(
            item.recordId,
            'error',
            '机器人不可用（未启用或非 AI 运行时）',
          );
        }
        return;
      }
      const content = await this.buildBatchPrompt(batch, messages);
      if (!content) {
        for (const item of messages) {
          await this.markDecision(item.recordId, 'record_only');
        }
        return;
      }
      const last = messages[messages.length - 1];
      const run: GroupRun = {
        configId: batch.config.id,
        groupId: batch.group.id,
        chatId: batch.chatId,
        workerId: worker.id,
        scope: batch.scope,
        threadId: batch.threadId,
        replyToMessageId: last.replyToMessageId,
        policy: batch.policy,
        recordId: 0,
        recordIds: messages.map((item) => item.recordId),
        incomingMessageId: last.messageId,
        reactionId: null,
        cards: new Map(),
        pendingQuestion: null,
        settled: false,
      };
      this.runs.set(runKey, run);
      try {
        await this.debug.send(
          FEISHU_GROUP_SESSION_OWNER_ID,
          worker.id,
          content,
          {
            scope: run.scope,
            firstPrompt: buildGroupFirstPrompt({
              chatName: batch.group.name,
              chatId: batch.chatId,
              threadId: batch.threadId,
              policy: batch.policy,
            }),
            promptPrefix:
              batch.policy === 'feedback'
                ? FEEDBACK_MODE_PROMPT
                : SMART_MODE_PROMPT,
          },
        );
      } catch (error) {
        this.runs.delete(runKey);
        for (const item of messages) {
          await this.markDecision(
            item.recordId,
            'error',
            (error as Error).message,
          );
        }
        await this.sendTextTo(
          batch.config.id,
          batch.secrets,
          batch.chatId,
          last.replyToMessageId,
          error instanceof ConflictException
            ? '上一条消息仍在处理中，请稍候再发送。'
            : `消息处理失败：${(error as Error).message}`,
        );
        return;
      }
      this.waitForRun(run, batch.secrets, runKey);
    } catch (error) {
      for (const item of messages) {
        await this.markDecision(
          item.recordId,
          'error',
          (error as Error).message,
        ).catch(() => {});
      }
      this.logger.warn(
        `飞书群批量消息处理失败（chat=${batch.chatId}）: ${(error as Error).message}`,
      );
    } finally {
      this.flushingChats.delete(runKey);
    }
  }

  /** 批次消息拼成提示词：[发送者|消息ID] 内容，多条用 --- 分隔；反馈批次头部标注对应反馈 */
  private async buildBatchPrompt(
    batch: GroupBatch,
    messages: PendingGroupMessage[],
  ): Promise<string> {
    const lines: string[] = [];
    for (const item of messages) {
      const text = await this.batchMessageText(batch, item);
      if (!text) continue;
      lines.push(`[${item.senderName}|${item.messageId}] ${text}`);
    }
    const body = lines.join('\n---\n');
    if (batch.feedbackId !== null) {
      return [
        `【反馈 #${batch.feedbackId}】本话题消息已由平台自动收录进该反馈（首帖为正文、后续为跟帖），请判断是否需要分发动作或回复。`,
        '',
        body,
      ].join('\n');
    }
    return body;
  }

  /** 单条批次消息文本：文本压缩成单行，图片转存后给 HTTP 地址，其余给占位 */
  private async batchMessageText(
    batch: GroupBatch,
    item: PendingGroupMessage,
  ): Promise<string> {
    const text = item.text.trim();
    if (text) {
      return text.replace(/\s*\r?\n\s*/g, ' ').slice(0, SMART_BATCH_ITEM_LIMIT);
    }
    if (item.messageType === 'image') {
      const url = await this.imageUrlOf(
        batch.config,
        batch.secrets,
        item,
      ).catch(() => null);
      return url ? `[图片] ${url}` : '[图片]';
    }
    return historyMessageText(item.messageType, item.content);
  }

  /** 下载批次中的图片并转存平台附件目录，返回公开 HTTP 地址 */
  private async imageUrlOf(
    config: FeishuBotConfig,
    secrets: FeishuBotSecrets,
    item: PendingGroupMessage,
  ): Promise<string | null> {
    let imageKey = '';
    try {
      const payload = JSON.parse(item.content || '{}') as Record<
        string,
        unknown
      >;
      imageKey = typeof payload.image_key === 'string' ? payload.image_key : '';
    } catch {
      return null;
    }
    if (!imageKey) return null;
    const buffer = await this.client.downloadImage(
      config.id,
      secrets,
      item.messageId,
      imageKey,
    );
    const path = feishuAttachmentPath('.png');
    const abs = path.absPathOf(fileWebroot());
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, buffer);
    return `${this.client.appUrl}${path.publicUrl}`;
  }

  /** 同群上一轮结束后立即触发缓冲批次处理（替换等待中的重试定时器） */
  private scheduleChatBatchFlush(configId: number, chatId: string): void {
    const prefix = `${configId}:${chatId}:`;
    for (const [key, batch] of this.batches) {
      if (!key.startsWith(prefix)) continue;
      if (batch.messages.length === 0) continue;
      this.clearBatchTimer(batch);
      this.scheduleBatchFlush(key, batch, 0);
    }
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

  /** 修改单群策略（null = 跟随默认）；反馈采集策略仅能经收录群批量端点设置 */
  async setGroupPolicy(
    configId: number,
    groupId: number,
    policy: FeishuBotGroupPolicy | null,
  ): Promise<void> {
    if (policy !== null && !isFeishuBotGroupPolicy(policy)) {
      throw new BadRequestException('未知的群聊答复策略');
    }
    if (policy === FEISHU_BOT_FEEDBACK_GROUP_POLICY) {
      throw new BadRequestException(
        '反馈采集策略请在「收录群」配置中批量选择，不支持单群直接设置',
      );
    }
    const group = await this.groups.findOne({
      where: { id: groupId, configId },
    });
    if (!group) throw new NotFoundException('群不存在');
    await this.groups.update({ id: group.id }, { policy });
  }

  /**
   * 收录群批量设置（仅「系统-反馈处理」机器人的飞书配置使用）：
   * 选中的群置为反馈采集策略；原本被选中但本轮未选中的群恢复跟随默认策略。
   */
  async setFeedbackGroups(
    configId: number,
    groupIds: number[],
  ): Promise<{ collected: number[] }> {
    const ids = [...new Set(groupIds)];
    if (ids.some((id) => !Number.isInteger(id) || id <= 0)) {
      throw new BadRequestException('收录群 ID 非法');
    }
    const all = await this.groups.find({ where: { configId } });
    const known = new Set(all.map((group) => group.id));
    for (const id of ids) {
      if (!known.has(id)) {
        throw new NotFoundException(`群 #${id} 不属于该机器人的飞书配置`);
      }
    }
    const want = new Set(ids);
    const collected: number[] = [];
    for (const group of all) {
      const selected = want.has(group.id);
      if (selected) collected.push(group.id);
      const next: FeishuBotGroupPolicy | null = selected
        ? FEISHU_BOT_FEEDBACK_GROUP_POLICY
        : group.policy === FEISHU_BOT_FEEDBACK_GROUP_POLICY
          ? null
          : group.policy;
      if (next === group.policy) continue;
      await this.groups.update({ id: group.id }, { policy: next });
    }
    return { collected };
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
        threadId: row.threadId,
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
        threadId: message.threadId ?? null,
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
    threadId?: string | null;
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
        threadId: input.threadId ?? null,
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

  /** 恢复服务重启前遗留的待回答卡片（按群内最近一张 pending 卡片，优先匹配当前话题） */
  private async recoverPendingRun(
    config: FeishuBotConfig,
    group: FeishuBotGroup,
    chatId: string,
    threadId: string | null,
  ): Promise<GroupRun | null> {
    const card = await this.cards.findOne({
      where: {
        configId: config.id,
        chatId,
        state: 'pending',
        scope: In([groupScopeOf(chatId, threadId), groupScopeOf(chatId)]),
      },
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
      threadId: threadIdOfGroupScope(card.scope),
      replyToMessageId: null,
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
    replyToMessageId: string | null,
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
    const replyTarget = replyToMessageId ?? run.replyToMessageId;
    const normalized = text.trim();
    if (!normalized) {
      await this.sendTextTo(
        config.id,
        secrets,
        run.chatId,
        replyTarget,
        '请输入答案，或回复「跳过」跳过提问。',
      );
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
          await this.sendTextTo(
            config.id,
            secrets,
            run.chatId,
            replyTarget,
            '无法识别答案，请点击卡片选项，或直接输入有效内容；回复「跳过」可跳过。',
          );
          return;
        }
        answers = [mapped];
      } else {
        const lines = normalized
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
        if (lines.length !== questions.length) {
          await this.sendTextTo(
            config.id,
            secrets,
            run.chatId,
            replyTarget,
            `该组提问共 ${questions.length} 个问题，请按顺序每行一个答案回复。`,
          );
          return;
        }
        const mappedLines: string[][] = [];
        for (const [index, line] of lines.entries()) {
          const mapped = mapTextAnswer(line, questions[index]);
          if (!mapped) {
            await this.sendTextTo(
              config.id,
              secrets,
              run.chatId,
              replyTarget,
              `第 ${index + 1} 行无法识别为有效答案，请调整后重新回复。`,
            );
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
      await this.sendTextTo(
        config.id,
        secrets,
        run.chatId,
        replyTarget,
        `提交答案失败：${(error as Error).message}`,
      );
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
          run.replyToMessageId ?? undefined,
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
      // 智能/反馈模式且无错误、回复仅为静默标记：不发群消息，记为 AI 静默
      if (
        !error &&
        (run.policy === 'smart' || run.policy === 'feedback') &&
        isSilentReply(content)
      ) {
        if (run.recordId) {
          await this.markDecision(run.recordId, 'silent');
        }
        for (const recordId of run.recordIds ?? []) {
          await this.markDecision(recordId, 'silent');
        }
        this.scheduleChatBatchFlush(run.configId, run.chatId);
        return;
      }
      const body = error
        ? `${content ? `${content}\n\n` : ''}⚠️ ${error}`
        : content || '（本轮没有产生回复）';
      // 智能模式批量回复：解析「>>> 消息ID」定向回复，逐段发送；其余保持单段
      const segments =
        !error && run.recordIds?.length ? parseBatchReplySegments(content) : [];
      const replies =
        segments.length > 0
          ? segments
          : [{ targetMessageId: null, content: body }];
      for (const segment of replies) {
        const target =
          segment.targetMessageId ?? run.replyToMessageId ?? undefined;
        try {
          await this.messages.sendMarkdown(
            run.configId,
            secrets,
            'chat_id',
            run.chatId,
            segment.content,
            target,
          );
        } catch (cardError) {
          // 卡片失败降级为纯文本（话题消息仍以回复形式发送，避免掉出话题）
          await this.sendTextTo(
            run.configId,
            secrets,
            run.chatId,
            target ?? null,
            segment.content.slice(0, 3000),
          );
          this.logger.warn(
            `飞书群回复卡片发送失败（已降级文本）: ${(cardError as Error).message}`,
          );
        }
        await this.writeRecord({
          configId: run.configId,
          groupId: run.groupId,
          kind: 'reply',
          threadId: run.threadId,
          content: segment.content,
          error,
        }).catch((recordError: Error) => {
          this.logger.warn(`飞书群回复记录写入失败: ${recordError.message}`);
        });
      }
      if (run.recordId) {
        await this.markDecision(
          run.recordId,
          error ? 'error' : 'replied',
          error,
        );
      }
      for (const recordId of run.recordIds ?? []) {
        await this.markDecision(recordId, error ? 'error' : 'replied', error);
      }
      // 同群上一轮结束后立即处理缓冲中的下一批
      this.scheduleChatBatchFlush(run.configId, run.chatId);
    })();
  }

  // ==== 内部：回执与话题上文 ====

  /**
   * 回执文本：有回复目标时以回复形式发送（话题群落回原话题），
   * 回复失败降级为普通群发，保证消息不丢。
   */
  private async sendTextTo(
    configId: number,
    secrets: FeishuBotSecrets,
    chatId: string,
    replyToMessageId: string | null,
    text: string,
  ): Promise<void> {
    if (replyToMessageId) {
      await this.client
        .replyText(configId, secrets, replyToMessageId, text)
        .catch(() =>
          this.client
            .sendText(configId, secrets, 'chat_id', chatId, text)
            .catch(() => {}),
        );
      return;
    }
    await this.client
      .sendText(configId, secrets, 'chat_id', chatId, text)
      .catch(() => {});
  }

  /**
   * 上文提示词：仅被 @ 策略下补拉最近消息（话题内拉话题、普通群拉群聊），
   * 只保留机器人最后一次回复之后的消息；接口失败时返回空串，不阻断本轮回复。
   */
  private async historyPrompt(
    config: FeishuBotConfig,
    secrets: FeishuBotSecrets,
    chatId: string,
    threadId: string | null,
    currentMessageId: string,
  ): Promise<string> {
    const limit = HISTORY_LIMIT + 1;
    const rows: FeishuHistoryMessage[] = await (
      threadId
        ? this.client.listThreadMessages(config.id, secrets, threadId, limit)
        : this.client.listChatMessages(config.id, secrets, chatId, limit)
    ).catch((error: Error) => {
      this.logger.warn(
        `飞书${threadId ? '话题' : '群聊'}历史读取失败（${threadId ?? chatId}）: ${error.message}`,
      );
      return [];
    });
    if (rows.length === 0) return '';
    const names = new Map<string, string>();
    const entries: { senderName: string; text: string }[] = [];
    for (const row of historySinceBotReply(rows, config.appId)) {
      if (row.messageId === currentMessageId) continue;
      const text = historyMessageText(row.messageType, row.content);
      if (!text) continue;
      entries.push({
        senderName: await this.historySenderName(config, row, names),
        text,
      });
    }
    return formatHistoryPrompt(
      threadId ? '【话题上文】' : '【群聊上文】',
      entries.slice(-HISTORY_LIMIT),
    );
  }

  /** 历史发送者展示名：机器人消息记为「机器人」，用户尽力解析平台姓名 */
  private async historySenderName(
    config: FeishuBotConfig,
    row: FeishuHistoryMessage,
    cache: Map<string, string>,
  ): Promise<string> {
    if (row.senderType === 'app') return '机器人';
    const openId = row.senderOpenId ?? '';
    if (!openId) return '群成员';
    const cached = cache.get(openId);
    if (cached) return cached;
    const user = await this.identities
      .resolve(config, { openId, unionId: null })
      .catch(() => null);
    const name = user?.name?.trim() || '群成员';
    cache.set(openId, name);
    return name;
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

/** 智能模式批次键：同一群内不同话题分别缓冲 */
function batchKeyOf(
  configId: number,
  chatId: string,
  threadId: string | null,
): string {
  return `${configId}:${chatId}:${threadId ?? ''}`;
}
