import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FeishuBotApprovalService } from './feishu-bot-approval.service';
import { FeishuBotCard } from './feishu-bot-card.entity';
import { FeishuBotEvent } from './feishu-bot-event.entity';
import type {
  FeishuBotConfig,
  FeishuBotSecrets,
} from './feishu-bot-config.entity';
import { FeishuBotConfigService } from './feishu-bot-config.service';
import { FeishuBotCryptoService } from './feishu-bot-crypto.service';
import {
  FeishuBotGroupChatService,
  isFeishuGroupScope,
} from './feishu-bot-group-chat.service';
import {
  FeishuBotIdentityService,
  type FeishuSenderId,
} from './feishu-bot-identity.service';
import type { FeishuInboundMessage } from './feishu-bot-p2p.service';
import { FeishuBotP2PService } from './feishu-bot-p2p.service';
import { FeishuBotTaskChatService } from './feishu-bot-task-chat.service';

/** 未识别用户的引导文案 */
const BIND_GUIDANCE =
  '未识别平台账号：请先用当前飞书账号登录平台一次后重试；或联系管理员在「管理 → 飞书配置」中处理。';

/**
 * 飞书事件回调处理：
 * - URL verification challenge（明文/加密两种）；
 * - Verification Token 校验（配置了才校验）；
 * - Encrypt Key 解密（AES-256-CBC）；
 * - event_id 去重（飞书至少一次投递）；
 * - 消息事件 → 私聊（P2P 桥接）/ 群聊（任务群）；
 * - 卡片动作 → 提问按钮答复（v2 schema 与 v1 旧格式）。
 * 消息处理异步执行，回调快速返回 200。
 */
@Injectable()
export class FeishuBotEventService {
  private readonly logger = new Logger(FeishuBotEventService.name);

  constructor(
    private readonly configs: FeishuBotConfigService,
    private readonly crypto: FeishuBotCryptoService,
    private readonly identities: FeishuBotIdentityService,
    private readonly p2p: FeishuBotP2PService,
    private readonly taskChats: FeishuBotTaskChatService,
    private readonly groupChats: FeishuBotGroupChatService,
    private readonly approvals: FeishuBotApprovalService,
    @InjectRepository(FeishuBotEvent)
    private readonly events: Repository<FeishuBotEvent>,
    @InjectRepository(FeishuBotCard)
    private readonly cards: Repository<FeishuBotCard>,
  ) {}

  /** 回调入口：返回值直接作为 HTTP 响应（challenge / code / toast） */
  async handleCallback(
    configId: number,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    let row: FeishuBotConfig;
    try {
      row = await this.configs.loadWithSecrets(configId);
    } catch {
      throw new NotFoundException('飞书配置不存在');
    }
    if (!row.enabled) {
      return { code: 0 };
    }
    const secrets = this.configs.secretsOf(row);

    // 加密事件解密
    let payload: Record<string, unknown> = body;
    const encryptKey = this.configs.encryptKeyOf(row);
    if (typeof body.encrypt === 'string' && body.encrypt) {
      if (!encryptKey) {
        throw new BadRequestException('该应用未配置 Encrypt Key，无法解密事件');
      }
      try {
        payload = JSON.parse(
          this.crypto.decryptEventPayload(encryptKey, body.encrypt),
        ) as Record<string, unknown>;
      } catch (error) {
        throw new BadRequestException(
          `飞书事件解密失败：${(error as Error).message}`,
        );
      }
    }

    // URL 验证（v1 明文 / v2 加密）
    if (payload.type === 'url_verification') {
      return { challenge: payload.challenge ?? '' };
    }

    // v2 事件（schema 2.0）
    if (payload.schema === '2.0' || payload.header) {
      const header = (payload.header ?? {}) as Record<string, unknown>;
      if (header.event_type === 'url_verification') {
        const event = (payload.event ?? {}) as Record<string, unknown>;
        return { challenge: event.challenge ?? payload.challenge ?? '' };
      }
      const token = this.configs.verificationTokenOf(row);
      if (token && !this.crypto.safeEqualToken(header.token as string, token)) {
        throw new ForbiddenException('Verification Token 校验失败');
      }
      const eventId =
        typeof header.event_id === 'string' ? header.event_id : '';
      const eventType =
        typeof header.event_type === 'string' ? header.event_type : '';
      if (eventId && (await this.isDuplicate(eventId, row.id, eventType))) {
        return { code: 0 };
      }
      if (eventType === 'im.message.receive_v1') {
        void this.handleMessageEvent(row, secrets, payload.event).catch(
          (error: Error) =>
            this.logger.warn(
              `飞书消息处理失败（config#${row.id}）: ${error.message}`,
            ),
        );
        return { code: 0 };
      }
      if (
        eventType === 'im.chat.member.bot.added_v1' ||
        eventType === 'im.chat.member.bot.deleted_v1'
      ) {
        void this.handleBotMembershipEvent(
          row,
          secrets,
          eventType,
          payload.event,
        ).catch((error: Error) =>
          this.logger.warn(
            `飞书机器人进出群事件处理失败（config#${row.id}）: ${error.message}`,
          ),
        );
        return { code: 0 };
      }
      if (eventType === 'card.action.trigger') {
        return this.handleCardAction(
          row,
          secrets,
          (payload.event ?? {}) as Record<string, unknown>,
        );
      }
      return { code: 0 };
    }

    // v1 旧卡片回调（type=card_action_trigger）
    if (payload.type === 'card_action_trigger') {
      return this.handleCardActionLegacy(row, secrets, payload);
    }
    return { code: 0 };
  }

