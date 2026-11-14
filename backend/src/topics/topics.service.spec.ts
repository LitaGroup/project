import { TopicStatus, TopicType } from '../common/enums';
import { TopicsService } from './topics.service';

function now(): Date {
  return new Date('2026-11-14T10:00:00+08:00');
}

function repoMock() {
  return {
    findOne: jest.fn(),
    find: jest.fn(),
    findAndCount: jest.fn(),
    count: jest.fn(),
    create: jest.fn((input: unknown) => input),
    save: jest.fn((input: Record<string, unknown>) =>
      Promise.resolve({
        ...input,
        id: input.id ?? 1,
        createdAt: input.createdAt ?? now(),
        updatedAt: input.updatedAt ?? now(),
      }),
    ),
    insert: jest.fn(),
    update: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
}

describe('TopicsService', () => {
  const topics = repoMock();
  const replies = repoMock();
  const reads = repoMock();
  const notifications = repoMock();
  const taskContexts = repoMock();
  const ideas = repoMock();
  const backlogs = repoMock();
  const tasks = repoMock();
  const tickets = repoMock();
  const workers = repoMock();
  const knowledge = { getNodeById: jest.fn() };
  const taskChat = { messagePersisted$: { subscribe: jest.fn() } };
  const tasksService = { sendMessage: jest.fn() };
  const taskActors = { resolveRequesterActor: jest.fn() };
  const collaboration = { answer: jest.fn() };
  const taskTopicHooks = { register: jest.fn(), emit: jest.fn() };
  const debug = { stream: jest.fn(), send: jest.fn() };
  const notify = {
    notifyGroup: jest.fn(),
    notifyMentions: jest.fn(() => Promise.resolve([])),
    notifyTopicAuthor: jest.fn(),
    notifyQuestion: jest.fn(),
  };
  const realtime = { publish: jest.fn() };

  const service = new TopicsService(
    topics as never,
    replies as never,
    reads as never,
    notifications as never,
    taskContexts as never,
    ideas as never,
    backlogs as never,
    tasks as never,
    tickets as never,
    workers as never,
    knowledge as never,
    taskChat as never,
    tasksService as never,
    taskActors as never,
    collaboration as never,
    taskTopicHooks as never,
    debug as never,
    notify as never,
    realtime as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    topics.findOne.mockReset();
    topics.save.mockImplementation((input: Record<string, unknown>) =>
      Promise.resolve({
        ...input,
        id: input.id ?? 1,
        createdAt: input.createdAt ?? now(),
        updatedAt: input.updatedAt ?? now(),
      }),
    );
    replies.save.mockImplementation((input: Record<string, unknown>) =>
      Promise.resolve({
        ...input,
        id: input.id ?? 2,
        createdAt: input.createdAt ?? now(),
        updatedAt: input.updatedAt ?? now(),
      }),
    );
    taskContexts.findOne.mockResolvedValue(null);
    taskContexts.save.mockImplementation((input: unknown) =>
      Promise.resolve(input),
    );
    workers.find.mockResolvedValue([
      {
        id: 7,
        name: '机器人七',
        enabled: true,
        runtime: 'opencode',
      },
    ]);
  });

  it('主话题回复会投递到任务会话并记录活动话题', async () => {
    topics.findOne.mockResolvedValue({
      id: 11,
      subjectType: 'task',
      subjectId: '100',
      title: '主话题',
      content: '',
      type: TopicType.CONTENT,
      status: TopicStatus.OPEN,
      tags: [],
      blocking: false,
      isDefault: true,
      pinned: false,
      locked: false,
      authorType: 'system',
      authorId: null,
      authorName: '系统',
      authorAvatarUrl: null,
      images: null,
      mentions: null,
      metadata: null,
      replyCount: 0,
      lastReplyAt: null,
      lastReplyByName: null,
      deletedAt: null,
      createdAt: now(),
      updatedAt: now(),
    });
    tasks.findOne.mockResolvedValue({
      id: 100,
      code: 'TK-0100',
      title: '测试任务',
      status: '进行中',
      requesterType: 'user',
      requesterId: 1,
      createdById: 1,
      agentId: 7,
    });

    const result = await service.reply(
      11,
      { content: '请继续实现', mentions: [7] },
      {
        user: { id: 1, name: '张三', role: '成员', avatarUrl: null } as never,
        name: '张三',
        isAdmin: false,
        userId: 1,
        workerId: null,
      },
    );

    expect(result.reply.content).toBe('请继续实现');
    expect(tasksService.sendMessage).toHaveBeenCalledWith(
      100,
      '请继续实现',
      '张三',
      expect.objectContaining({ perspective: 'requester' }),
    );
    expect(taskContexts.save).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 100, activeTopicId: 11 }),
    );
    expect(notify.notifyGroup).toHaveBeenCalled();
  });

  it('验收不通过会创建独立系统话题并设为活动话题', async () => {
    tasks.findOne.mockResolvedValue({
      id: 200,
      code: 'TK-0200',
      title: '验收任务',
      agentId: 7,
    });

    const topic = await service.recordAcceptanceRejection(
      {
        id: 200,
        code: 'TK-0200',
        title: '验收任务',
        agentId: 7,
      } as never,
      { type: 'user', user: { id: 1, name: '张三' } as never },
      '按钮位置不对，请调整',
    );

    expect(topic).toEqual(
      expect.objectContaining({
        subjectType: 'task',
        subjectId: '200',
        title: '验收不通过',
        type: TopicType.SYSTEM,
        content: '按钮位置不对，请调整',
      }),
    );
    expect(taskContexts.save).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 200, activeTopicId: 1 }),
    );
    expect(realtime.publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'topic.upsert' }),
    );
  });

  it('机器人提问同步为问答话题并进入待回答', async () => {
    topics.createQueryBuilder.mockReturnValue({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(null),
    });
    topics.findOne.mockResolvedValue({
      id: 300,
      code: 'TK-0300',
      title: '提问任务',
      agentId: 7,
    });

    await service.syncTaskQuestion({
      id: 'chat:300:question:q1',
      taskId: 300,
      role: 'assistant',
      sender: { id: 'worker:7', name: '机器人七', kind: 'worker', workerId: 7 },
      content: '',
      createdAt: now().toISOString(),
      status: 'complete',
      kind: 'question',
      question: {
        id: 'q1',
        sessionId: 's1',
        state: 'pending',
        askedAt: now().toISOString(),
        questions: [{ header: '澄清', question: '按钮放哪？', options: [] }],
      },
    });

    expect(topics.save).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectType: 'task',
        subjectId: '300',
        type: TopicType.QUESTION,
        blocking: true,
        title: '澄清',
      }),
    );
    expect(notify.notifyQuestion).toHaveBeenCalled();
    expect(taskContexts.save).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 300 }),
    );
  });

  it('创建话题会归档标签并@机器人', async () => {
    ideas.findOne.mockResolvedValue({
      id: 5,
      title: '一个灵感',
      creatorId: 1,
      projectId: null,
    });
    topics.findOne.mockResolvedValue({
      id: 1,
      subjectType: 'idea',
      subjectId: '5',
      title: '性能建议',
      content: '建议优化首屏',
      type: TopicType.CONTENT,
      status: TopicStatus.OPEN,
      tags: ['建议', '性能'],
      blocking: false,
      isDefault: false,
      pinned: false,
      locked: false,
      authorType: 'user',
      authorId: 1,
      authorName: '张三',
      authorAvatarUrl: null,
      images: null,
      mentions: [{ type: 'worker', id: 7, name: '机器人七' }],
      metadata: null,
      replyCount: 0,
      lastReplyAt: null,
      lastReplyByName: null,
      deletedAt: null,
      createdAt: now(),
      updatedAt: now(),
    });
    replies.find.mockResolvedValue([]);
    reads.findOne.mockResolvedValue(null);

    const created = await service.create(
      {
        subjectType: 'idea' as never,
        subjectId: '5',
        title: '性能建议',
        content: '建议优化首屏',
        tags: ['建议', '性能', '建议'],
        mentions: [7],
      },
      {
        user: { id: 1, name: '张三', role: '成员', avatarUrl: null } as never,
        name: '张三',
        isAdmin: false,
        userId: 1,
        workerId: null,
      },
    );

    expect(created.title).toBe('性能建议');
    expect(topics.save).toHaveBeenCalledWith(
      expect.objectContaining({
        tags: ['建议', '性能'],
        mentions: [{ type: 'worker', id: 7, name: '机器人七' }],
      }),
    );
    expect(notify.notifyMentions).toHaveBeenCalled();
  });
});
