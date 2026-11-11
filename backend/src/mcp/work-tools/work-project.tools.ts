import { Injectable, Logger } from '@nestjs/common';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DocumentType, MilestoneAchieved } from '../../common/enums';
import { DocumentsService } from '../../documents/documents.service';
import { MilestonesService } from '../../milestones/milestones.service';
import { ProjectsService } from '../../projects/projects.service';
import { ResourcesService } from '../../resources/resources.service';
import { executeTool, jsonResult, markdownResult } from './work-tools.util';
import type { McpWorkPrincipal, WorkToolRegistrar } from './work-tools.types';

const DocumentTypeArg = z.enum(
  Object.values(DocumentType) as [DocumentType, ...DocumentType[]],
);

/** 项目 / 文档 / 资源 / 节点：搜索、详情、配置写入与来访资料登记 */
@Injectable()
export class WorkProjectTools implements WorkToolRegistrar {
  private readonly logger = new Logger(WorkProjectTools.name);

  constructor(
    private readonly projects: ProjectsService,
    private readonly documents: DocumentsService,
    private readonly resources: ResourcesService,
    private readonly milestones: MilestonesService,
  ) {}

  register(server: McpServer, principal: McpWorkPrincipal): void {
    server.registerTool(
      'search_projects',
      {
        title: '搜索项目',
        description:
          '按项目名称模糊搜索，返回匹配度排序的前 5 个项目（名称/类型/状态/id/更新时间与详情入口）。不知道项目 id 时先搜索。',
        inputSchema: {
          query: z.string().min(1).describe('项目名称关键词'),
        },
      },
      async (args) =>
        executeTool(this.logger, 'search_projects', principal, async () =>
          markdownResult(await this.projects.searchMarkdown(args.query)),
        ),
    );

    server.registerTool(
      'get_project',
      {
        title: '项目详情',
        description:
          '获取项目完整详情：元信息、描述、文档/资源/节点/检查/用例/导出/定时任务/提测记录/缺陷清单与最近运行结果，末尾附全部 AI 操作端点。',
        inputSchema: {
          projectId: z.number().int().positive().describe('项目 ID'),
        },
      },
      async (args) =>
        executeTool(this.logger, 'get_project', principal, async () =>
          markdownResult(await this.projects.findOneMarkdown(args.projectId)),
        ),
    );

    server.registerTool(
      'update_project',
      {
        title: '更新项目配置',
        description:
          '仅更新本地字段：脚本目录、Markdown 描述、人员（前端/后端/测试/产品/客户端）。只更新提供的字段，空串清除；类型/状态/优先级等来自飞书同步，不要通过本工具修改。',
        inputSchema: {
          projectId: z.number().int().positive().describe('项目 ID'),
          scriptsPath: z
            .string()
            .optional()
            .describe('脚本目录（相对脚本根目录的子目录），空串清除'),
          description: z
            .string()
            .optional()
            .describe('项目描述（Markdown），空串清除'),
          resources: z
            .object({
              frontend: z.string().optional(),
              backend: z.string().optional(),
              qa: z.string().optional(),
              product: z.string().optional(),
              client: z.string().optional(),
            })
            .nullable()
            .optional()
            .describe('人员配置；null 清除全部'),
        },
      },
      async ({ projectId, ...dto }) =>
        executeTool(this.logger, 'update_project', principal, async () =>
          markdownResult(await this.projects.updateMarkdown(projectId, dto)),
        ),
    );

    server.registerTool(
      'read_document',
      {
        title: '读取项目文档',
        description:
          '读取文档元信息与 Markdown 正文全文（飞书/APIPOST 导入文档正文只读）。',
        inputSchema: {
          documentId: z.number().int().positive().describe('文档 ID'),
        },
      },
      async (args) =>
        executeTool(this.logger, 'read_document', principal, async () =>
          markdownResult(await this.documents.findOneMarkdown(args.documentId)),
        ),
    );

    server.registerTool(
      'upsert_document',
      {
        title: '写入项目文档',
        description:
          '按 (projectId, fileName) upsert 项目文档：已存在覆盖正文，不存在新建。fileName 是稳定唯一标识（如 deploy-guide.md）。命中飞书/APIPOST 导入的文档会被拒绝。',
        inputSchema: {
          projectId: z.number().int().positive().describe('项目 ID'),
          fileName: z
            .string()
            .min(1)
            .describe('文档文件名（项目内唯一，如 TECHNICAL_DESIGN.md）'),
          content: z.string().describe('Markdown 正文'),
          title: z
            .string()
            .optional()
            .describe('展示标题（新建缺省取 fileName）'),
          type: DocumentTypeArg.optional().describe(
            '文档类型：需求/功能/测试/技术/接口/配置（新建缺省技术）',
          ),
          description: z.string().optional().describe('文档描述'),
        },
      },
      async (args) =>
        executeTool(this.logger, 'upsert_document', principal, async () =>
          markdownResult(await this.documents.upsertMarkdown(args)),
        ),
    );

    server.registerTool(
      'sync_apipost_document',
      {
        title: '导入 APIPOST 接口文档',
        description:
          '从 docs.apipost.net 文档页或 openapi.apipost.net swagger 链接单向导入接口文档（同项目按链接判重更新）。',
        inputSchema: {
          projectId: z.number().int().positive().describe('项目 ID'),
          url: z.string().min(1).describe('APIPOST 文档或 swagger 链接'),
          type: DocumentTypeArg.optional().describe('文档类型，缺省接口'),
          description: z.string().optional().describe('文档描述'),
        },
      },
      async (args) =>
        executeTool(this.logger, 'sync_apipost_document', principal, async () =>
          jsonResult(await this.documents.syncFromApipost(args)),
        ),
    );

    server.registerTool(
      'list_resources',
      {
        title: '资源清单',
        description:
          '项目资源（需求方提供的素材/信息）清单；不含多语言缓存正文。',
        inputSchema: {
          projectId: z.number().int().positive().optional().describe('项目 ID'),
          includeDeleted: z
            .boolean()
            .optional()
            .describe('是否包含软删除（状态=废弃）记录'),
        },
      },
      async (args) =>
        executeTool(this.logger, 'list_resources', principal, async () =>
          jsonResult(
            await this.resources.findByProject(
              args.projectId,
              args.includeDeleted === true,
            ),
          ),
        ),
    );

    server.registerTool(
      'read_resource',
      {
        title: '读取资源详情',
        description:
          '读取资源元信息与正文：配置=绑定文档内容，多语言=文案缓存表格，其它=描述。',
        inputSchema: {
          resourceId: z.number().int().positive().describe('资源 ID'),
        },
      },
      async (args) =>
        executeTool(this.logger, 'read_resource', principal, async () =>
          markdownResult(await this.resources.findOneMarkdown(args.resourceId)),
        ),
    );

    server.registerTool(
      'sync_resource',
      {
        title: '同步资源',
        description:
          '配置类型重新拉取绑定飞书文档；多语言类型按前缀拉取 Lita word/sheet 文案缓存。',
        inputSchema: {
          resourceId: z.number().int().positive().describe('资源 ID'),
        },
      },
      async (args) =>
        executeTool(this.logger, 'sync_resource', principal, async () =>
          jsonResult(await this.resources.sync(args.resourceId)),
        ),
    );

    server.registerTool(
      'list_milestones',
      {
        title: '节点清单',
        description: '项目节点（时间点事项）列表，按日期升序并附推导状态。',
        inputSchema: {
          projectId: z.number().int().positive().optional().describe('项目 ID'),
        },
      },
      async (args) =>
        executeTool(this.logger, 'list_milestones', principal, async () =>
          jsonResult(await this.milestones.findByProject(args.projectId)),
        ),
    );

    server.registerTool(
      'create_milestone',
      {
        title: '登记节点',
        description:
          '新建项目节点：日期（北京时间当日 23:59:59 前）、内容，可选备注/交付人/验收人。',
        inputSchema: {
          projectId: z.number().int().positive().describe('项目 ID'),
          date: z.string().describe('应完成日期 YYYY-MM-DD'),
          content: z.string().min(1).describe('节点要完成的事项'),
          remark: z.string().optional().describe('备注'),
          deliverer: z.string().optional().describe('交付人'),
          acceptor: z.string().optional().describe('验收人'),
        },
      },
      async (args) =>
        executeTool(this.logger, 'create_milestone', principal, async () =>
          jsonResult(await this.milestones.create(args)),
        ),
    );

    server.registerTool(
      'update_milestone',
      {
        title: '更新/验收节点',
        description:
          '更新节点日期/内容/备注/交付人/验收人，或标记达成：achieved=yes 表示研发验收通过（自动记录北京时间当天为实际达成日期），no 撤销，cancel 取消节点。',
        inputSchema: {
          milestoneId: z.number().int().positive().describe('节点 ID'),
          date: z.string().optional().describe('应完成日期 YYYY-MM-DD'),
          content: z.string().optional().describe('节点事项'),
          remark: z.string().optional().describe('备注'),
          deliverer: z.string().optional().describe('交付人'),
          acceptor: z.string().optional().describe('验收人'),
          achieved: z
            .nativeEnum(MilestoneAchieved)
            .optional()
            .describe('达成标记：yes=验收通过，no=撤销，cancel=取消'),
        },
      },
      async ({ milestoneId, ...dto }) =>
        executeTool(this.logger, 'update_milestone', principal, async () =>
          jsonResult(await this.milestones.update(milestoneId, dto)),
        ),
    );

    server.registerTool(
      'delete_milestone',
      {
        title: '删除节点',
        description: '删除项目节点（不可恢复）。',
        inputSchema: {
          milestoneId: z.number().int().positive().describe('节点 ID'),
        },
      },
      async (args) =>
        executeTool(this.logger, 'delete_milestone', principal, async () => {
          await this.milestones.remove(args.milestoneId);
          return markdownResult(`节点 #${args.milestoneId} 已删除。`);
        }),
    );
  }
}
