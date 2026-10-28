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
import { TaskQuestionAutoAnswerService } from './task-question-auto-answer.service';

describe('TaskQuestionAutoAnswerService 父机器人自动答复', () => {
  const questions = [
    {
      question: '使用哪个环境？',
      header: '环境',
      options: [{ label: '测试' }, { label: '生产' }],
      custom: false,
    },
  ];
  const request = {
    id: 'q1',
    sessionID: 'child-session',
    questions,
  };

  const child = (over: Partial<Task> = {}): Task =>
    ({
      id: 2,
      code: 'TK-0002',
      title: '子任务',
      parentId: 1,
      rootId: 1,
      status: TaskStatus.RUNNING,
      subStatus: TaskSubStatus.EXECUTING,
      agentId: 2001,
      executorId: 20,
      opencodeSessionId: 'child-session',
      description: '子任务描述',
      input: null,
      content: null,
      outputSpec: '交付列表',
      workPlan: null,
      result: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...over,
    }) as Task;

  const parent = (over: Partial<Task> = {}): Task =>
    ({
      id: 1,
      code: 'TK-0001',
      title: '父任务',
      parentId: null,
      rootId: 1,
      status: TaskStatus.WAITING,
      subStatus: TaskSubStatus.PENDING_ACCEPT,
      agentId: 1001,
      description: '父任务描述',
      input: '父任务原始需求',
      content: '父任务整理需求',
      outputSpec: '交付页面',
      workPlan: '先设计再开发',
      result: '已完成',
      createdAt: new Date('2026-10-27T10:00:00+08:00'),
      updatedAt: new Date(),
      ...over,
    }) as Task;

  const parentWorker = {
    id: 1001,
    name: '前端机器人',
    enabled: true,
    role: WorkerRole.WORKER,
    runtime: WorkerRuntime.OPENCODE,
    executorId: 10,
    providerId: 'provider-a',
    modelId: 'model-a',
  } as Worker;

  let tasks: { findOne: jest.Mock };
  let executors: { findOne: jest.Mock };
  let workers: { findOne: jest.Mock };
  let taskChat: {
    findQuestion: jest.Mock;
    questionMeta: jest.Mock;
    setQuestionMeta: jest.Mock;
    questionSettled: jest.Mock;
  };
  let taskNotify: { notifyTaskRequester: jest.Mock };
  let taskRealtime: { taskChanged: jest.Mock };
  let service: TaskQuestionAutoAnswerService;
  let currentQuestion: Record<string, unknown>;

  beforeEach(() => {
    currentQuestion = {
      id: 'q1',
      sessionId: 'child-session',
      questions,
      state: 'pending',
      askedAt: new Date().toISOString(),
    };
    tasks = {
      findOne: jest.fn((args: { where: { id: number } }) =>
        Promise.resolve(args.where.id === 1 ? parent() : child()),
      ),
    };
    executors = {
      findOne: jest.fn((args: { where: { id: number } }) =>
        Promise.resolve(
          args.where.id === 10
            ? {
                id: 10,
                name: '父机器人执行器',
                online: true,
                providersCache: null,
                defaultLocation: null,
              }
            : {
                id: 20,
                name: '子任务执行器',
                online: true,
                providersCache: null,
                defaultLocation: null,
              },
        ),
      ),
    };
    workers = { findOne: jest.fn().mockResolvedValue(parentWorker) };
    taskChat = {
      findQuestion: jest.fn(() => currentQuestion),
      questionMeta: jest.fn(() => undefined),
      setQuestionMeta: jest.fn(),
      questionSettled: jest.fn(
        (_taskId: number, _id: string, state: string, answers: string[][]) => {
          currentQuestion = {
            ...currentQuestion,
            state,
            answers,
          };
        },
      ),
    };
    taskNotify = {
      notifyTaskRequester: jest.fn().mockResolvedValue({ sent: true }),
    };
    taskRealtime = { taskChanged: jest.fn() };
    service = new TaskQuestionAutoAnswerService(
      tasks as never,
      {
        find: jest.fn().mockResolvedValue([]),
        create: jest.fn((value: unknown) => value),
        save: jest.fn().mockResolvedValue(undefined),
      } as never,
      { find: jest.fn().mockResolvedValue([]) } as never,
      executors as never,
      workers as never,
      { workdirOf: jest.fn().mockReturnValue('/tmp/workdir') } as never,
      taskChat as never,
      taskNotify as never,
      taskRealtime as never,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('子任务提问由父任务机器人生成答案并自动回复', async () => {
    const run = jest
      .spyOn(opencodeRun, 'runOpencodePrompt')
      .mockImplementation((_client, input) => {
        input.onSessionCreated?.('consult-session');
        return Promise.resolve('{"answers":[["测试"]]}');
      });
    const listQuestions = jest
      .spyOn(OpencodeClient.prototype, 'listQuestions')
      .mockResolvedValue([request]);
    const replyQuestion = jest
      .spyOn(OpencodeClient.prototype, 'replyQuestion')
      .mockResolvedValue(undefined);
    const deleteSession = jest
      .spyOn(OpencodeClient.prototype, 'deleteSession')
      .mockResolvedValue(undefined);

    await expect(service.start(2, request)).resolves.toBe(true);
    await waitFor(() => replyQuestion.mock.calls.length > 0);

    expect(run).toHaveBeenCalledWith(
      expect.any(OpencodeClient),
      expect.objectContaining({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        title: expect.stringContaining('父任务答复'),
        model: { id: 'model-a', providerID: 'provider-a' },
      }),
    );
    expect(listQuestions).toHaveBeenCalledWith('child-session');
    expect(replyQuestion).toHaveBeenCalledWith(
      'child-session',
      'q1',
      [['测试']],
      questions,
    );
    expect(taskChat.questionSettled).toHaveBeenCalledWith(2, 'q1', 'answered', [
      ['测试'],
    ]);
    expect(deleteSession).toHaveBeenCalledWith('consult-session');
    expect(taskNotify.notifyTaskRequester).not.toHaveBeenCalled();
  });

  it('根任务或无父机器人时不自动答复', async () => {
    tasks.findOne.mockResolvedValue(child({ parentId: null }));
    const run = jest.spyOn(opencodeRun, 'runOpencodePrompt');

    await expect(service.start(2, request)).resolves.toBe(false);

    expect(run).not.toHaveBeenCalled();
    expect(taskChat.setQuestionMeta).not.toHaveBeenCalled();
  });

  it('自动答复失败时保持待回答并回退通知需求方', async () => {
    jest
      .spyOn(opencodeRun, 'runOpencodePrompt')
      .mockRejectedValue(new Error('父机器人执行失败'));
    jest
      .spyOn(OpencodeClient.prototype, 'listQuestions')
      .mockResolvedValue([request]);

    await expect(service.start(2, request)).resolves.toBe(true);
    await waitFor(() =>
      taskChat.setQuestionMeta.mock.calls.some(
        (call) => autoAnswerStatus((call as unknown[])[2]) === 'failed',
      ),
    );

    expect(currentQuestion.state).toBe('pending');
    expect(taskNotify.notifyTaskRequester).toHaveBeenCalledWith(
      expect.objectContaining({ id: 2 }),
      'notice',
      expect.stringContaining('任务等待回答'),
      expect.stringContaining('父任务机器人自动答复失败'),
    );
  });

  it('人工已处理提问时不再自动答复', async () => {
    currentQuestion = { ...currentQuestion, state: 'answered' };
    const run = jest.spyOn(opencodeRun, 'runOpencodePrompt');

    await expect(service.start(2, request)).resolves.toBe(true);

    expect(run).not.toHaveBeenCalled();
    expect(taskChat.setQuestionMeta).not.toHaveBeenCalled();
  });
});

function autoAnswerStatus(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const autoAnswer = (value as Record<string, unknown>).autoAnswer;
  if (!autoAnswer || typeof autoAnswer !== 'object') return undefined;
  const status = (autoAnswer as Record<string, unknown>).status;
  return typeof status === 'string' ? status : undefined;
}

async function waitFor(check: () => boolean): Promise<void> {
  for (let index = 0; index < 50; index += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('等待异步自动答复超时');
}
