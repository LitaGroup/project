import { Injectable, Logger } from '@nestjs/common';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { beijingTime, mdFrontmatter } from '../../common/frontmatter';
import { TaskActorService } from '../../tasks/task-actor.service';
import { TaskCollaborationService } from '../../tasks/task-collaboration.service';
import { TaskDeliveryService } from '../../tasks/task-delivery.service';
import { TaskDocumentService } from '../../tasks/task-document.service';
import { TasksAgentService } from '../../tasks/tasks-agent.service';
import { TasksService } from '../../tasks/tasks.service';
import {
  asAuthedRequest,
  executeTool,
  markdownResult,
  requireWorkerPrincipal,
} from './work-tools.util';
import type { McpWorkPrincipal, WorkToolRegistrar } from './work-tools.types';

const TaskStatusArg = z
  .enum(['等待中', '进行中', '已结束'])
  .optional()
  .describe('主状态筛选');
const TaskSubStatusArg = z
  .enum([
    '待分配',
    '待接受',
    '待反馈',
    '待继续',
    '待申请验收',
    '待验收',
    '执行中',
    '完成',
    '已拒绝',
    '失败',
    '取消',
  ])
  .optional()
  .describe('子状态筛选');

const QuestionOptionArg = z.object({
  label: z.string().min(1).describe('选项文案'),
  description: z.string().optional().describe('选项说明'),
});

const QuestionArg = z.object({
  question: z.string().min(1).describe('问题正文'),
  header: z.string().min(1).describe('问题标题（短标签）'),
  options: z.array(QuestionOptionArg).optional().describe('可选项'),
  multiple: z.boolean().optional().describe('是否多选'),
  custom: z
    .boolean()
    .optional()
    .describe('是否允许自由输入，false 时只能选选项'),
  fieldKey: z.string().optional().describe('form 协议字段 key（可选）'),
});

const DeliveryReportArg = {
  delivery: z.string().optional().describe('交付结果、代码仓库/分支、文档清单'),
  problems: z.string().optional().describe('实现问题与解决过程'),
  detours: z.string().optional().describe('走过的弯路、返工或失败尝试'),
  lessons: z.string().optional().describe('可复用的经验与改进项'),
  followUps: z.string().optional().describe('遗留问题、建议与后续待办'),
  other: z.string().optional().describe('其它需要保留的信息'),
};

/**
 * 任务协同（MCP 二期）：我的任务、详情/创建、接受/拒绝、提问/答复、
 * 交付文档、任务文档、申请验收与需求方验收/返工/判失败。
 * 复用 tasks controller 相同的服务与身份校验，权限与 `.md` 端点一致。
 */
@Injectable()
export class WorkTaskTools implements WorkToolRegistrar {
  private readonly logger = new Logger(WorkTaskTools.name);

  constructor(
    private readonly tasksAgent: TasksAgentService,
    private readonly tasks: TasksService,
    private readonly collaboration: TaskCollaborationService,
    private readonly delivery: TaskDeliveryService,
    private readonly taskDocuments: TaskDocumentService,
    private readonly taskActors: TaskActorService,
  ) {}

