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
import { TaskRequesterSessionService } from './task-requester-session.service';
import { TaskRequesterVerifyService } from './task-requester-verify.service';

describe('TaskRequesterVerifyService 根任务机器人需求方自动验收', () => {
  const task = (over: Partial<Task> = {}): Task =>
    ({
      id: 53,
      code: 'TK-0053',
      title: '验证任务',
      status: TaskStatus.WAITING,
      subStatus: TaskSubStatus.PENDING_ACCEPT,
      parentId: null,
      rootId: 53,
      requesterType: 'worker',
      requesterId: 1002,
      agentId: 1035,
      description: '验证任务流转',
      content: null,
      input: null,
      outputSpec: '给出验证结论',
      workPlan: null,
      handoffPath: '/task/20261103/TK-0053/HANDOFF',
      handoffVersion: 2,
      handoffSubmittedVersion: 2,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...over,
    }) as Task;

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
  let executors: { findOne: jest.Mock };
  let workers: { findOne: jest.Mock };
  let tasksService: { addEvent: jest.Mock };
  let service: TaskRequesterVerifyService;

  beforeEach(() => {
    tasks = { findOne: jest.fn().mockResolvedValue(task()) };
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
    service = new TaskRequesterVerifyService(
      tasks as never,
      executors as never,
      workers as never,
      {
        ensureWorkToken: jest.fn().mockResolvedValue('worker-token'),
        workdirOf: jest.fn().mockReturnValue('/tmp/worker-1002'),
      } as never,
      tasksService as never,
      new TaskRequesterSessionService(),
      {
        get: jest.fn().mockReturnValue('http://api.example/api'),
      } as never,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('用需求方机器人一次性会话验收，任务推进后清理会话且不重试', async () => {
    const run = jest
      .spyOn(opencodeRun, 'runOpencodePrompt')
      .mockImplementation((_client, input) => {
        input.onSessionCreated?.('verify-session');
        return Promise.resolve('已验收通过');
      });
    const shell = jest
      .spyOn(OpencodeClient.prototype, 'shell')
      .mockResolvedValue(undefined);
    const deleteSession = jest
      .spyOn(OpencodeClient.prototype, 'deleteSession')
      .mockResolvedValue(undefined);
    tasks.findOne.mockResolvedValue(
      task({
        status: TaskStatus.FINISHED,
        subStatus: TaskSubStatus.COMPLETED,
      }),
    );

    await expect(service.verify(task())).resolves.toBe(true);

    expect(shell).toHaveBeenCalledWith(
      expect.stringContaining(
        '/tmp/worker-1002/.opencode/agent-token',
      ) as string,
    );
    expect(run).toHaveBeenCalledWith(
      expect.any(OpencodeClient),
      expect.objectContaining({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        title: expect.stringContaining('需求方验收'),
        model: { id: 'deepseek-flash', providerID: 'deepseek' },
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        prompt: expect.stringContaining(
          'http://api.example/api/tasks/53/handoff/accept.md',
        ),
      }),
    );
    expect(deleteSession).toHaveBeenCalledWith('verify-session');
    expect(tasksService.addEvent).not.toHaveBeenCalled();
  });

  it('会话结束仍未推进验收时持续重试，不转人工', async () => {
    jest
      .spyOn(opencodeRun, 'runOpencodePrompt')
      .mockResolvedValue('我认为可以验收');
    jest.spyOn(OpencodeClient.prototype, 'shell').mockResolvedValue(undefined);
    jest
      .spyOn(OpencodeClient.prototype, 'deleteSession')
      .mockResolvedValue(undefined);

    for (let index = 0; index < 5; index += 1) {
      await expect(service.verify(task())).resolves.toBe(false);
    }

    expect(tasksService.addEvent).toHaveBeenCalledTimes(5);
    expect(tasksService.addEvent).toHaveBeenLastCalledWith(
      53,
      '系统',
      expect.stringContaining('将继续重试'),
      null,
      expect.objectContaining({ autoVerify: true, workerId: 1002 }),
    );
  });

  it('父任务仍可唤醒的子任务、非待验收状态和真人需求方不自动验收', async () => {
    const run = jest.spyOn(opencodeRun, 'runOpencodePrompt');

    tasks.findOne.mockImplementation(({ where }: { where: { id: number } }) =>
      Promise.resolve(
        where.id === 1
          ? ({ id: 1, status: TaskStatus.RUNNING, agentId: 1002 } as Task)
          : task({ parentId: 1 }),
      ),
    );
    await expect(service.verify(task({ parentId: 1 }))).resolves.toBe(false);
    await expect(
      service.verify(
        task({
          status: TaskStatus.RUNNING,
          subStatus: TaskSubStatus.EXECUTING,
        }),
      ),
    ).resolves.toBe(false);
    workers.findOne.mockResolvedValue({
      ...requester,
      runtime: WorkerRuntime.HUMAN,
      humanUserId: 1,
    });
    await expect(service.verify(task())).resolves.toBe(true);

    expect(run).not.toHaveBeenCalled();
  });

  it('父任务已结束的子任务使用需求方机器人一次性会话验收', async () => {
    jest
      .spyOn(opencodeRun, 'runOpencodePrompt')
      .mockImplementation((_client, input) => {
        input.onSessionCreated?.('verify-session');
        return Promise.resolve('已验收通过');
      });
    jest.spyOn(OpencodeClient.prototype, 'shell').mockResolvedValue(undefined);
    jest
      .spyOn(OpencodeClient.prototype, 'deleteSession')
      .mockResolvedValue(undefined);
    tasks.findOne.mockImplementation(({ where }: { where: { id: number } }) =>
      Promise.resolve(
        where.id === 1
          ? ({
              id: 1,
              status: TaskStatus.FINISHED,
              subStatus: TaskSubStatus.COMPLETED,
              agentId: 1035,
            } as Task)
          : task({
              parentId: 1,
              rootId: 1,
              status: TaskStatus.FINISHED,
              subStatus: TaskSubStatus.COMPLETED,
            }),
      ),
    );

    await expect(service.verify(task({ parentId: 1 }))).resolves.toBe(true);
  });

  it('执行器离线时跳过自动验收，不记录失败', async () => {
    executors.findOne.mockResolvedValue({
      id: 8,
      name: '默认执行器',
      online: false,
      providersCache: null,
    });
    const run = jest.spyOn(opencodeRun, 'runOpencodePrompt');

    await expect(service.verify(task())).resolves.toBe(false);

    expect(run).not.toHaveBeenCalled();
    expect(tasksService.addEvent).not.toHaveBeenCalled();
  });
});
