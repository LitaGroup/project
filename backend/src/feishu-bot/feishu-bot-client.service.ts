import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { basename, extname, join } from 'path';
import { ConfigService } from '@nestjs/config';
import { fileWebroot, imageWebroot } from '../common/paths';
import type { FeishuBotSecrets } from './feishu-bot-config.entity';
import { FeishuBotCryptoService } from './feishu-bot-crypto.service';

/** 飞书开放平台根地址 */
const FEISHU_BASE = 'https://open.feishu.cn/open-apis';

/** token 提前过期余量（毫秒） */
const TOKEN_EXPIRY_MARGIN_MS = 5 * 60 * 1000;

/** 发送目标类型 */
export type FeishuReceiveIdType = 'open_id' | 'chat_id';

/** 单条飞书消息发送结果 */
export interface FeishuSendResult {
  messageId: string | null;
}

/** 表情回应结果（失败为 null，不影响主流程） */
export interface FeishuReaction {
  reactionId: string | null;
}

/** 会话历史消息（拉取话题上文/群聊上文用） */
export interface FeishuHistoryMessage {
  messageId: string;
  messageType: string;
  /** 原始 content JSON 字符串 */
  content: string;
  /** 发送者 id：用户为 open_id、机器人为 app_id（系统消息可能为空） */
  senderOpenId: string | null;
  /** 发送者类型：user / app 等 */
  senderType: string;
  /** 消息发送时间（毫秒时间戳；解析失败为 0） */
  createTime: number;
}

interface TokenCache {
  token: string;
  expiresAt: number;
}

/** 机器人基本信息（验证连接时读取） */
export interface FeishuBotInfo {
  /** 机器人名称 */
  name: string | null;
  /** 机器人自身 open_id（识别群内 @机器人） */
  openId: string | null;
}

/**
 * 飞书自建应用客户端：按配置缓存 tenant_access_token，
 * 提供 消息/卡片/表情回应/图片素材/群管理 等聊天所需 API。
 * 与现有单应用 FeishuService（文档同步）互不影响。
 */
@Injectable()
export class FeishuBotClientService {
  private readonly logger = new Logger(FeishuBotClientService.name);
  private readonly tokens = new Map<number, TokenCache>();

  constructor(
    private readonly crypto: FeishuBotCryptoService,
    private readonly config: ConfigService,
  ) {}

  /** 平台前端访问地址（公开文件/任务链接拼接用） */
  get appUrl(): string {
    return (
      this.config.get<string>('APP_URL')?.trim().replace(/\/+$/, '') ||
      'http://localhost:5273'
    );
  }

  /** 使配置的 token 缓存失效（Secret 更换后调用） */
  invalidate(configId: number): void {
    this.tokens.delete(configId);
  }

  /** 校验 APP ID / APP Secret 是否有效（换取 tenant_access_token）；失败抛错 */
  async validateCredentials(appId: string, appSecret: string): Promise<void> {
    await this.fetchTenantToken({
      appId,
      appSecret,
      verificationToken: null,
      encryptKey: null,
    });
  }

