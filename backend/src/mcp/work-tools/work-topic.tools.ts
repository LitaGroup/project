import { Injectable, Logger } from '@nestjs/common';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { TopicStatus, TopicSubjectType, TopicType } from '../../common/enums';
import { topicActorOfPrincipal } from '../../topics/topics.actor';
import {
  renderTopicDetail,
  renderTopicList,
} from '../../topics/topics.markdown';
import { TopicsService } from '../../topics/topics.service';
import { executeTool, markdownResult } from './work-tools.util';
import type { McpWorkPrincipal, WorkToolRegistrar } from './work-tools.types';

const SubjectTypeArg = z
  .enum(
    Object.values(TopicSubjectType) as [
      TopicSubjectType,
      ...TopicSubjectType[],
    ],
  )
  .describe('话题主体类型：idea / backlog / knowledge / task / ticket');

const TopicTypeArg = z
  .enum(Object.values(TopicType) as [TopicType, ...TopicType[]])
  .describe('话题类型：content（内容）/ question（问答）/ system（系统）');

const TopicStatusArg = z
  .enum(Object.values(TopicStatus) as [TopicStatus, ...TopicStatus[]])
  .describe('话题状态：open（进行中）/ resolved（已解决）/ closed（已关闭）');

const SubjectIdArg = z
  .union([z.string(), z.number()])
  .transform((value) => String(value))
  .describe('主体 ID：任务/工单/灵感/迭代项传数字，知识文章传知识节点 ID');

/**
 * 话题（Topic）MCP 工具：统一覆盖灵感、迭代项、知识、任务、工单。
 * 任务主话题消息会自动投递到执行机器人；其它主体 @机器人时内联回答。
 */
@Injectable()
export class WorkTopicTools implements WorkToolRegistrar {
  private readonly logger = new Logger(WorkTopicTools.name);

  constructor(private readonly topics: TopicsService) {}

