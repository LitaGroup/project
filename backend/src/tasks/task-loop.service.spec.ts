import { TaskStatus, TaskSubStatus } from '../common/enums';
import { Task } from './task.entity';
import { TaskLoopService } from './task-loop.service';
import {
  TASK_REMIND_INTERVAL_MS,
  TASK_REMIND_TIMEOUT_MS,
} from './task-loop.rules';
import type { TaskWorkerInbox } from './task-worker-inbox.entity';

describe('TaskLoopService 多机器人协同', () => {
  const baseTask = (over: Partial<Task> = {}): Task =>
    ({
      id: 1,
      code: 'TK-0001',
      title: '协同任务',
      type: '其它',
      status: TaskStatus.WAITING,
      subStatus: TaskSubStatus.PENDING_ASSIGNMENT,
      description: '帮我做一个活动页',
      input: null,
      outputSpec: null,
      workPlan: null,
      missingItems: null,
      agentId: null,
      schedulerId: null,
      remindCount: 0,
      firstRemindedAt: null,
      lastRemindedAt: null,
      parentId: null,
      rootId: 1,
      requesterType: 'user',
      requesterId: 8,
      ...over,
    }) as Task;

  let tasksRepo: { find: jest.Mock; findOne: jest.Mock; update: jest.Mock };
  let tasksService: { addEvent: jest.Mock };
  let assignmentService: { assign: jest.Mock };
  let dispatchService: {
    dispatch: jest.Mock;
    offer: jest.Mock;
    isWorkerBusy: jest.Mock;
    taskChatRunning: jest.Mock;
    claimExecution: jest.Mock;
  };
  let taskNotify: {
    notifyTaskOwner: jest.Mock;
    notifyTaskRequester: jest.Mock;
    notifyTaskAgentOwner: jest.Mock;
  };
  let inbox: {
    listPending: jest.Mock;
    markQueued: jest.Mock;
    markDelivered: jest.Mock;
    markDead: jest.Mock;
    completeForChild: jest.Mock;
  };
  let service: TaskLoopService;

  beforeEach(() => {
    tasksRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    tasksService = { addEvent: jest.fn().mockResolvedValue(undefined) };
    assignmentService = { assign: jest.fn() };
    dispatchService = {
      dispatch: jest.fn().mockResolvedValue(undefined),
      offer: jest.fn().mockResolvedValue(undefined),
      isWorkerBusy: jest.fn().mockResolvedValue(false),
      taskChatRunning: jest.fn().mockReturnValue(false),
      claimExecution: jest.fn().mockResolvedValue(
        baseTask({
          status: TaskStatus.RUNNING,
          subStatus: TaskSubStatus.EXECUTING,
          agentId: 1001,
        }),
      ),
    };
    taskNotify = {
      notifyTaskOwner: jest.fn().mockResolvedValue({ sent: true }),
      notifyTaskRequester: jest
        .fn()
        .mockResolvedValue({ sent: true, ownerName: '需求方' }),
      notifyTaskAgentOwner: jest
        .fn()
        .mockResolvedValue({ sent: true, ownerName: '机器人负责人' }),
    };
    inbox = {
      listPending: jest.fn().mockResolvedValue([]),
      markQueued: jest.fn().mockResolvedValue(undefined),
      markDelivered: jest.fn().mockResolvedValue(undefined),
      markDead: jest.fn().mockResolvedValue(undefined),
      completeForChild: jest.fn().mockResolvedValue(undefined),
    };
    service = new TaskLoopService(
      tasksRepo as never,
      tasksService as never,
      assignmentService as never,
      dispatchService as never,
      taskNotify as never,
      inbox as never,
    );
    (service as unknown as { ready: boolean }).ready = true;
  });

  function returnForStatus(status: TaskSubStatus, task: Task): void {
    tasksRepo.find.mockImplementation(
      (args?: { where?: { subStatus?: TaskSubStatus } }) =>
        Promise.resolve(args?.where?.subStatus === status ? [task] : []),
    );
  }

  it('待分配 → 待接受，不直接执行', async () => {
    const task = baseTask();
    returnForStatus(TaskSubStatus.PENDING_ASSIGNMENT, task);
    assignmentService.assign.mockResolvedValue({
      type: '前端开发',
      agentId: 3,
      agentName: '前端工程师',
      templateId: 11,
      templateName: '前端任务定义',
      source: 'type-definition',
    });

    await service.tick();

    expect(tasksRepo.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 1,
        subStatus: TaskSubStatus.PENDING_ASSIGNMENT,
      }),
      expect.objectContaining({
        subStatus: TaskSubStatus.PENDING_ACCEPTANCE,
        type: '前端开发',
        templateId: 11,
        agentId: 3,
      }),
    );
    expect(dispatchService.dispatch).not.toHaveBeenCalled();
  });

  it('负责机器人忙碌时保留待分配', async () => {
    const task = baseTask();
    returnForStatus(TaskSubStatus.PENDING_ASSIGNMENT, task);
    assignmentService.assign.mockResolvedValue({
      type: '前端开发',
      agentId: 3,
      agentName: '前端工程师',
      templateId: 11,
      templateName: '前端任务定义',
      source: 'definition',
    });
    dispatchService.isWorkerBusy.mockResolvedValue(true);

    await service.tick();

    expect(tasksRepo.update).not.toHaveBeenCalled();
    expect(dispatchService.offer).not.toHaveBeenCalled();
  });

  it('待接受任务只发送邀约，不自动进入执行中', async () => {
    const task = baseTask({
      subStatus: TaskSubStatus.PENDING_ACCEPTANCE,
      agentId: 1001,
    });
    returnForStatus(TaskSubStatus.PENDING_ACCEPTANCE, task);

    await service.tick();

    expect(dispatchService.offer).toHaveBeenCalledWith(1);
    expect(dispatchService.dispatch).not.toHaveBeenCalled();
  });

  it('没有可用机器人时进入待反馈', async () => {
    const task = baseTask();
    returnForStatus(TaskSubStatus.PENDING_ASSIGNMENT, task);
    assignmentService.assign.mockResolvedValue({
      type: '未知任务',
      agentId: null,
      agentName: null,
      templateId: 6,
      templateName: '未知任务',
      source: 'unknown',
    });

    await service.tick();

    expect(tasksRepo.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      expect.objectContaining({
        subStatus: TaskSubStatus.PENDING_FEEDBACK,
        missingItems: [
          expect.objectContaining({
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            item: expect.stringContaining('未知任务定义（ID=6）'),
          }),
        ],
      }),
    );
  });

  it('待继续任务在机器人空闲后恢复并投递父机器人事件', async () => {
    const task = baseTask({
      subStatus: TaskSubStatus.PENDING_RESUME,
      agentId: 1001,
      resumePrompt: '# 提问答复\n\n继续',
    });
    returnForStatus(TaskSubStatus.PENDING_RESUME, task);

    await service.tick();

    expect(dispatchService.claimExecution).toHaveBeenCalledWith(
      1,
      TaskSubStatus.PENDING_RESUME,
      { nullIfStateChanged: true },
    );
    expect(dispatchService.dispatch).toHaveBeenCalledWith(
      1,
      null,
      '# 提问答复\n\n继续',
    );
    expect(inbox.markDelivered).toHaveBeenCalledWith(1);
  });

  it('父机器人子任务事件进入待继续上下文', async () => {
    const entry = {
      id: 9,
      parentTaskId: 1,
      workerId: 1001,
      childTaskId: 2,
      kind: 'handoff',
      referenceId: null,
      status: 'pending',
    } as TaskWorkerInbox;
    const parent = baseTask({
      id: 1,
      agentId: 1001,
      subStatus: TaskSubStatus.PENDING_ACCEPT,
    });
    const child = baseTask({
      id: 2,
      code: 'TK-0002',
      parentId: 1,
      rootId: 1,
      requesterType: 'worker',
      requesterId: 1001,
      subStatus: TaskSubStatus.PENDING_ACCEPT,
    });
    inbox.listPending.mockResolvedValue([entry]);
    tasksRepo.findOne.mockImplementation(
      ({ where }: { where: { id: number } }) =>
        Promise.resolve(where.id === 1 ? parent : child),
    );

    await service.tick();

    expect(tasksRepo.update).toHaveBeenCalledWith(
      { id: 1, status: TaskStatus.WAITING },
      expect.objectContaining({
        subStatus: TaskSubStatus.PENDING_RESUME,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        resumePrompt: expect.stringContaining('子任务协同事件'),
      }),
    );
    expect(inbox.markQueued).toHaveBeenCalledWith(9);
  });

  it('父任务不可用时把子任务需求方回退给根任务创建人', async () => {
    const entry = {
      id: 10,
      parentTaskId: 1,
      workerId: 1001,
      childTaskId: 2,
      kind: 'handoff',
      referenceId: null,
      status: 'pending',
    } as TaskWorkerInbox;
    const child = baseTask({
      id: 2,
      code: 'TK-0002',
      parentId: 1,
      rootId: 3,
      requesterType: 'worker',
      requesterId: 1001,
      subStatus: TaskSubStatus.PENDING_ACCEPT,
    });
    const root = baseTask({ id: 3, rootId: 3, createdById: 8 });
    inbox.listPending.mockResolvedValue([entry]);
    tasksRepo.findOne.mockImplementation(
      ({ where }: { where: { id: number } }) =>
        Promise.resolve(where.id === 2 ? child : where.id === 3 ? root : null),
    );

    await service.tick();

    expect(inbox.markDead).toHaveBeenCalledWith(10);
    expect(tasksRepo.update).toHaveBeenCalledWith(
      { id: 2 },
      { requesterType: 'user', requesterId: 8 },
    );
    expect(taskNotify.notifyTaskRequester).toHaveBeenCalledWith(
      expect.objectContaining({ id: 2, requesterType: 'user' }),
      'notice',
      expect.stringContaining('子任务需要人工介入'),
      expect.any(String),
    );
  });

  it('验收升级后的待反馈优先提醒执行机器人负责人', async () => {
    const task = baseTask({
      subStatus: TaskSubStatus.PENDING_FEEDBACK,
      missingItems: [{ item: '验收不通过已达 4 次，等待任务负责人处理' }],
      ownerTakeoverAt: new Date(),
      ownerTakeoverUserId: 9,
      ownerTakeoverName: '王五',
    });
    returnForStatus(TaskSubStatus.PENDING_FEEDBACK, task);

    await service.tick();

    expect(taskNotify.notifyTaskAgentOwner).toHaveBeenCalledWith(
      task,
      'feedback',
      expect.stringContaining('任务待反馈'),
      expect.stringContaining('请任务负责人「王五」补充处理意见'),
    );
  });

  it('待反馈提醒按 30 分钟节流并通知需求方', async () => {
    const task = baseTask({
      subStatus: TaskSubStatus.PENDING_FEEDBACK,
      missingItems: [{ item: '请提供活动规则' }],
    });
    returnForStatus(TaskSubStatus.PENDING_FEEDBACK, task);

    await service.tick();
    expect(taskNotify.notifyTaskRequester).toHaveBeenCalledTimes(1);

    task.remindCount = 1;
    task.firstRemindedAt = new Date(Date.now() - TASK_REMIND_INTERVAL_MS * 2);
    task.lastRemindedAt = new Date();
    await service.tick();
    expect(taskNotify.notifyTaskRequester).toHaveBeenCalledTimes(1);

    task.lastRemindedAt = new Date(Date.now() - TASK_REMIND_INTERVAL_MS - 1);
    await service.tick();
    expect(taskNotify.notifyTaskRequester).toHaveBeenCalledTimes(2);
  });

  it('待反馈首次提醒满 7 天仍未处理 → 取消', async () => {
    const task = baseTask({
      subStatus: TaskSubStatus.PENDING_FEEDBACK,
      remindCount: 42,
      firstRemindedAt: new Date(Date.now() - TASK_REMIND_TIMEOUT_MS),
      lastRemindedAt: new Date(Date.now() - TASK_REMIND_INTERVAL_MS + 1),
    });
    returnForStatus(TaskSubStatus.PENDING_FEEDBACK, task);

    await service.tick();

    expect(tasksRepo.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      expect.objectContaining({
        status: TaskStatus.FINISHED,
        subStatus: TaskSubStatus.CANCELED,
      }),
    );
  });

  it('待验收提醒发送给任务需求方', async () => {
    const task = baseTask({
      subStatus: TaskSubStatus.PENDING_ACCEPT,
      agentId: 1001,
    });
    returnForStatus(TaskSubStatus.PENDING_ACCEPT, task);

    await service.tick();

    expect(taskNotify.notifyTaskRequester).toHaveBeenCalledWith(
      task,
      'accept',
      expect.stringContaining('任务待验收'),
      expect.any(String),
    );
  });

  it('待验收首次提醒满 7 天仍未处理 → 完成', async () => {
    const task = baseTask({
      subStatus: TaskSubStatus.PENDING_ACCEPT,
      remindCount: 42,
      firstRemindedAt: new Date(Date.now() - TASK_REMIND_TIMEOUT_MS - 1),
      lastRemindedAt: new Date(Date.now() - TASK_REMIND_INTERVAL_MS + 1),
    });
    returnForStatus(TaskSubStatus.PENDING_ACCEPT, task);

    await service.tick();

    expect(tasksRepo.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      expect.objectContaining({
        status: TaskStatus.FINISHED,
        subStatus: TaskSubStatus.COMPLETED,
      }),
    );
  });
});
