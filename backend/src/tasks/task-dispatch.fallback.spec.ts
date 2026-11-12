import { TaskStatus, TaskSubStatus } from '../common/enums';
import { OpencodeClient } from '../executors/opencode-client';
import {
  isModelExhausted,
  resetModelAvailability,
  resolveWorkerModel,
} from '../executors/model-availability';
import type { Worker } from '../workers/worker.entity';
import { Task } from './task.entity';
import { TaskDispatchService } from './task-dispatch.service';

describe('TaskDispatchService 主模型限额切换备用模型', () => {
  const worker = {
    id: 1001,
    name: '前端工程师',
    executorId: 9,
    providerId: 'openai',
    modelId: 'gpt-5',
    variant: null,
    backupProviderId: 'deepseek',
    backupModelId: 'deepseek-chat',
    backupVariant: null,
  } as Worker;

  const task = {
    id: 1,
    code: 'TK-0001',
    title: '活动页开发',
    status: TaskStatus.RUNNING,
    subStatus: TaskSubStatus.EXECUTING,
    agentId: 1001,
    executorId: 9,
    opencodeSessionId: 'oc-1',
  } as Task;

  let tasks: { findOne: jest.Mock };
  let workers: { findOne: jest.Mock };
  let executors: { findOne: jest.Mock };
  let events: { create: jest.Mock; save: jest.Mock };
  let taskChat: { failTask: jest.Mock };
  let taskRealtime: { lineAppended: jest.Mock; taskChanged: jest.Mock };
  let service: TaskDispatchService;

  beforeEach(() => {
    resetModelAvailability();
    jest.restoreAllMocks();
    tasks = { findOne: jest.fn().mockResolvedValue(task) };
    workers = { findOne: jest.fn().mockResolvedValue(worker) };
    executors = {
      findOne: jest
        .fn()
        .mockResolvedValue({ id: 9, name: '执行器', online: true }),
    };
    events = {
      create: jest.fn((value: unknown) => value),
      save: jest.fn().mockResolvedValue(undefined),
    };
    taskChat = { failTask: jest.fn().mockResolvedValue(undefined) };
    taskRealtime = { lineAppended: jest.fn(), taskChanged: jest.fn() };
    service = new TaskDispatchService(
      tasks as never,
      events as never,
      executors as never,
      workers as never,
      { findOne: jest.fn() } as never,
      { workdirOf: jest.fn() } as never,
      { onEvent: jest.fn(), retain: jest.fn(), release: jest.fn() } as never,
      {
        notifyTaskRequester: jest.fn(),
        notifyTaskAgentOwner: jest.fn(),
      } as never,
      taskRealtime as never,
      taskChat as never,
      {} as never,
      { start: jest.fn() } as never,
      { enqueue: jest.fn(), requeueDelivered: jest.fn() } as never,
      { buildServersConfig: jest.fn() } as never,
      { transaction: jest.fn() } as never,
      { get: jest.fn() } as never,
    );
  });

  type Internals = {
    continueWithBackupModel(
      taskId: number,
      executorId: number,
      sessionId: string,
      error: { type?: string | null; message?: string | null } | null,
    ): Promise<boolean>;
  };

  it('限额错误：切换备用模型、续跑本轮并写入任务事件', async () => {
    const switchModel = jest
      .spyOn(OpencodeClient.prototype, 'switchModel')
      .mockResolvedValue(undefined);
    const prompt = jest
      .spyOn(OpencodeClient.prototype, 'prompt')
      .mockResolvedValue({ time: { created: 1 } });

    const handled = await (
      service as unknown as Internals
    ).continueWithBackupModel(1, 9, 'oc-1', {
      type: 'APIError',
      message: '429 Too Many Requests',
    });

    expect(handled).toBe(true);
    expect(switchModel).toHaveBeenCalledWith('oc-1', {
      id: 'deepseek-chat',
      providerID: 'deepseek',
    });
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(taskChat.failTask).toHaveBeenCalledWith(
      1,
      expect.stringContaining('备用模型'),
    );
    // 主模型进入共享冷却
    expect(isModelExhausted(9, 'openai', 'gpt-5')).toBe(true);
    expect(events.create).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 1 }),
    );
    const calls = events.create.mock.calls as Array<[{ content?: string }]>;
    expect(calls[0][0].content).toContain('deepseek/deepseek-chat');
  });

  it('非限额错误不切换模型', async () => {
    const switchModel = jest.spyOn(OpencodeClient.prototype, 'switchModel');
    const handled = await (
      service as unknown as Internals
    ).continueWithBackupModel(1, 9, 'oc-1', {
      message: 'tool crashed unexpectedly',
    });
    expect(handled).toBe(false);
    expect(switchModel).not.toHaveBeenCalled();
    expect(isModelExhausted(9, 'openai', 'gpt-5')).toBe(false);
  });

  it('未配置备用模型时只标记冷却，供其它机器人共用', async () => {
    workers.findOne.mockResolvedValue({
      ...worker,
      backupProviderId: null,
      backupModelId: null,
    });
    const switchModel = jest.spyOn(OpencodeClient.prototype, 'switchModel');

    const handled = await (
      service as unknown as Internals
    ).continueWithBackupModel(1, 9, 'oc-1', { message: 'insufficient quota' });

    expect(handled).toBe(false);
    expect(switchModel).not.toHaveBeenCalled();
    expect(isModelExhausted(9, 'openai', 'gpt-5')).toBe(true);
    // 同执行器上配置了备用模型的机器人直接使用备用
    expect(resolveWorkerModel(worker).usingBackup).toBe(true);
  });

  it('每轮最多切换一次备用模型', async () => {
    jest
      .spyOn(OpencodeClient.prototype, 'switchModel')
      .mockResolvedValue(undefined);
    jest
      .spyOn(OpencodeClient.prototype, 'prompt')
      .mockResolvedValue({ time: { created: 1 } });
    const internals = service as unknown as Internals;

    await internals.continueWithBackupModel(1, 9, 'oc-1', {
      message: 'rate limit exceeded',
    });
    const again = await internals.continueWithBackupModel(1, 9, 'oc-1', {
      message: 'rate limit exceeded',
    });

    expect(again).toBe(false);
  });
});
