import { TaskStatus, TaskSubStatus } from '../common/enums';
import { Task } from './task.entity';
import { TaskLoopService } from './task-loop.service';
import {
  TASK_REMIND_INTERVAL_MS,
  TASK_REMIND_TIMEOUT_MS,
} from './task-loop.rules';

describe('TaskLoopService', () => {
  const baseTask = (over: Partial<Task> = {}): Task =>
    ({
      id: 1,
      code: 'TK-0001',
      title: '待识别任务',
      type: '其它',
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
      firstRemindedAt: null,
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
  let tasksService: { addEvent: jest.Mock };
  let assignmentService: { assign: jest.Mock };
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
      addEvent: jest.fn().mockResolvedValue(undefined),
    };
    assignmentService = { assign: jest.fn() };
    dispatchService = { dispatch: jest.fn().mockResolvedValue(undefined) };
    taskNotify = {
      notifyTaskOwner: jest
        .fn()
        .mockResolvedValue({ sent: true, ownerName: '张三' }),
    };
    service = new TaskLoopService(
      tasksRepo as never,
      tasksService as never,
      assignmentService as never,
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

  it('待识别 → 平台直接分配 → 机器人接管派发', async () => {
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
    assignmentService.assign.mockResolvedValue({
      type: '前端开发',
      agentId: 3,
      agentName: '前端工程师',
      templateId: 11,
      templateName: '前端任务定义',
      source: 'type-definition',
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
      }),
    );
    expect(assignmentService.assign).toHaveBeenCalledTimes(1);
    expect(tasksRepo.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 1,
        status: TaskStatus.RUNNING,
        subStatus: TaskSubStatus.IDENTIFYING,
      }),
      expect.objectContaining({
        type: '前端开发',
        templateId: 11,
        templateName: '前端任务定义',
        agentId: 3,
      }),
    );
    expect(dispatchService.dispatch).toHaveBeenCalledWith(1, null);
    expect(tasksService.addEvent).toHaveBeenCalledWith(
      1,
      '系统',
      '识别分配完成：前端开发，分配给「前端工程师」（同类型任务定义）',
      null,
      expect.objectContaining({ source: 'type-definition', agentId: 3 }),
    );
  });

  it('无法匹配时标记未知任务并交给系统未知任务定义的机器人派发', async () => {
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
    assignmentService.assign.mockResolvedValue({
      type: '未知任务',
      agentId: 1002,
      agentName: '技术-后端架构师',
      templateId: 6,
      templateName: '未知任务',
      source: 'unknown',
      originalType: '其它',
    });

    await service.tick();
    await flush();

    expect(tasksRepo.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      expect.objectContaining({
        type: '未知任务',
        templateId: 6,
        agentId: 1002,
      }),
    );
    expect(dispatchService.dispatch).toHaveBeenCalledWith(1, null);
  });

  it('系统未知任务定义没有可承接机器人 → 待反馈', async () => {
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
    assignmentService.assign.mockResolvedValue({
      type: '未知任务',
      agentId: null,
      agentName: null,
      templateId: 6,
      templateName: '未知任务',
      source: 'unknown',
      originalType: '其它',
    });

    await service.tick();
    await flush();

    expect(tasksRepo.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      expect.objectContaining({
        status: TaskStatus.WAITING,
        subStatus: TaskSubStatus.PENDING_FEEDBACK,
        missingItems: [
          expect.objectContaining({
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            item: expect.stringContaining('未知任务定义（ID=6）'),
          }),
        ],
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
        firstRemindedAt: expect.any(Date),
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        lastRemindedAt: expect.any(Date),
      }),
    );

    // 30 分钟内不重复提醒
    task.remindCount = 1;
    task.firstRemindedAt = new Date(Date.now() - TASK_REMIND_INTERVAL_MS * 2);
    task.lastRemindedAt = new Date();
    await service.tick();
    expect(taskNotify.notifyTaskOwner).toHaveBeenCalledTimes(1);

    // 超过 30 分钟再次提醒，首次提醒时间保持不变（7 天期限不续期）
    task.lastRemindedAt = new Date(Date.now() - TASK_REMIND_INTERVAL_MS - 1);
    const firstRemindedAt = task.firstRemindedAt;
    await service.tick();
    expect(taskNotify.notifyTaskOwner).toHaveBeenCalledTimes(2);
    expect(tasksRepo.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 1 }),
      expect.objectContaining({ remindCount: 2, firstRemindedAt }),
    );
  });

  it('待反馈：首次提醒满 7 天仍未处理 → 已结束-取消（标记失败）', async () => {
    const task = baseTask({
      status: TaskStatus.WAITING,
      subStatus: TaskSubStatus.PENDING_FEEDBACK,
      remindCount: 42,
      firstRemindedAt: new Date(Date.now() - TASK_REMIND_TIMEOUT_MS),
      // 最近刚提醒过也应到期收尾，7 天期限不随提醒续期
      lastRemindedAt: new Date(Date.now() - TASK_REMIND_INTERVAL_MS + 1),
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

  it('待验收：首次提醒满 7 天仍未处理 → 已结束-完成（标记成功）', async () => {
    const task = baseTask({
      status: TaskStatus.WAITING,
      subStatus: TaskSubStatus.PENDING_ACCEPT,
      remindCount: 42,
      firstRemindedAt: new Date(Date.now() - TASK_REMIND_TIMEOUT_MS - 1),
      lastRemindedAt: new Date(Date.now() - TASK_REMIND_INTERVAL_MS + 1),
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
