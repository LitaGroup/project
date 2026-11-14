import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { MessageEvent } from '@nestjs/common';
import { Observable, Subscription } from 'rxjs';
import { In, IsNull, Repository } from 'typeorm';
import {
  TaskStatus,
  TopicAuthorType,
  TopicReplyStatus,
  TopicStatus,
  TopicSubjectType,
  TopicType,
  WorkerRuntime,
} from '../common/enums';
import { Idea } from '../ideas/idea.entity';
import { Backlog } from '../iterations/backlog.entity';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { Task } from '../tasks/task.entity';
import { TaskActorService } from '../tasks/task-actor.service';
import { TaskChatService } from '../tasks/task-chat.service';
import type {
  TaskChatMessage,
  TaskChatQuestion,
} from '../tasks/task-chat.types';
import { TaskCollaborationService } from '../tasks/task-collaboration.service';
import { TaskTopicHooksService } from '../tasks/task-topic-hooks.service';
import { TasksService } from '../tasks/tasks.service';
import type { TaskActor } from '../tasks/task-requester';
import { Ticket } from '../tickets/ticket.entity';
import { Worker } from '../workers/worker.entity';
import { WorkerDebugService } from '../workers/worker-debug.service';
import type { DebugStreamPayload } from '../workers/worker-debug.types';
import { Topic, type TopicMention } from './topic.entity';
import { TopicNotification } from './topic-notification.entity';
import { TopicRead } from './topic-read.entity';
import { TopicReply } from './topic-reply.entity';
import { TopicTaskContext } from './topic-task-context.entity';
import { TopicNotifyService } from './topic-notify.service';
import { TopicRealtimeService } from './topic-realtime.service';
import type {
  AnswerTopicInput,
  CreateTopicInput,
  ReplyTopicInput,
  TopicActor,
  TopicDetailView,
  TopicListQuery,
  TopicListResult,
  TopicNotificationList,
  TopicReplyView,
  TopicSubjectInfo,
  TopicView,
  UpdateTopicInput,
} from './topics.types';

const MAX_TAGS = 10;
const MAX_TAG_LENGTH = 30;
const MAX_MENTIONS = 10;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const MAX_REPLIES = 500;