  register(server: McpServer, principal: McpWorkPrincipal): void {
    server.registerTool(
      'list_topics',
      {
        title: '话题清单',
        description:
          '按主体（灵感/迭代项/知识/任务/工单）读取话题清单，返回 Markdown 表格（ID 即详情入口）。',
        inputSchema: {
          subjectType: SubjectTypeArg,
          subjectId: SubjectIdArg,
          q: z.string().optional().describe('标题/正文关键词'),
          type: TopicTypeArg.optional(),
          status: TopicStatusArg.optional(),
          tag: z.string().optional().describe('标签（澄清/建议或自定义）'),
        },
      },
      async (args) =>
        executeTool(this.logger, 'list_topics', principal, async () => {
          const result = await this.topics.list(
            {
              subjectType: args.subjectType,
              subjectId: args.subjectId,
              q: args.q,
              type: args.type,
              status: args.status,
              tag: args.tag,
              pageSize: 100,
            },
            topicActorOfPrincipal(principal),
          );
          return markdownResult(renderTopicList(result));
        }),
    );

    server.registerTool(
      'get_topic',
      {
        title: '话题详情',
        description: '读取话题正文、标签、问答状态与最近回复（含作者与时间）。',
        inputSchema: {
          topicId: z.number().int().positive().describe('话题 ID'),
        },
      },
      async (args) =>
        executeTool(this.logger, 'get_topic', principal, async () => {
          const detail = await this.topics.get(
            args.topicId,
            topicActorOfPrincipal(principal),
          );
          return markdownResult(renderTopicDetail(detail));
        }),
    );

    server.registerTool(
      'create_topic',
      {
        title: '新开话题',
        description:
          '在主体下新开一个话题。默认消息进主话题；需要独立讨论时使用本工具。type=question 表示问答话题。',
        inputSchema: {
          subjectType: SubjectTypeArg,
          subjectId: SubjectIdArg,
          title: z.string().max(200).optional().describe('标题（可省略）'),
          content: z.string().min(1).describe('正文（Markdown）'),
          type: TopicTypeArg.optional(),
          tags: z
            .array(z.string())
            .optional()
            .describe('标签：固定「澄清 / 建议」+ 自定义'),
          mentions: z
            .array(z.number().int().positive())
            .optional()
            .describe('@机器人 workerId 列表'),
        },
      },
      async (args) =>
        executeTool(this.logger, 'create_topic', principal, async () => {
          const topic = await this.topics.create(
            {
              subjectType: args.subjectType,
              subjectId: args.subjectId,
              title: args.title,
              content: args.content,
              type: args.type,
              tags: args.tags,
              mentions: args.mentions,
            },
            topicActorOfPrincipal(principal),
          );
          return markdownResult(
            [
              `话题已创建：#${topic.id}`,
              '',
              `- 主体：${topic.subjectTitle}`,
              `- 标题：${topic.title || '（无）'}`,
              `- 阅读：GET /api/topics/${topic.id}.md`,
              '',
            ].join('\n'),
          );
        }),
    );

    server.registerTool(
      'reply_topic',
      {
        title: '回复话题',
        description:
          '在指定话题下追加一条回复。机器人答复话题必须调用本工具，平台不会自动把执行会话输出转发到话题；@执行机器人会触发任务会话，其它主体 @AI 机器人会内联回答。',
        inputSchema: {
          topicId: z.number().int().positive().describe('话题 ID'),
          content: z.string().min(1).describe('回复正文（Markdown）'),
          mentions: z
            .array(z.number().int().positive())
            .optional()
            .describe('@机器人 workerId 列表'),
        },
      },
      async (args) =>
        executeTool(this.logger, 'reply_topic', principal, async () => {
          const result = await this.topics.reply(
            args.topicId,
            { content: args.content, mentions: args.mentions },
            topicActorOfPrincipal(principal),
          );
          return markdownResult(
            [
              `回复已发布：#${result.reply.id}`,
              '',
              `- 话题：${result.topic.title || '主话题'}`,
              `- 阅读：GET /api/topics/${result.topic.id}.md`,
              '',
            ].join('\n'),
          );
        }),
    );

    server.registerTool(
      'answer_topic_question',
      {
        title: '答复话题问答',
        description:
          '答复 type=question 的话题；任务/工单问答会同时恢复对应任务。answers 按问题顺序。',
        inputSchema: {
          topicId: z.number().int().positive().describe('问答话题 ID'),
          answers: z
            .array(z.array(z.string()))
            .optional()
            .describe('按问题顺序的答案'),
          reject: z.boolean().optional().describe('跳过本次提问'),
        },
      },
      async (args) =>
        executeTool(
          this.logger,
          'answer_topic_question',
          principal,
          async () => {
            const topic = await this.topics.answer(
              args.topicId,
              { answers: args.answers, reject: args.reject },
              topicActorOfPrincipal(principal),
            );
            return markdownResult(`问答话题已答复：#${topic.id}\n`);
          },
        ),
    );

    server.registerTool(
      'resolve_topic',
      {
        title: '标记话题已解决',
        description: '把话题状态改为已解决（仅作者或管理员）。',
        inputSchema: {
          topicId: z.number().int().positive().describe('话题 ID'),
        },
      },
      async (args) =>
        executeTool(this.logger, 'resolve_topic', principal, async () => {
          const topic = await this.topics.update(
            args.topicId,
            { status: TopicStatus.RESOLVED },
            topicActorOfPrincipal(principal),
          );
          return markdownResult(`话题已标记为已解决：#${topic.id}\n`);
        }),
    );

    server.registerTool(
      'list_my_topic_notifications',
      {
        title: '我的话题通知',
        description: '@机器人、被回复、问答待回答等站内通知（最近 100 条）。',
        inputSchema: {},
      },
      async () =>
        executeTool(
          this.logger,
          'list_my_topic_notifications',
          principal,
          async () => {
            const result = await this.topics.notificationsOf(
              topicActorOfPrincipal(principal),
            );
            if (!result.items.length) return markdownResult('暂无话题通知。\n');
            return markdownResult(
              [
                '# 我的话题通知',
                '',
                `- 未读：${result.unread}`,
                '',
                '| ID | 类型 | 标题 | 时间 | 已读 |',
                '| --- | --- | --- | --- | --- |',
                ...result.items.map((item) =>
                  [
                    item.id,
                    item.type,
                    item.title.replace(/\|/g, '\\|'),
                    new Date(item.createdAt).toLocaleString('zh-CN'),
                    item.readAt ? '是' : '否',
                  ].join(' | '),
                ),
                '',
              ].join('\n'),
            );
          },
        ),
    );
  }
}