  /** 长连接入站消息（飞书已鉴权；按 message_id 去重后复用 HTTP 回调同一处理链） */
  async dispatchLongConnectionMessage(
    configId: number,
    secrets: FeishuBotSecrets,
    data: Record<string, unknown>,
  ): Promise<void> {
    const message = (data.message ?? {}) as Record<string, unknown>;
    this.logger.log(
      `飞书长连接收到消息 config#${configId} type=${asString(message.message_type) || '-'} chat=${asString(message.chat_id) || '-'}`,
    );
    const row = await this.configs.loadEnabledWithSecrets(configId);
    if (!row) return;
    const messageId = asString(message.message_id);
    if (!messageId) return;
    if (
      await this.isDuplicate(
        `ws:${messageId}`,
        configId,
        'im.message.receive_v1',
      )
    ) {
      return;
    }
    await this.handleMessageEvent(row, secrets, {
      sender: data.sender,
      message: data.message,
    });
  }

  /** 长连接卡片动作：返回值由 SDK 原路回给飞书（toast 等） */
  async dispatchLongConnectionCardAction(
    configId: number,
    secrets: FeishuBotSecrets,
    data: Record<string, unknown>,
  ): Promise<unknown> {
    this.logger.log(
      `飞书长连接收到卡片回调 config#${configId} action=${asString((data.action as Record<string, unknown> | undefined)?.tag) || '-'}`,
    );
    const row = await this.configs.loadEnabledWithSecrets(configId);
    if (!row) return undefined;
    return this.handleCardAction(row, secrets, {
      operator: data.operator,
      action: data.action,
    });
  }

  /**
   * 长连接机器人进出群事件：
   * 长连接回调不携带 header.event_id，用 chatId + 分钟级时间片做去重，
   * 避免同一条事件在重连补发时重复写入记录。
   */
  async dispatchLongConnectionBotMembership(
    configId: number,
    secrets: FeishuBotSecrets,
    eventType: 'im.chat.member.bot.added_v1' | 'im.chat.member.bot.deleted_v1',
    data: Record<string, unknown>,
  ): Promise<void> {
    const chatId = asString(data.chat_id);
    if (!chatId) return;
    const slice = Math.floor(Date.now() / 60_000);
    if (
      await this.isDuplicate(
        `ws:${eventType}:${chatId}:${slice}`,
        configId,
        eventType,
      )
    ) {
      return;
    }
    const row = await this.configs.loadEnabledWithSecrets(configId);
    if (!row) return;
    await this.handleBotMembershipEvent(row, secrets, eventType, data);
  }

  // ==== 机器人进出群 ====

  private async handleBotMembershipEvent(
    row: FeishuBotConfig,
    secrets: FeishuBotSecrets,
    eventType: 'im.chat.member.bot.added_v1' | 'im.chat.member.bot.deleted_v1',
    event: unknown,
  ): Promise<void> {
    const data = (event ?? {}) as Record<string, unknown>;
    if (eventType === 'im.chat.member.bot.added_v1') {
      await this.groupChats.handleBotAdded(row, secrets, data);
      return;
    }
    await this.groupChats.handleBotRemoved(row, data);
  }

  // ==== 消息事件 ====

  private async handleMessageEvent(
    row: FeishuBotConfig,
    secrets: FeishuBotSecrets,
    event: unknown,
  ): Promise<void> {
    const data = (event ?? {}) as Record<string, unknown>;
    const sender = (data.sender ?? {}) as Record<string, unknown>;
    const senderId = (sender.sender_id ?? {}) as Record<string, unknown>;
    const openId = typeof senderId.open_id === 'string' ? senderId.open_id : '';
    if (!openId) return;
    const source: FeishuSenderId = {
      openId,
      unionId: typeof senderId.union_id === 'string' ? senderId.union_id : null,
    };
    const message = parseInboundMessage(data.message);
    if (!message) return;

    if (message.chatType === 'p2p') {
      const user = await this.identities.resolve(row, source);
      if (!user) {
        await this.p2p.sendGuidance(
          row,
          secrets,
          message.chatId,
          BIND_GUIDANCE,
        );
        return;
      }
      await this.p2p.handleMessage(row, secrets, user, message);
      return;
    }

    // 群消息：官方机器人处理任务群；机器人绑定的应用按外部群策略处理
    if (row.kind === 'official') {
      await this.taskChats.handleGroupMessage(row, secrets, source, message);
      return;
    }
    await this.groupChats.handleGroupMessage(row, secrets, source, message);
  }