  /** 连接验证：获取 token + 读取机器人信息（名称与自身 open_id） */
  async verify(secrets: FeishuBotSecrets): Promise<FeishuBotInfo | null> {
    const token = (await this.fetchTenantToken(secrets)).token;
    try {
      const response = await fetch(`${FEISHU_BASE}/bot/v3/info`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15_000),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        code?: number;
        bot?: { app_name?: unknown; open_id?: unknown };
      };
      if (!response.ok || payload.code !== 0) return null;
      const appName = payload.bot?.app_name;
      const openId = payload.bot?.open_id;
      return {
        name: typeof appName === 'string' && appName ? appName : null,
        openId: typeof openId === 'string' && openId ? openId : null,
      };
    } catch {
      return null;
    }
  }

  // ---- 消息 ----

  /** 发送文本消息 */
  async sendText(
    configId: number,
    secrets: FeishuBotSecrets,
    receiveIdType: FeishuReceiveIdType,
    receiveId: string,
    text: string,
  ): Promise<FeishuSendResult> {
    return this.sendRaw(
      configId,
      secrets,
      receiveIdType,
      receiveId,
      'text',
      JSON.stringify({ text }),
    );
  }

  /** 发送互动卡片（card 对象整体序列化为 content） */
  async sendCard(
    configId: number,
    secrets: FeishuBotSecrets,
    receiveIdType: FeishuReceiveIdType,
    receiveId: string,
    card: Record<string, unknown>,
  ): Promise<FeishuSendResult> {
    return this.sendRaw(
      configId,
      secrets,
      receiveIdType,
      receiveId,
      'interactive',
      JSON.stringify(card),
    );
  }

  /** 更新已发送的互动卡片内容（审批卡片处理结果回写） */
  async updateCard(
    configId: number,
    secrets: FeishuBotSecrets,
    messageId: string,
    card: Record<string, unknown>,
  ): Promise<void> {
    await this.request(
      configId,
      secrets,
      'PATCH',
      `/im/v1/messages/${encodeURIComponent(messageId)}`,
      { content: JSON.stringify(card) },
    );
  }

  /** 发送图片消息 */
  async sendImage(
    configId: number,
    secrets: FeishuBotSecrets,
    receiveIdType: FeishuReceiveIdType,
    receiveId: string,
    imageKey: string,
  ): Promise<FeishuSendResult> {
    return this.sendRaw(
      configId,
      secrets,
      receiveIdType,
      receiveId,
      'image',
      JSON.stringify({ image_key: imageKey }),
    );
  }

  /** 发送文件消息 */
  async sendFile(
    configId: number,
    secrets: FeishuBotSecrets,
    receiveIdType: FeishuReceiveIdType,
    receiveId: string,
    fileKey: string,
  ): Promise<FeishuSendResult> {
    return this.sendRaw(
      configId,
      secrets,
      receiveIdType,
      receiveId,
      'file',
      JSON.stringify({ file_key: fileKey }),
    );
  }

  /** 回复文本消息（话题群会落入被回复消息所在话题，普通群表现为引用回复） */
  async replyText(
    configId: number,
    secrets: FeishuBotSecrets,
    messageId: string,
    text: string,
  ): Promise<FeishuSendResult> {
    return this.replyRaw(
      configId,
      secrets,
      messageId,
      'text',
      JSON.stringify({ text }),
    );
  }

  /** 回复互动卡片（话题群会落入被回复消息所在话题） */
  async replyCard(
    configId: number,
    secrets: FeishuBotSecrets,
    messageId: string,
    card: Record<string, unknown>,
  ): Promise<FeishuSendResult> {
    return this.replyRaw(
      configId,
      secrets,
      messageId,
      'interactive',
      JSON.stringify(card),
    );
  }

  private async replyRaw(
    configId: number,
    secrets: FeishuBotSecrets,
    messageId: string,
    msgType: string,
    content: string,
  ): Promise<FeishuSendResult> {
    const data = await this.request(
      configId,
      secrets,
      'POST',
      `/im/v1/messages/${encodeURIComponent(messageId)}/reply`,
      {
        msg_type: msgType,
        content,
        uuid: randomUUID(),
      },
    );
    return { messageId: readString(data, 'message_id') };
  }

  /**
   * 拉取话题历史消息（container_id_type=thread），按时间正序返回最近 limit 条。
   * 需要应用具备「获取单聊、群组消息」或「获取与发送单聊、群组消息」权限；
   * 无权限时由调用方降级（不拼话题上文）。
   */
  async listThreadMessages(
    configId: number,
    secrets: FeishuBotSecrets,
    threadId: string,
    limit = 20,
  ): Promise<FeishuHistoryMessage[]> {
    return this.listHistoryMessages(
      configId,
      secrets,
      {
        container_id_type: 'thread',
        container_id: threadId,
      },
      limit,
    );
  }

  /**
   * 拉取群聊历史消息（container_id_type=chat），按时间正序返回最近 limit 条。
   * 普通群补拉「群聊上文」用；话题群里 chat 容器只返回话题根消息。
   * sinceSeconds 为秒级时间戳时只返回该时间之后的消息（飞书 chat 容器支持时间范围）。
   */
  async listChatMessages(
    configId: number,
    secrets: FeishuBotSecrets,
    chatId: string,
    limit = 20,
    sinceSeconds?: number,
  ): Promise<FeishuHistoryMessage[]> {
    return this.listHistoryMessages(
      configId,
      secrets,
      {
        container_id_type: 'chat',
        container_id: chatId,
        ...(sinceSeconds && sinceSeconds > 0
          ? { start_time: String(Math.floor(sinceSeconds)) }
          : {}),
      },
      limit,
    );
  }

  /** 会话历史消息拉取（话题/群聊共用），倒序取最近 N 条后转正序 */
  private async listHistoryMessages(
    configId: number,
    secrets: FeishuBotSecrets,
    container: {
      container_id_type: 'thread' | 'chat';
      container_id: string;
      start_time?: string;
    },
    limit: number,
  ): Promise<FeishuHistoryMessage[]> {
    const pageSize = Math.min(Math.max(Math.floor(limit) || 20, 1), 50);
    const query = new URLSearchParams({
      container_id_type: container.container_id_type,
      container_id: container.container_id,
      sort_type: 'ByCreateTimeDesc',
      page_size: String(pageSize),
      ...(container.start_time ? { start_time: container.start_time } : {}),
    });
    const data = await this.request(
      configId,
      secrets,
      'GET',
      `/im/v1/messages?${query.toString()}`,
    );
    const items = Array.isArray(data.items) ? (data.items as unknown[]) : [];
    return items
      .map((item) => {
        const row = (item ?? {}) as Record<string, unknown>;
        const body = (row.body ?? {}) as Record<string, unknown>;
        const sender = (row.sender ?? {}) as Record<string, unknown>;
        return {
          messageId: readString(row, 'message_id') ?? '',
          messageType: readString(row, 'msg_type') ?? '',
          content: readString(body, 'content') ?? '',
          senderOpenId: readString(sender, 'id'),
          senderType: readString(sender, 'sender_type') ?? 'user',
          createTime: Number(readString(row, 'create_time')) || 0,
        };
      })
      .filter((row) => Boolean(row.messageId))
      .reverse();
  }

  private async sendRaw(
    configId: number,
    secrets: FeishuBotSecrets,
    receiveIdType: FeishuReceiveIdType,
    receiveId: string,
    msgType: string,
    content: string,
  ): Promise<FeishuSendResult> {
    const data = await this.request(
      configId,
      secrets,
      'POST',
      `/im/v1/messages?receive_id_type=${receiveIdType}`,
      {
        receive_id: receiveId,
        msg_type: msgType,
        content,
      },
    );
    return { messageId: readString(data, 'message_id') };
  }

  // ---- 表情回应（处理中提示） ----

  /** 给消息添加表情回应；失败仅告警（表情 key 不支持等情况不阻断对话） */
  async react(
    configId: number,
    secrets: FeishuBotSecrets,
    messageId: string,
    emojiType: string,
  ): Promise<FeishuReaction> {
    try {
      const data = await this.request(
        configId,
        secrets,
        'POST',
        `/im/v1/messages/${encodeURIComponent(messageId)}/reactions`,
        { reaction_type: { emoji_type: emojiType } },
      );
      const reactionId =
        readString(data, 'reaction_id') ??
        readString(
          (data as { reaction?: Record<string, unknown> }).reaction,
          'id',
        );
      return { reactionId };
    } catch (error) {
      this.logger.warn(
        `添加飞书表情回应失败（message=${messageId}, emoji=${emojiType}）: ${(error as Error).message}`,
      );
      return { reactionId: null };
    }
  }

  /** 撤销表情回应；失败仅告警 */
  async unreact(
    configId: number,
    secrets: FeishuBotSecrets,
    messageId: string,
    reactionId: string,
  ): Promise<void> {
    try {
      await this.request(
        configId,
        secrets,
        'DELETE',
        `/im/v1/messages/${encodeURIComponent(messageId)}/reactions/${encodeURIComponent(reactionId)}`,
      );
    } catch (error) {
      this.logger.warn(
        `撤销飞书表情回应失败（message=${messageId}）: ${(error as Error).message}`,
      );
    }
  }

  // ---- 素材 ----

  /**
   * 下载消息中的图片素材。
   * 注意：`/im/v1/images` 仅能下载机器人自己上传的图片，
   * 读取用户消息里的图片必须走消息资源接口，且 file_key 与 message_id 需匹配。
   */
  async downloadImage(
    configId: number,
    secrets: FeishuBotSecrets,
    messageId: string,
    imageKey: string,
  ): Promise<Buffer> {
    return this.requestBinary(
      configId,
      secrets,
      'GET',
      `/im/v1/messages/${encodeURIComponent(messageId)}/resources/${encodeURIComponent(imageKey)}?type=image`,
    );
  }

  /** 下载消息中的文件素材（同样必须走消息资源接口） */
  async downloadFile(
    configId: number,
    secrets: FeishuBotSecrets,
    messageId: string,
    fileKey: string,
  ): Promise<Buffer> {
    return this.requestBinary(
      configId,
      secrets,
      'GET',
      `/im/v1/messages/${encodeURIComponent(messageId)}/resources/${encodeURIComponent(fileKey)}?type=file`,
    );
  }

  /**
   * 上传本地图片到飞书并返回 image_key（上传失败抛错，由调用方降级为链接）。
   * path 必须是 /images/... 或 /files/... 的平台内路径（服务端直接读盘，不走公网）。
   */
  async uploadLocalImage(
    configId: number,
    secrets: FeishuBotSecrets,
    urlPath: string,
  ): Promise<string | null> {
    const abs = localPathOf(urlPath);
    if (!abs) return null;
    const { readFile } = await import('fs/promises');
    const buffer = await readFile(abs);
    const form = new FormData();
    form.append('image_type', 'message');
    form.append('image', new Blob([new Uint8Array(buffer)]), basename(abs));
    const token = await this.tenantToken(configId, secrets);
    const response = await fetch(`${FEISHU_BASE}/im/v1/images`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
    const payload = (await response.json()) as {
      code?: number;
      msg?: string;
      data?: { image_key?: string };
    };
    if (!response.ok || payload.code !== 0 || !payload.data?.image_key) {
      throw new ServiceUnavailableException(
        `飞书图片上传失败：${payload.msg ?? response.status}`,
      );
    }
    return payload.data.image_key;
  }

  /**
   * 上传本地文件到飞书并返回 file_key（上传失败返回 null，由调用方降级为链接）。
   * path 必须是 /images/... 或 /files/... 的平台内路径。
   */
  async uploadLocalFile(
    configId: number,
    secrets: FeishuBotSecrets,
    urlPath: string,
  ): Promise<string | null> {
    const abs = localPathOf(urlPath);
    if (!abs) return null;
    const { readFile } = await import('fs/promises');
    const buffer = await readFile(abs);
    const form = new FormData();
    form.append('file_type', feishuFileTypeOf(abs));
    form.append('file_name', basename(abs).slice(0, 120));
    form.append('file', new Blob([new Uint8Array(buffer)]), basename(abs));
    const token = await this.tenantToken(configId, secrets);
    const response = await fetch(`${FEISHU_BASE}/im/v1/files`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
      signal: AbortSignal.timeout(120_000),
    });
    const payload = (await response.json()) as {
      code?: number;
      msg?: string;
      data?: { file_key?: string };
    };
    if (!response.ok || payload.code !== 0 || !payload.data?.file_key) {
      return null;
    }
    return payload.data.file_key;
  }

  // ---- 群管理（任务群） ----

  /** 读取群基本信息（群名等）；机器人须在群内且有 im:chat:readonly 权限 */
  async getChatInfo(
    configId: number,
    secrets: FeishuBotSecrets,
    chatId: string,
  ): Promise<{ name: string | null }> {
    const data = await this.request(
      configId,
      secrets,
      'GET',
      `/im/v1/chats/${encodeURIComponent(chatId)}`,
    );
    return { name: readString(data, 'name') };
  }

  /**
   * 创建群（操作者为机器人本身，默认群主）；userIds 为 open_id 列表。
   * botIds 使用应用的 App ID；idempotencyKey 由飞书 uuid 参数保证重试幂等。
   */
  async createChat(
    configId: number,
    secrets: FeishuBotSecrets,
    name: string,
    description: string | null,
    userIds: string[],
    options: { botIds?: string[]; idempotencyKey?: string } = {},
  ): Promise<string> {
    const query = new URLSearchParams({ user_id_type: 'open_id' });
    if (options.idempotencyKey) query.set('uuid', options.idempotencyKey);
    const botIds = (options.botIds ?? []).slice(0, 5);
    const data = await this.request(
      configId,
      secrets,
      'POST',
      `/im/v1/chats?${query.toString()}`,
      {
        name,
        ...(description ? { description } : {}),
        ...(userIds.length ? { user_id_list: userIds } : {}),
        ...(botIds.length ? { bot_id_list: botIds } : {}),
      },
    );
    const chatId = readString(data, 'chat_id');
    if (!chatId) {
      throw new ServiceUnavailableException('飞书建群成功但未返回 chat_id');
    }
    return chatId;
  }

  /** 将机器人拉入群（appIds 为应用 App ID；不可用机器人由飞书忽略） */
  async addChatMembers(
    configId: number,
    secrets: FeishuBotSecrets,
    chatId: string,
    appIds: string[],
  ): Promise<void> {
    if (appIds.length === 0) return;
    await this.request(
      configId,
      secrets,
      'POST',
      `/im/v1/chats/${encodeURIComponent(chatId)}/members?member_id_type=app_id&succeed_type=1`,
      { id_list: appIds.slice(0, 5) },
    );
  }

  /** 解散群（机器人须为群主） */
  async dissolveChat(
    configId: number,
    secrets: FeishuBotSecrets,
    chatId: string,
  ): Promise<void> {
    await this.request(
      configId,
      secrets,
      'DELETE',
      `/im/v1/chats/${encodeURIComponent(chatId)}`,
    );
  }

  // ---- 底层请求 ----

  /** 业务请求：自动带 token，code!==0 抛错 */
  private async request(
    configId: number,
    secrets: FeishuBotSecrets,
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const data = (await this.requestRaw(
      secrets,
      method,
      path,
      body,
      configId,
    )) as Record<string, unknown>;
    return data;
  }

  /** 原始请求（verify 场景尚未有 configId，直接用凭据取 token） */
  private async requestRaw(
    secrets: FeishuBotSecrets,
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body?: Record<string, unknown>,
    cacheKey?: number,
  ): Promise<unknown> {
    const token =
      cacheKey !== undefined
        ? await this.tenantToken(cacheKey, secrets)
        : (await this.fetchTenantToken(secrets)).token;
    const response = await fetch(`${FEISHU_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json; charset=utf-8' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(60_000),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      code?: number;
      msg?: string;
      data?: unknown;
    };
    if (!response.ok || (payload.code !== undefined && payload.code !== 0)) {
      throw new ServiceUnavailableException(
        `飞书接口调用失败：${payload.msg ?? response.status}（code=${payload.code ?? '-'}）`,
      );
    }
    return payload.data ?? {};
  }

  private async requestBinary(
    configId: number,
    secrets: FeishuBotSecrets,
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
  ): Promise<Buffer> {
    const token = await this.tenantToken(configId, secrets);
    const response = await fetch(`${FEISHU_BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      throw new ServiceUnavailableException(
        `飞书素材下载失败：HTTP ${response.status}`,
      );
    }
    return Buffer.from(await response.arrayBuffer());
  }

  /** 带缓存的 tenant_access_token（提前 5 分钟过期）；平台统一凭据（官方机器人）也经此获取 */
  async tenantToken(
    configId: number,
    secrets: FeishuBotSecrets,
  ): Promise<string> {
    const cached = this.tokens.get(configId);
    if (cached && cached.expiresAt > Date.now()) return cached.token;
    const fetched = await this.fetchTenantToken(secrets);
    this.tokens.set(configId, fetched);
    return fetched.token;
  }

  private async fetchTenantToken(
    secrets: FeishuBotSecrets,
  ): Promise<TokenCache> {
    const response = await fetch(
      `${FEISHU_BASE}/auth/v3/tenant_access_token/internal`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({
          app_id: secrets.appId,
          app_secret: secrets.appSecret,
        }),
        signal: AbortSignal.timeout(30_000),
      },
    );
    const data = (await response.json().catch(() => ({}))) as {
      code?: number;
      msg?: string;
      tenant_access_token?: unknown;
      expire?: unknown;
    };
    const token =
      typeof data.tenant_access_token === 'string'
        ? data.tenant_access_token
        : '';
    const expire = Number(data.expire) || 0;
    if (!response.ok || data.code !== 0 || !token) {
      throw new ServiceUnavailableException(
        `获取飞书 tenant_access_token 失败：${data.msg ?? response.status}（code=${data.code ?? '-'}）`,
      );
    }
    return {
      token,
      expiresAt:
        Date.now() + Math.max(expire * 1000 - TOKEN_EXPIRY_MARGIN_MS, 60_000),
    };
  }
}

