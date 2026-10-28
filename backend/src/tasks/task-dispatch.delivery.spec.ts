import { ForbiddenException } from '@nestjs/common';
import { TaskStatus, TaskSubStatus } from '../common/enums';
import type { Worker } from '../workers/worker.entity';
import { Task } from './task.entity';
import { TaskDispatchService } from './task-dispatch.service';

describe('TaskDispatchService 显式申请验收', () => {
  const baseTask = (over: Partial<Task> = {}): Task =>
    ({
      id: 1,
      code: 'TK-0001',
      title: '活动页开发',
      type: '其它',
      status: TaskStatus.RUNNING,
      subStatus: TaskSubStatus.EXECUTING,
      description: '开发活动页',
      agentId: 1001,
      executorId: null,
      opencodeSessionId: null,
      remindCount: 0,
      firstRemindedAt: null,
      lastRemindedAt: null,
      result: null,
      ...over,
    }) as Task;

  const worker = { id: 1001, name: '前端工程师' } as Worker;

  let tasksRepo: { findOne: jest.Mock; save: jest.Mock };
  let eventsRepo: { create: jest.Mock; save: jest.Mock };
  let taskChat: { finishTask: jest.Mock };
  let taskNotify: { notifyTaskRequester: jest.Mock };
  let taskRealtime: { lineAppended: jest.Mock; taskChanged: jest.Mock };
  let taskDocuments: { upsertHandoff: jest.Mock };
  let service: TaskDispatchService;

  beforeEach(() => {
    tasksRepo = {
      findOne: jest.fn(),
      save: jest.fn((task: Task) => Promise.resolve(task)),
    };
    eventsRepo = {
      create: jest.fn((value: unknown) => value),
      save: jest.fn().mockResolvedValue(undefined),
    };
    taskChat = { finishTask: jest.fn().mockResolvedValue(undefined) };
    taskNotify = {
      notifyTaskRequester: jest.fn().mockResolvedValue({ sent: true }),
    };
    taskRealtime = {
      lineAppended: jest.fn(),
      taskChanged: jest.fn(),
    };
    taskDocuments = {
      upsertHandoff: jest.fn().mockResolvedValue({
        path: '/task/20261028/TK-0001/HANDOFF.md',
        url: '/docs/detail/task/20261028/TK-0001/HANDOFF.md',
        title: 'TK-0001 活动页开发 · 任务交付',
      }),
    };
    service = new TaskDispatchService(
      tasksRepo as never,
      eventsRepo as never,
      { findOne: jest.fn() } as never,
      { findOne: jest.fn() } as never,
      { findOne: jest.fn() } as never,
      { workdirOf: jest.fn() } as never,
      { onEvent: jest.fn(), retain: jest.fn(), release: jest.fn() } as never,
      taskNotify as never,
      taskRealtime as never,
      taskChat as never,
      taskDocuments as never,
      { get: jest.fn() } as never,
    );
  });

  it('申请验收保存本轮产出并推进到等待中-待验收', async () => {
    const task = baseTask();
    tasksRepo.findOne.mockResolvedValue(task);
    (
      service as unknown as {
        textBuffers: Map<number, Map<string, string>>;
      }
    ).textBuffers.set(1, new Map([['message-1', '活动页已完成']]));

    const applied = await service.applyForAcceptance(1, worker);
    const saved = applied.task;

    expect(saved.status).toBe(TaskStatus.WAITING);
    expect(saved.subStatus).toBe(TaskSubStatus.PENDING_ACCEPT);
    expect(saved.result).toBe('活动页已完成');
    expect(saved.remindCount).toBe(1);
    expect(applied.handoff.path).toBe('/task/20261028/TK-0001/HANDOFF.md');
    expect(taskDocuments.upsertHandoff).toHaveBeenCalledWith(
      expect.objectContaining({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        task: expect.objectContaining({ id: 1 }),
        result: '活动页已完成',
        worker,
      }),
    );
    expect(eventsRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 1,
        operator: '前端工程师',
        content: expect.stringContaining('执行机器人申请验收') as string,
      }),
    );
    expect(taskNotify.notifyTaskRequester).toHaveBeenCalledWith(
      saved,
      'accept',
      expect.stringContaining('任务待验收'),
      expect.stringContaining('HANDOFF.md'),
    );
    expect(taskChat.finishTask).toHaveBeenCalledWith(1);
  });

  it('非当前执行机器人申请验收返回 403', async () => {
    tasksRepo.findOne.mockResolvedValue(baseTask());
    await expect(
      service.applyForAcceptance(1, { id: 1002, name: '其他机器人' } as Worker),
    ).rejects.toThrow(ForbiddenException);
    expect(tasksRepo.save).not.toHaveBeenCalled();
  });

  it('交付文档写入失败时不进入待验收', async () => {
    const task = baseTask();
    tasksRepo.findOne.mockResolvedValue(task);
    taskDocuments.upsertHandoff.mockRejectedValue(
      new Error('知识库不可用，无法生成任务文档'),
    );

    await expect(service.applyForAcceptance(1, worker)).rejects.toThrow(
      '知识库不可用',
    );
    expect(task.status).toBe(TaskStatus.RUNNING);
    expect(task.subStatus).toBe(TaskSubStatus.EXECUTING);
    expect(tasksRepo.save).not.toHaveBeenCalled();
    expect(taskNotify.notifyTaskRequester).not.toHaveBeenCalled();
  });

  it('会话成功只补齐产出，不自动进入待验收', async () => {
    const task = baseTask();
    tasksRepo.findOne.mockResolvedValue(task);

    await (
      service as unknown as {
        finalizeSuccess(taskId: number): Promise<void>;
      }
    ).finalizeSuccess(1);

    expect(task.status).toBe(TaskStatus.RUNNING);
    expect(task.subStatus).toBe(TaskSubStatus.EXECUTING);
    expect(eventsRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 1,
        content: expect.stringContaining('等待执行机器人调用') as string,
      }),
    );
    expect(taskNotify.notifyTaskRequester).not.toHaveBeenCalled();
  });
});