  register(server: McpServer, principal: McpWorkPrincipal): void {
    server.registerTool(
      'list_my_tasks',
      {
        title: '我的任务清单',
        description:
          '按当前身份返回作为需求方、执行方或负责方的任务清单（最多 300 条），支持编号/标题搜索与状态筛选。',
        inputSchema: {
          q: z.string().optional().describe('编号或标题模糊搜索'),
          status: TaskStatusArg,
          subStatus: TaskSubStatusArg,
          rootOnly: z.boolean().optional().describe('只看根任务'),
        },
      },
      async (args) =>
        executeTool(this.logger, 'list_my_tasks', principal, async () => {
          const scope = await this.tasksAgent.resolveScope(
            asAuthedRequest(principal),
          );
          return markdownResult(
            await this.tasksAgent.listMarkdown(scope, {
              q: args.q,
              status: args.status,
              subStatus: args.subStatus,
              rootOnly: args.rootOnly,
            }),
          );
        }),
    );

    server.registerTool(
      'get_task',
      {
        title: '任务详情',
        description:
          '读取任务详情：状态、需求方/执行方、文档目录、描述/输入/需求/输出要求/工作计划、待反馈事项、子任务、最近事件与交付结果。',
        inputSchema: {
          taskId: z.number().int().positive().describe('任务 ID'),
        },
      },
      async (args) =>
        executeTool(this.logger, 'get_task', principal, async () => {
          const scope = await this.tasksAgent.resolveScope(
            asAuthedRequest(principal),
          );
          return markdownResult(
            await this.tasksAgent.detailMarkdown(scope, args.taskId),
          );
        }),
    );

    server.registerTool(
      'create_task',
      {
        title: '创建任务',
        description:
          '创建根任务并交由平台按任务定义自动分配机器人。至少提供 title 或 description。',
        inputSchema: {
          title: z.string().optional().describe('任务标题'),
          description: z.string().optional().describe('任务描述'),
          input: z.string().optional().describe('原始需求/补充输入'),
          outputSpec: z.string().optional().describe('交付方式与输出要求'),
          templateId: z
            .number()
            .int()
            .positive()
            .optional()
            .describe('任务定义 ID（可用 list_task_defines 查询）'),
        },
      },
      async (args) =>
        executeTool(this.logger, 'create_task', principal, async () =>
          markdownResult(
            await this.tasksAgent.createMarkdown(
              asAuthedRequest(principal),
              args,
            ),
          ),
        ),
    );

    server.registerTool(
      'list_task_defines',
      {
        title: '任务定义清单',
        description:
          '查询当前支持分发的任务定义（名称、说明与可用机器人），创建子任务前先查询 templateId。',
        inputSchema: {},
      },
      async () =>
        executeTool(this.logger, 'list_task_defines', principal, async () =>
          markdownResult(await this.collaboration.definesMarkdown()),
        ),
    );

    server.registerTool(
      'create_subtask',
      {
        title: '创建子任务',
        description:
          '父任务执行机器人按任务定义创建子任务；需要机器人身份。创建后父任务成为子任务需求方。',
        inputSchema: {
          parentTaskId: z.number().int().positive().describe('父任务 ID'),
          templateId: z.number().int().positive().describe('任务定义 ID'),
          title: z.string().min(1).describe('子任务标题'),
          description: z.string().optional().describe('子任务描述'),
          input: z.string().optional().describe('子任务输入'),
          outputSpec: z.string().optional().describe('子任务输出要求'),
        },
      },
      async (args) =>
        executeTool(this.logger, 'create_subtask', principal, async () => {
          const worker = requireWorkerPrincipal(principal);
          const task = await this.collaboration.createSubtask(
            args.parentTaskId,
            worker,
            {
              templateId: args.templateId,
              title: args.title,
              description: args.description,
              input: args.input,
              outputSpec: args.outputSpec,
            },
          );
          return markdownResult(
            this.collaboration.actionMarkdown('子任务已创建', task, [
              `- 父任务：${args.parentTaskId}`,
              `- 需求方机器人：${worker.name}（${worker.id}）`,
            ]),
          );
        }),
    );

    server.registerTool(
      'accept_task',
      {
        title: '接受任务',
        description:
          '负责机器人在「等待中-待接受」接受邀约，进入执行中；达到并行上限时拒绝接受。',
        inputSchema: {
          taskId: z.number().int().positive().describe('任务 ID'),
        },
      },
      async (args) =>
        executeTool(this.logger, 'accept_task', principal, async () => {
          const task = await this.collaboration.accept(
            args.taskId,
            requireWorkerPrincipal(principal),
          );
          return markdownResult(
            this.collaboration.actionMarkdown('任务已接受', task),
          );
        }),
    );

    server.registerTool(
      'refuse_task',
      {
        title: '拒绝任务',
        description:
          '负责机器人在待接受阶段拒绝不匹配的任务；必须填写理由，尽量给出分发建议。',
        inputSchema: {
          taskId: z.number().int().positive().describe('任务 ID'),
          reason: z.string().min(1).describe('拒绝理由'),
          suggestion: z.string().optional().describe('分发建议'),
        },
      },
      async (args) =>
        executeTool(this.logger, 'refuse_task', principal, async () => {
          const task = await this.collaboration.refuse(
            args.taskId,
            requireWorkerPrincipal(principal),
            args.reason,
            args.suggestion,
          );
          return markdownResult(
            this.collaboration.actionMarkdown('任务已拒绝承接', task, [
              `- 拒绝理由：${task.refusalReason ?? '-'}`,
              `- 分发建议：${task.dispatchSuggestion ?? '-'}`,
            ]),
          );
        }),
    );

    server.registerTool(
      'ask_task_question',
      {
        title: '向需求方提问',
        description:
          '执行机器人在执行中向需求方提问；提交后停止本轮，等待平台在需求方答复后恢复会话。',
        inputSchema: {
          taskId: z.number().int().positive().describe('任务 ID'),
          questions: z
            .array(QuestionArg)
            .min(1)
            .describe('问题列表（按顺序展示）'),
        },
      },
      async (args) =>
        executeTool(this.logger, 'ask_task_question', principal, async () => {
          const result = await this.collaboration.ask(
            args.taskId,
            requireWorkerPrincipal(principal),
            { questions: args.questions },
          );
          return markdownResult(
            this.collaboration.actionMarkdown('任务提问已提交', result.task, [
              `- 提问 ID：${result.questionId}`,
              '- 后续：请停止本轮执行，等待需求方答复后由平台恢复会话。',
            ]),
          );
        }),
    );

    server.registerTool(
      'answer_task_question',
      {
        title: '答复任务提问',
        description:
          '需求方（用户或父任务机器人）或管理员答复执行方提问；answers 按问题顺序，reject=true 表示跳过。',
        inputSchema: {
          taskId: z.number().int().positive().describe('任务 ID'),
          questionId: z.string().min(1).describe('提问 ID'),
          answers: z
            .array(z.array(z.string()))
            .optional()
            .describe('按问题顺序的答案（选项 label + 自定义文本）'),
          reject: z.boolean().optional().describe('跳过本次提问'),
        },
      },
      async (args) =>
        executeTool(
          this.logger,
          'answer_task_question',
          principal,
          async () => {
            const actor = await this.taskActors.resolveRequesterActor(
              principal,
              args.taskId,
            );
            const task = await this.collaboration.answer(
              args.taskId,
              args.questionId,
              actor,
              { answers: args.answers, reject: args.reject === true },
            );
            return markdownResult(
              this.collaboration.actionMarkdown('提问已答复', task),
            );
          },
        ),
    );

    server.registerTool(
      'reply_task_message',
      {
        title: '回复任务消息',
        description:
          '需求方（用户或父任务机器人）回复子任务执行方的普通消息；只写入对话，不改变任务状态。',
        inputSchema: {
          taskId: z.number().int().positive().describe('任务 ID'),
          content: z.string().min(1).describe('回复内容'),
        },
      },
      async (args) =>
        executeTool(this.logger, 'reply_task_message', principal, async () => {
          const actor = await this.taskActors.resolveRequesterActor(
            principal,
            args.taskId,
          );
          const task = await this.collaboration.replyMessage(
            args.taskId,
            actor,
            args.content,
          );
          return markdownResult(
            this.collaboration.actionMarkdown('消息已回复', task),
          );
        }),
    );

    server.registerTool(
      'list_task_documents',
      {
        title: '任务文档清单',
        description:
          '列出任务目录下的文档（API / TECH_DESIGN / HANDOFF / REVIEW 等）及 Markdown 阅读地址。',
        inputSchema: {
          taskId: z.number().int().positive().describe('任务 ID'),
        },
      },
      async (args) =>
        executeTool(this.logger, 'list_task_documents', principal, async () => {
          const task = await this.tasks.mustFind(args.taskId);
          const documents = await this.taskDocuments.listTaskDocuments(task);
          return markdownResult(
            this.taskDocuments.taskDocumentsMarkdown(task, documents),
          );
        }),
    );

    server.registerTool(
      'upsert_task_document',
      {
        title: '写入任务文档',
        description:
          '写入任务目录下的普通文档（如 API.md / TECH_DESIGN.md）。HANDOFF/REVIEW 必须走交付文档与验收流程。',
        inputSchema: {
          taskId: z.number().int().positive().describe('任务 ID'),
          name: z
            .string()
            .min(1)
            .describe('文档名，支持 API / API.md / TECH_DESIGN.md'),
          content: z.string().optional().describe('完整 Markdown 正文'),
          title: z.string().optional().describe('文档标题'),
        },
      },
      async (args) =>
        executeTool(
          this.logger,
          'upsert_task_document',
          principal,
          async () => {
            const task = await this.tasks.mustFind(args.taskId);
            const updatedBy = await this.taskActors.resolveDocumentAuthor(
              task,
              principal,
            );
            const entry = await this.taskDocuments.upsertTaskDocument(task, {
              name: args.name,
              content: args.content,
              title: args.title,
              updatedBy,
            });
            return markdownResult(
              [
                mdFrontmatter({
                  title: `任务 ${task.code} 文档已更新`,
                  update: new Date(),
                }),
                '# 任务文档已更新',
                '',
                `- 文档：\`${entry.name}\``,
                `- 知识路径：\`${entry.path}\``,
                `- 阅读地址：\`/api${entry.markdownUrl}\``,
                `- 更新时间：${beijingTime(new Date())}`,
                '',
                `> 任务文档目录：\`${this.taskDocuments.taskDirectory(task)}\`。HANDOFF 请使用 update_task_handoff 工具维护。`,
                '',
              ].join('\n'),
            );
          },
        ),
    );

    server.registerTool(
      'read_task_handoff',
      {
        title: '读取交付文档',
        description: '读取任务交付文档（HANDOFF）正文与平台维护的版本信息。',
        inputSchema: {
          taskId: z.number().int().positive().describe('任务 ID'),
        },
      },
      async (args) =>
        executeTool(this.logger, 'read_task_handoff', principal, async () =>
          markdownResult(await this.delivery.getHandoffMarkdown(args.taskId)),
        ),
    );

    server.registerTool(
      'update_task_handoff',
      {
        title: '更新交付文档',
        description:
          '执行机器人维护交付文档：提交完整正文（或 append）与读取时的 baseVersion。首次创建 baseVersion=0；申请验收前必须补齐最终内容。',
        inputSchema: {
          taskId: z.number().int().positive().describe('任务 ID'),
          content: z
            .string()
            .optional()
            .describe('完整正文（与 append 二选一）'),
          append: z.string().optional().describe('追加到当前正文末尾'),
          baseVersion: z
            .number()
            .int()
            .min(0)
            .describe('读取时的版本号；首次创建用 0'),
        },
      },
      async (args) =>
        executeTool(this.logger, 'update_task_handoff', principal, async () => {
          const worker = requireWorkerPrincipal(principal);
          await this.delivery.updateHandoffByWorker(args.taskId, worker, {
            content: args.content,
            append: args.append,
            baseVersion: args.baseVersion,
            updatedBy: worker.name,
          });
          return markdownResult(
            await this.delivery.getHandoffMarkdown(args.taskId),
          );
        }),
    );

    server.registerTool(
      'apply_task_acceptance',
      {
        title: '申请验收',
        description:
          '执行机器人完成并自检后申请验收；交付文档必须已创建且为最终内容。会话结束不等于完成。',
        inputSchema: {
          taskId: z.number().int().positive().describe('任务 ID'),
          ...DeliveryReportArg,
        },
      },
      async (args) =>
        executeTool(
          this.logger,
          'apply_task_acceptance',
          principal,
          async () => {
            const { taskId, ...report } = args;
            return markdownResult(
              await this.delivery.apply(
                taskId,
                requireWorkerPrincipal(principal),
                report,
              ),
            );
          },
        ),
    );

    server.registerTool(
      'accept_task_handoff',
      {
        title: '验收通过',
        description: '任务需求方验收通过，任务完成并异步生成 REVIEW 复盘。',
        inputSchema: {
          taskId: z.number().int().positive().describe('任务 ID'),
        },
      },
      async (args) =>
        executeTool(this.logger, 'accept_task_handoff', principal, async () => {
          const actor = await this.taskActors.resolveRequesterActor(
            principal,
            args.taskId,
          );
          const task = await this.collaboration.acceptHandoff(
            args.taskId,
            actor,
          );
          return markdownResult(
            this.collaboration.actionMarkdown('任务验收已通过', task),
          );
        }),
    );

    server.registerTool(
      'refuse_task_handoff',
      {
        title: '验收不通过',
        description: '任务需求方拒绝验收并退回原执行机器人返工；反馈原因必填。',
        inputSchema: {
          taskId: z.number().int().positive().describe('任务 ID'),
          content: z.string().min(1).describe('不通过原因与返工要求'),
        },
      },
      async (args) =>
        executeTool(this.logger, 'refuse_task_handoff', principal, async () => {
          const actor = await this.taskActors.resolveRequesterActor(
            principal,
            args.taskId,
          );
          const task = await this.collaboration.refuseHandoff(
            args.taskId,
            actor,
            args.content,
          );
          return markdownResult(
            this.collaboration.actionMarkdown('任务验收已拒绝', task),
          );
        }),
    );

    server.registerTool(
      'fail_task',
      {
        title: '判定任务失败',
        description:
          '仅任务需求方在待验收阶段判定失败；失败原因必填。不得代替需求方验收或判失败。',
        inputSchema: {
          taskId: z.number().int().positive().describe('任务 ID'),
          reason: z.string().min(1).describe('失败原因'),
        },
      },
      async (args) =>
        executeTool(this.logger, 'fail_task', principal, async () => {
          const actor = await this.taskActors.resolveRequesterActor(
            principal,
            args.taskId,
          );
          const task = await this.collaboration.fail(
            args.taskId,
            actor,
            args.reason,
          );
          return markdownResult(
            this.collaboration.actionMarkdown('任务已判定失败', task, [
              `- 失败原因：${task.failureReason ?? '-'}`,
            ]),
          );
        }),
    );
  }
}
