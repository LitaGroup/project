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
import type { TaskMessage } from './task-message.entity';
import { TaskRequesterAnswerService } from './task-requester-answer.service';
import { TaskRequesterSessionService } from './task-requester-session.service';
import type { TaskWorkerInbox } from './task-worker-inbox.entity';

describe('TaskRequesterAnswerService 机器人需求方答问', () => {
  const task = (over: Partial<Task> = {}): Task =>
    ({
      id: 251,
      code: 'TK-0251',
      title: '余额 Redis 锁 P0 测试',
      status: TaskStatus.WAITING,
      subStatus: TaskSubStatus.PENDING_FEEDBACK,
      parentId: 250,
      rootId: 250,
      requesterType: 'worker',
      requesterId: 1063,
      agentId: 1082,
      description: '测试任务',
      content: null,
      input: null,
      outputSpec: '交付测试报告',
      workPlan: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...over,
    }) as Task;

  const questionRow = (over: Partial<TaskMessage> = {}): TaskMessage =>
    ({
      id: 88,
      taskId: 251,
      messageKey: 'chat:251:question:project-q1',
      role: 'assistant',
      sender: { name: '技术-测试-接口' },
      content: '',
      reasoning: null,
      status: 'complete',
      kind: 'question',
      tools: null,
      question: {
        id: 'project-q1',
        sessionId: 'project-task-251',
        questions: [
          {
            header: '部署与验收方式',
            question: '请确认下一步：A 部署 / B 按阻塞交付 / C 延期',
            options: [{ label: 'A' }, { label: 'B' }, { label: 'C' }],
            multiple: false,
            custom: false,
          },
        ],
        state: 'pending',
        askedAt: new Date().toISOString(),
      },
      meta: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...over,
    }) as TaskMessage;

  const entry = (over: Partial<TaskWorkerInbox> = {}): TaskWorkerInbox =>
    ({
      id: 40,
      parentTaskId: 250,
      workerId: 1063,
      childTaskId: 251,
      kind: 'question',
      referenceId: 'project-q1',
      payload: {},
      status: 'pending',
      attempts: 0,
      ...over,
    }) as TaskWorkerInbox;

  const requester = {
    id: 1063,
    name: '技术-架构师',
    enabled: true,
    role: WorkerRole.WORKER,
    runtime: WorkerRuntime.OPENCODE,
    executorId: 8,
    providerId: 'deepseek',
    modelId: 'deepseek-flash',
    personalAgentUserId: null,
  } as Worker;

  let tasks: { findOne: jest.Mock };
  let messages: { find: jest.Mock; findOne: jest.Mock };
  let executors: { findOne: jest.Mock };
  let workers: { findOne: jest.Mock };
  let tasksService: { addEvent: jest.Mock };
  let inbox: {
    markEventDelivered: jest.Mock;
    markDone: jest.Mock;
    markDead: jest.Mock;
    defer: jest.Mock;
  };
  let service: TaskRequesterAnswerService;

  beforeEach(() => {
    tasks = { findOne: jest.fn().mockResolvedValue(task()) };
    messages = {
      find: jest.fn().mockResolvedValue([questionRow()]),
      findOne: jest.fn().mockResolvedValue(
        questionRow({
          question: { ...questionRow().question!, state: 'answered' },
        }),
      ),
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
    inbox = {
      markEventDelivered: jest.fn().mockResolvedValue(true),
      markDone: jest.fn().mockResolvedValue(undefined),
      markDead: jest.fn().mockResolvedValue(undefined),
      defer: jest.fn().mockResolvedValue(undefined),
    };
    service = new TaskRequesterAnswerService(
      tasks as never,
      messages as never,
      executors as never,
      workers as never,
      {
        ensureWorkToken: jest.fn().mockResolvedValue('worker-token'),
        workdirOf: jest.fn().mockReturnValue('/tmp/worker-1063'),
      } as never,
      tasksService as never,
      inbox as never,
      new TaskRequesterSessionService(),
      {
        get: jest.fn().mockReturnValue('http://api.example/api'),
      } as never,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('用需求方机器人一次性会话答问并携带问题与答复接口', async () => {
    const run = jest
      .spyOn(opencodeRun, 'runOpencodePrompt')
      .mockImplementation((_client, input) => {
        input.onSessionCreated?.('answer-session');
        return Promise.resolve('已答复');
      });
    const shell = jest
      .spyOn(OpencodeClient.prototype, 'shell')
      .mockResolvedValue(undefined);
    const deleteSession = jest
      .spyOn(OpencodeClient.prototype, 'deleteSession')
      .mockResolvedValue(undefined);

    await expect(service.answer(task(), entry())).resolves.toBe(true);

    expect(inbox.markEventDelivered).toHaveBeenCalledWith(40);
    expect(shell).toHaveBeenCalledWith(
      expect.stringContaining('/tmp/worker-1063/.opencode/agent-token'),
    );
    expect(run).toHaveBeenCalledWith(
      expect.any(OpencodeClient),
      expect.objectContaining({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        title: expect.stringContaining('需求方答问'),
        model: { id: 'deepseek-flash', providerID: 'deepseek' },
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        prompt: expect.stringContaining(
          'http://api.example/api/tasks/251/questions/project-q1/answer.md',
        ),
      }),
    );
    const prompt = run.mock.calls[0][1].prompt;
    expect(prompt).toContain('部署与验收方式');
    expect(prompt).toContain('A / B / C');
    expect(prompt).toContain('仅限选项');
    expect(deleteSession).toHaveBeenCalledWith('answer-session');
    expect(inbox.markDone).toHaveBeenCalledWith(40);
    expect(tasksService.addEvent).not.toHaveBeenCalled();
  });

  it('会话结束未调用答复接口时持续退避重试，不转人工', async () => {
    jest
      .spyOn(opencodeRun, 'runOpencodePrompt')
      .mockResolvedValue('只输出了文字');
    jest.spyOn(OpencodeClient.prototype, 'shell').mockResolvedValue(undefined);
    jest
      .spyOn(OpencodeClient.prototype, 'deleteSession')
      .mockResolvedValue(undefined);
    messages.findOne.mockResolvedValue(questionRow());

    for (const attempts of [0, 1, 2, 20]) {
      await expect(service.answer(task(), entry({ attempts }))).resolves.toBe(
        false,
      );
    }

    expect(inbox.defer).toHaveBeenCalledTimes(4);
    expect(inbox.defer).toHaveBeenLastCalledWith(
      40,
      expect.any(Date),
      expect.stringContaining('未调用答复接口'),
    );
    expect(inbox.markDead).not.toHaveBeenCalledWith(40);
    expect(tasksService.addEvent).toHaveBeenCalledWith(
      251,
      '系统',
      expect.stringContaining('继续重试'),
      null,
      expect.objectContaining({
        autoAnswerFailed: true,
        questionId: 'project-q1',
      }),
    );
  });

  it('没有待答提问时直接关闭事件', async () => {
    const run = jest.spyOn(opencodeRun, 'runOpencodePrompt');
    messages.find.mockResolvedValue([
      questionRow({
        question: { ...questionRow().question!, state: 'answered' },
      }),
    ]);

    await expect(service.answer(task(), entry())).resolves.toBe(true);

    expect(run).not.toHaveBeenCalled();
    expect(inbox.markDone).toHaveBeenCalledWith(40);
  });

  it('真人需求方不启动自动答问会话', async () => {
    const run = jest.spyOn(opencodeRun, 'runOpencodePrompt');
    workers.findOne.mockResolvedValue({
      ...requester,
      runtime: WorkerRuntime.HUMAN,
      humanUserId: 1,
    });

    await expect(service.answer(task(), entry())).resolves.toBe(true);

    expect(run).not.toHaveBeenCalled();
    expect(inbox.markDone).toHaveBeenCalledWith(40);
  });

  it('需求方机器人执行器离线时退避并记录事件', async () => {
    const run = jest.spyOn(opencodeRun, 'runOpencodePrompt');
    executors.findOne.mockResolvedValue({
      id: 8,
      name: '默认执行器',
      online: false,
      providersCache: null,
    });

    await expect(service.answer(task(), entry())).resolves.toBe(false);

    expect(run).not.toHaveBeenCalled();
    expect(inbox.defer).toHaveBeenCalledWith(
      40,
      expect.any(Date),
      expect.stringContaining('执行器离线'),
    );
    expect(tasksService.addEvent).toHaveBeenCalledWith(
      251,
      '系统',
      expect.stringContaining('自动答问未完成'),
      null,
      expect.objectContaining({ autoAnswerFailed: true }),
    );
  });
});
