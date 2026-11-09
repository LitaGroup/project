import { Injectable, Logger } from '@nestjs/common';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { TicketDocumentsService } from '../../tickets/ticket-documents.service';
import { TicketsService } from '../../tickets/tickets.service';
import {
  executeTool,
  markdownResult,
  requireWorkerPrincipal,
} from './work-tools.util';
import type { McpWorkPrincipal, WorkToolRegistrar } from './work-tools.types';

/**
 * 工单（MCP 二期）：调度工单上下文与任务定义转交、工作流工单上下文与节点拒绝、
 * 工单交付文档的查询/交付/更新/删除。权限与 `.md` 端点一致（写操作仅任务执行机器人）。
 */
@Injectable()
export class WorkTicketTools implements WorkToolRegistrar {
  private readonly logger = new Logger(WorkTicketTools.name);

  constructor(
    private readonly tickets: TicketsService,
    private readonly ticketDocuments: TicketDocumentsService,
  ) {}

  register(server: McpServer, principal: McpWorkPrincipal): void {
    server.registerTool(
      'get_task_ticket',
      {
        title: '读取任务所属工单',
        description:
          '读取当前任务对应的调度工单上下文：工单信息、当前识别结果、可转派任务定义与接口说明。',
        inputSchema: {
          taskId: z.number().int().positive().describe('任务 ID'),
        },
      },
      async (args) =>
        executeTool(this.logger, 'get_task_ticket', principal, async () =>
          markdownResult(await this.tickets.taskTicketMarkdown(args.taskId)),
        ),
    );

    server.registerTool(
      'route_task_ticket',
      {
        title: '工单转交任务定义',
        description:
          '调度工单澄清完成后，把当前任务转交给管理员配置的后续任务定义；调用后结束本轮，不要继续执行或申请验收。',
        inputSchema: {
          taskId: z.number().int().positive().describe('任务 ID'),
          templateId: z.number().int().positive().describe('目标任务定义 ID'),
          title: z.string().min(1).describe('澄清后的标题'),
          content: z.string().min(1).describe('澄清后的需求内容'),
          outputSpec: z.string().min(1).describe('交付要求'),
          workPlan: z.string().min(1).describe('工作计划'),
        },
      },
      async (args) =>
        executeTool(this.logger, 'route_task_ticket', principal, async () => {
          const { taskId, ...dto } = args;
          return markdownResult(
            await this.tickets.routeMarkdown(
              taskId,
              requireWorkerPrincipal(principal),
              dto,
            ),
          );
        }),
    );

    server.registerTool(
      'get_ticket',
      {
        title: '工单完整上下文',
        description:
          '工作流工单完整信息：工单信息、需求正文、工单输入、流程进度、各节点输入输出、待回答问题、失败原因与交付文档全文。',
        inputSchema: {
          ticketId: z.number().int().positive().describe('工单 ID'),
        },
      },
      async (args) =>
        executeTool(this.logger, 'get_ticket', principal, async () =>
          markdownResult(await this.tickets.ticketMarkdown(args.ticketId)),
        ),
    );

    server.registerTool(
      'reject_ticket_node',
      {
        title: '拒绝工单当前节点',
        description:
          '当前节点处理机器人拒绝节点：nodeKey 必须与工单当前节点一致，reason 必填；调用后结束本轮。',
        inputSchema: {
          ticketId: z.number().int().positive().describe('工单 ID'),
          nodeKey: z.string().min(1).describe('当前节点 key'),
          reason: z.string().min(1).describe('拒绝原因'),
        },
      },
      async (args) =>
        executeTool(this.logger, 'reject_ticket_node', principal, async () =>
          markdownResult(
            await this.tickets.rejectMarkdown(
              args.ticketId,
              requireWorkerPrincipal(principal),
              { nodeKey: args.nodeKey, reason: args.reason },
            ),
          ),
        ),
    );

    server.registerTool(
      'list_ticket_documents',
      {
        title: '工单交付文档清单',
        description:
          '查看任务所属工单的交付文档清单与调用示例（历史工单与工作流节点任务均支持）。',
        inputSchema: {
          taskId: z.number().int().positive().describe('任务 ID'),
        },
      },
      async (args) =>
        executeTool(this.logger, 'list_ticket_documents', principal, async () =>
          markdownResult(await this.ticketDocuments.listMarkdown(args.taskId)),
        ),
    );

    server.registerTool(
      'read_ticket_document',
      {
        title: '读取工单交付文档',
        description:
          '读取一篇工单交付文档（链接形态返回引用，正文形态返回全文）。',
        inputSchema: {
          taskId: z.number().int().positive().describe('任务 ID'),
          documentId: z.number().int().positive().describe('工单文档 ID'),
        },
      },
      async (args) =>
        executeTool(this.logger, 'read_ticket_document', principal, async () =>
          markdownResult(
            await this.ticketDocuments.readMarkdown(
              args.taskId,
              args.documentId,
            ),
          ),
        ),
    );

    server.registerTool(
      'deliver_ticket_document',
      {
        title: '交付工单文档',
        description:
          '任务执行机器人把文档交付给所属工单：title 必填，url 与 content 必须且只能提供一个。交付不影响任务验收状态。',
        inputSchema: {
          taskId: z.number().int().positive().describe('任务 ID'),
          title: z.string().min(1).describe('文档标题'),
          url: z
            .string()
            .optional()
            .describe('链接地址（http(s) 或站内绝对路径 /api/docs/...）'),
          content: z.string().optional().describe('独立 Markdown 正文副本'),
        },
      },
      async (args) =>
        executeTool(
          this.logger,
          'deliver_ticket_document',
          principal,
          async () => {
            const { taskId, ...dto } = args;
            return markdownResult(
              await this.ticketDocuments.createMarkdown(
                taskId,
                requireWorkerPrincipal(principal),
                dto,
              ),
            );
          },
        ),
    );

    server.registerTool(
      'update_ticket_document',
      {
        title: '更新工单文档',
        description:
          '更新本任务交付的工单文档；title/url/content 至少传一项，url 与 content 只能传一项（传入会切换文档形态）。',
        inputSchema: {
          taskId: z.number().int().positive().describe('任务 ID'),
          documentId: z.number().int().positive().describe('工单文档 ID'),
          title: z.string().optional().describe('新标题'),
          url: z.string().optional().describe('切换为链接形态'),
          content: z.string().optional().describe('切换为正文形态'),
        },
      },
      async (args) =>
        executeTool(
          this.logger,
          'update_ticket_document',
          principal,
          async () => {
            const { taskId, documentId, ...dto } = args;
            return markdownResult(
              await this.ticketDocuments.updateMarkdown(
                taskId,
                documentId,
                requireWorkerPrincipal(principal),
                dto,
              ),
            );
          },
        ),
    );

    server.registerTool(
      'delete_ticket_document',
      {
        title: '删除工单文档',
        description: '删除本任务交付的工单文档；其它节点任务交付的文档只读。',
        inputSchema: {
          taskId: z.number().int().positive().describe('任务 ID'),
          documentId: z.number().int().positive().describe('工单文档 ID'),
        },
      },
      async (args) =>
        executeTool(
          this.logger,
          'delete_ticket_document',
          principal,
          async () =>
            markdownResult(
              await this.ticketDocuments.deleteMarkdown(
                args.taskId,
                args.documentId,
                requireWorkerPrincipal(principal),
              ),
            ),
        ),
    );
  }
}
