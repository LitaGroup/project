import { Injectable, Logger } from '@nestjs/common';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ReleaseStatus } from '../../common/enums';
import { DefectsService } from '../../defects/defects.service';
import { ReleasesService } from '../../releases/releases.service';
import { executeTool, markdownResult } from './work-tools.util';
import {
  actorNameOf,
  type McpWorkPrincipal,
  type WorkToolRegistrar,
} from './work-tools.types';

const ReleaseStatusArg = z.enum(
  Object.values(ReleaseStatus) as [ReleaseStatus, ...ReleaseStatus[]],
);

const DefectPlatformArg = z
  .enum(['前端', '后端', 'APP端', '未知'])
  .describe('端：前端/后端/APP端/未知（缺省未知）');

const DefectPriorityArg = z
  .enum(['高', '中', '低'])
  .describe('优先级：高/中/低（缺省中）');

const DefectStatusArg = z
  .enum(['开放', '修复', '关闭'])
  .describe('缺陷状态：开放/修复/关闭');

/** 缺陷与提测 */
@Injectable()
export class WorkDefectTools implements WorkToolRegistrar {
  private readonly logger = new Logger(WorkDefectTools.name);

  constructor(
    private readonly defects: DefectsService,
    private readonly releases: ReleasesService,
  ) {}

