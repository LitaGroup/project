import { Injectable, Logger } from '@nestjs/common';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  WorkerGithubPermission,
  WorkerResourcePermission,
  WorkerRole,
} from '../../common/enums';
import { TaskTemplatesService } from '../../tasks/task-templates.service';
import type { TaskTemplateActor } from '../../tasks/task-templates.service';
import { WorkerSkillCatalogService } from '../../workers/worker-skill-catalog.service';
import { WorkerStandardCatalogService } from '../../workers/worker-standard-catalog.service';
import { WorkersMarkdownService } from '../../workers/workers-markdown.service';
import { executeTool, jsonResult, markdownResult } from './work-tools.util';
import type { McpWorkPrincipal, WorkToolRegistrar } from './work-tools.types';

const WorkerRoleArg = z.enum(
  Object.values(WorkerRole) as [WorkerRole, ...WorkerRole[]],
);
const GithubPermissionArg = z.enum(
  Object.values(WorkerGithubPermission) as [
    WorkerGithubPermission,
    ...WorkerGithubPermission[],
  ],
);
const ResourcePermissionArg = z.enum(
  Object.values(WorkerResourcePermission) as [
    WorkerResourcePermission,
    ...WorkerResourcePermission[],
  ],
);

const SkillArg = z.object({
  name: z.string().describe('技能展示名'),
  path: z
    .string()
    .describe('技能库内 SKILL.md 相对路径，如 active/rank/SKILL.md'),
  url: z.string().describe('SKILL.md 原始下载地址'),
  description: z.string().nullish().describe('技能说明'),
  version: z.string().nullish().describe('版本'),
  sourceUrl: z.string().nullish().describe('源页面地址'),
});

const StandardArg = z.object({
  name: z.string().describe('规范展示名'),
  path: z.string().describe('规范库内 README.md 相对路径'),
  directory: z.string().describe('规范所在目录，如 fe/h5'),
  url: z.string().describe('README 原始下载地址'),
  description: z.string().nullish().describe('规范说明'),
  version: z.string().nullish().describe('版本'),
  sourceUrl: z.string().nullish().describe('源页面地址'),
});

const TaskDefArg = z.object({
  inputs: z.array(
    z.object({
      name: z.string(),
      desc: z.string().optional(),
      required: z.boolean().optional(),
    }),
  ),
  outputs: z.array(z.object({ name: z.string(), desc: z.string().optional() })),
  how: z.string().optional().describe('完成方式说明'),
});

const CommonWorkerFields = {
  intro: z.string().nullish().describe('简介：擅长什么、能接什么任务'),
  avatarUrl: z.string().nullish().describe('头像（仅 /images/... 路径）'),
  executorId: z.number().int().positive().nullish().describe('执行器 ID'),
  providerId: z.string().nullish().describe('供应商 ID'),
  modelId: z.string().nullish().describe('模型 ID'),
  variant: z.string().nullish().describe('默认思考等级'),
  backupProviderId: z
    .string()
    .nullish()
    .describe('备用模型供应商 ID（主模型限额/限流时自动切换，可空）'),
  backupModelId: z
    .string()
    .nullish()
    .describe('备用模型 ID（主模型限额/限流时自动切换，可空）'),
  backupVariant: z.string().nullish().describe('备用模型思考等级'),
  prompt: z.string().nullish().describe('机器人定义 AGENTS.md'),
  skills: z
    .array(SkillArg)
    .nullish()
    .describe('技能清单（先用 list_worker_skill_catalog 查询）'),
  standards: z
    .array(StandardArg)
    .nullish()
    .describe('规范清单（先用 list_worker_standard_catalog 查询）'),
  mcps: z
    .array(z.number().int().positive())
    .nullish()
    .describe('MCP 配置 ID 清单（管理区「MCP 配置」）'),
  taskDefs: z.array(TaskDefArg).nullish().describe('机器人任务定义'),
  ownerUserId: z.number().int().positive().nullish().describe('责任人用户 ID'),
  enabled: z.boolean().optional().describe('启用状态'),
  githubPermission: GithubPermissionArg.optional().describe('GitHub 权限'),
  resourcePermission: ResourcePermissionArg.optional().describe('资源网关权限'),
  maxParallelTasks: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe('并行执行上限（1 表示串行，默认 3，仅 AI 机器人）'),
};

