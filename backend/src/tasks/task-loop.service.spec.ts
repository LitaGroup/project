import { TaskStatus, TaskSubStatus, TaskType } from '../common/enums';
import { Task } from './task.entity';
import { TaskLoopService } from './task-loop.service';
import { TASK_REMIND_INTERVAL_MS } from './task-loop.rules';

describe('TaskLoopService', () => {
  const baseTask = (over: Partial<Task> = {}): Task =>
    ({
      id: 1,
      code: 'TK-0001',
      title: '待识别任务',
      type: TaskType.OTHER,
      status: TaskStatus.WAITING,
      subStatus: TaskSubStatus.PENDING_IDENTIFY,
      description: '帮我做一个活动页',
      input: null,
      outputSpec: null,
      workPlan: null,
      missingItems: null,
      agentId: null,
      schedulerId: null,
      remindCount: 0,
      lastRemindedAt: null,
      parentId: null,
      rootId: 1,
      ...over,
    }) as Task;

  let tasksRepo: {
    find: jest.Mock;
    findOne: jest.Mock;
    update: jest.Mock;
  };
  let tasksService: {
    findScheduler: jest.Mock;
    addEvent: jest.Mock;
  };
  let workersService: { findAll: jest.Mock };
  let identifyService: { identify: jest.Mock };
  let dispatchService: { dispatch: jest.Mock };
  let taskNotify: { notifyTaskOwner: jest.Mock };
  let service: TaskLoopService;

  beforeEach(() => {
    tasksRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    tasksService = {
      findScheduler: jest.fn().mockResolvedValue({
        id: 9,
        name: '调度机器人',
        enabled: true,
      }),
      addEvent: jest.fn().mockResolvedValue(undefined),
    };
    workersService = {
      findAll: jest
        .fn()
        .mockResolvedValue([{ id: 3, name: '前端工程师', enabled: true }]),
    };
    identifyService = { identify: jest.fn() };
    dispatchService = { dispatch: jest.fn().mockResolvedValue(undefined) };
    taskNotify = {
      notifyTaskOwner: jest
        .fn()
        .mockResolvedValue({ sent: true, ownerName: '张三' }),
    };
    service = new TaskLoopService(
      tasksRepo as never,
      tasksService as never,
      workersService as never,
      identifyService as never,
      dispatchService as never,
      taskNotify as never,
    );
    // 跳过启动迁移，直接测试 LOOP 单轮逻辑
    (service as unknown as { ready: boolean }).ready = true;
  });

  const flush = async (): Promise<void> => {
    for (let i = 0; i < 4; i++) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  };

  it('待识别 → 进行中-识别中 → 识别成功自动派发', async () => {
    const task = baseTask();
    tasksRepo.find.mockImplementation(
      (args?: { where?: { subStatus?: TaskSubStatus } }) =>
        Promise.resolve(
          args?.where?.subStatus === TaskSubStatus.PENDING_IDENTIFY
            ? [task]
            : [],
        ),
    );
    tasksRepo.findOne.mockResolvedValue(
      baseTask({
        status: TaskStatus.RUNNING,
        subStatus: TaskSubStatus.IDENTIFYING,
      }),
    );
    identifyService.identify.mockResolvedValue({
      title: '活动页开发',
      type: TaskType.FRONTEND,
      input: '活动需求',
      outputSpec: '活动页',
      workPlan: '1. 开发页面',
      feedback: [],
      agentId: 3,
      agentName: '前端工程师',
    });

    await service.tick();
    await flush();

    expect(tasksRepo.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 1,
        status: TaskStatus.WAITING,
        subStatus: TaskSubStatus.PENDING_IDENTIFY,
      }),
      expect.objectContaining({
        status: TaskStatus.RUNNING,
        subStatus: TaskSubStatus.IDENTIFYING,
        schedulerId: 9,
      }),
    );
    expect(identifyService.identify).toHaveBeenCalledTimes(1);
    expect(tasksRepo.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 1,
        status: TaskStatus.RUNNING,
        subStatus: TaskSubStatus.IDENTIFYING,
      }),
      expect.objectContaining({
        title: '活动页开发',
        type: TaskType.FRONTEND,
        agentId: 3,
        workPlan: '1. 开发页面',
      }),
    );
    expect(dispatchService.dispatch).toHaveBeenCalledWith(1, null);
  });

  it('识别返回反馈 → 等待中-待反馈并记录反馈清单', async () => {
    const task = baseTask();
    tasksRepo.find.mockImplementation(
      (args?: { where?: { subStatus?: TaskSubStatus } }) =>
        Promise.resolve(
          args?.where?.subStatus === TaskSubStatus.PENDING_IDENTIFY
            ? [task]
            : [],
        ),
    );
    tasksRepo.findOne.mockResolvedValue(
      baseTask({
        status: TaskStatus.RUNNING,
        subStatus: TaskSubStatus.IDENTIFYING,
      }),
    );
    identifyService.identify.mockResolvedValue({
      type: TaskType.OTHER,
      feedback: [{ item: '请提供活动规则', reason: '缺少关键信息' }],
      agentId: null,
    });

    await service.tick();
    await flush();

    expect(tasksRepo.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      expect.objectContaining({
        status: TaskStatus.WAITING,
        subStatus: TaskSubStatus.PENDING_FEEDBACK,
        missingItems: [{ item: '请提供活动规则', reason: '缺少关键信息' }],
      }),
    );
    expect(dispatchService.dispatch).not.toHaveBeenCalled();
  });

  it('待反馈：首次发送提醒，30 分钟后再次发送', async () => {
    const task = baseTask({
      status: TaskStatus.WAITING,
      subStatus: TaskSubStatus.PENDING_FEEDBACK,
      missingItems: [{ item: '请提供活动规则' }],
    });
    tasksRepo.find.mockImplementation(
      (args?: { where?: { subStatus?: TaskSubStatus } }) =>
        Promise.resolve(
          args?.where?.subStatus === TaskSubStatus.PENDING_FEEDBACK
            ? [task]
            : [],
        ),
    );

    await service.tick();
    expect(taskNotify.notifyTaskOwner).toHaveBeenCalledTimes(1);
    expect(tasksRepo.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 1,
        status: TaskStatus.WAITING,
        subStatus: TaskSubStatus.PENDING_FEEDBACK,
      }),
      expect.objectContaining({
        remindCount: 1,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        lastRemindedAt: expect.any(Date),
      }),
    );

    // 30 分钟内不重复提醒
    task.remindCount = 1;
    task.lastRemindedAt = new Date();
    await service.tick();
    expect(taskNotify.notifyTaskOwner).toHaveBeenCalledTimes(1);

    // 超过 30 分钟再次提醒
    task.lastRemindedAt = new Date(Date.now() - TASK_REMIND_INTERVAL_MS - 1);
    await service.tick();
    expect(taskNotify.notifyTaskOwner).toHaveBeenCalledTimes(2);
  });

  it('待反馈：3 次提醒后仍未处理 → 已结束-取消（标记失败）', async () => {
    const task = baseTask({
      status: TaskStatus.WAITING,
      subStatus: TaskSubStatus.PENDING_FEEDBACK,
      remindCount: 3,
      lastRemindedAt: new Date(Date.now() - TASK_REMIND_INTERVAL_MS - 1),
    });
    tasksRepo.find.mockImplementation(
      (args?: { where?: { subStatus?: TaskSubStatus } }) =>
        Promise.resolve(
          args?.where?.subStatus === TaskSubStatus.PENDING_FEEDBACK
            ? [task]
            : [],
        ),
    );

    await service.tick();

    expect(taskNotify.notifyTaskOwner).not.toHaveBeenCalled();
    expect(tasksRepo.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 1,
        status: TaskStatus.WAITING,
        subStatus: TaskSubStatus.PENDING_FEEDBACK,
      }),
      expect.objectContaining({
        status: TaskStatus.FINISHED,
        subStatus: TaskSubStatus.CANCELED,
      }),
    );
  });

  it('待验收：3 次提醒后仍未处理 → 已结束-完成（标记成功）', async () => {
    const task = baseTask({
      status: TaskStatus.WAITING,
      subStatus: TaskSubStatus.PENDING_ACCEPT,
      remindCount: 3,
      lastRemindedAt: new Date(Date.now() - TASK_REMIND_INTERVAL_MS - 1),
    });
    tasksRepo.find.mockImplementation(
      (args?: { where?: { subStatus?: TaskSubStatus } }) =>
        Promise.resolve(
          args?.where?.subStatus === TaskSubStatus.PENDING_ACCEPT ? [task] : [],
        ),
    );

    await service.tick();

    expect(taskNotify.notifyTaskOwner).not.toHaveBeenCalled();
    expect(tasksRepo.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 1,
        status: TaskStatus.WAITING,
        subStatus: TaskSubStatus.PENDING_ACCEPT,
      }),
      expect.objectContaining({
        status: TaskStatus.FINISHED,
        subStatus: TaskSubStatus.COMPLETED,
      }),
    );
  });
});
