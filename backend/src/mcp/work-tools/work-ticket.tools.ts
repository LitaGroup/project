import { Injectable, Logger } from '@nestjs/common';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { TicketDocumentsService } from '../../tickets/ticket-documents.service';
import { TicketsService } from '../../tickets/tickets.service';
import { WorkflowDefinitionsService } from '../../workflows/workflow-definitions.service';
import type { WorkflowInputField } from '../../workflows/workflow.types';
import {
  asAuthedRequest,
  executeTool,
  markdownResult,
  requireWorkerPrincipal,
} from './work-tools.util';
import type { McpWorkPrincipal, WorkToolRegistrar } from './work-tools.types';

/** Markdown 表格单元格转义 */
function cell(value: string | number | null | undefined): string {
  const text = value == null ? '' : String(value);
  return text.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ') || '-';
}

/** 起始节点输入字段表格 */
function inputFieldsLines(fields: WorkflowInputField[]): string[] {
  if (!fields.length) return ['起始节点无输入字段。'];
  return [
    '| 字段 key | 名称 | 类型 | 必填 | 选项 | 默认值 |',
    '|---|---|---|---|---|---|',
    ...fields.map(
      (field) =>
        `| ${cell(field.key)} | ${cell(field.label)} | ${cell(field.type)} | ${
          field.required ? '是' : '否'
        } | ${cell((field.options ?? []).join(' / '))} | ${cell(
          field.defaultValue as string | number | null,
        )} |`,
    ),
  ];
}

/**
 * 工单（MCP 二期）：调度工单上下文与任务定义转交、工作流工单上下文与节点拒绝、
 * 工单创建与验收、工单交付文档的查询/交付/更新/删除。
 * 权限与 `.md` 端点一致（写操作仅任务执行机器人）。
 */
@Injectable()
export class WorkTicketTools implements WorkToolRegistrar {
  private readonly logger = new Logger(WorkTicketTools.name);

  constructor(
    private readonly tickets: TicketsService,
    private readonly ticketDocuments: TicketDocumentsService,
    private readonly workflows: WorkflowDefinitionsService,
  ) {}

  register(server: McpServer, principal: McpWorkPrincipal): void {
    server.registerTool(
      'list_ticket_defines',
      {
        title: '工单配置清单',
        description:
          '查询可创建工单的配置（启用且已发布）及起始节点输入字段；创建工单前先查询 workflowDefinitionId 与字段定义。',
        inputSchema: {},
      },
      async () =>
        executeTool(this.logger, 'list_ticket_defines', principal, async () => {
          const summaries = await this.workflows.findAll();
          const creatable = summaries.filter(
            (item) => item.enabled && item.latestPublishedVersion > 0,
          );
          if (!creatable.length) {
            return markdownResult(
              '# 工单配置清单\n\n（暂无可创建工单的配置：需启用且已有发布版本）\n',
            );
          }
          const details = await Promise.all(
            creatable.map((item) => this.workflows.findOne(item.id)),
          );
          const lines = ['# 工单配置清单', ''];
          for (const detail of details) {
            const start = detail.published?.definition.nodes.find(
              (node) => node.kind === 'start',
            );
            lines.push(
              `## ${detail.name}（workflowDefinitionId=${detail.id}）`,
              '',
              `- 分类：${detail.category}`,
              `- 发布版本：v${detail.latestPublishedVersion}`,
            );
            if (detail.description?.trim()) {
              lines.push(`- 说明：${detail.description.trim()}`);
            }
            lines.push(
              '',
              '### 起始节点输入字段',
              '',
              ...inputFieldsLines(start?.inputFields ?? []),
              '',
              `调用示例：\`create_ticket {"workflowDefinitionId": ${detail.id}, "title": "...", "inputValues": {"<字段 key>": "<值>"}}\``,
              '',
            );
          }
          return markdownResult(lines.join('\n'));
        }),
    );

    server.registerTool(
      'create_ticket',
      {
        title: '创建工单',
        description:
          '按工单配置创建工单并进入起始节点派发。workflowDefinitionId 与起始节点字段可通过 list_ticket_defines 查询；真人机器人令牌以绑定真人身份发起，AI 机器人令牌以自身为发起机器人。',
        inputSchema: {
          workflowDefinitionId: z
            .number()
            .int()
            .positive()
            .describe('工单配置 ID（用 list_ticket_defines 查询）'),
          title: z
            .string()
            .optional()
            .describe('工单标题（缺省按输入字段自动生成）'),
          inputValues: z
            .record(z.string(), z.unknown())
            .optional()
            .describe('起始节点输入字段（key → 值）'),
        },
      },
      async (args) =>
        executeTool(this.logger, 'create_ticket', principal, async () => {
          const ticket = await this.tickets.create(
            {
              workflowDefinitionId: args.workflowDefinitionId,
              title: args.title,
              inputValues: args.inputValues ?? {},
            },
            { user: principal.user ?? null, worker: principal.worker ?? null },
          );
          return markdownResult(await this.tickets.ticketMarkdown(ticket.id));
        }),
    );

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
      'accept_ticket',
      {
        title: '验收工单',
        description:
          '工单发起机器人验收当前验收节点：approved 完成工单，rejected 按流程退回；仅工单发起机器人（或其绑定用户）可用。',
        inputSchema: {
          ticketId: z.number().int().positive().describe('工单 ID'),
          outcome: z
            .enum(['approved', 'rejected'])
            .describe('验收结果：approved 通过 / rejected 驳回'),
          remark: z.string().optional().describe('验收说明'),
        },
      },
      async (args) =>
        executeTool(this.logger, 'accept_ticket', principal, async () => {
          const ticket = await this.tickets.acceptWorkflow(
            args.ticketId,
            args.outcome,
            asAuthedRequest(principal),
            args.remark,
          );
          return markdownResult(await this.tickets.ticketMarkdown(ticket.id));
        }),
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