  register(server: McpServer, principal: McpWorkPrincipal): void {
    server.registerTool(
      'list_defects',
      {
        title: '缺陷清单',
        description:
          '按项目/提测/状态/优先级/关键词筛选缺陷，返回 Markdown 表格（ID 即详情入口）。',
        inputSchema: {
          projectId: z.number().int().positive().optional().describe('项目 ID'),
          releaseId: z.number().int().positive().optional().describe('提测 ID'),
          status: DefectStatusArg.optional(),
          priority: DefectPriorityArg.optional(),
          q: z.string().optional().describe('模糊匹配预期与实际结果'),
        },
      },
      async (args) =>
        executeTool(this.logger, 'list_defects', principal, async () =>
          markdownResult(await this.defects.listMarkdown(args)),
        ),
    );

    server.registerTool(
      'get_defect',
      {
        title: '缺陷详情',
        description:
          '读取缺陷元信息、预期/实际结果、图片、变更记录与 AI 操作端点。',
        inputSchema: {
          defectId: z.number().int().positive().describe('缺陷 ID'),
        },
      },
      async (args) =>
        executeTool(this.logger, 'get_defect', principal, async () =>
          markdownResult(await this.defects.findOneMarkdown(args.defectId)),
        ),
    );

    server.registerTool(
      'create_defect',
      {
        title: '创建缺陷',
        description:
          '创建缺陷（预期与实际结果必填）。不传 releaseId 时，项目最新有效机器人提测会自动关联并派单；显式传 null 表示不关联。',
        inputSchema: {
          projectId: z.number().int().positive().describe('项目 ID'),
          expected: z.string().min(1).describe('预期功能描述'),
          actual: z.string().min(1).describe('实际结果描述'),
          platform: DefectPlatformArg.optional(),
          priority: DefectPriorityArg.optional(),
          images: z
            .array(z.string())
            .max(9)
            .optional()
            .describe('图片 /images/... 路径数组，最多 9 张'),
          testScript: z
            .string()
            .optional()
            .describe('用例脚本路径（相对脚本根目录的 .test.ts）'),
          releaseId: z
            .number()
            .int()
            .positive()
            .nullable()
            .optional()
            .describe('关联提测 ID；null 明确不关联'),
        },
      },
      async ({ projectId, ...dto }) =>
        executeTool(this.logger, 'create_defect', principal, async () =>
          markdownResult(
            await this.defects.createMarkdown(
              { projectId, ...dto },
              actorNameOf(principal),
              {
                user: principal.user,
                worker: principal.worker,
              },
            ),
          ),
        ),
    );

    server.registerTool(
      'update_defect',
      {
        title: '更新缺陷',
        description:
          '更新缺陷字段（端/优先级/状态/预期/实际/图片/用例脚本/提测关联），可附带变更内容与备注写入变更记录。',
        inputSchema: {
          defectId: z.number().int().positive().describe('缺陷 ID'),
          platform: DefectPlatformArg.optional(),
          priority: DefectPriorityArg.optional(),
          status: DefectStatusArg.optional(),
          expected: z.string().optional().describe('预期功能描述'),
          actual: z.string().optional().describe('实际结果描述'),
          images: z
            .array(z.string())
            .optional()
            .describe('图片路径数组（全量覆盖，空数组清除）'),
          testScript: z.string().optional().describe('用例脚本（空串清除）'),
          releaseId: z
            .number()
            .int()
            .positive()
            .nullable()
            .optional()
            .describe('关联提测 ID；null 清除关联'),
          changeContent: z.string().optional().describe('变更内容'),
          changeRemark: z.string().optional().describe('变更备注'),
        },
      },
      async ({ defectId, ...dto }) =>
        executeTool(this.logger, 'update_defect', principal, async () =>
          markdownResult(
            await this.defects.updateMarkdown(
              defectId,
              dto,
              actorNameOf(principal),
            ),
          ),
        ),
    );

    server.registerTool(
      'change_defect_status',
      {
        title: '变更缺陷状态',
        description:
          '专用状态流转（开放/修复/关闭），可带备注并自动写变更记录；状态未变化时幂等返回。',
        inputSchema: {
          defectId: z.number().int().positive().describe('缺陷 ID'),
          status: DefectStatusArg,
          remark: z.string().optional().describe('变更备注'),
          content: z
            .string()
            .optional()
            .describe('变更内容（缺省生成“状态变更：X → Y”）'),
        },
      },
      async ({ defectId, ...dto }) =>
        executeTool(this.logger, 'change_defect_status', principal, async () =>
          markdownResult(
            await this.defects.changeStatusMarkdown(
              defectId,
              dto,
              actorNameOf(principal),
            ),
          ),
        ),
    );

    server.registerTool(
      'add_defect_record',
      {
        title: '追加缺陷变更记录',
        description: '只追加一条变更记录，不修改缺陷字段。',
        inputSchema: {
          defectId: z.number().int().positive().describe('缺陷 ID'),
          content: z.string().min(1).describe('变更内容'),
          remark: z.string().optional().describe('备注'),
        },
      },
      async ({ defectId, ...dto }) =>
        executeTool(this.logger, 'add_defect_record', principal, async () =>
          markdownResult(
            await this.defects.addRecordMarkdown(
              defectId,
              dto,
              actorNameOf(principal),
            ),
          ),
        ),
    );

    server.registerTool(
      'delete_defect',
      {
        title: '删除缺陷',
        description: '删除本地缺陷记录及其变更记录（不可恢复）。',
        inputSchema: {
          defectId: z.number().int().positive().describe('缺陷 ID'),
        },
      },
      async (args) =>
        executeTool(this.logger, 'delete_defect', principal, async () =>
          markdownResult(await this.defects.removeMarkdown(args.defectId)),
        ),
    );

    server.registerTool(
      'list_releases',
      {
        title: '提测记录清单',
        description:
          '按提测时间倒序返回提测记录（时间/提测人/状态/判定人/判定时间/测试人员/地址/分支/内容摘要）；不传项目返回全平台。',
        inputSchema: {
          projectId: z.number().int().positive().optional().describe('项目 ID'),
        },
      },
      async (args) =>
        executeTool(this.logger, 'list_releases', principal, async () =>
          markdownResult(await this.releases.listMarkdown(args.projectId)),
        ),
    );

    server.registerTool(
      'submit_release',
      {
        title: '发起项目提测',
        description:
          '创建提测记录并将项目状态流转「测试中」，通知提测群与项目人员。testers 至少 1 人且须为平台用户。',
        inputSchema: {
          projectId: z.number().int().positive().describe('项目 ID'),
          testers: z
            .array(z.string())
            .min(1)
            .describe('测试人员姓名（平台用户）'),
          content: z.string().optional().describe('提测内容 Markdown'),
          urls: z.array(z.string()).optional().describe('访问地址'),
          branches: z
            .array(z.object({ repo: z.string(), branch: z.string() }))
            .optional()
            .describe('代码分支'),
          taskId: z
            .number()
            .int()
            .positive()
            .optional()
            .describe('来源任务 ID（机器人令牌缺省取当前执行中任务）'),
        },
      },
      async ({ projectId, ...dto }) =>
        executeTool(this.logger, 'submit_release', principal, async () =>
          markdownResult(
            await this.releases.submitMarkdown(projectId, dto, {
              operator: actorNameOf(principal),
              workerId: principal.worker?.id ?? null,
              sourceTaskId: dto.taskId ?? null,
            }),
          ),
        ),
    );

    server.registerTool(
      'update_release_status',
      {
        title: '判定提测结果',
        description:
          '推进提测状态：待冒烟/进行中/已通过/未通过；改为已通过或未通过时记录判定人与判定时间。',
        inputSchema: {
          releaseId: z.number().int().positive().describe('提测记录 ID'),
          status: ReleaseStatusArg,
        },
      },
      async (args) =>
        executeTool(this.logger, 'update_release_status', principal, async () =>
          markdownResult(
            await this.releases.updateStatusMarkdown(
              args.releaseId,
              args.status,
              actorNameOf(principal),
            ),
          ),
        ),
    );
  }
}
