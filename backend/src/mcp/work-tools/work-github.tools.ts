import { Injectable, Logger } from '@nestjs/common';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { CodeBranchCategory } from '../../common/enums';
import { CodeBranchesService } from '../../github/code-branches.service';
import { CodeEventsService } from '../../github/code-events.service';
import { GithubService } from '../../github/github.service';
import { executeTool, jsonResult, markdownResult } from './work-tools.util';
import type { McpWorkPrincipal, WorkToolRegistrar } from './work-tools.types';

const CodeBranchCategoryArg = z.enum(
  Object.values(CodeBranchCategory) as [
    CodeBranchCategory,
    ...CodeBranchCategory[],
  ],
);

/** GitHub 仓库/分支联想、代码分支登记与提交记录 */
@Injectable()
export class WorkGithubTools implements WorkToolRegistrar {
  private readonly logger = new Logger(WorkGithubTools.name);

  constructor(
    private readonly github: GithubService,
    private readonly branches: CodeBranchesService,
    private readonly events: CodeEventsService,
  ) {}

  register(server: McpServer, principal: McpWorkPrincipal): void {
    server.registerTool(
      'search_github_repos',
      {
        title: '搜索 GitHub 仓库',
        description:
          '在配置的组织下搜索仓库（q 匹配名称/描述，最多 50 条，按最近更新倒序）。',
        inputSchema: {
          q: z.string().optional().describe('仓库名称/描述关键词'),
        },
      },
      async (args) =>
        executeTool(this.logger, 'search_github_repos', principal, async () =>
          jsonResult(await this.github.searchRepos(args.q)),
        ),
    );

    server.registerTool(
      'list_github_branches',
      {
        title: '分支联想',
        description:
          '列出指定仓库的全部分支名（repo 支持 名/owner/name/完整 URL）。',
        inputSchema: {
          repo: z.string().min(1).describe('仓库名/全名/URL'),
        },
      },
      async (args) =>
        executeTool(this.logger, 'list_github_branches', principal, async () =>
          jsonResult(await this.github.listBranches(args.repo)),
        ),
    );

    server.registerTool(
      'list_code_branches',
      {
        title: '代码分支登记清单',
        description: '项目登记的代码分支（仓库+分支，含归属与备注）。',
        inputSchema: {
          projectId: z.number().int().positive().optional().describe('项目 ID'),
        },
      },
      async (args) =>
        executeTool(this.logger, 'list_code_branches', principal, async () =>
          jsonResult(await this.branches.findByProject(args.projectId)),
        ),
    );

    server.registerTool(
      'register_code_branch',
      {
        title: '登记代码分支',
        description:
          '登记项目涉及的 GitHub 仓库与分支（同项目同仓库同分支唯一），登记后平台自动监听新提交/合并。仅支持配置组织下的仓库。',
        inputSchema: {
          projectId: z.number().int().positive().describe('项目 ID'),
          repo: z.string().min(1).describe('仓库名/owner/name/完整 URL'),
          branch: z.string().min(1).describe('分支名（建议 test/main/stable）'),
          category:
            CodeBranchCategoryArg.optional().describe('归属（缺省其它）'),
          remark: z.string().optional().describe('备注'),
        },
      },
      async (args) =>
        executeTool(this.logger, 'register_code_branch', principal, async () =>
          jsonResult(await this.branches.create(args)),
        ),
    );

    server.registerTool(
      'update_code_branch',
      {
        title: '更新代码分支登记',
        description: '更新已登记代码分支的仓库/分支/归属/备注。',
        inputSchema: {
          id: z.number().int().positive().describe('登记 ID'),
          repo: z.string().optional().describe('仓库'),
          branch: z.string().optional().describe('分支'),
          category: CodeBranchCategoryArg.optional().describe('归属'),
          remark: z.string().optional().describe('备注'),
        },
      },
      async ({ id, ...dto }) =>
        executeTool(this.logger, 'update_code_branch', principal, async () =>
          jsonResult(await this.branches.update(id, dto)),
        ),
    );

    server.registerTool(
      'delete_code_branch',
      {
        title: '删除代码分支登记',
        description: '删除代码分支登记（已监听到的提交记录保留）。',
        inputSchema: {
          id: z.number().int().positive().describe('登记 ID'),
        },
      },
      async (args) =>
        executeTool(this.logger, 'delete_code_branch', principal, async () => {
          await this.branches.remove(args.id);
          return markdownResult(`代码分支登记 #${args.id} 已删除。`);
        }),
    );

    server.registerTool(
      'list_code_events',
      {
        title: '提交记录清单',
        description:
          '查询平台监听到的提交/合并记录（按提交时间倒序，含仓库分支、提交信息、合并标记、作者与链接）。',
        inputSchema: {
          projectId: z
            .number()
            .int()
            .positive()
            .optional()
            .describe('按项目登记的仓库+分支过滤'),
          repo: z.string().optional().describe('仓库'),
          branch: z.string().optional().describe('分支'),
          q: z.string().optional().describe('模糊匹配提交信息与作者'),
          limit: z
            .number()
            .int()
            .min(1)
            .max(500)
            .optional()
            .describe('条数上限'),
        },
      },
      async (args) =>
        executeTool(this.logger, 'list_code_events', principal, async () =>
          markdownResult(await this.events.listMarkdown(args)),
        ),
    );
  }
}