/** 读取对象中的字符串字段 */
function readString(
  source: Record<string, unknown> | undefined,
  field: string,
): string | null {
  const value = source?.[field];
  return typeof value === 'string' && value ? value : null;
}

/** /images/... /files/... 平台内路径 → 本地磁盘路径；非法返回 null */
export function localPathOf(urlPath: string): string | null {
  const clean = urlPath.split('?')[0];
  if (clean.includes('..')) return null;
  if (clean.startsWith('/images/')) {
    return join(imageWebroot(), clean.slice('/images/'.length));
  }
  if (clean.startsWith('/files/')) {
    return join(fileWebroot(), clean.slice('/files/'.length));
  }
  return null;
}

/** 从 URL/路径推断扩展名（无扩展名默认 png） */
export function imageExtensionOf(urlPath: string): string {
  const ext = extname(urlPath.split('?')[0]).toLowerCase();
  return /^\.(png|jpe?g|gif|webp)$/.test(ext)
    ? ext === '.jpeg'
      ? '.jpg'
      : ext
    : '.png';
}

/** 飞书文件消息类型：常见文档映射到专用类型，其余用 stream */
export function feishuFileTypeOf(filePath: string): string {
  const ext = extname(filePath.split('?')[0]).toLowerCase();
  if (ext === '.pdf') return 'pdf';
  if (ext === '.doc' || ext === '.docx') return 'doc';
  if (ext === '.xls' || ext === '.xlsx') return 'xls';
  if (ext === '.ppt' || ext === '.pptx') return 'ppt';
  if (ext === '.mp4') return 'mp4';
  if (ext === '.opus') return 'opus';
  return 'stream';
}

/** 生成平台内附件存储相对路径（feishu/{date}/{uuid}{ext}） */
export function feishuAttachmentPath(ext: string): {
  relPath: string;
  publicUrl: string;
  absPathOf: (fileWebrootValue: string) => string;
} {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const relPath = `feishu/${date}/${randomUUID()}${ext}`;
  return {
    relPath,
    publicUrl: `/files/${relPath}`,
    absPathOf: (fileWebrootValue: string) => join(fileWebrootValue, relPath),
  };
}
