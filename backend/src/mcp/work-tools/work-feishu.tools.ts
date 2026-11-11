import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Repository } from 'typeorm';
import { z } from 'zod';
import type { FeishuBotConfig } from '../../feishu-bot/feishu-bot-config.entity';
import { FeishuBotConfigService } from '../../feishu-bot/feishu-bot-config.service';
import { FeishuBotGroup } from '../../feishu-bot/feishu-bot-group.entity';
import { historyMessageText } from '../../feishu-bot/feishu-bot-group-chat.service';
import { FeishuBotIdentityService } from '../../feishu-bot/feishu-bot-identity.service';
import {
  FeishuBotClientService,
  type FeishuHistoryMessage,
} from '../../feishu-bot/feishu-bot-client.service';
import {
  executeTool,
  jsonResult,
  requireWorkerPrincipal,
} from './work-tools.util';
import type { McpWorkPrincipal, WorkToolRegistrar } from './work-tools.types';

/** 历史消息只开放最近 7 天 */
const FEISHU_HISTORY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** 单次查询最大条数（飞书历史接口单页上限 50） */
const FEISHU_HISTORY_MAX_LIMIT = 50;

/** 单条消息文本截断长度（避免工具结果过大） */
const FEISHU_HISTORY_TEXT_LIMIT = 1000;

/** 飞书历史查询参数 */
export interface FeishuHistoryInput {
  chat_id: string;
  thread_id?: string;
  limit?: number;
}

/**
 * 飞书历史消息查询（lita-work MCP 工具 feishu_history）：
 * - 只允许机器人查询自己绑定飞书应用所在的会话，且只开放最近 7 天；
 * - 复用机器人客户端的历史接口（群聊/话题/私聊），应用需具备消息读取权限。
 */
@Injectable()
export class WorkFeishuTools implements WorkToolRegistrar {
  private readonly logger = new Logger(WorkFeishuTools.name);

  constructor(
    private readonly configs: FeishuBotConfigService,
    private readonly client: FeishuBotClientService,
    private readonly identities: FeishuBotIdentityService,
    @InjectRepository(FeishuBotGroup)
    private readonly groups: Repository<FeishuBotGroup>,
  ) {}

  register(server: McpServer, principal: McpWorkPrincipal): void {
    server.registerTool(
      'feishu_history',
      {
        title: '查询飞书会话历史',
        description:
          '查询飞书群聊/话题/私聊最近 7 天内的消息（需要机器人绑定的飞书应用具备消息读取权限）。用于回看当前会话前文、被 @ 之前漏掉的消息或某个话题的讨论。chat_id/thread_id 可在会话上下文（首条提示词）里找到。',
        inputSchema: {
          chat_id: z
            .string()
            .min(1)
            .describe('飞书会话 ID（群聊或私聊的 chat_id）'),
          thread_id: z
            .string()
            .optional()
            .describe('话题 ID；查询话题内消息时传入（群聊话题会话）'),
          limit: z
            .number()
            .int()
            .min(1)
            .max(FEISHU_HISTORY_MAX_LIMIT)
            .optional()
            .describe(
              `返回条数，默认 20，最多 ${FEISHU_HISTORY_MAX_LIMIT}（仅最近 7 天）`,
            ),
        },
      },
      async (args) =>
        executeTool(this.logger, 'feishu_history', principal, () =>
          this.queryHistory(principal, args),
        ),
    );
  }

  /** 查询逻辑（独立方法便于单测）：鉴权 → 拉取 → 7 天过滤 → 结构化输出 */
  async queryHistory(principal: McpWorkPrincipal, input: FeishuHistoryInput) {
    const worker = requireWorkerPrincipal(principal);
    const found = await this.configs.findEnabledWorkerConfig(worker.id);
    if (!found) {
      throw new ForbiddenException(
        '当前机器人未绑定启用的飞书应用，无法查询飞书历史',
      );
    }
    // 复用发送链路的密文列读取（findOne 默认不返回 select:false 的密钥列）
    const config = await this.configs
      .loadWithSecrets(found.id)
      .catch(() => null);
    if (!config) {
      throw new ForbiddenException(
        '当前机器人未绑定启用的飞书应用，无法查询飞书历史',
      );
    }
    const chatId = input.chat_id?.trim();
    if (!chatId) throw new ForbiddenException('chat_id 不能为空');
    const threadId = input.thread_id?.trim() || null;
    const limit = Math.min(
      Math.max(Math.floor(input.limit ?? 20) || 20, 1),
      FEISHU_HISTORY_MAX_LIMIT,
    );
    const secrets = this.configs.secretsOf(config);
    // 已退出的群不允许再查；未登记的群交给飞书接口按机器人成员关系校验
    const group = await this.groups.findOne({
      where: { configId: config.id, chatId },
    });
    if (group?.leftAt) {
      throw new ForbiddenException('机器人已退出该群，无法查询历史');
    }
    const cutoff = Date.now() - FEISHU_HISTORY_WINDOW_MS;
    const sinceSeconds = Math.floor(cutoff / 1000);
    const rows = threadId
      ? await this.client.listThreadMessages(
          config.id,
          secrets,
          threadId,
          FEISHU_HISTORY_MAX_LIMIT,
        )
      : await this.client.listChatMessages(
          config.id,
          secrets,
          chatId,
          limit,
          sinceSeconds,
        );
    const recent = rows
      .filter((row) => !row.createTime || row.createTime >= cutoff)
      .slice(-limit);
    const names = new Map<string, string>();
    const messages = [];
    for (const row of recent) {
      messages.push({
        message_id: row.messageId,
        sender: await this.senderNameOf(config, row, names),
        time: row.createTime ? new Date(row.createTime).toISOString() : null,
        type: row.messageType,
        text: historyMessageText(row.messageType, row.content).slice(
          0,
          FEISHU_HISTORY_TEXT_LIMIT,
        ),
      });
    }
    return jsonResult({
      chat_id: chatId,
      thread_id: threadId,
      window: '最近 7 天',
      count: messages.length,
      messages,
    });
  }

  /** 发送者展示名：机器人消息记为「机器人」，用户尽力解析平台姓名 */
  private async senderNameOf(
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
}
