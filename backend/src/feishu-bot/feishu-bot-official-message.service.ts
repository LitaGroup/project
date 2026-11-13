import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../auth/user.entity';
import { UserRole } from '../common/enums';
import type { Worker } from '../workers/worker.entity';
import type { FeishuReceiveIdType } from './feishu-bot-client.service';
import { FeishuBotConfigService } from './feishu-bot-config.service';
import { FeishuBotIdentityService } from './feishu-bot-identity.service';
import { FeishuBotMessageService } from './feishu-bot-message.service';
import {
  FeishuBotOfficialMessage,
  type FeishuOfficialMessageSenderType,
  type FeishuOfficialMessageTargetType,
  type FeishuOfficialMessageView,
} from './feishu-bot-official-message.entity';

/** 单条消息正文上限（字符；超长正文由发送层自动分片） */
const MAX_CONTENT_LENGTH = 20000;

/** 卡片标题上限（飞书卡片标题不宜过长） */
const MAX_TITLE_LENGTH = 80;

/** 审计列表默认/最大分页 */
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/** 平台名义消息的发送方（控制器 / MCP 工具按令牌身份构造） */
export interface FeishuOfficialMessageSender {
  type: FeishuOfficialMessageSenderType;
  id: number;
  name: string;
}

/** 调用方身份：机器人令牌优先，其次管理员用户（含公共 Agent） */
export interface OfficialMessageCaller {
  worker?: Worker;
  user?: User;
}

/** 发送入参：userId / openId / chatId 三选一 */
export interface SendOfficialMessageInput {
  userId?: number;
  openId?: string;
  chatId?: string;
  content: string;
  title?: string;
  replyToMessageId?: string;
}

/** 发送结果 */
export interface SendOfficialMessageResult {
  messageIds: string[];
  receiveIdType: FeishuReceiveIdType;
  receiveId: string;
}

/** 审计列表分页结果 */
export interface FeishuOfficialMessagePage {
  items: FeishuOfficialMessageView[];
  total: number;
  page: number;
  pageSize: number;
}

/** 解析后的发送目标 */
interface ResolvedTarget {
  type: FeishuOfficialMessageTargetType;
  receiveIdType: FeishuReceiveIdType;
  /** targetType=user 时的平台用户 ID */
  userId?: number;
  /** 直接指定的 open_id / chat_id */
  receiveId?: string;
}

/**
 * 平台名义飞书消息：统一以「平台官方机器人」身份发送 Markdown 卡片。
 * - REST（POST /api/feishu-bot/messages）与 MCP（feishu_send_message）共用本服务；
 * - 收件人支持平台用户（自动解析 open_id）、指定 open_id、群 chat_id；
 * - 每次发送（成功/失败）都写审计表，记录发送方、目标与正文。
 */
@Injectable()
export class FeishuBotOfficialMessageService {
  private readonly logger = new Logger(FeishuBotOfficialMessageService.name);

  constructor(
    private readonly configs: FeishuBotConfigService,
    private readonly messages: FeishuBotMessageService,
    private readonly identities: FeishuBotIdentityService,
    @InjectRepository(FeishuBotOfficialMessage)
    private readonly audits: Repository<FeishuBotOfficialMessage>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
  ) {}

  /** 发送一条平台名义消息（超长正文自动分片） */
  async send(
    input: SendOfficialMessageInput,
    sender: FeishuOfficialMessageSender,
  ): Promise<SendOfficialMessageResult> {
    const content = (input.content ?? '').trim();
    if (!content) throw new BadRequestException('消息正文 content 不能为空');
    if (content.length > MAX_CONTENT_LENGTH) {
      throw new BadRequestException(
        `消息正文不能超过 ${MAX_CONTENT_LENGTH} 字符`,
      );
    }
    const title = input.title?.trim() || null;
    if (title && title.length > MAX_TITLE_LENGTH) {
      throw new BadRequestException(
        `卡片标题不能超过 ${MAX_TITLE_LENGTH} 字符`,
      );
    }
    const replyToMessageId = input.replyToMessageId?.trim() || null;
    const target = this.resolveTarget(input);

    const config = await this.configs.loadEnabledOfficial();
    if (!config) {
      throw new ServiceUnavailableException(
        '平台官方机器人未配置或未启用，无法发送飞书消息',
      );
    }

    let receiveId = target.receiveId ?? '';
    let targetUserId: number | null = null;
    let targetName: string | null = null;
    if (target.type === 'user') {
      const user = await this.users.findOne({ where: { id: target.userId } });
      if (!user) {
        throw new NotFoundException(`用户 ${target.userId} 不存在`);
      }
      // 官方应用下的 open_id 优先（已知映射时更可靠），否则回退登录 open_id
      receiveId =
        (await this.identities
          .openIdFor(config.id, user.id)
          .catch(() => null)) ?? user.feishuOpenId;
      if (!receiveId) {
        throw new BadRequestException(`用户 ${user.name} 未绑定飞书 open_id`);
      }
      targetUserId = user.id;
      targetName = user.name;
    }

    try {
      const results = await this.messages.sendMarkdown(
        config.id,
        this.configs.secretsOf(config),
        target.receiveIdType,
        receiveId,
        content,
        replyToMessageId ?? undefined,
        title ?? undefined,
      );
      const messageIds = results
        .map((result) => result.messageId)
        .filter((id): id is string => Boolean(id));
      await this.record({
        sender,
        target,
        receiveId,
        targetUserId,
        targetName,
        title,
        content,
        replyToMessageId,
        messageIds,
        status: 'success',
        error: null,
      });
      return { messageIds, receiveIdType: target.receiveIdType, receiveId };
    } catch (error) {
      await this.record({
        sender,
        target,
        receiveId,
        targetUserId,
        targetName,
        title,
        content,
        replyToMessageId,
        messageIds: null,
        status: 'failed',
        error: (error as Error).message,
      });
      throw error;
    }
  }