/**
 * 机器人与任务定义管理（MCP 二期）：机器人清单/详情/创建/编辑/删除、
 * 技能库与规范库目录、任务定义清单/详情/创建/编辑/删除。
 * 权限与 `.md` 端点一致（沿用用户/公共 Agent/机器人令牌身份）。
 */
@Injectable()
export class WorkAgentTools implements WorkToolRegistrar {
  private readonly logger = new Logger(WorkAgentTools.name);

  constructor(
    private readonly workersMarkdown: WorkersMarkdownService,
    private readonly skillCatalog: WorkerSkillCatalogService,
    private readonly standardCatalog: WorkerStandardCatalogService,
    private readonly taskTemplates: TaskTemplatesService,
  ) {}

  register(server: McpServer, principal: McpWorkPrincipal): void {
    server.registerTool(
      'list_workers',
      {
        title: '机器人清单',
        description:
          '列出机器人（可按角色筛选），含归属/角色/运行时/权限/并行上限/实时状态/执行器/模型/当前任务。',
        inputSchema: {
          role: WorkerRoleArg.optional().describe('按角色筛选'),
        },
      },
      async (args) =>
        executeTool(this.logger, 'list_workers', principal, async () =>
          markdownResult(
            await this.workersMarkdown.listMarkdown(
              args.role ? { role: args.role } : undefined,
            ),
          ),
        ),
    );

    server.registerTool(
      'get_worker',
      {
        title: '机器人详情',
        description:
          '读取机器人配置与工位信息（不含 agentToken 与令牌文件内容）。',
        inputSchema: {
          workerId: z.number().int().positive().describe('机器人 ID'),
        },
      },
      async (args) =>
        executeTool(this.logger, 'get_worker', principal, async () =>
          markdownResult(
            await this.workersMarkdown.findOneMarkdown(args.workerId),
          ),
        ),
    );

    server.registerTool(
      'create_worker',
      {
        title: '创建机器人',
        description:
          '创建自定义 AI 工作者（运行时固定 opencode，ID 从 1000 开始）。启用中必须配置执行器、供应商与模型；保存后自动异步初始化工位。',
        inputSchema: {
          name: z.string().min(1).describe('名称（唯一）'),
          ...CommonWorkerFields,
        },
      },
      async (args) =>
        executeTool(this.logger, 'create_worker', principal, async () =>
          markdownResult(await this.workersMarkdown.createMarkdown(args)),
        ),
    );

    server.registerTool(
      'update_worker',
      {
        title: '编辑机器人',
        description:
          '编辑机器人配置：未提交字段保持不变，null 清除可空字段；保存后自动异步重新初始化工位（真人机器人跳过）。',
        inputSchema: {
          workerId: z.number().int().positive().describe('机器人 ID'),
          name: z.string().min(1).optional().describe('新名称'),
          ...CommonWorkerFields,
        },
      },
      async (args) =>
        executeTool(this.logger, 'update_worker', principal, async () => {
          const { workerId, ...input } = args;
          return markdownResult(
            await this.workersMarkdown.updateMarkdown(workerId, input),
          );
        }),
    );

    server.registerTool(
      'delete_worker',
      {
        title: '删除机器人',
        description:
          '删除自定义机器人；系统机器人、真人机器人与个人 AGENT 不可删除，存在未完结任务时拒绝。',
        inputSchema: {
          workerId: z.number().int().positive().describe('机器人 ID'),
        },
      },
      async (args) =>
        executeTool(this.logger, 'delete_worker', principal, async () =>
          markdownResult(
            await this.workersMarkdown.removeMarkdown(args.workerId),
          ),
        ),
    );

    server.registerTool(
      'list_worker_skill_catalog',
      {
        title: '技能库目录',
        description:
          '从 Gitea 技能库发现可选 SKILL.md（name/description/version/path/url）；配置机器人 skills 前先查询。',
        inputSchema: {
          q: z.string().optional().describe('名称/描述/路径关键词'),
        },
      },
      async (args) =>
        executeTool(
          this.logger,
          'list_worker_skill_catalog',
          principal,
          async () => jsonResult(await this.skillCatalog.search(args.q)),
        ),
    );

    server.registerTool(
      'list_worker_standard_catalog',
      {
        title: '规范库目录',
        description:
          '从 Gitea 规范库发现可选规范目录 README.md；配置机器人 standards 前先查询。',
        inputSchema: {
          q: z.string().optional().describe('名称/描述/目录关键词'),
        },
      },
      async (args) =>
        executeTool(
          this.logger,
          'list_worker_standard_catalog',
          principal,
          async () => jsonResult(await this.standardCatalog.search(args.q)),
        ),
    );

    server.registerTool(
      'list_task_templates',
      {
        title: '任务定义清单',
        description: '列出任务定义（名称、描述、默认处理机器人与关注状态）。',
        inputSchema: {},
      },
      async () =>
        executeTool(this.logger, 'list_task_templates', principal, async () =>
          markdownResult(await this.taskTemplates.listMarkdown()),
        ),
    );

    server.registerTool(
      'get_task_template',
      {
        title: '任务定义详情',
        description:
          '读取任务定义详情：描述、默认处理机器人、系统定义标记与操作说明。',
        inputSchema: {
          templateId: z.number().int().positive().describe('任务定义 ID'),
        },
      },
      async (args) =>
        executeTool(this.logger, 'get_task_template', principal, async () =>
          markdownResult(
            await this.taskTemplates.findOneMarkdown(args.templateId),
          ),
        ),
    );

    server.registerTool(
      'create_task_template',
      {
        title: '创建任务定义',
        description:
          '创建任务定义：name 必填且唯一；agentIds 为默认处理机器人 ID（须启用、非调度机器人），空数组表示不指定。',
        inputSchema: {
          name: z.string().min(1).describe('名称（唯一）'),
          description: z.string().optional().describe('Markdown 描述'),
          agentIds: z
            .array(z.number().int().positive())
            .optional()
            .describe('默认处理机器人 ID 列表'),
        },
      },
      async (args) =>
        executeTool(this.logger, 'create_task_template', principal, async () =>
          markdownResult(
            await this.taskTemplates.createMarkdown(
              args,
              this.templateActor(principal),
            ),
          ),
        ),
    );

    server.registerTool(
      'update_task_template',
      {
        title: '编辑任务定义',
        description:
          '编辑任务定义：未提交字段保持不变；系统任务定义不可改名，可维护描述与处理机器人。',
        inputSchema: {
          templateId: z.number().int().positive().describe('任务定义 ID'),
          name: z.string().min(1).optional().describe('新名称'),
          description: z.string().nullish().describe('Markdown 描述'),
          agentIds: z
            .array(z.number().int().positive())
            .nullish()
            .describe('默认处理机器人 ID 列表'),
        },
      },
      async (args) =>
        executeTool(
          this.logger,
          'update_task_template',
          principal,
          async () => {
            const { templateId, ...input } = args;
            return markdownResult(
              await this.taskTemplates.updateMarkdown(templateId, input),
            );
          },
        ),
    );

    server.registerTool(
      'delete_task_template',
      {
        title: '删除任务定义',
        description:
          '删除任务定义（系统任务定义不可删除）；不影响已创建的历史任务。',
        inputSchema: {
          templateId: z.number().int().positive().describe('任务定义 ID'),
        },
      },
      async (args) =>
        executeTool(this.logger, 'delete_task_template', principal, async () =>
          markdownResult(
            await this.taskTemplates.removeMarkdown(args.templateId),
          ),
        ),
    );
  }

  /** 任务定义创建人：用户/公共 Agent 记录用户；机器人令牌仅记录机器人名称 */
  private templateActor(principal: McpWorkPrincipal): TaskTemplateActor | null {
    if (principal.user) {
      return { id: principal.user.id, name: principal.user.name };
    }
    if (principal.worker) {
      return { id: null, name: principal.worker.name };
    }
    return null;
  }
}
