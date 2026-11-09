import { BadRequestException } from '@nestjs/common';
import { TaskStatus, TaskSubStatus, WorkerRuntime } from '../common/enums';
import { OpencodeClient } from '../executors/opencode-client';
import { Task } from './task.entity';
import { TaskDispatchService } from './task-dispatch.service';

describe('TaskDispatchService.continueConversation 状态守卫', () => {
  const baseTask = (over: Partial<Task> = {}): Task =>
    ({
      id: 1,
      code: 'TK-0001',
      title: '任务标题',
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
  let workersRepo: { findOne: jest.Mock };
  let inbox: { enqueue: jest.Mock; requeueDelivered: jest.Mock };
  let eventsRepo: { create: jest.Mock; save: jest.Mock };
  let taskChat: {
    isRunning: jest.Mock;
    archiveResult: jest.Mock;
    finishTask: jest.Mock;
  };
  let taskRealtime: { taskChanged: jest.Mock; lineAppended: jest.Mock };
  let workersService: {
    workdirOf: jest.Mock;
    ensureWorkToken: jest.Mock;
  };
  let hub: { onEvent: jest.Mock; retain: jest.Mock; release: jest.Mock };
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
        online: true,
      }),
    };
    eventsRepo = {
      create: jest.fn((v: unknown) => v),
      save: jest.fn().mockResolvedValue(undefined),
    };
    taskChat = {
      isRunning: jest.fn().mockReturnValue(false),
      archiveResult: jest.fn().mockResolvedValue(undefined),
      finishTask: jest.fn().mockResolvedValue(undefined),
    };
    taskRealtime = {
      taskChanged: jest.fn(),
      lineAppended: jest.fn(),
    };
    workersRepo = { findOne: jest.fn() };
    workersService = {
      workdirOf: jest.fn().mockReturnValue('/tmp/worker/1'),
      ensureWorkToken: jest.fn().mockResolvedValue('worker-token'),
    };
    hub = {
      onEvent: jest.fn(),
      retain: jest.fn(),
      release: jest.fn(),
    };
    inbox = {
      enqueue: jest.fn().mockResolvedValue(null),
      requeueDelivered: jest.fn().mockResolvedValue(undefined),
    };
    service = new TaskDispatchService(
      tasksRepo as never,
      eventsRepo as never,
      executorsRepo as never,
      workersRepo as never,
      { findOne: jest.fn() } as never,
      workersService as never,
      hub as never,
      {} as never,
      taskRealtime as never,
      taskChat as never,
      {} as never,
      {} as never,
      inbox as never,
      { buildServersConfig: jest.fn() } as never,
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
    expect(dispatchSpy).toHaveBeenCalledWith(
      1,
      '张三',
      '继续修改文案',
      'execute',
      undefined,
      { queueInOpencode: true },
    );
  });

  it('机器人正在回复时消息仍直接投递，由 opencode 会话排队', async () => {
    const running = baseTask({
      status: TaskStatus.RUNNING,
      subStatus: TaskSubStatus.EXECUTING,
    });
    tasksRepo.findOne.mockResolvedValue(running);
    dispatchSpy.mockResolvedValue(running);
    taskChat.isRunning.mockReturnValue(true);

    const saved = await service.continueConversation(1, '补充说明', '张三');

    expect(dispatchSpy).toHaveBeenCalledWith(
      1,
      '张三',
      '补充说明',
      'execute',
      undefined,
      { queueInOpencode: true },
    );
    expect(eventsRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 1,
        type: '反馈',
        content: '补充说明',
      }),
    );
    expect(saved.subStatus).toBe(TaskSubStatus.EXECUTING);
  });

  it('执行中返工消息直接投递完整 Prompt，用户气泡仍展示原始反馈', async () => {
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

    expect(dispatchSpy).toHaveBeenCalledWith(
      1,
      '张三',
      '# 验收返工\n\n请补充错误提示\n\n必须重新申请验收',
      'execute',
      undefined,
      { queueInOpencode: true },
    );
    expect(eventsRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 1,
        type: '反馈',
        content: '请补充错误提示',
      }),
    );
  });

  it('直接投递失败时返回错误，不生成用户气泡或平台队列', async () => {
    tasksRepo.findOne.mockResolvedValue(
      baseTask({
        status: TaskStatus.RUNNING,
        subStatus: TaskSubStatus.EXECUTING,
      }),
    );
    taskChat.isRunning.mockReturnValue(true);
    dispatchSpy.mockRejectedValue(new Error('执行器离线'));

    await expect(
      service.continueConversation(1, '补充说明', '张三'),
    ).rejects.toThrow('执行器离线');

    expect(eventsRepo.save).not.toHaveBeenCalled();
    expect(taskChat.archiveResult).toHaveBeenCalledWith(1);
  });

  it('执行中续聊复用会话时直接调用 prompt，不中断当前轮', async () => {
    dispatchSpy.mockRestore();
    const running = baseTask({
      status: TaskStatus.RUNNING,
      subStatus: TaskSubStatus.EXECUTING,
    });
    tasksRepo.findOne.mockResolvedValue(running);
    workersRepo.findOne.mockResolvedValue({
      id: 1001,
      name: '执行机器人',
      enabled: true,
      runtime: WorkerRuntime.OPENCODE,
      executorId: 3,
      providerId: 'provider',
      modelId: 'model',
      variant: null,
    });
    (
      service as unknown as {
        buildPrompt: jest.Mock;
      }
    ).buildPrompt = jest.fn().mockResolvedValue('任务上下文');
    const shell = jest
      .spyOn(OpencodeClient.prototype, 'shell')
      .mockResolvedValue('');
    const session = jest
      .spyOn(OpencodeClient.prototype, 'session')
      .mockResolvedValue({ id: 'session-1' });
    const prompt = jest
      .spyOn(OpencodeClient.prototype, 'prompt')
      .mockResolvedValue(null);
    const interrupt = jest
      .spyOn(OpencodeClient.prototype, 'interrupt')
      .mockResolvedValue(undefined);

    await service.continueConversation(1, '补充说明', '张三');

    expect(prompt).toHaveBeenCalledWith('session-1', { text: '补充说明' });
    expect(interrupt).not.toHaveBeenCalled();
    expect(eventsRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 1,
        type: '反馈',
        content: '补充说明',
      }),
    );

    shell.mockRestore();
    session.mockRestore();
    prompt.mockRestore();
    interrupt.mockRestore();
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

  it('子任务 AI 机器人需求方会收到执行方消息收件箱事件', async () => {
    workersRepo.findOne.mockResolvedValue({
      id: 1001,
      runtime: WorkerRuntime.OPENCODE,
      personalAgentUserId: null,
    });
    const task = baseTask({
      parentId: 9,
      requesterType: 'worker',
      requesterId: 1001,
    });

    await service.notifyRequesterWorkerMessage(
      task,
      '  请确认方案  ',
      'chat:1:assistant:2',
    );

    expect(inbox.enqueue).toHaveBeenCalledWith(task, 'message', {
      referenceId: 'chat:1:assistant:2',
      payload: { content: '请确认方案' },
    });
  });

  it('根任务 AI 机器人需求方会收到执行方消息收件箱事件', async () => {
    workersRepo.findOne.mockResolvedValue({
      id: 1001,
      runtime: WorkerRuntime.OPENCODE,
      personalAgentUserId: null,
    });
    const rootTask = baseTask({ parentId: null, requesterId: 1001 });
    rootTask.requesterType = 'worker';

    await service.notifyRequesterWorkerMessage(
      rootTask,
      '  根任务消息  ',
      'chat:1:assistant:9',
    );

    expect(inbox.enqueue).toHaveBeenCalledWith(rootTask, 'message', {
      referenceId: 'chat:1:assistant:9',
      payload: { content: '根任务消息' },
    });
  });

  it('真人需求方与个人 AGENT 需求方不进入收件箱', async () => {
    workersRepo.findOne.mockResolvedValue({
      id: 1001,
      runtime: WorkerRuntime.HUMAN,
      personalAgentUserId: null,
    });
    const humanTask = baseTask({
      parentId: 9,
      requesterType: 'worker',
      requesterId: 1001,
    });
    await service.notifyRequesterWorkerMessage(humanTask, '消息');
    expect(inbox.enqueue).not.toHaveBeenCalled();

    workersRepo.findOne.mockResolvedValue({
      id: 1001,
      runtime: WorkerRuntime.OPENCODE,
      personalAgentUserId: 8,
    });
    await service.notifyRequesterWorkerMessage(humanTask, '消息');
    expect(inbox.enqueue).not.toHaveBeenCalled();
  });
});