  /** 审计列表（仅管理员；不含正文大字段） */
  async list(
    pageInput: number,
    pageSizeInput: number,
  ): Promise<FeishuOfficialMessagePage> {
    const page = Math.max(Math.floor(pageInput) || 1, 1);
    const pageSize = Math.min(
      Math.max(Math.floor(pageSizeInput) || DEFAULT_PAGE_SIZE, 1),
      MAX_PAGE_SIZE,
    );
    const [rows, total] = await this.audits.findAndCount({
      select: {
        id: true,
        senderType: true,
        senderId: true,
        senderName: true,
        targetType: true,
        targetId: true,
        targetUserId: true,
        targetName: true,
        title: true,
        contentLength: true,
        replyToMessageId: true,
        messageIds: true,
        status: true,
        error: true,
        createdAt: true,
      },
      order: { id: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return {
      items: rows.map((row) => ({
        id: row.id,
        senderType: row.senderType,
        senderId: row.senderId,
        senderName: row.senderName,
        targetType: row.targetType,
        targetId: row.targetId,
        targetUserId: row.targetUserId,
        targetName: row.targetName,
        title: row.title,
        contentLength: row.contentLength,
        replyToMessageId: row.replyToMessageId,
        messageIds: row.messageIds,
        status: row.status,
        error: row.error,
        createdAt: row.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    };
  }

  /** 目标三选一校验 */
  private resolveTarget(input: SendOfficialMessageInput): ResolvedTarget {
    const openId = input.openId?.trim();
    const chatId = input.chatId?.trim();
    const hasUserId = input.userId !== undefined && input.userId !== null;
    const count = [hasUserId, Boolean(openId), Boolean(chatId)].filter(
      Boolean,
    ).length;
    if (count !== 1) {
      throw new BadRequestException('userId / openId / chatId 三选一');
    }
    if (hasUserId) {
      const userId = Math.floor(Number(input.userId));
      if (!Number.isFinite(userId) || userId <= 0) {
        throw new BadRequestException('userId 必须为正整数');
      }
      return { type: 'user', receiveIdType: 'open_id', userId };
    }
    if (openId) {
      return { type: 'open_id', receiveIdType: 'open_id', receiveId: openId };
    }
    return { type: 'chat', receiveIdType: 'chat_id', receiveId: chatId };
  }

  /** 写审计记录：失败只告警，不影响发送主流程 */
  private async record(input: {
    sender: FeishuOfficialMessageSender;
    target: ResolvedTarget;
    receiveId: string;
    targetUserId: number | null;
    targetName: string | null;
    title: string | null;
    content: string;
    replyToMessageId: string | null;
    messageIds: string[] | null;
    status: 'success' | 'failed';
    error: string | null;
  }): Promise<void> {
    try {
      await this.audits.save(
        this.audits.create({
          senderType: input.sender.type,
          senderId: input.sender.id,
          senderName: input.sender.name,
          targetType: input.target.type,
          targetId: input.receiveId,
          targetUserId: input.targetUserId,
          targetName: input.targetName,
          title: input.title,
          content: input.content,
          contentLength: input.content.length,
          replyToMessageId: input.replyToMessageId,
          messageIds: input.messageIds,
          status: input.status,
          error: input.error,
        }),
      );
    } catch (error) {
      this.logger.warn(
        `平台飞书消息审计写入失败（${input.sender.name} → ${input.target.type}）：${(error as Error).message}`,
      );
    }
  }
}

/**
 * 解析平台名义发送权限：机器人令牌优先，其次管理员用户（含公共 Agent）。
 * 其余身份（普通成员网页会话）直接拒绝。
 */
export function resolveOfficialMessageSender(
  caller: OfficialMessageCaller,
): FeishuOfficialMessageSender {
  if (caller.worker) {
    return {
      type: 'worker',
      id: caller.worker.id,
      name: caller.worker.name,
    };
  }
  if (caller.user?.role === UserRole.ADMIN) {
    return { type: 'user', id: caller.user.id, name: caller.user.name };
  }
  throw new ForbiddenException('仅机器人令牌或管理员可发送平台飞书消息');
}