  // ==== 卡片动作 ====

  /** v2 卡片动作：event.operator + event.action.value */
  private async handleCardAction(
    row: FeishuBotConfig,
    secrets: FeishuBotSecrets,
    event: Record<string, unknown>,
  ): Promise<unknown> {
    const operator = (event.operator ?? {}) as Record<string, unknown>;
    const action = (event.action ?? {}) as Record<string, unknown>;
    const value = (action.value ?? {}) as Record<string, unknown>;
    const operatorId: FeishuSenderId = {
      openId: typeof operator.open_id === 'string' ? operator.open_id : '',
      unionId: typeof operator.union_id === 'string' ? operator.union_id : null,
    };
    return this.answerCard(row, secrets, value, operatorId);
  }

  /** v1 旧卡片回调：顶层 open_id + action.value */
  private async handleCardActionLegacy(
    row: FeishuBotConfig,
    secrets: FeishuBotSecrets,
    payload: Record<string, unknown>,
  ): Promise<unknown> {
    const action = (payload.action ?? {}) as Record<string, unknown>;
    const value = (action.value ?? {}) as Record<string, unknown>;
    const operatorId: FeishuSenderId = {
      openId: typeof payload.open_id === 'string' ? payload.open_id : '',
      unionId: typeof payload.union_id === 'string' ? payload.union_id : null,
    };
    return this.answerCard(row, secrets, value, operatorId);
  }

  /** 校验操作者与卡片归属后答复提问 / 处理审批卡片 */
  private async answerCard(
    row: FeishuBotConfig,
    secrets: FeishuBotSecrets,
    value: Record<string, unknown>,
    operator: FeishuSenderId,
  ): Promise<unknown> {
    const approval = await this.approvals
      .handleCardAction(row, value, operator)
      .catch((error: Error) => {
        this.logger.warn(`审批卡片动作处理失败：${error.message}`);
        return {
          toast: { type: 'error', content: '审批处理失败，请稍后重试' },
        };
      });
    if (approval) return approval;
    if (value.k !== 'qa') return { code: 0 };
    const cardId = Number(value.c);
    const labels = Array.isArray(value.a)
      ? (value.a as unknown[]).map(asString).filter(Boolean)
      : [];
    if (!Number.isInteger(cardId) || cardId <= 0 || labels.length === 0) {
      return { toast: { type: 'error', content: '卡片参数无效' } };
    }
    const user = operator.openId
      ? await this.identities.resolve(row, operator)
      : null;
    if (!user) {
      return { toast: { type: 'error', content: '未识别平台账号，无法提交' } };
    }
    // 私聊卡片校验卡片属主；群聊卡片允许任意已识别平台账号的群成员作答
    const card = await this.cards.findOne({ where: { id: cardId } });
    if (card && isFeishuGroupScope(card.scope)) {
      return this.groupChats.answerByCardButton(row, cardId, labels, user.id);
    }
    return this.p2p.answerByCardButton(row, secrets, cardId, labels, user.id);
  }

  /** 事件去重：返回 true 表示重复事件应跳过 */
  private async isDuplicate(
    eventId: string,
    configId: number,
    type: string,
  ): Promise<boolean> {
    const result = await this.events
      .createQueryBuilder()
      .insert()
      .into(FeishuBotEvent)
      .values({ eventId, configId, type })
      .orIgnore()
      .execute();
    return !result.identifiers?.length;
  }
}

/** 事件字段安全转字符串（仅接受 string，避免对象被模板字符串意外序列化） */
function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * 解析事件的 message 结构为内部入站消息。
 * 话题群/话题回复会带 root_id / parent_id / thread_id：
 * reply 接口据此把机器人回执落回原话题，群聊逻辑据此隔离话题会话并拼接话题上文。
 */
export function parseInboundMessage(raw: unknown): FeishuInboundMessage | null {
  const messageRaw = (raw ?? {}) as Record<string, unknown>;
  const chatType = messageRaw.chat_type === 'group' ? 'group' : 'p2p';
  const mentions = Array.isArray(messageRaw.mentions)
    ? (messageRaw.mentions as unknown[])
        .map((item) => {
          const mention = (item ?? {}) as Record<string, unknown>;
          const id = (mention.id ?? {}) as Record<string, unknown>;
          return {
            key: asString(mention.key),
            openId: asString(id.open_id),
            name: asString(mention.name),
          };
        })
        .filter((mention) => Boolean(mention.openId))
    : [];
  const messageId = asString(messageRaw.message_id);
  const chatId = asString(messageRaw.chat_id);
  if (!messageId || !chatId) return null;
  return {
    messageId,
    chatId,
    chatType,
    messageType: asString(messageRaw.message_type),
    content: asString(messageRaw.content) || '{}',
    mentions,
    rootId: asString(messageRaw.root_id) || undefined,
    parentId: asString(messageRaw.parent_id) || undefined,
    threadId: asString(messageRaw.thread_id) || undefined,
  };
}
