import { Injectable, Logger } from '@nestjs/common';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { FeishuService } from '../../feishu/feishu.service';
import { KnowledgeService } from '../../knowledge/knowledge.service';
import { assertTaskDocumentWritable } from '../../knowledge/task-document.guard';
import { executeTool, markdownResult } from './work-tools.util';
import type { McpWorkPrincipal, WorkToolRegistrar } from './work-tools.types';

/** 知识库检索、目录浏览、文章读写与飞书文档转换 */
@Injectable()
export class WorkKnowledgeTools implements WorkToolRegistrar {
  private readonly logger = new Logger(WorkKnowledgeTools.name);

  constructor(
    private readonly knowledge: KnowledgeService,
    private readonly feishu: FeishuService,
  ) {}

  register(server: McpServer, principal: McpWorkPrincipal): void {
    server.registerTool(
      'search_knowledge',
      {
        title: '搜索知识库',
        description:
          '全文 + 向量混合检索站内知识，返回带知识路径、章节、相关度与原文地址的 RAG 片段；先搜索再按需读取原文。',
        inputSchema: {
          query: z.string().min(1).describe('关键词或问题'),
          path: z.string().optional().describe('限定目录（含其后代）'),
          page: z.number().int().min(1).optional().describe('页码，从 1 开始'),
          pageSize: z
            .number()
            .int()
            .min(1)
            .max(100)
            .optional()
            .describe('每页条数 1..100，默认 8'),
        },
      },
      async (args) =>
        executeTool(this.logger, 'search_knowledge', principal, async () =>
          markdownResult(
            this.knowledge.renderSearchMarkdown(
              await this.knowledge.search({
                query: args.query,
                path: args.path,
                page: args.page,
                pageSize: args.pageSize,
              }),
            ),
          ),
        ),
    );

    server.registerTool(
      'list_knowledge_dir',
      {
        title: '浏览知识目录',
        description: '列出知识目录的直接子目录与直接文章；根目录传 / 或省略。',
        inputSchema: {
          path: z
            .string()
            .optional()
            .describe('目录绝对路径（不带结尾 /），根目录为 /'),
        },
      },
      async (args) =>
        executeTool(this.logger, 'list_knowledge_dir', principal, async () =>
          markdownResult(
            await this.knowledge.renderDirectoryMarkdown(args.path ?? '/'),
          ),
        ),
    );

    server.registerTool(
      'read_knowledge',
      {
        title: '读取知识文章',
        description:
          '读取指定知识路径的完整 Markdown 文章（含项目文档镜像 /project/** 与任务文档 /task/**，均只读）。',
        inputSchema: {
          path: z.string().min(1).describe('知识路径（不带 .md 后缀）'),
        },
      },
      async (args) =>
        executeTool(this.logger, 'read_knowledge', principal, async () =>
          markdownResult(
            this.knowledge.renderArticleMarkdown(
              await this.knowledge.readArticle(args.path),
            ),
          ),
        ),
    );

    server.registerTool(
      'create_knowledge',
      {
        title: '创建知识',
        description:
          '创建知识文章或目录：parentPath 目录必须存在，路径冲突返回 400。项目同步 /project/** 与任务文档 /task/** 只读。',
        inputSchema: {
          kind: z.enum(['directory', 'article']).describe('节点类型'),
          parentPath: z.string().optional().describe('父目录绝对路径，缺省 /'),
          name: z.string().min(1).describe('路径名（不含斜杠）'),
          title: z.string().optional().describe('展示标题'),
          content: z
            .string()
            .optional()
            .describe('Markdown 正文（kind=article 时使用）'),
        },
      },
      async (args) =>
        executeTool(this.logger, 'create_knowledge', principal, async () => {
          assertTaskDocumentWritable(args.parentPath);
          const node = await this.knowledge.create({
            kind: args.kind,
            parentPath: args.parentPath ?? '/',
            name: args.name,
            title: args.title,
            content: args.content,
          });
          return markdownResult(this.knowledge.renderNodeCreatedMarkdown(node));
        }),
    );

    server.registerTool(
      'update_knowledge',
      {
        title: '更新知识',
        description:
          '更新文章正文/标题，或移动/重命名文章与目录（至少提供 title/content/name/parentPath 之一）。',
        inputSchema: {
          path: z.string().min(1).describe('当前知识路径'),
          title: z.string().optional().describe('新标题'),
          content: z.string().optional().describe('新 Markdown 正文'),
          name: z.string().optional().describe('新路径名（重命名）'),
          parentPath: z.string().optional().describe('新父目录（移动）'),
        },
      },
      async (args) =>
        executeTool(this.logger, 'update_knowledge', principal, async () => {
          assertTaskDocumentWritable(args.path, args.parentPath);
          const current = await this.knowledge.getNodeByPath(args.path);
          const node = await this.knowledge.update(current.id, {
            title: args.title,
            content: args.content,
            name: args.name,
            parentPath: args.parentPath,
          });
          return markdownResult(
            this.knowledge.renderNodeUpdatedMarkdown(node, current.path),
          );
        }),
    );

    server.registerTool(
      'delete_knowledge',
      {
        title: '删除知识',
        description:
          '删除知识文章或目录（不可恢复）；删除非空目录必须 recursive=true。',
        inputSchema: {
          path: z.string().min(1).describe('知识路径'),
          recursive: z
            .boolean()
            .optional()
            .describe('删除非空目录时必须为 true'),
        },
      },
      async (args) =>
        executeTool(this.logger, 'delete_knowledge', principal, async () => {
          assertTaskDocumentWritable(args.path);
          const node = await this.knowledge.getNodeByPath(args.path);
          await this.knowledge.remove(node.id, args.recursive === true);
          return markdownResult(
            this.knowledge.renderNodeDeletedMarkdown(
              node,
              args.recursive === true,
            ),
          );
        }),
    );

    server.registerTool(
      'read_feishu_doc',
      {
        title: '读取飞书文档',
        description:
          '把飞书 docx/docs/sheets/base/wiki 链接单向转换为 Markdown（不落库）。',
        inputSchema: {
          url: z.string().min(1).describe('飞书文档链接'),
        },
      },
      async (args) =>
        executeTool(this.logger, 'read_feishu_doc', principal, async () =>
          markdownResult(await this.feishu.readMarkdown(args.url)),
        ),
    );
  }
}
