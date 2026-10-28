import { BadRequestException } from '@nestjs/common';
import { TaskStatus, TaskSubStatus } from '../common/enums';
import { OpencodeClient } from '../executors/opencode-client';
import { Task } from './task.entity';
import { TaskDispatchService } from './task-dispatch.service';

describe('TaskDispatchService.continueConversation 状态守卫', () => {
  const baseTask = (over: Partial<Task> = {}): Task =>
    ({
      id: 1,
      code: 'TK-0001',
      title: '任务标题',
      type: '其它',
      status: TaskStatus.WAITING,
      subStatus: TaskSubStatus.PENDING_ACCEPT,
      description: '原始需求',
      input: null,
      outputSpec: null,
      workPlan: null,
      missingItems: null,
      agentId: 1001,
      schedulerId: null,
      remindCount: 0,
      firstRemindedAt: null,
      lastRemindedAt: null,
      parentId: null,
      rootId: 1,
      executorId: 3,
      opencodeSessionId: 'session-1',
      ...over,
    }) as Task;

  let tasksRepo: { findOne: jest.Mock; update: jest.Mock };
  let executorsRepo: { findOne: jest.Mock };
  let eventsRepo: { create: jest.Mock; save: jest.Mock };
  let taskChat: { isRunning: jest.Mock; archiveResult: jest.Mock };
  let taskRealtime: { taskChanged: jest.Mock };
  let service: TaskDispatchService;
  let dispatchSpy: jest.SpyInstance;

  beforeEach(() => {
    tasksRepo = { findOne: jest.fn(), update: jest.fn() };
    executorsRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 3,
        name: '执行器',
        ip: '127.0.0.1',
        port: 4096,
        token: null,
      }),
    };
    eventsRepo = {
      create: jest.fn((v: unknown) => v),
      save: jest.fn().mockResolvedValue(undefined),
    };
    taskChat = {
      isRunning: jest.fn().mockReturnValue(false),
      archiveResult: jest.fn().mockResolvedValue(undefined),
    };
    taskRealtime = { taskChanged: jest.fn() };
    service = new TaskDispatchService(
      tasksRepo as never,
      eventsRepo as never,
      executorsRepo as never,
      { findOne: jest.fn() } as never,
      { findOne: jest.fn() } as never,
      { workdirOf: jest.fn() } as never,
      { onEvent: jest.fn() } as never,
      {} as never,
      taskRealtime as never,
      taskChat as never,
      {} as never,
      {} as never,
      {
        enqueue: jest.fn(),
        requeueDelivered: jest.fn(),
      } as never,
      { transaction: jest.fn() } as never,
      { get: jest.fn() } as never,
    );
    dispatchSpy = jest.spyOn(service, 'dispatch').mockResolvedValue(baseTask());
  });

  it('已占用机器人的执行任务可继续对话：归档结果、记反馈并重新派发', async () => {
    tasksRepo.findOne.mockResolvedValue(
      baseTask({
        status: TaskStatus.RUNNING,
        subStatus: TaskSubStatus.EXECUTING,
      }),
    );

    await service.continueConversation(1, '继续修改文案', '张三');

    expect(taskChat.archiveResult).toHaveBeenCalledWith(1);
    expect(eventsRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 1,
        type: '反馈',
        content: '继续修改文案',
      }),
    );
    expect(dispatchSpy).toHaveBeenCalledWith(1, '张三', '继续修改文案');
  });

  it('待识别任务仍要求先补充需求并重新识别', async () => {
    tasksRepo.findOne.mockResolvedValue(
      baseTask({ subStatus: TaskSubStatus.PENDING_IDENTIFY }),
    );

    await expect(
      service.continueConversation(1, '补充内容', '张三'),
    ).rejects.toThrow(
      new BadRequestException('等待任务必须先由 LOOP 或验收返工占用机器人'),
    );
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('待反馈任务仍要求先补充需求并重新识别', async () => {
    tasksRepo.findOne.mockResolvedValue(
      baseTask({ subStatus: TaskSubStatus.PENDING_FEEDBACK }),
    );

    await expect(
      service.continueConversation(1, '补充内容', '张三'),
    ).rejects.toThrow(
      new BadRequestException('等待任务必须先由 LOOP 或验收返工占用机器人'),
    );
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('验收完成后删除执行器会话并解除平台绑定', async () => {
    tasksRepo.findOne.mockResolvedValue(
      baseTask({
        status: TaskStatus.FINISHED,
        subStatus: TaskSubStatus.COMPLETED,
      }),
    );
    const deleteSession = jest
      .spyOn(OpencodeClient.prototype, 'deleteSession')
      .mockResolvedValue(undefined);

    await service.destroyAcceptedSession(1);

    expect(deleteSession).toHaveBeenCalledWith('session-1');
    expect(tasksRepo.update).toHaveBeenCalledWith(1, {
      opencodeSessionId: null,
    });
    expect(eventsRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 1,
        type: '系统',
        content: expect.stringContaining('已销毁执行器会话') as string,
      }),
    );
    deleteSession.mockRestore();
  });

  it('未完成任务不销毁执行器会话', async () => {
    tasksRepo.findOne.mockResolvedValue(baseTask());
    const deleteSession = jest.spyOn(OpencodeClient.prototype, 'deleteSession');

    await service.destroyAcceptedSession(1);

    expect(deleteSession).not.toHaveBeenCalled();
    expect(tasksRepo.update).not.toHaveBeenCalled();
    deleteSession.mockRestore();
  });

  it('识别中的任务仍要求先补充需求并重新识别', async () => {
    tasksRepo.findOne.mockResolvedValue(
      baseTask({
        status: TaskStatus.RUNNING,
        subStatus: TaskSubStatus.IDENTIFYING,
      }),
    );

    await expect(
      service.continueConversation(1, '补充内容', '张三'),
    ).rejects.toThrow(
      new BadRequestException('等待任务必须先由 LOOP 或验收返工占用机器人'),
    );
    expect(dispatchSpy).not.toHaveBeenCalled();
  });
});
