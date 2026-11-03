import {
  TaskStatus,
  TaskSubStatus,
  WorkerRole,
  WorkerRuntime,
} from '../common/enums';
import { OpencodeClient } from '../executors/opencode-client';
import * as opencodeRun from '../executors/opencode-run';
import type { Worker } from '../workers/worker.entity';
import { Task } from './task.entity';
import { TaskRequesterReplyService } from './task-requester-reply.service';
import type { TaskWorkerInbox } from './task-worker-inbox.entity';

describe('TaskRequesterReplyService 根任务机器人需求方回复', () => {
  const task = (over: Partial<Task> = {}): Task =>
    ({
      id: 54,
      code: 'TK-0054',
      title: '咱们APP的主要业务是什么',
      type: '其它',
      status: TaskStatus.WAITING,
      subStatus: TaskSubStatus.PENDING_ACCEPTANCE,
      parentId: null,
      rootId: 54,
      requesterType: 'worker',
      requesterId: 1002,
      agentId: 1035,
      description: '咱们APP的主要业务是什么',
      content: null,
      input: null,
      outputSpec: '说明业务范围',
      workPlan: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...over,
    }) as Task;

  const entry = (over: Partial<TaskWorkerInbox> = {}): TaskWorkerInbox =>
    ({
      id: 7,
      parentTaskId: 54,
      workerId: 1002,
      childTaskId: 54,
      kind: 'message',
      referenceId: 'chat:54:assistant:1',
      payload: { content: '你问的是 Lita' },
      status: 'pending',
      attempts: 0,
      ...over,
    }) as TaskWorkerInbox;

  const requester = {
    id: 1002,
    name: '技术-后端架构师',
    enabled: true,
    role: WorkerRole.WORKER,
    runtime: WorkerRuntime.OPENCODE,
    executorId: 8,
    providerId: 'deepseek',
    modelId: 'deepseek-flash',
    personalAgentUserId: null,
  } as Worker;

  let tasks: { findOne: jest.Mock };
  let messages: { find: jest.Mock };
  let executors: { findOne: jest.Mock };
  let workers: { findOne: jest.Mock };
  let tasksService: { addEvent: jest.Mock };
  let taskNotify: { notifyTaskRequester: jest.Mock };
  let inbox: {
    markEventDelivered: jest.Mock;
    findById: jest.Mock;
    markDone: jest.Mock;
    markDead: jest.Mock;
    defer: jest.Mock;
  };
  let service: TaskRequesterReplyService;

  beforeEach(() => {
    tasks = { findOne: jest.fn().mockResolvedValue(task()) };
    messages = {
      find: jest.fn().mockResolvedValue([
        {
          id: 1,
          role: 'assistant',
          sender: { name: '胡峰' },
          content: '你问的是 Lita',
        },
      ]),
    };
    executors = {
      findOne: jest.fn().mockResolvedValue({
        id: 8,
        name: '默认执行器',
        online: true,
        providersCache: null,
      }),
    };
    workers = { findOne: jest.fn().mockResolvedValue(requester) };
    tasksService = { addEvent: jest.fn().mockResolvedValue(undefined) };
    taskNotify = {
      notifyTaskRequester: jest.fn().mockResolvedValue({ sent: true }),
    };
    inbox = {
      markEventDelivered: jest.fn().mockResolvedValue(true),
      findById: jest.fn().mockResolvedValue(entry({ status: 'done' })),
      markDone: jest.fn().mockResolvedValue(undefined),
      markDead: jest.fn().mockResolvedValue(undefined),
      defer: jest.fn().mockResolvedValue(undefined),
    };
    service = new TaskRequesterReplyService(
      tasks as never,
      messages as never,
      executors as never,
      workers as never,
      {
        ensureWorkToken: jest.fn().mockResolvedValue('worker-token'),
        workdirOf: jest.fn().mockReturnValue('/tmp/worker-1002'),
      } as never,
      tasksService as never,
      taskNotify as never,
      inbox as never,
      {
        get: jest.fn().mockReturnValue('http://api.example/api'),
      } as never,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('用需求方机器人一次性会话回复并携带最近对话与回复接口', async () => {
    const run = jest
      .spyOn(opencodeRun, 'runOpencodePrompt')
      .mockImplementation((_client, input) => {
        input.onSessionCreated?.('reply-session');
        return Promise.resolve('已回复');
      });
    const shell = jest
      .spyOn(OpencodeClient.prototype, 'shell')
      .mockResolvedValue(undefined);
    const deleteSession = jest
      .spyOn(OpencodeClient.prototype, 'deleteSession')
      .mockResolvedValue(undefined);

    await expect(service.reply(task(), entry())).resolves.toBe(true);

    expect(inbox.markEventDelivered).toHaveBeenCalledWith(7);
    expect(shell).toHaveBeenCalledWith(
      expect.stringContaining('/tmp/worker-1002/.opencode/agent-token'),
    );
    expect(run).toHaveBeenCalledWith(
      expect.any(OpencodeClient),
      expect.objectContaining({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        title: expect.stringContaining('需求方回复'),
        model: { id: 'deepseek-flash', providerID: 'deepseek' },
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        prompt: expect.stringContaining(
          'http://api.example/api/tasks/54/messages/reply.md',
        ),
      }),
    );
    const prompt = run.mock.calls[0][1].prompt;
    expect(prompt).toContain('你问的是 Lita');
    expect(prompt).toContain('执行方（胡峰）');
    expect(deleteSession).toHaveBeenCalledWith('reply-session');
    expect(tasksService.addEvent).not.toHaveBeenCalled();
  });

  it('会话结束未调用回复接口时退避重试，连续 3 次后转人工', async () => {
    jest
      .spyOn(opencodeRun, 'runOpencodePrompt')
      .mockResolvedValue('只输出了文字');
    jest.spyOn(OpencodeClient.prototype, 'shell').mockResolvedValue(undefined);
    jest
      .spyOn(OpencodeClient.prototype, 'deleteSession')
      .mockResolvedValue(undefined);
    inbox.findById.mockResolvedValue(entry({ status: 'delivered' }));

    await expect(service.reply(task(), entry({ attempts: 0 }))).resolves.toBe(
      false,
    );
    expect(inbox.defer).toHaveBeenCalledWith(
      7,
      expect.any(Date),
      expect.stringContaining('未调用回复接口'),
    );

    await expect(service.reply(task(), entry({ attempts: 1 }))).resolves.toBe(
      false,
    );
    await expect(service.reply(task(), entry({ attempts: 2 }))).resolves.toBe(
      false,
    );

    expect(inbox.markDead).toHaveBeenCalledWith(7);
    expect(taskNotify.notifyTaskRequester).toHaveBeenCalledWith(
      expect.objectContaining({ id: 54 }),
      'notice',
      expect.stringContaining('任务消息待回复'),
      expect.stringContaining('连续 3 次'),
    );
  });

  it('子任务、真人需求方和已结束任务不启动回复会话', async () => {
    const run = jest.spyOn(opencodeRun, 'runOpencodePrompt');

    await expect(service.reply(task({ parentId: 1 }), entry())).resolves.toBe(
      false,
    );
    workers.findOne.mockResolvedValue({
      ...requester,
      runtime: WorkerRuntime.HUMAN,
      humanUserId: 1,
    });
    // 真人需求方由本人处理，事件直接关闭，不启动机器人会话。
    await expect(service.reply(task(), entry({ attempts: 0 }))).resolves.toBe(
      true,
    );
    await expect(
      service.reply(
        task({
          status: TaskStatus.FINISHED,
          subStatus: TaskSubStatus.COMPLETED,
        }),
        entry(),
      ),
    ).resolves.toBe(true);

    expect(run).not.toHaveBeenCalled();
    expect(inbox.markDone).toHaveBeenCalledWith(7);
  });
});
