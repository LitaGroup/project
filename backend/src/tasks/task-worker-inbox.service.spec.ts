import type { Task } from './task.entity';
import type { TaskWorkerInbox } from './task-worker-inbox.entity';
import {
  TaskWorkerInboxService,
  taskInboxPrompt,
} from './task-worker-inbox.service';

describe('TaskWorkerInboxService 子任务收件箱', () => {
  const inboxRepo = {
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    find: jest.fn().mockResolvedValue([]),
  };

  beforeEach(() => {
    inboxRepo.update.mockClear();
    inboxRepo.find.mockClear();
  });

  it('会话未消费的事件同时重排 queued 与 delivered', async () => {
    const service = new TaskWorkerInboxService(inboxRepo as never);

    await service.requeueDelivered(1);

    expect(inboxRepo.update).toHaveBeenCalledTimes(2);
    expect(inboxRepo.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        parentTaskId: 1,
        status: expect.objectContaining({
          value: ['queued', 'delivered'],
        }) as unknown,
      }),
      expect.objectContaining({
        status: 'pending',
        deliveredAt: null,
        attempts: expect.any(Function) as unknown,
      }),
    );
    expect(inboxRepo.update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        parentTaskId: 1,
        status: expect.objectContaining({
          value: ['queued', 'delivered'],
        }) as unknown,
      }),
      expect.objectContaining({ status: 'done' }),
    );
  });

  it('listActionable 立即返回 pending，只返回陈旧的 queued/delivered，并遵守退避', async () => {
    const now = new Date('2026-11-03T12:00:00+08:00');
    inboxRepo.find.mockResolvedValue([
      {
        id: 1,
        status: 'pending',
        updatedAt: now,
        nextRetryAt: null,
      },
      {
        id: 2,
        status: 'queued',
        updatedAt: new Date(now.getTime() - 10 * 60_000),
        nextRetryAt: null,
      },
      {
        id: 3,
        status: 'delivered',
        updatedAt: new Date(now.getTime() - 10 * 60_000),
        nextRetryAt: null,
      },
      {
        id: 4,
        status: 'delivered',
        updatedAt: now,
        nextRetryAt: null,
      },
      {
        id: 5,
        status: 'pending',
        updatedAt: now,
        nextRetryAt: new Date(now.getTime() + 60_000),
      },
    ] as unknown);
    const service = new TaskWorkerInboxService(inboxRepo as never);

    const rows = await service.listActionable(now, 60_000);

    expect(rows.map((row) => row.id)).toEqual([1, 2, 3]);
  });

  it('reopen 只更新开放事件并递增尝试次数', async () => {
    const service = new TaskWorkerInboxService(inboxRepo as never);

    await expect(service.reopen(7, '会话结束未处理')).resolves.toBe(true);

    expect(inboxRepo.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 7 }),
      expect.objectContaining({
        status: 'pending',
        attempts: expect.any(Function) as unknown,
        lastError: '会话结束未处理',
      }),
    );
  });

  it('验收事件提示词直接给出交付文档与验收接口', () => {
    const child = {
      id: 2,
      code: 'TK-0002',
      title: '子任务',
      status: '等待中',
      subStatus: '待验收',
    } as Task;
    const entry = {
      id: 9,
      parentTaskId: 1,
      workerId: 1001,
      childTaskId: 2,
      kind: 'handoff',
      referenceId: null,
      payload: {
        handoffUrl: '/docs/detail/task/20261103/TK-0002/HANDOFF',
        acceptUrl: 'http://localhost:3100/api/tasks/2/handoff/accept.md',
      },
      status: 'queued',
    } as unknown as TaskWorkerInbox;

    const prompt = taskInboxPrompt(entry, child, 'http://api.example/api/');

    expect(prompt).toContain('事件收件箱 ID：9');
    expect(prompt).toContain('GET http://api.example/api/tasks/2/handoff.md');
    expect(prompt).toContain('/docs/detail/task/20261103/TK-0002/HANDOFF');
    expect(prompt).toContain(
      'http://api.example/api/tasks/2/handoff/accept.md',
    );
    expect(prompt).toContain(
      'http://api.example/api/tasks/2/handoff/refuse.md',
    );
    expect(prompt).toContain('http://api.example/api/tasks/2/fail.md');
    expect(prompt).toContain('.opencode/agent-token');
    expect(prompt).toContain('不能只回复消息');
  });

  it('提问事件提示词携带问题正文、选项和完整答复接口', () => {
    const child = {
      id: 2,
      code: 'TK-0002',
      title: '子任务',
      status: '等待中',
      subStatus: '待反馈',
    } as Task;
    const entry = {
      id: 10,
      parentTaskId: 1,
      workerId: 1001,
      childTaskId: 2,
      kind: 'question',
      referenceId: 'project-q1',
      payload: {
        questions: [
          {
            header: '方案确认',
            question: '使用哪个活动方案？',
            options: [
              { label: 'A 方案', description: '成本优先' },
              { label: 'B 方案', description: '体验优先' },
            ],
            multiple: false,
            custom: false,
          },
          {
            header: '上线时间',
            question: '计划什么时候上线？',
            multiple: false,
            custom: true,
          },
        ],
      },
      status: 'queued',
    } as unknown as TaskWorkerInbox;

    const prompt = taskInboxPrompt(entry, child, 'http://api.example/api');

    expect(prompt).toContain('只回复消息不会解除');
    expect(prompt).toContain('GET http://api.example/api/tasks/2.md');
    expect(prompt).toContain('1. 方案确认');
    expect(prompt).toContain('使用哪个活动方案？');
    expect(prompt).toContain('A 方案（成本优先） / B 方案（体验优先）');
    expect(prompt).toContain('仅限选项');
    expect(prompt).toContain('2. 上线时间');
    expect(prompt).toContain('计划什么时候上线？');
    expect(prompt).toContain(
      'http://api.example/api/tasks/2/questions/project-q1/answer.md',
    );
    expect(prompt).toContain('{"answers":[["答案"],["答案"]]}');
  });

  it('执行方消息事件提示词携带正文与需求方回复接口', () => {
    const child = {
      id: 2,
      code: 'TK-0002',
      title: '子任务',
      status: '进行中',
      subStatus: '执行中',
    } as Task;
    const entry = {
      id: 12,
      parentTaskId: 1,
      workerId: 1001,
      childTaskId: 2,
      kind: 'message',
      referenceId: 'chat:2:assistant:1',
      payload: { content: '需求方请确认这个方案是否可以' },
      status: 'queued',
    } as unknown as TaskWorkerInbox;

    const prompt = taskInboxPrompt(entry, child, 'http://api.example/api/');

    expect(prompt).toContain('事件：message');
    expect(prompt).toContain('需求方请确认这个方案是否可以');
    expect(prompt).toContain('GET http://api.example/api/tasks/2.md');
    expect(prompt).toContain(
      'http://api.example/api/tasks/2/messages/reply.md',
    );
    expect(prompt).toContain('"content":"回复内容"');
    expect(prompt).toContain('.opencode/agent-token');
  });

  it('需求方回复后只完成已投递的消息事件，保留处理期间新到的消息', async () => {
    const service = new TaskWorkerInboxService(inboxRepo as never);

    await service.completeDeliveredForChild(2, 'message');

    expect(inboxRepo.update).toHaveBeenCalledWith(
      {
        childTaskId: 2,
        kind: 'message',
        status: expect.objectContaining({
          value: ['queued', 'delivered'],
        }) as unknown,
      },
      expect.objectContaining({ status: 'done' }),
    );
  });

  it('根任务消息与提问以自身为 parentTaskId 入队，验收事件不入队', async () => {
    const repo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((value: unknown) => value),
      save: jest.fn((value: unknown) => Promise.resolve(value)),
    };
    const service = new TaskWorkerInboxService(repo as never);
    const root = {
      id: 54,
      parentId: null,
      requesterType: 'worker',
      requesterId: 1002,
    } as Task;

    await service.enqueue(root, 'message', {
      referenceId: 'chat:54:assistant:1',
      payload: { content: '请确认' },
    });
    await service.enqueue(root, 'question', {
      referenceId: 'project-q1',
      payload: { questions: [] },
    });
    await service.enqueue(root, 'handoff');

    expect(repo.save).toHaveBeenCalledTimes(2);
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        parentTaskId: 54,
        workerId: 1002,
        childTaskId: 54,
        kind: 'message',
      }),
    );
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        parentTaskId: 54,
        workerId: 1002,
        childTaskId: 54,
        kind: 'question',
      }),
    );
  });
});
