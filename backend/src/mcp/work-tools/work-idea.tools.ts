import { Injectable, Logger } from '@nestjs/common';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  IdeaStatus,
  IdeaType,
  ProjectType,
  UserRole,
} from '../../common/enums';
import {
  IdeasService,
  UpdateIdeaInput,
  type IdeaActor,
} from '../../ideas/ideas.service';
import { executeTool, markdownResult } from './work-tools.util';
import type { McpWorkPrincipal, WorkToolRegistrar } from './work-tools.types';

const IdeaTypeArg = z
  .enum(Object.values(IdeaType) as [IdeaType, ...IdeaType[]])
  .describe('灵感类型：想法/创意/待办/建议/其它');

const IdeaStatusArg = z
  .enum(Object.values(IdeaStatus) as [IdeaStatus, ...IdeaStatus[]])
  .describe('灵感状态：构思/废弃/采纳');

const ProjectTypeArg = z
  .enum(Object.values(ProjectType) as [ProjectType, ...ProjectType[]])
  .describe('采纳新建需求时的项目类型：活动/功能/游戏/数据/后台/技术/其它');

/**
 * 灵感（业务分区「灵感」）：
 * - 机器人可创建灵感、在构思期协作完善正文；
 * - 状态流转（采纳/废弃）仅管理员身份可操作，采纳时新建或关联需求池需求。
 */
@Injectable()
export class WorkIdeaTools implements WorkToolRegistrar {
  private readonly logger = new Logger(WorkIdeaTools.name);

  constructor(private readonly ideas: IdeasService) {}

  register(server: McpServer, principal: McpWorkPrincipal): void {
    server.registerTool(
      'list_ideas',
      {
        title: '灵感清单',
        description:
          '按关键词/状态/类型筛选灵感，返回 Markdown 表格（ID 即详情入口；采纳后带关联需求）。',
        inputSchema: {
          q: z
            .string()
            .optional()
            .describe('关键词（标题/创建人，支持拼音首字母）'),
          status: IdeaStatusArg.optional(),
          type: IdeaTypeArg.optional(),
        },
      },
      async (args) =>
        executeTool(this.logger, 'list_ideas', principal, async () =>
          markdownResult(
            await this.ideas.listMarkdown({
              q: args.q,
              status: args.status,
              type: args.type,
            }),
          ),
        ),
    );

    server.registerTool(
      'get_idea',
      {
        title: '灵感详情',
        description:
          '读取灵感元信息（类型/状态/创建人/采纳关联需求）、Markdown 正文与图片。',
        inputSchema: {
          ideaId: z.number().int().positive().describe('灵感 ID'),
        },
      },
      async (args) =>
        executeTool(this.logger, 'get_idea', principal, async () =>
          markdownResult(await this.ideas.findOneMarkdown(args.ideaId)),
        ),
    );

    server.registerTool(
      'create_idea',
      {
        title: '创建灵感',
        description:
          '收集一个想法/创意/待办/建议。标题必填，正文为 Markdown（可空）；图片需先上传得到 /images/... 地址。',
        inputSchema: {
          title: z.string().min(1).max(200).describe('标题'),
          content: z.string().optional().describe('正文（Markdown，可空）'),
          type: IdeaTypeArg.optional(),
          images: z
            .array(z.string())
            .max(9)
            .optional()
            .describe('图片地址数组（/images/...，最多 9 张）'),
        },
      },
      async (args) =>
        executeTool(this.logger, 'create_idea', principal, async () => {
          const idea = await this.ideas.create(args, ideaActorOf(principal));
          return markdownResult(await this.ideas.findOneMarkdown(idea.id));
        }),
    );

    server.registerTool(
      'update_idea',
      {
        title: '完善灵感',
        description:
          '更新灵感标题/正文/类型/图片。构思期任何身份可协作完善；采纳或废弃后仅管理员可改。',
        inputSchema: {
          ideaId: z.number().int().positive().describe('灵感 ID'),
          title: z.string().min(1).max(200).optional().describe('标题'),
          content: z.string().optional().describe('正文（Markdown）'),
          type: IdeaTypeArg.optional(),
          images: z
            .array(z.string())
            .max(9)
            .optional()
            .describe('图片地址数组（/images/...，全量覆盖）'),
        },
      },
      async (args) =>
        executeTool(this.logger, 'update_idea', principal, async () => {
          const input: UpdateIdeaInput = {};
          if (args.title !== undefined) input.title = args.title;
          if (args.content !== undefined) input.content = args.content;
          if (args.type !== undefined) input.type = args.type;
          if (args.images !== undefined) input.images = args.images;
          const idea = await this.ideas.update(
            args.ideaId,
            input,
            ideaActorOf(principal),
          );
          return markdownResult(await this.ideas.findOneMarkdown(idea.id));
        }),
    );

    server.registerTool(
      'change_idea_status',
      {
        title: '流转灵感状态',
        description:
          '仅管理员：把灵感置为构思/废弃/采纳。采纳时用 createProject=true 在需求池新建需求，或传 projectId 关联已有需求。',
        inputSchema: {
          ideaId: z.number().int().positive().describe('灵感 ID'),
          status: IdeaStatusArg,
          createProject: z
            .boolean()
            .optional()
            .describe('采纳时在需求池新建需求（标题/正文取自灵感）'),
          projectId: z
            .number()
            .int()
            .positive()
            .optional()
            .describe('采纳时关联已有需求（projects.id）'),
          projectType:
            ProjectTypeArg.optional().describe(
              '新建需求的项目类型（默认其它）',
            ),
        },
      },
      async (args) =>
        executeTool(this.logger, 'change_idea_status', principal, async () => {
          const idea = await this.ideas.changeStatus(
            args.ideaId,
            {
              status: args.status,
              createProject: args.createProject,
              projectId: args.projectId,
              projectType: args.projectType,
            },
            ideaActorOf(principal),
          );
          return markdownResult(await this.ideas.findOneMarkdown(idea.id));
        }),
    );
  }
}

/** MCP 身份 → 灵感操作人：优先落到绑定真人，未绑定真人时记机器人名称 */
function ideaActorOf(principal: McpWorkPrincipal): IdeaActor {
  return {
    userId: principal.user?.id ?? null,
    userName: principal.user?.name || principal.worker?.name || '公共 Agent',
    isAdmin: principal.user?.role === UserRole.ADMIN,
  };
}