/** 话题标题兜底：取正文首行，去掉 Markdown 前缀 */
function deriveTitle(content: string): string {
  const line = content
    .split('\n')
    .map((item) => item.replace(/^[#>*\-\s]+/, '').trim())
    .find(Boolean);
  return (line ?? '新话题').slice(0, 120);
}

/** 问答正文：把问题与选项格式化为 Markdown */
function formatQuestions(questions: TaskChatQuestion['questions']): string {
  return questions
    .map((question, index) => {
      const lines = [
        `**问题 ${index + 1}：${question.header || '请确认'}**`,
        '',
        question.question,
      ];
      if (question.options?.length) {
        lines.push(
          '',
          ...question.options.map(
            (option) =>
              `- ${option.label}${option.description ? `：${option.description}` : ''}`,
          ),
        );
      }
      return lines.join('\n');
    })
    .join('\n\n');
}

function formatAnswers(
  questions: TaskChatQuestion['questions'],
  answers: string[][],
): string {
  return questions
    .map(
      (question, index) =>
        `问：${question.question}\n答：${(answers[index] ?? []).join('、') || '（空）'}`,
    )
    .join('\n\n');
}

@Injectable()
export class TopicsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(TopicsService.name);
  private taskMessageSub: Subscription | null = null;

  constructor(
    @InjectRepository(Topic)
    private readonly topics: Repository<Topic>,
    @InjectRepository(TopicReply)
    private readonly replies: Repository<TopicReply>,
    @InjectRepository(TopicRead)
    private readonly reads: Repository<TopicRead>,
    @InjectRepository(TopicNotification)
    private readonly notifications: Repository<TopicNotification>,
    @InjectRepository(TopicTaskContext)
    private readonly taskContexts: Repository<TopicTaskContext>,
    @InjectRepository(Idea)
    private readonly ideas: Repository<Idea>,
    @InjectRepository(Backlog)
    private readonly backlogs: Repository<Backlog>,
    @InjectRepository(Task)
    private readonly tasks: Repository<Task>,
    @InjectRepository(Ticket)
    private readonly tickets: Repository<Ticket>,
    @InjectRepository(Worker)
    private readonly workers: Repository<Worker>,
    private readonly knowledge: KnowledgeService,
    private readonly taskChat: TaskChatService,
    private readonly tasksService: TasksService,
    private readonly taskActors: TaskActorService,
    private readonly collaboration: TaskCollaborationService,
    private readonly taskTopicHooks: TaskTopicHooksService,
    private readonly debug: WorkerDebugService,
    private readonly notify: TopicNotifyService,
    private readonly realtime: TopicRealtimeService,
  ) {}

  onApplicationBootstrap(): void {
    this.taskTopicHooks.register(async (event) => {
      if (event.type === 'question-answered') {
        await this.syncQuestionAnswer(
          event.taskId,
          event.questionId,
          event.actor,
          event.answers,
          event.rejected,
        );
        return;
      }
      await this.recordAcceptanceRejection(
        event.task,
        event.actor,
        event.content,
      );
    });
    this.taskMessageSub = this.taskChat.messagePersisted$.subscribe(
      (message) => {
        void this.handleTaskMessage(message).catch((error: Error) => {
          this.logger.warn(
            `任务消息同步到话题失败（taskId=${message.taskId}）: ${error.message}`,
          );
        });
      },
    );
  }

  onModuleDestroy(): void {
    this.taskMessageSub?.unsubscribe();
    this.taskMessageSub = null;
  }

  // ===== 查询 =====

  async list(
    query: TopicListQuery,
    actor: TopicActor,
  ): Promise<TopicListResult> {
    const subject = await this.resolveSubject(
      query.subjectType,
      String(query.subjectId),
    );
    const defaultTopic = await this.ensureDefaultTopic(subject);
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, query.pageSize ?? DEFAULT_PAGE_SIZE),
    );

    const qb = this.topics
      .createQueryBuilder('topic')
      .where('topic.subjectType = :subjectType', {
        subjectType: subject.type,
      })
      .andWhere('topic.subjectId = :subjectId', { subjectId: subject.id })
      .andWhere('topic.deletedAt IS NULL');
    if (query.q?.trim()) {
      qb.andWhere('(topic.title ILIKE :q OR topic.content ILIKE :q)', {
        q: `%${query.q.trim()}%`,
      });
    }
    if (query.type) {
      qb.andWhere('topic.type = :type', { type: query.type });
    }
    if (query.status) {
      qb.andWhere('topic.status = :status', { status: query.status });
    }
    if (query.tag?.trim()) {
      qb.andWhere('topic.tags @> :tag::jsonb', {
        tag: JSON.stringify([query.tag.trim()]),
      });
    }
    const [rows, total] = await qb
      .orderBy('topic.pinned', 'DESC')
      .addOrderBy('COALESCE(topic.lastReplyAt, topic.createdAt)', 'DESC')
      .addOrderBy('topic.id', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    const readMap = await this.readMapForTopics(
      rows.map((row) => row.id),
      actor.userId,
    );
    const unreadMap = await this.unreadCountMap(
      rows.map((row) => row.id),
      readMap,
    );
    const items = rows.map((row) =>
      this.toTopicView(row, subject, unreadMap.get(row.id) ?? 0),
    );
    const unreadTotal = [...unreadMap.values()].reduce(
      (sum, value) => sum + value,
      0,
    );
    return {
      subjectType: subject.type,
      subjectId: subject.id,
      subjectTitle: subject.title,
      subjectUrl: subject.url,
      defaultTopicId: defaultTopic.id,
      total,
      page,
      pageSize,
      items,
      unreadTotal,
    };
  }

  async get(topicId: number, actor: TopicActor): Promise<TopicDetailView> {
    const topic = await this.mustFindTopic(topicId);
    const subject = await this.resolveSubject(
      topic.subjectType,
      topic.subjectId,
    );
    const rows = await this.replies.find({
      where: { topicId, deletedAt: IsNull() },
      order: { id: 'DESC' },
      take: MAX_REPLIES,
    });
    rows.reverse();
    const read = actor.userId
      ? await this.reads.findOne({
          where: { topicId, userId: actor.userId },
        })
      : null;
    const unread = rows.filter(
      (row) => row.id > (read?.lastReadReplyId ?? 0),
    ).length;
    return {
      ...this.toTopicView(topic, subject, unread),
      replies: rows.map((row) => this.toReplyView(row)),
      totalReplies: topic.replyCount,
    };
  }

  async notificationsOf(actor: TopicActor): Promise<TopicNotificationList> {
    if (!actor.userId) {
      return { total: 0, unread: 0, items: [] };
    }
    const [rows, total] = await this.notifications.findAndCount({
      where: { userId: actor.userId },
      order: { id: 'DESC' },
      take: 100,
    });
    const unread = await this.notifications.count({
      where: { userId: actor.userId, readAt: IsNull() },
    });
    return {
      total,
      unread,
      items: rows.map((row) => ({
        id: row.id,
        type: row.type,
        topicId: row.topicId,
        replyId: row.replyId,
        title: row.title,
        content: row.content,
        readAt: row.readAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  async markNotificationsRead(
    actor: TopicActor,
    ids?: number[],
  ): Promise<{ updated: number }> {
    if (!actor.userId) return { updated: 0 };
    const where = ids?.length
      ? { userId: actor.userId, id: In(ids), readAt: IsNull() }
      : { userId: actor.userId, readAt: IsNull() };
    const result = await this.notifications.update(where, {
      readAt: new Date(),
    });
    return { updated: result.affected ?? 0 };
  }

  // ===== 写入 =====

  async create(
    input: CreateTopicInput,
    actor: TopicActor,
  ): Promise<TopicDetailView> {
    const subject = await this.resolveSubject(
      input.subjectType,
      String(input.subjectId),
    );
    const type = input.type ?? TopicType.CONTENT;
    if (type === TopicType.SYSTEM && !actor.isAdmin) {
      throw new ForbiddenException('系统话题仅管理员可创建');
    }
    const content = input.content?.trim() ?? '';
    if (!content && type !== TopicType.SYSTEM) {
      throw new BadRequestException('话题内容不能为空');
    }
    const title = (input.title?.trim() || deriveTitle(content)).slice(0, 200);
    const mentions = await this.resolveMentions(input.mentions);
    const topic = await this.topics.save(
      this.topics.create({
        subjectType: subject.type,
        subjectId: subject.id,
        title,
        content,
        type,
        status: TopicStatus.OPEN,
        tags: this.normalizeTags(input.tags),
        blocking: false,
        isDefault: false,
        authorType: this.authorTypeOf(actor),
        authorId: this.authorIdOf(actor),
        authorName: actor.name,
        authorAvatarUrl:
          actor.user?.avatarUrl ?? actor.worker?.avatarUrl ?? null,
        images: input.images?.length ? input.images : null,
        mentions: mentions.length ? mentions : null,
        metadata: null,
      }),
    );
    const view = this.toTopicView(topic, subject, 0);
    this.realtime.publish({
      type: 'topic.upsert',
      subjectType: subject.type,
      subjectId: subject.id,
      topic: view,
    });
    await this.notify.notifyGroup(subject, view, content, actor.name);
    await this.notify.notifyMentions(view, mentions, content, actor.name, null);
    if (type === TopicType.QUESTION && subject.requesterUserId) {
      await this.notify.notifyQuestion(
        view,
        subject.requesterUserId,
        `问答待回答：${title}`,
        content,
      );
    }
    await this.afterWrite(subject, topic, content, actor, mentions, null);
    return this.get(topic.id, actor);
  }

  async update(
    topicId: number,
    input: UpdateTopicInput,
    actor: TopicActor,
  ): Promise<TopicView> {
    const topic = await this.mustFindTopic(topicId);
    const subject = await this.resolveSubject(
      topic.subjectType,
      topic.subjectId,
    );
    this.assertCanModify(topic, actor);
    if (input.title !== undefined) {
      topic.title = input.title?.trim()?.slice(0, 200) || null;
    }
    if (input.tags !== undefined) topic.tags = this.normalizeTags(input.tags);
    if (input.status !== undefined) topic.status = input.status;
    if (input.pinned !== undefined) topic.pinned = input.pinned;
    if (input.locked !== undefined) topic.locked = input.locked;
    const saved = await this.topics.save(topic);
    const view = this.toTopicView(saved, subject, 0);
    this.realtime.publish({
      type: 'topic.upsert',
      subjectType: subject.type,
      subjectId: subject.id,
      topic: view,
    });
    return view;
  }

  async remove(topicId: number, actor: TopicActor): Promise<void> {
    const topic = await this.mustFindTopic(topicId);
    this.assertCanModify(topic, actor);
    if (topic.isDefault) {
      throw new BadRequestException('主话题不能删除');
    }
    topic.deletedAt = new Date();
    await this.topics.save(topic);
    this.realtime.publish({
      type: 'topic.delete',
      subjectType: topic.subjectType,
      subjectId: topic.subjectId,
      topicId: topic.id,
    });
  }

  async reply(
    topicId: number,
    input: ReplyTopicInput,
    actor: TopicActor,
  ): Promise<{ topic: TopicView; reply: TopicReplyView }> {
    const topic = await this.mustFindTopic(topicId);
    if (topic.locked) throw new BadRequestException('话题已锁定，不能回复');
    const subject = await this.resolveSubject(
      topic.subjectType,
      topic.subjectId,
    );
    const content = input.content?.trim() ?? '';
    if (!content) throw new BadRequestException('回复内容不能为空');
    const mentions = await this.resolveMentions(input.mentions);
    const reply = await this.replies.save(
      this.replies.create({
        topicId: topic.id,
        content,
        authorType: this.authorTypeOf(actor),
        authorId: this.authorIdOf(actor),
        authorName: actor.name,
        authorAvatarUrl:
          actor.user?.avatarUrl ?? actor.worker?.avatarUrl ?? null,
        images: input.images?.length ? input.images : null,
        mentions: mentions.length ? mentions : null,
        metadata: null,
        status: TopicReplyStatus.COMPLETE,
      }),
    );
    await this.touchTopic(topic, reply);
    const view = this.toTopicView(topic, subject, 0);
    const replyView = this.toReplyView(reply);
    this.realtime.publish({
      type: 'reply.upsert',
      subjectType: subject.type,
      subjectId: subject.id,
      topicId: topic.id,
      reply: replyView,
    });
    await this.notify.notifyGroup(subject, view, content, actor.name);
    const notified = await this.notify.notifyMentions(
      view,
      mentions,
      content,
      actor.name,
      reply.id,
    );
    await this.notify.notifyTopicAuthor(view, content, actor.name, reply.id);
    await this.afterWrite(
      subject,
      topic,
      content,
      actor,
      mentions,
      reply,
      notified,
    );
    return { topic: view, reply: replyView };
  }

  async answer(
    topicId: number,
    input: AnswerTopicInput,
    actor: TopicActor,
  ): Promise<TopicDetailView> {
    const topic = await this.mustFindTopic(topicId);
    const subject = await this.resolveSubject(
      topic.subjectType,
      topic.subjectId,
    );
    if (topic.type !== TopicType.QUESTION) {
      throw new BadRequestException('该话题不是问答类型');
    }
    const metadata = (topic.metadata ?? {}) as Record<string, unknown>;
    const questionId =
      typeof metadata.questionId === 'string' ? metadata.questionId : null;
    const taskId =
      typeof metadata.taskId === 'number'
        ? metadata.taskId
        : subject.type === TopicSubjectType.TASK
          ? Number(subject.id)
          : null;
    if (questionId && taskId) {
      const taskActor = await this.taskActors.resolveRequesterActor(
        { user: actor.user, worker: actor.worker },
        taskId,
      );
      await this.collaboration.answer(taskId, questionId, taskActor, {
        answers: input.answers,
        reject: input.reject === true,
      });
      return this.get(topic.id, actor);
    }
    return this.answerLocally(topic, subject, input, actor);
  }

  async markRead(
    topicId: number,
    actor: TopicActor,
  ): Promise<{ lastReadReplyId: number }> {
    await this.mustFindTopic(topicId);
    if (!actor.userId) return { lastReadReplyId: 0 };
    const latest = await this.replies.findOne({
      where: { topicId, deletedAt: IsNull() },
      order: { id: 'DESC' },
      select: { id: true },
    });
    const lastReadReplyId = latest?.id ?? 0;
    let read = await this.reads.findOne({
      where: { topicId, userId: actor.userId },
    });
    if (!read) {
      read = this.reads.create({
        topicId,
        userId: actor.userId,
        lastReadReplyId,
        readAt: new Date(),
      });
    } else {
      read.lastReadReplyId = Math.max(read.lastReadReplyId, lastReadReplyId);
      read.readAt = new Date();
    }
    await this.reads.save(read);
    return { lastReadReplyId: read.lastReadReplyId };
  }

  // ===== 任务集成 =====

  /** 机器人提问：创建/更新问答话题 */
  async syncTaskQuestion(message: TaskChatMessage): Promise<void> {
    const question = message.question;
    if (!question) return;
    const subject = await this.resolveSubject(
      TopicSubjectType.TASK,
      String(message.taskId),
    );
    let topic = await this.findQuestionTopic(message.taskId, question.id);
    const metadata = {
      questionId: question.id,
      taskId: message.taskId,
      questions: question.questions,
      answers: question.answers,
      state: question.state,
    };
    if (!topic) {
      topic = await this.topics.save(
        this.topics.create({
          subjectType: TopicSubjectType.TASK,
          subjectId: String(message.taskId),
          title: (
            question.questions[0]?.header ||
            question.questions[0]?.question ||
            '机器人提问'
          ).slice(0, 200),
          content: formatQuestions(question.questions),
          type: TopicType.QUESTION,
          status:
            question.state === 'pending'
              ? TopicStatus.OPEN
              : TopicStatus.RESOLVED,
          tags: ['澄清'],
          blocking: true,
          isDefault: false,
          authorType: message.sender.workerId
            ? TopicAuthorType.WORKER
            : TopicAuthorType.SYSTEM,
          authorId: message.sender.workerId ?? null,
          authorName: message.sender.name,
          authorAvatarUrl: message.sender.avatarUrl ?? null,
          metadata,
        }),
      );
      const view = this.toTopicView(topic, subject, 0);
      this.realtime.publish({
        type: 'topic.upsert',
        subjectType: subject.type,
        subjectId: subject.id,
        topic: view,
      });
      await this.notify.notifyQuestion(
        view,
        subject.requesterUserId,
        `任务待反馈：${subject.title}`,
        formatQuestions(question.questions),
      );
    } else {
      topic.metadata = {
        ...((topic.metadata ?? {}) as Record<string, unknown>),
        ...metadata,
      };
      if (question.state === 'cancelled') topic.status = TopicStatus.CLOSED;
      else if (question.state !== 'pending')
        topic.status = TopicStatus.RESOLVED;
      topic = await this.topics.save(topic);
      const view = this.toTopicView(topic, subject, 0);
      this.realtime.publish({
        type: 'topic.upsert',
        subjectType: subject.type,
        subjectId: subject.id,
        topic: view,
      });
    }
    await this.setActiveTopic(
      message.taskId,
      topic.id,
      topic.title ?? '机器人提问',
    );
  }

  /** 问答答复：由 TaskCollaborationService 在答复成功后调用 */
  async syncQuestionAnswer(
    taskId: number,
    questionId: string,
    actor: TaskActor,
    answers: string[][] | undefined,
    rejected: boolean,
  ): Promise<void> {
    const topic = await this.findQuestionTopic(taskId, questionId);
    if (!topic) return;
    const subject = await this.resolveSubject(
      TopicSubjectType.TASK,
      String(taskId),
    );
    const metadata = (topic.metadata ?? {}) as Record<string, unknown>;
    const questions = Array.isArray(metadata.questions)
      ? (metadata.questions as TaskChatQuestion['questions'])
      : [];
    const answerText = rejected
      ? '跳过本次提问'
      : formatAnswers(questions, answers ?? []);
    const authorType =
      actor.type === 'worker' ? TopicAuthorType.WORKER : TopicAuthorType.USER;
    const authorId = actor.type === 'worker' ? actor.worker.id : actor.user.id;
    const authorName =
      actor.type === 'worker' ? actor.worker.name : actor.user.name;
    topic.metadata = {
      ...metadata,
      answers: answers ?? null,
      rejected,
      answeredBy: { type: actor.type, id: authorId, name: authorName },
      answeredAt: new Date().toISOString(),
    };
    topic.status = TopicStatus.RESOLVED;
    const saved = await this.topics.save(topic);
    const reply = await this.replies.save(
      this.replies.create({
        topicId: topic.id,
        content: answerText,
        authorType,
        authorId,
        authorName,
        authorAvatarUrl:
          actor.type === 'worker'
            ? actor.worker.avatarUrl
            : actor.user.avatarUrl,
        metadata: { answer: true, questionId },
        status: TopicReplyStatus.COMPLETE,
      }),
    );
    await this.touchTopic(saved, reply);
    const view = this.toTopicView(saved, subject, 0);
    this.realtime.publish({
      type: 'topic.upsert',
      subjectType: subject.type,
      subjectId: subject.id,
      topic: view,
    });
    this.realtime.publish({
      type: 'reply.upsert',
      subjectType: subject.type,
      subjectId: subject.id,
      topicId: saved.id,
      reply: this.toReplyView(reply),
    });
    await this.notify.notifyGroup(subject, view, answerText, authorName);
    await this.setActiveTopic(taskId, saved.id, saved.title ?? '机器人提问');
  }

  /** 验收不通过：单独生成一个系统帖子 */
  async recordAcceptanceRejection(
    task: Task,
    actor: TaskActor,
    content: string,
  ): Promise<Topic> {
    const subject = await this.resolveSubject(
      TopicSubjectType.TASK,
      String(task.id),
    );
    const authorName =
      actor.type === 'worker' ? actor.worker.name : actor.user.name;
    const topic = await this.topics.save(
      this.topics.create({
        subjectType: TopicSubjectType.TASK,
        subjectId: String(task.id),
        title: '验收不通过',
        content: content.trim(),
        type: TopicType.SYSTEM,
        status: TopicStatus.OPEN,
        tags: [],
        blocking: false,
        isDefault: false,
        authorType:
          actor.type === 'worker'
            ? TopicAuthorType.WORKER
            : TopicAuthorType.USER,
        authorId: actor.type === 'worker' ? actor.worker.id : actor.user.id,
        authorName,
        authorAvatarUrl:
          actor.type === 'worker'
            ? actor.worker.avatarUrl
            : actor.user.avatarUrl,
        metadata: { acceptanceRejection: true, taskId: task.id },
      }),
    );
    const view = this.toTopicView(topic, subject, 0);
    this.realtime.publish({
      type: 'topic.upsert',
      subjectType: subject.type,
      subjectId: subject.id,
      topic: view,
    });
    await this.notify.notifyGroup(subject, view, content, authorName);
    await this.setActiveTopic(task.id, topic.id, topic.title ?? '验收不通过');
    return topic;
  }

  /** 任务机器人文本消息镜像到当前话题 */
  private async handleTaskMessage(message: TaskChatMessage): Promise<void> {
    if (message.kind === 'question') {
      await this.syncTaskQuestion(message);
      return;
    }
    if (message.role !== 'assistant' || message.kind !== 'message') return;
    if (message.status === 'running') return;
    const content = message.content?.trim();
    if (!content) return;
    const subject = await this.resolveSubject(
      TopicSubjectType.TASK,
      String(message.taskId),
    );
    let topic = await this.activeTopic(message.taskId);
    if (!topic) {
      topic = await this.ensureDefaultTopic(subject);
    }
    const existing = await this.replies.findOne({
      where: { topicId: topic.id, sourceMessageId: message.id },
    });
    if (existing) {
      existing.content = content;
      existing.status =
        message.status === 'error'
          ? TopicReplyStatus.ERROR
          : TopicReplyStatus.COMPLETE;
      existing.authorName = message.sender.name;
      existing.authorAvatarUrl = message.sender.avatarUrl ?? null;
      await this.replies.save(existing);
      this.realtime.publish({
        type: 'reply.upsert',
        subjectType: subject.type,
        subjectId: subject.id,
        topicId: topic.id,
        reply: this.toReplyView(existing),
      });
      return;
    }
    const reply = await this.replies.save(
      this.replies.create({
        topicId: topic.id,
        content,
        authorType: message.sender.workerId
          ? TopicAuthorType.WORKER
          : message.sender.kind === 'system'
            ? TopicAuthorType.SYSTEM
            : TopicAuthorType.USER,
        authorId: message.sender.workerId ?? null,
        authorName: message.sender.name,
        authorAvatarUrl: message.sender.avatarUrl ?? null,
        metadata: { taskMessageId: message.id },
        status:
          message.status === 'error'
            ? TopicReplyStatus.ERROR
            : TopicReplyStatus.COMPLETE,
        sourceMessageId: message.id,
      }),
    );
    await this.touchTopic(topic, reply);
    const view = this.toTopicView(topic, subject, 0);
    this.realtime.publish({
      type: 'reply.upsert',
      subjectType: subject.type,
      subjectId: subject.id,
      topicId: topic.id,
      reply: this.toReplyView(reply),
    });
    await this.notify.notifyGroup(subject, view, content, message.sender.name);
  }

  private async afterWrite(
    subject: TopicSubjectInfo,
    topic: Topic,
    content: string,
    actor: TopicActor,
    mentions: TopicMention[],
    reply: TopicReply | null,
    notifiedWorkerIds: number[] = [],
  ): Promise<void> {
    if (subject.type === TopicSubjectType.TASK) {
      await this.maybeTriggerTask(subject, topic, content, actor, mentions);
    }
    await this.triggerBotReplies(
      subject,
      topic,
      content,
      actor,
      mentions,
      notifiedWorkerIds,
    );
  }

  /** 任务话题：主话题消息或 @执行机器人 时投递到任务会话 */
  private async maybeTriggerTask(
    subject: TopicSubjectInfo,
    topic: Topic,
    content: string,
    actor: TopicActor,
    mentions: TopicMention[],
  ): Promise<void> {
    if (!actor.user && !actor.worker) return;
    if (actor.workerId && actor.workerId === subject.defaultWorkerId) {
      // 真人执行机器人自己回复，只落话题，不再投递任务
      if (actor.worker?.runtime === WorkerRuntime.HUMAN) return;
    }
    const taskId = Number(subject.id);
    const task = await this.tasks.findOne({ where: { id: taskId } });
    if (!task || task.status === TaskStatus.FINISHED) return;
    const mentionedAgent =
      subject.defaultWorkerId != null &&
      mentions.some((mention) => mention.id === subject.defaultWorkerId);
    if (!topic.isDefault && !mentionedAgent) return;
    if (!(await this.canActAsTaskRequester(task, actor))) return;
    await this.setActiveTopic(taskId, topic.id, topic.title ?? '主话题');
    try {
      await this.tasksService.sendMessage(taskId, content, actor.name, {
        actorWorkerId: actor.workerId,
        perspective: 'requester',
      });
    } catch (error) {
      this.logger.warn(
        `话题消息投递任务失败（taskId=${taskId}）: ${(error as Error).message}`,
      );
    }
  }

  /** 非任务主体或非当前执行机器人：@AI 机器人内联回答 */
  private async triggerBotReplies(
    subject: TopicSubjectInfo,
    topic: Topic,
    content: string,
    actor: TopicActor,
    mentions: TopicMention[],
    notifiedWorkerIds: number[],
  ): Promise<void> {
    if (!mentions.length) return;
    for (const mention of mentions) {
      if (mention.id === subject.defaultWorkerId) continue;
      const worker = await this.workers.findOne({
        where: { id: mention.id },
      });
      if (!worker || !worker.enabled) continue;
      if (worker.runtime === WorkerRuntime.HUMAN) continue;
      if (
        worker.runtime !== WorkerRuntime.OPENCODE &&
        worker.runtime !== WorkerRuntime.CODEX &&
        worker.runtime !== WorkerRuntime.CLAUDE_CODE
      ) {
        continue;
      }
      void this.askBot(subject, topic, content, actor, worker).catch(
        (error: Error) => {
          this.logger.warn(
            `话题 @机器人回复失败（worker=${worker.id}）: ${error.message}`,
          );
        },
      );
      if (!notifiedWorkerIds.includes(worker.id)) {
        // 通知已在 notifyMentions 中发出；这里只保留去重语义
      }
    }
  }

  private async askBot(
    subject: TopicSubjectInfo,
    topic: Topic,
    content: string,
    actor: TopicActor,
    worker: Worker,
  ): Promise<void> {
    const scope = `topic:${topic.id}`;
    const recent = await this.replies.find({
      where: { topicId: topic.id, deletedAt: IsNull() },
      order: { id: 'DESC' },
      take: 10,
    });
    recent.reverse();
    const context = recent
      .map((row) => `${row.authorName ?? '未知'}：${row.content}`)
      .join('\n\n');
    const promptPrefix = [
      '# 话题上下文',
      '',
      `- 主体：${subject.title}`,
      `- 话题：${topic.title ?? '主话题'}`,
      `- 发起人：${actor.name}`,
      '',
      '## 最近讨论',
      '',
      context || '（暂无）',
      '',
      '请只针对当前话题给出简洁、可执行的回答；不要重复角色设定，不要创建新话题。',
    ].join('\n');
    let assistantId: string | null = null;
    let done = false;
    const subscription = this.debug.stream(0, worker.id, scope).subscribe({
      next: (event: MessageEvent) => {
        if (done) return;
        const payload = event.data as DebugStreamPayload;
        if (payload.type !== 'snapshot' || !payload.snapshot) return;
        if (!assistantId) {
          const last = [...payload.snapshot.messages]
            .reverse()
            .find((item) => item.role === 'assistant');
          if (last) assistantId = last.id;
          else return;
        }
        const message = payload.snapshot.messages.find(
          (item) => item.id === assistantId,
        );
        if (!message || message.status === 'running') return;
        done = true;
        subscription.unsubscribe();
        const text = message.content.trim();
        if (!text) return;
        void this.addBotReply(
          subject,
          topic,
          worker,
          text,
          message.status === 'error',
          `debug:${worker.id}:${assistantId}`,
        ).catch((error: Error) => {
          this.logger.warn(
            `话题机器人回复落库失败（worker=${worker.id}）: ${error.message}`,
          );
        });
      },
      error: (error: Error) => {
        done = true;
        subscription.unsubscribe();
        this.logger.warn(
          `话题机器人流失败（worker=${worker.id}）: ${error.message}`,
        );
      },
    });
    try {
      await this.debug.send(0, worker.id, content, {
        scope,
        promptPrefix,
        firstPrompt: [
          '# 话题内联回答',
          '',
          '你正在平台话题中回答用户。请结合上下文直接回复，回答会展示在该话题下。',
        ].join('\n'),
      });
    } catch (error) {
      done = true;
      subscription.unsubscribe();
      throw error;
    }
  }

  private async addBotReply(
    subject: TopicSubjectInfo,
    topic: Topic,
    worker: Worker,
    content: string,
    error: boolean,
    sourceMessageId: string,
  ): Promise<void> {
    const existing = await this.replies.findOne({
      where: { topicId: topic.id, sourceMessageId },
    });
    if (existing) {
      existing.content = content;
      existing.status = error
        ? TopicReplyStatus.ERROR
        : TopicReplyStatus.COMPLETE;
      await this.replies.save(existing);
      return;
    }
    const reply = await this.replies.save(
      this.replies.create({
        topicId: topic.id,
        content,
        authorType: TopicAuthorType.WORKER,
        authorId: worker.id,
        authorName: worker.name,
        authorAvatarUrl: worker.avatarUrl,
        metadata: { botReply: true },
        status: error ? TopicReplyStatus.ERROR : TopicReplyStatus.COMPLETE,
        sourceMessageId,
      }),
    );
    await this.touchTopic(topic, reply);
    const view = this.toTopicView(topic, subject, 0);
    this.realtime.publish({
      type: 'reply.upsert',
      subjectType: subject.type,
      subjectId: subject.id,
      topicId: topic.id,
      reply: this.toReplyView(reply),
    });
    await this.notify.notifyGroup(subject, view, content, worker.name);
  }

  private async answerLocally(
    topic: Topic,
    subject: TopicSubjectInfo,
    input: AnswerTopicInput,
    actor: TopicActor,
  ): Promise<TopicDetailView> {
    const metadata = (topic.metadata ?? {}) as Record<string, unknown>;
    const questions = Array.isArray(metadata.questions)
      ? (metadata.questions as TaskChatQuestion['questions'])
      : [];
    const answers = input.reject ? undefined : (input.answers ?? []);
    topic.status = TopicStatus.RESOLVED;
    topic.metadata = {
      ...metadata,
      answers: answers ?? null,
      rejected: input.reject === true,
      answeredBy: {
        type: this.authorTypeOf(actor),
        id: this.authorIdOf(actor),
        name: actor.name,
      },
      answeredAt: new Date().toISOString(),
    };
    await this.topics.save(topic);
    const content = input.reject
      ? '跳过本次提问'
      : formatAnswers(questions, answers ?? []);
    const reply = await this.replies.save(
      this.replies.create({
        topicId: topic.id,
        content,
        authorType: this.authorTypeOf(actor),
        authorId: this.authorIdOf(actor),
        authorName: actor.name,
        authorAvatarUrl:
          actor.user?.avatarUrl ?? actor.worker?.avatarUrl ?? null,
        metadata: { answer: true },
        status: TopicReplyStatus.COMPLETE,
      }),
    );
    await this.touchTopic(topic, reply);
    const view = this.toTopicView(topic, subject, 0);
    this.realtime.publish({
      type: 'topic.upsert',
      subjectType: subject.type,
      subjectId: subject.id,
      topic: view,
    });
    this.realtime.publish({
      type: 'reply.upsert',
      subjectType: subject.type,
      subjectId: subject.id,
      topicId: topic.id,
      reply: this.toReplyView(reply),
    });
    await this.notify.notifyGroup(subject, view, content, actor.name);
    return this.get(topic.id, actor);
  }

  // ===== 主体与默认话题 =====

  private async resolveSubject(
    type: TopicSubjectType,
    id: string,
  ): Promise<TopicSubjectInfo> {
    if (!Object.values(TopicSubjectType).includes(type)) {
      throw new BadRequestException(`不支持的话题主体：${type}`);
    }
    const subjectId = String(id).trim();
    if (!subjectId) throw new BadRequestException('缺少话题主体 ID');
    if (type === TopicSubjectType.IDEA) {
      const idea = await this.ideas.findOne({
        where: { id: Number(subjectId) },
      });
      if (!idea) throw new NotFoundException(`灵感 ${subjectId} 不存在`);
      return {
        type,
        id: subjectId,
        title: idea.title,
        code: `I-${idea.id}`,
        url: `/ideas/${idea.id}`,
        group: idea.projectId ? { kind: 'project', id: idea.projectId } : null,
        defaultWorkerId: null,
        requesterUserId: idea.creatorId,
      };
    }
    if (type === TopicSubjectType.BACKLOG) {
      const backlog = await this.backlogs.findOne({
        where: { id: Number(subjectId) },
      });
      if (!backlog) throw new NotFoundException(`迭代项 ${subjectId} 不存在`);
      return {
        type,
        id: subjectId,
        title: backlog.title,
        code: backlog.code,
        url: `/backlogs/${backlog.id}`,
        group: { kind: 'backlog', id: backlog.id },
        defaultWorkerId: backlog.ownerWorkerId,
        requesterUserId: null,
      };
    }
    if (type === TopicSubjectType.KNOWLEDGE) {
      const node = await this.knowledge.getNodeById(subjectId);
      if (node.kind !== 'article') {
        throw new BadRequestException('话题只能挂在知识文章下，不能挂在目录');
      }
      return {
        type,
        id: subjectId,
        title: node.title,
        code: null,
        url: `/docs/detail/${node.path
          .split('/')
          .filter(Boolean)
          .map((segment) => encodeURIComponent(segment))
          .join('/')}`,
        group: null,
        defaultWorkerId: null,
        requesterUserId: null,
      };
    }
    if (type === TopicSubjectType.TASK) {
      const task = await this.tasks.findOne({
        where: { id: Number(subjectId) },
      });
      if (!task) throw new NotFoundException(`任务 ${subjectId} 不存在`);
      return {
        type,
        id: subjectId,
        title: `${task.code} ${task.title}`,
        code: task.code,
        url: `/tasks/${task.id}`,
        group: { kind: 'task', id: task.id },
        defaultWorkerId: task.agentId,
        requesterUserId: await this.requesterUserIdOfTask(task),
      };
    }
    const ticket = await this.tickets.findOne({
      where: { id: Number(subjectId) },
    });
    if (!ticket) throw new NotFoundException(`工单 ${subjectId} 不存在`);
    return {
      type: TopicSubjectType.TICKET,
      id: subjectId,
      title: `${ticket.code} ${ticket.title}`,
      code: ticket.code,
      url: `/tickets/${ticket.id}`,
      group: ticket.backlogId
        ? { kind: 'backlog', id: ticket.backlogId }
        : ticket.taskId
          ? { kind: 'task', id: ticket.taskId }
          : null,
      defaultWorkerId:
        ticket.assigneeType === 'worker' ? ticket.assigneeId : null,
      requesterUserId: ticket.createdById,
    };
  }

  private async requesterUserIdOfTask(task: Task): Promise<number | null> {
    if (task.requesterType === 'user') return task.requesterId;
    if (task.requesterType === 'worker' && task.requesterId) {
      const worker = await this.workers.findOne({
        where: { id: task.requesterId },
        select: { id: true, humanUserId: true },
      });
      return worker?.humanUserId ?? null;
    }
    return task.createdById ?? null;
  }

  private async ensureDefaultTopic(subject: TopicSubjectInfo): Promise<Topic> {
    const existing = await this.topics.findOne({
      where: {
        subjectType: subject.type,
        subjectId: subject.id,
        isDefault: true,
        deletedAt: IsNull(),
      },
    });
    if (existing) return existing;
    try {
      return await this.topics.save(
        this.topics.create({
          subjectType: subject.type,
          subjectId: subject.id,
          title: '主话题',
          content: '',
          type: TopicType.CONTENT,
          status: TopicStatus.OPEN,
          tags: [],
          blocking: false,
          isDefault: true,
          authorType: TopicAuthorType.SYSTEM,
          authorId: null,
          authorName: '系统',
          authorAvatarUrl: null,
        }),
      );
    } catch (error) {
      // 并发首次访问：唯一索引兜底后重查
      const fresh = await this.topics.findOne({
        where: {
          subjectType: subject.type,
          subjectId: subject.id,
          isDefault: true,
          deletedAt: IsNull(),
        },
      });
      if (fresh) return fresh;
      throw error;
    }
  }

  private async mustFindTopic(topicId: number): Promise<Topic> {
    const topic = await this.topics.findOne({
      where: { id: topicId, deletedAt: IsNull() },
    });
    if (!topic) throw new NotFoundException(`话题 ${topicId} 不存在`);
    return topic;
  }

  // ===== 任务上下文 =====

  private async setActiveTopic(
    taskId: number,
    topicId: number,
    title: string | null,
  ): Promise<void> {
    let context = await this.taskContexts.findOne({ where: { taskId } });
    if (!context) {
      context = this.taskContexts.create({ taskId, activeTopicId: topicId });
    }
    context.activeTopicId = topicId;
    context.activeTopicTitle = title?.slice(0, 200) ?? null;
    await this.taskContexts.save(context);
  }

  private async activeTopic(taskId: number): Promise<Topic | null> {
    const context = await this.taskContexts.findOne({ where: { taskId } });
    if (!context?.activeTopicId) return null;
    return this.topics.findOne({
      where: { id: context.activeTopicId, deletedAt: IsNull() },
    });
  }

  private async findQuestionTopic(
    taskId: number,
    questionId: string,
  ): Promise<Topic | null> {
    return this.topics
      .createQueryBuilder('topic')
      .where('topic.subjectType = :type', { type: TopicSubjectType.TASK })
      .andWhere('topic.subjectId = :subjectId', {
        subjectId: String(taskId),
      })
      .andWhere('topic.type = :topicType', { topicType: TopicType.QUESTION })
      .andWhere("topic.metadata ->> 'questionId' = :questionId", {
        questionId,
      })
      .andWhere('topic.deletedAt IS NULL')
      .getOne();
  }

  // ===== 工具方法 =====

  private async touchTopic(topic: Topic, reply: TopicReply): Promise<void> {
    topic.replyCount += 1;
    topic.lastReplyAt = reply.createdAt;
    topic.lastReplyByName = reply.authorName;
    await this.topics.save(topic);
  }

  private async readMapForTopics(
    topicIds: number[],
    userId: number | null,
  ): Promise<Map<number, TopicRead>> {
    if (!userId || topicIds.length === 0) return new Map();
    const rows = await this.reads.find({
      where: { topicId: In(topicIds), userId },
    });
    return new Map(rows.map((row) => [row.topicId, row]));
  }

  private async unreadCountMap(
    topicIds: number[],
    readMap: Map<number, TopicRead>,
  ): Promise<Map<number, number>> {
    const result = new Map<number, number>();
    for (const topicId of topicIds) {
      const lastRead = readMap.get(topicId)?.lastReadReplyId ?? 0;
      const count = await this.replies
        .createQueryBuilder('reply')
        .where('reply.topicId = :topicId', { topicId })
        .andWhere('reply.deletedAt IS NULL')
        .andWhere('reply.id > :lastRead', { lastRead })
        .getCount();
      result.set(topicId, count);
    }
    return result;
  }

  private normalizeTags(tags?: string[]): string[] {
    if (!tags?.length) return [];
    const out: string[] = [];
    for (const raw of tags) {
      const tag = raw?.trim();
      if (!tag) continue;
      if (tag.length > MAX_TAG_LENGTH) {
        throw new BadRequestException(`标签长度不能超过 ${MAX_TAG_LENGTH} 字`);
      }
      if (!out.includes(tag)) out.push(tag);
      if (out.length >= MAX_TAGS) break;
    }
    return out;
  }

  private async resolveMentions(ids?: number[]): Promise<TopicMention[]> {
    if (!ids?.length) return [];
    const unique = [
      ...new Set(ids.filter((id) => Number.isInteger(id) && id > 0)),
    ];
    if (unique.length === 0) return [];
    if (unique.length > MAX_MENTIONS) {
      throw new BadRequestException(`最多 @ ${MAX_MENTIONS} 个机器人`);
    }
    const workers = await this.workers.find({ where: { id: In(unique) } });
    if (workers.length !== unique.length) {
      throw new BadRequestException('存在不存在的机器人');
    }
    return workers.map((worker) => ({
      type: 'worker' as const,
      id: worker.id,
      name: worker.name,
    }));
  }

  private authorTypeOf(actor: TopicActor): TopicAuthorType {
    if (actor.worker) return TopicAuthorType.WORKER;
    if (actor.user) return TopicAuthorType.USER;
    return TopicAuthorType.SYSTEM;
  }

  private authorIdOf(actor: TopicActor): number | null {
    return actor.worker?.id ?? actor.user?.id ?? null;
  }

  private assertCanModify(topic: Topic, actor: TopicActor): void {
    if (actor.isAdmin) return;
    if (
      topic.authorType === TopicAuthorType.USER &&
      actor.userId &&
      topic.authorId === actor.userId
    ) {
      return;
    }
    if (
      topic.authorType === TopicAuthorType.WORKER &&
      actor.workerId &&
      topic.authorId === actor.workerId
    ) {
      return;
    }
    throw new ForbiddenException('仅话题作者或管理员可以操作');
  }

  private async canActAsTaskRequester(
    task: Task,
    actor: TopicActor,
  ): Promise<boolean> {
    if (actor.isAdmin) return true;
    if (!task.requesterType) {
      return actor.userId != null && task.createdById === actor.userId;
    }
    if (task.requesterType === 'user') {
      return actor.userId != null && task.requesterId === actor.userId;
    }
    if (actor.workerId != null && task.requesterId === actor.workerId) {
      return true;
    }
    if (actor.userId != null) {
      const human = await this.workers.findOne({
        where: { humanUserId: actor.userId },
        select: { id: true },
      });
      if (human && task.requesterId === human.id) return true;
    }
    return false;
  }

  private toTopicView(
    topic: Topic,
    subject: TopicSubjectInfo,
    unreadCount: number,
  ): TopicView {
    return {
      id: topic.id,
      subjectType: topic.subjectType,
      subjectId: topic.subjectId,
      subjectTitle: subject.title,
      subjectUrl: subject.url,
      title: topic.title,
      content: topic.content,
      type: topic.type,
      status: topic.status,
      tags: topic.tags ?? [],
      blocking: topic.blocking,
      isDefault: topic.isDefault,
      pinned: topic.pinned,
      locked: topic.locked,
      author: {
        type: topic.authorType,
        id: topic.authorId,
        name: topic.authorName ?? '系统',
        avatarUrl: topic.authorAvatarUrl,
      },
      images: topic.images,
      mentions: topic.mentions,
      metadata: topic.metadata,
      replyCount: topic.replyCount,
      unreadCount,
      lastReplyAt: topic.lastReplyAt?.toISOString() ?? null,
      lastReplyByName: topic.lastReplyByName,
      createdAt: topic.createdAt.toISOString(),
      updatedAt: topic.updatedAt.toISOString(),
    };
  }

  private toReplyView(reply: TopicReply): TopicReplyView {
    return {
      id: reply.id,
      topicId: reply.topicId,
      content: reply.content,
      author: {
        type: reply.authorType,
        id: reply.authorId,
        name: reply.authorName ?? '系统',
        avatarUrl: reply.authorAvatarUrl,
      },
      images: reply.images,
      mentions: reply.mentions,
      metadata: reply.metadata,
      status: reply.status,
      createdAt: reply.createdAt.toISOString(),
      updatedAt: reply.updatedAt.toISOString(),
    };
  }

  /** SSE：按主体订阅话题事件 */
  stream(
    subjectType: TopicSubjectType,
    subjectId: string,
  ): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      subscriber.next({ data: { type: 'ready', at: Date.now() } });
      const subscription = this.realtime.events$.subscribe((event) => {
        if (
          event.subjectType === subjectType &&
          event.subjectId === subjectId
        ) {
          subscriber.next({ data: event });
        }
      });
      const heartbeat = setInterval(() => {
        subscriber.next({ data: { type: 'ping', at: Date.now() } });
      }, 20_000);
      return () => {
        clearInterval(heartbeat);
        subscription.unsubscribe();
      };
    });
  }
}
