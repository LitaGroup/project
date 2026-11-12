import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TaskStatus, TaskSubStatus } from '../common/enums';
import { Task } from './task.entity';
import { TaskExternalEvent } from './task-external-event.entity';
import { TaskExternalEventService } from './task-external-event.service';

describe('TaskExternalEventService 外部工单回调', () => {
  const baseTask = (over: Partial<Task> = {}): Task =>
    ({
      id: 42,
      code: 'TK-0042',
      title: '线上配置变更',
      status: TaskStatus.WAITING,
      subStatus: TaskSubStatus.PENDING_APPLY,
      agentId: 1001,
      resumePrompt: null,
      remindCount: 1,
      firstRemindedAt: new Date(),
      lastRemindedAt: new Date(),
      ...over,
    }) as Task;

  const baseEvent = (
    over: Partial<TaskExternalEvent> = {},
  ): TaskExternalEvent => ({
    id: 7,
    taskId: 42,
    source: 'lita-proxy',
    externalTicketId: 123,
    eventType: 'ticket.status_changed',
    externalStatus: 'success',
    payload: {
      ticketId: 123,
      status: 'success',
      kind: 'mysql',
      env: 'prod',
      resourceName: 'order-db',
      operation: 'update',
      operator: 'alice',
      message: 'affected 1 row',
    },
    deliveryStatus: 'queued',
    attempts: 0,
    lastAttemptAt: null,
    nextRetryAt: null,
    lastError: null,
    deliveredAt: null,
    processedAt: null,
    createdAt: new Date('2026-11-12T02:00:00Z'),
    updatedAt: new Date('2026-11-12T02:00:00Z'),
    ...over,
  });

  let tasksRepo: {
    findOne: jest.Mock;
    update: jest.Mock;
  };
  let eventsRepo: {
    findOne: jest.Mock;
    find: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
  };
  let dispatch: {
    taskChatRunning: jest.Mock;
    continueConversation: jest.Mock;
  };
  let service: TaskExternalEventService;

  beforeEach(() => {
    tasksRepo = {
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    eventsRepo = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((value: unknown) => value),
      save: jest.fn((value: Record<string, unknown>) => ({
        ...value,
        id: 7,
      })),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    dispatch = {
      taskChatRunning: jest.fn().mockReturnValue(false),
      continueConversation: jest.fn().mockResolvedValue(undefined),
    };
    service = new TaskExternalEventService(
      tasksRepo as never,
      eventsRepo as never,
      dispatch as never,
      { get: () => 'http://work.test/api' } as never,
    );
  });

  it('任务不存在时拒绝接收', async () => {
    tasksRepo.findOne.mockResolvedValue(null);
    await expect(
      service.receive(42, { ticketId: 1, status: 'success' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('报文缺少 ticketId/status 时拒绝', async () => {
    tasksRepo.findOne.mockResolvedValue(baseTask());
    await expect(
      service.receive(42, { status: 'success' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.receive(42, { ticketId: 1 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('新事件落库后异步唤醒', async () => {
    tasksRepo.findOne.mockResolvedValue(baseTask());
    eventsRepo.findOne.mockResolvedValue(null);
    const deliver = jest.spyOn(service, 'deliver').mockResolvedValue();
    const receipt = await service.receive(42, {
      event: 'ticket.status_changed',
      ticketId: 123,
      status: 'success',
    });
    expect(receipt).toEqual({ accepted: true, duplicate: false });
    expect(eventsRepo.save).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledWith(7);
  });

  it('重复回调按任务 + 工单 + 状态幂等', async () => {
    tasksRepo.findOne.mockResolvedValue(baseTask());
    eventsRepo.findOne.mockResolvedValue(baseEvent());
    const receipt = await service.receive(42, {
      ticketId: 123,
      status: 'success',
    });
    expect(receipt).toEqual({ accepted: true, duplicate: true });
    expect(eventsRepo.save).not.toHaveBeenCalled();
  });

  it('并发唯一键冲突也按重复处理', async () => {
    tasksRepo.findOne.mockResolvedValue(baseTask());
    eventsRepo.findOne.mockResolvedValue(null);
    eventsRepo.save.mockRejectedValue({ code: '23505' });
    const receipt = await service.receive(42, {
      ticketId: 123,
      status: 'success',
    });
    expect(receipt).toEqual({ accepted: true, duplicate: true });
  });

  it('任务已结束只记录不唤醒', async () => {
    eventsRepo.findOne.mockResolvedValue(baseEvent());
    tasksRepo.findOne.mockResolvedValue(
      baseTask({
        status: TaskStatus.FINISHED,
        subStatus: TaskSubStatus.COMPLETED,
      }),
    );
    await service.deliver(7);
    expect(eventsRepo.update).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ deliveryStatus: 'recorded' }),
    );
    expect(dispatch.continueConversation).not.toHaveBeenCalled();
    expect(tasksRepo.update).not.toHaveBeenCalled();
  });

  it('回合仍在执行时直投当前会话', async () => {
    eventsRepo.findOne.mockResolvedValue(baseEvent());
    tasksRepo.findOne.mockResolvedValue(
      baseTask({
        status: TaskStatus.RUNNING,
        subStatus: TaskSubStatus.EXECUTING,
      }),
    );
    dispatch.taskChatRunning.mockReturnValue(true);
    await service.deliver(7);
    expect(dispatch.continueConversation).toHaveBeenCalledWith(
      42,
      expect.stringContaining('lita-proxy 线上操作工单 #123'),
      '外部工单回调',
    );
    expect(tasksRepo.update).not.toHaveBeenCalled();
  });

  it('执行中但回合已结束时转待继续', async () => {
    eventsRepo.findOne.mockResolvedValue(baseEvent());
    tasksRepo.findOne.mockResolvedValue(
      baseTask({
        status: TaskStatus.RUNNING,
        subStatus: TaskSubStatus.EXECUTING,
      }),
    );
    dispatch.taskChatRunning.mockReturnValue(false);
    await service.deliver(7);
    expect(tasksRepo.update).toHaveBeenCalledWith(
      {
        id: 42,
        status: TaskStatus.RUNNING,
        subStatus: TaskSubStatus.EXECUTING,
      },
      expect.objectContaining({
        status: TaskStatus.WAITING,
        subStatus: TaskSubStatus.PENDING_RESUME,
        resumePrompt: expect.stringContaining('外部工单状态回调') as string,
      }),
    );
  });

  it('待申请验收收到事件转待继续', async () => {
    eventsRepo.findOne.mockResolvedValue(baseEvent());
    tasksRepo.findOne.mockResolvedValue(baseTask());
    await service.deliver(7);
    expect(tasksRepo.update).toHaveBeenCalledWith(
      {
        id: 42,
        status: TaskStatus.WAITING,
        subStatus: TaskSubStatus.PENDING_APPLY,
      },
      expect.objectContaining({
        subStatus: TaskSubStatus.PENDING_RESUME,
        resumePrompt: expect.stringContaining('affected 1 row') as string,
        remindCount: 0,
      }),
    );
  });

  it('已在待继续时追加事件且同一事件不重复写入', async () => {
    const task = baseTask({
      subStatus: TaskSubStatus.PENDING_RESUME,
      resumePrompt: '之前的上下文',
    });
    eventsRepo.findOne.mockResolvedValue(baseEvent());
    tasksRepo.findOne.mockResolvedValue(task);
    await service.deliver(7);
    expect(tasksRepo.update).toHaveBeenCalledWith(
      {
        id: 42,
        status: TaskStatus.WAITING,
        subStatus: TaskSubStatus.PENDING_RESUME,
      },
      { resumePrompt: expect.stringContaining('之前的上下文') as string },
    );

    tasksRepo.update.mockClear();
    tasksRepo.findOne.mockResolvedValue({
      ...task,
      resumePrompt: `之前的上下文\n\n> 事件记录 ID：7（同一工单同一状态只处理一次）`,
    });
    await service.deliver(7);
    expect(tasksRepo.update).not.toHaveBeenCalled();
  });

  it('任务暂不可接收时按退避重试', async () => {
    eventsRepo.findOne.mockResolvedValue(baseEvent());
    tasksRepo.findOne.mockResolvedValue(
      baseTask({ subStatus: TaskSubStatus.PENDING_FEEDBACK }),
    );
    await service.deliver(7);
    const [, patch] = eventsRepo.update.mock.calls[0] as [
      number,
      { deliveryStatus: string; attempts: number; nextRetryAt: Date },
    ];
    expect(patch.deliveryStatus).toBe('queued');
    expect(patch.attempts).toBe(1);
    expect(patch.nextRetryAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('对账扫描补投待处理事件', async () => {
    eventsRepo.find.mockResolvedValue([baseEvent()]);
    const deliver = jest.spyOn(service, 'deliver').mockResolvedValue();
    await service.retryPending();
    expect(deliver).toHaveBeenCalledWith(7);
  });

  it('回调地址按任务拼装', () => {
    expect(service.callbackUrl(42)).toBe(
      'http://work.test/api/tasks/42/external-event',
    );
  });
});
