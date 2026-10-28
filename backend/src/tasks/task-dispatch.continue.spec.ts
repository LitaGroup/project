import { BadRequestException } from '@nestjs/common';
import { TaskStatus, TaskSubStatus } from '../common/enums';
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
      ...over,
    }) as Task;

  let tasksRepo: { findOne: jest.Mock };
  let eventsRepo: { create: jest.Mock; save: jest.Mock };
  let taskChat: { isRunning: jest.Mock; archiveResult: jest.Mock };
  let taskRealtime: { taskChanged: jest.Mock };
  let service: TaskDispatchService;
  let dispatchSpy: jest.SpyInstance;

  beforeEach(() => {
    tasksRepo = { findOne: jest.fn() };
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
      { findOne: jest.fn() } as never,
      { findOne: jest.fn() } as never,
      { findOne: jest.fn() } as never,
      { workdirOf: jest.fn() } as never,
      { onEvent: jest.fn() } as never,
      {} as never,
      taskRealtime as never,
      taskChat as never,
    );
    dispatchSpy = jest.spyOn(service, 'dispatch').mockResolvedValue(baseTask());
  });

  it('待验收任务可继续对话：归档结果、记反馈并重新派发', async () => {
    tasksRepo.findOne.mockResolvedValue(baseTask());

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
      new BadRequestException('当前任务应先补充需求并重新识别'),
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
      new BadRequestException('当前任务应先补充需求并重新识别'),
    );
    expect(dispatchSpy).not.toHaveBeenCalled();
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
      new BadRequestException('当前任务应先补充需求并重新识别'),
    );
    expect(dispatchSpy).not.toHaveBeenCalled();
  });
});
