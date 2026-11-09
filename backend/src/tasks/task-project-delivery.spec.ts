import { IsNull } from 'typeorm';
import { TaskStatus, TaskSubStatus } from '../common/enums';
import { Task } from './task.entity';
import { TasksService } from './tasks.service';
import { SYSTEM_PROJECT_DELIVERY_TASK_TEMPLATE_ID } from './system-task-templates';

describe('TasksService 项目交付任务', () => {
  const task = (over: Partial<Task> = {}): Task =>
    ({
      id: 42,
      code: 'TK-0042',
      title: '技术-项目开发交付',
      templateId: SYSTEM_PROJECT_DELIVERY_TASK_TEMPLATE_ID,
      templateName: '技术-项目开发交付',
      projectId: 3708,
      parentId: null,
      rootId: 42,
      status: TaskStatus.RUNNING,
      subStatus: TaskSubStatus.EXECUTING,
      agentId: 1001,
      description: '项目ID：3708 的实施交付',
      createdAt: new Date('2026-11-09T10:00:00+08:00'),
      updatedAt: new Date('2026-11-09T11:00:00+08:00'),
      ...over,
    }) as Task;

  const tasksRepo = {
    findOne: jest.fn(),
    find: jest.fn(),
    count: jest.fn(),
    save: jest.fn(),
    create: jest.fn((value: Partial<Task>) => value),
    update: jest.fn(),
  };
  const eventsRepo = { find: jest.fn(), findOne: jest.fn() };
  const workersRepo = { findOne: jest.fn() };
  const templatesRepo = { findOne: jest.fn() };
  const usersRepo = { findOne: jest.fn() };
  const dispatchService = {
    addEvent: jest.fn(),
    liveLines: jest.fn(),
  };
  let service: TasksService;

  beforeEach(() => {
    jest.clearAllMocks();
    tasksRepo.findOne.mockResolvedValue(null);
    tasksRepo.find.mockResolvedValue([]);
    tasksRepo.count.mockResolvedValue(0);
    tasksRepo.save.mockImplementation((value: Task) => Promise.resolve(value));
    tasksRepo.create.mockImplementation((value: Partial<Task>) => value);
    eventsRepo.find.mockResolvedValue([]);
    eventsRepo.findOne.mockResolvedValue(null);
    workersRepo.findOne.mockResolvedValue(null);
    templatesRepo.findOne.mockResolvedValue(null);
    usersRepo.findOne.mockResolvedValue(null);
    dispatchService.addEvent.mockResolvedValue(undefined);
    dispatchService.liveLines.mockReturnValue([]);
    service = new TasksService(
      tasksRepo as never,
      eventsRepo as never,
      { delete: jest.fn() } as never,
      templatesRepo as never,
      usersRepo as never,
      workersRepo as never,
      {
        findAll: jest.fn().mockResolvedValue([]),
        findByHumanUserId: jest.fn().mockResolvedValue(null),
      } as never,
      dispatchService as never,
      {
        deleteForTasks: jest.fn(),
        completeForChild: jest.fn(),
        enqueue: jest.fn(),
      } as never,
      { taskChanged: jest.fn() } as never,
    );
  });

  it('按项目和系统任务定义查询最新交付任务及进展', async () => {
    tasksRepo.findOne.mockResolvedValue(task());
    workersRepo.findOne.mockResolvedValue({ id: 1001, name: '项目机器人' });
    eventsRepo.findOne.mockResolvedValue({
      id: 9,
      content: '状态变更：进行中-执行中',
    });
    tasksRepo.count.mockResolvedValue(2);
    dispatchService.liveLines.mockReturnValue(['准备环境', '执行开发计划']);

    const view = await service.findProjectDeliveryTask(3708);

    expect(tasksRepo.findOne).toHaveBeenCalledWith({
      where: {
        projectId: 3708,
        templateId: SYSTEM_PROJECT_DELIVERY_TASK_TEMPLATE_ID,
        parentId: IsNull(),
      },
      order: { id: 'DESC' },
    });
    expect(view).toMatchObject({
      agentName: '项目机器人',
      childCount: 2,
      liveLines: ['准备环境', '执行开发计划'],
    });
    expect(view?.latestEvent?.content).toBe('状态变更：进行中-执行中');
  });

  it('兼容旧任务按固定描述识别并回填项目关联', async () => {
    const legacy = task({ projectId: null });
    tasksRepo.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(legacy);

    const view = await service.findProjectDeliveryTask(3708);

    expect(tasksRepo.findOne).toHaveBeenNthCalledWith(2, {
      where: {
        templateId: SYSTEM_PROJECT_DELIVERY_TASK_TEMPLATE_ID,
        parentId: IsNull(),
        description: '项目ID：3708 的实施交付',
      },
      order: { id: 'DESC' },
    });
    expect(tasksRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 42, projectId: 3708 }),
    );
    expect(view?.task.projectId).toBe(3708);
  });

  it('项目已有交付任务时创建接口直接返回现有任务', async () => {
    const existing = {
      task: task(),
      agentName: '项目机器人',
      latestEvent: null,
      liveLines: [],
      childCount: 0,
    };
    const find = jest
      .spyOn(service, 'findProjectDeliveryTask')
      .mockResolvedValue(existing);
    const create = jest.spyOn(service, 'create');

    const result = await service.ensureProjectDeliveryTask(3708);

    expect(find).toHaveBeenCalledWith(3708);
    expect(create).not.toHaveBeenCalled();
    expect(result).toBe(existing);
  });

  it('项目交付任务已取消时允许重新创建', async () => {
    const canceled = {
      task: task({
        status: TaskStatus.FINISHED,
        subStatus: TaskSubStatus.CANCELED,
      }),
      agentName: '项目机器人',
      latestEvent: null,
      liveLines: [],
      childCount: 0,
    };
    const created = {
      task: task({ id: 43 }),
      agentName: null,
      latestEvent: null,
      liveLines: [],
      childCount: 0,
    };
    jest
      .spyOn(service, 'findProjectDeliveryTask')
      .mockResolvedValueOnce(canceled)
      .mockResolvedValueOnce(created);
    const create = jest.spyOn(service, 'create').mockResolvedValue(task());

    const result = await service.ensureProjectDeliveryTask(3708, {
      userId: 7,
      userName: '张三',
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 3708,
        templateId: SYSTEM_PROJECT_DELIVERY_TASK_TEMPLATE_ID,
      }),
    );
    expect(result).toBe(created);
  });

  it('创建项目交付任务时带上项目、系统定义和固定描述', async () => {
    const created = {
      task: task(),
      agentName: null,
      latestEvent: null,
      liveLines: [],
      childCount: 0,
    };
    jest
      .spyOn(service, 'findProjectDeliveryTask')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(created);
    const create = jest.spyOn(service, 'create').mockResolvedValue(task());

    const result = await service.ensureProjectDeliveryTask(3708, {
      userId: 7,
      userName: '张三',
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 3708,
        templateId: SYSTEM_PROJECT_DELIVERY_TASK_TEMPLATE_ID,
        title: '技术-项目开发交付',
        description: '项目ID：3708 的实施交付',
        createdById: 7,
        operatorName: '张三',
        requesterType: 'user',
        requesterId: 7,
      }),
    );
    expect(result).toBe(created);
  });

  it('创建任务时持久化 projectId', async () => {
    templatesRepo.findOne.mockResolvedValue({
      id: SYSTEM_PROJECT_DELIVERY_TASK_TEMPLATE_ID,
      name: '技术-项目开发交付',
    });

    await service.create({
      projectId: 3708,
      templateId: SYSTEM_PROJECT_DELIVERY_TASK_TEMPLATE_ID,
      title: '技术-项目开发交付',
      description: '项目ID：3708 的实施交付',
      createdById: 7,
      requesterType: 'user',
      requesterId: 7,
    });

    expect(tasksRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 3708,
        templateId: SYSTEM_PROJECT_DELIVERY_TASK_TEMPLATE_ID,
      }),
    );
  });
});
