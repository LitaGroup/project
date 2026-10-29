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
  let taskChat: {
    isRunning: jest.Mock;
    archiveResult: jest.Mock;
    hasQueuedUserMessages: jest.Mock;
    enqueueUserMessage: jest.Mock;
    queuedUserMessages: jest.Mock;
    queuedUserMessagePrompt: jest.Mock;
    markQueuedUserMessageSending: jest.Mock;
    removeQueuedUserMessage: jest.Mock;
    restoreQueuedUserMessage: jest.Mock;
    discardQueuedUserMessages: jest.Mock;
    finishTask: jest.Mock;
  };
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
      hasQueuedUserMessages: jest.fn().mockReturnValue(false),
      enqueueUserMessage: jest.fn().mockResolvedValue(undefined),
      queuedUserMessages: jest.fn().mockReturnValue([]),
      queuedUserMessagePrompt: jest.fn().mockReturnValue(null),
      markQueuedUserMessageSending: jest.fn(),
      removeQueuedUserMessage: jest.fn().mockResolvedValue(undefined),
      restoreQueuedUserMessage: jest.fn().mockResolvedValue(undefined),
      discardQueuedUserMessages: jest.fn().mockResolvedValue(undefined),
      finishTask: jest.fn().mockResolvedValue(undefined),
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

  it('机器人正在回复时消息进入发送队列，不立即派发或生成用户气泡', async () => {
    tasksRepo.findOne.mockResolvedValue(
      baseTask({
        status: TaskStatus.RUNNING,
        subStatus: TaskSubStatus.EXECUTING,
      }),
    );
    taskChat.isRunning.mockReturnValue(true);

    const saved = await service.continueConversation(1, '补充说明', '张三');

    expect(taskChat.enqueueUserMessage).toHaveBeenCalledWith(
      1,
      '补充说明',
      '张三',
      undefined,
    );
    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(eventsRepo.save).not.toHaveBeenCalled();
    expect(saved.subStatus).toBe(TaskSubStatus.EXECUTING);
  });

  it('返工消息入队时保留原始展示内容，模型 Prompt 单独保存', async () => {
    tasksRepo.findOne.mockResolvedValue(
      baseTask({
        status: TaskStatus.RUNNING,
        subStatus: TaskSubStatus.EXECUTING,
      }),
    );
    taskChat.isRunning.mockReturnValue(true);

    await service.continueConversation(1, '请补充错误提示', '张三', {
      modelContent: '# 验收返工\n\n请补充错误提示\n\n必须重新申请验收',
    });

    expect(taskChat.enqueueUserMessage).toHaveBeenCalledWith(
      1,
      '请补充错误提示',
      '张三',
      '# 验收返工\n\n请补充错误提示\n\n必须重新申请验收',
    );
  });

  it('队首消息投递成功后才移出队列并生成用户气泡', async () => {
    tasksRepo.findOne.mockResolvedValue(
      baseTask({
        status: TaskStatus.RUNNING,
        subStatus: TaskSubStatus.EXECUTING,
      }),
    );
    const queued = {
      id: 'queue:1:first',
      taskId: 1,
      sender: { id: 'user:张三', name: '张三', kind: 'user' },
      content: '补充说明',
      createdAt: new Date().toISOString(),
      status: 'queued' as const,
    };
    taskChat.queuedUserMessages.mockReturnValue([queued]);
    taskChat.markQueuedUserMessageSending.mockResolvedValue({
      ...queued,
      status: 'sending',
    });

    await (
      service as unknown as {
        drainQueuedConversation(taskId: number): Promise<void>;
      }
    ).drainQueuedConversation(1);

    expect(taskChat.markQueuedUserMessageSending).toHaveBeenCalledWith(
      1,
      queued.id,
    );
    expect(dispatchSpy).toHaveBeenCalledWith(1, '张三', '补充说明');
    expect(eventsRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 1,
        type: '反馈',
        content: '补充说明',
      }),
    );
    expect(taskChat.removeQueuedUserMessage).toHaveBeenCalledWith(1, queued.id);
  });

  it('队列中的返工消息投递完整 Prompt，用户气泡仍展示原始反馈', async () => {
    tasksRepo.findOne.mockResolvedValue(
      baseTask({
        status: TaskStatus.RUNNING,
        subStatus: TaskSubStatus.EXECUTING,
      }),
    );
    const queued = {
      id: 'queue:1:rework',
      taskId: 1,
      sender: { id: 'user:张三', name: '张三', kind: 'user' },
      content: '请补充错误提示',
      createdAt: new Date().toISOString(),
      status: 'queued' as const,
    };
    taskChat.queuedUserMessages.mockReturnValue([queued]);
    taskChat.markQueuedUserMessageSending.mockResolvedValue({
      ...queued,
      status: 'sending',
    });
    taskChat.queuedUserMessagePrompt.mockReturnValue(
      '# 验收返工\n\n请补充错误提示\n\n必须重新申请验收',
    );

    await (
      service as unknown as {
        drainQueuedConversation(taskId: number): Promise<void>;
      }
    ).drainQueuedConversation(1);

    expect(dispatchSpy).toHaveBeenCalledWith(
      1,
      '张三',
      '# 验收返工\n\n请补充错误提示\n\n必须重新申请验收',
    );
    expect(eventsRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 1,
        type: '反馈',
        content: '请补充错误提示',
      }),
    );
  });

  it('队首投递失败时保留消息并记录错误，不生成用户气泡', async () => {
    tasksRepo.findOne.mockResolvedValue(
      baseTask({
        status: TaskStatus.RUNNING,
        subStatus: TaskSubStatus.EXECUTING,
      }),
    );
    const queued = {
      id: 'queue:1:first',
      taskId: 1,
      sender: { id: 'user:张三', name: '张三', kind: 'user' },
      content: '补充说明',
      createdAt: new Date().toISOString(),
      status: 'queued' as const,
    };
    taskChat.queuedUserMessages.mockReturnValue([queued]);
    taskChat.markQueuedUserMessageSending.mockResolvedValue({
      ...queued,
      status: 'sending',
    });
    dispatchSpy.mockRejectedValue(new Error('执行器离线'));

    await expect(
      (
        service as unknown as {
          drainQueuedConversation(taskId: number): Promise<void>;
        }
      ).drainQueuedConversation(1),
    ).rejects.toThrow('执行器离线');

    expect(taskChat.restoreQueuedUserMessage).toHaveBeenCalledWith(
      1,
      queued.id,
      '执行器离线',
    );
    expect(taskChat.removeQueuedUserMessage).not.toHaveBeenCalled();
    expect(eventsRepo.save).not.toHaveBeenCalled();
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
