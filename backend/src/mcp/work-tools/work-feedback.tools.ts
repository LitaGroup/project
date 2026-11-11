import { Injectable, Logger } from '@nestjs/common';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { FeedbackStatus, FeedbackType } from '../../common/enums';
import { FeedbacksService } from '../../feedbacks/feedbacks.service';
import { executeTool, markdownResult } from './work-tools.util';
import type { McpWorkPrincipal, WorkToolRegistrar } from './work-tools.types';

const FeedbackTypeArg = z
  .enum(Object.values(FeedbackType) as [FeedbackType, ...FeedbackType[]])
  .describe('反馈类型：BUG/建议/其它');

const FeedbackStatusArg = z
  .enum(Object.values(FeedbackStatus) as [FeedbackStatus, ...FeedbackStatus[]])
  .describe('反馈状态：待处理/处理中/已解决/已关闭');

/**
 * 用户反馈读取（含「系统-反馈处理」从飞书反馈群自动收录的话题反馈）。
 * 分发动作（创建任务/缺陷等）复用既有 MCP 工具；反馈状态流转仍走平台管理端点。
 */
@Injectable()
export class WorkFeedbackTools implements WorkToolRegistrar {
  private readonly logger = new Logger(WorkFeedbackTools.name);

  constructor(private readonly feedbacks: FeedbacksService) {}

  register(server: McpServer, principal: McpWorkPrincipal): void {
    server.registerTool(
      'list_feedbacks',
      {
        title: '反馈清单',
        description:
          '按关键词/状态/类型筛选用户反馈，返回 Markdown 表格（含来源：平台/飞书群；ID 即详情入口）。',
        inputSchema: {
          q: z
            .string()
            .optional()
            .describe('关键词（标题/提交人，支持拼音首字母）'),
          status: FeedbackStatusArg.optional(),
          type: FeedbackTypeArg.optional(),
        },
      },
      async (args) =>
        executeTool(this.logger, 'list_feedbacks', principal, async () =>
          markdownResult(
            await this.feedbacks.listMarkdown({
              q: args.q,
              status: args.status,
              type: args.type,
            }),
          ),
        ),
    );

    server.registerTool(
      'get_feedback',
      {
        title: '反馈详情',
        description:
          '读取反馈元信息（类型/状态/来源群与话题）、正文、跟帖（飞书群话题内后续成员消息）与处理信息。',
        inputSchema: {
          feedbackId: z.number().int().positive().describe('反馈 ID'),
        },
      },
      async (args) =>
        executeTool(this.logger, 'get_feedback', principal, async () =>
          markdownResult(await this.feedbacks.findOneMarkdown(args.feedbackId)),
        ),
    );
  }
}
