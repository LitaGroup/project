import { BadRequestException } from '@nestjs/common';
import { TaskStatus, TaskSubStatus, WorkerRole } from '../common/enums';
import { Task } from '../tasks/task.entity';
import { TicketConfig } from './ticket-config.entity';
import { Ticket } from './ticket.entity';
import { TicketsService } from './tickets.service';

describe('TicketsService', () => {
  const user = {
    id: 7,
    name: '张三',
    enabled: true,
  };
  const worker = (id: number, over: Partial<Record<string, unknown>> = {}) => ({
    id,
    name: `机器人${id}`,
    role: WorkerRole.WORKER,
    enabled: true,
    ...over,
  });
  const task = (over: Partial<Task> = {}): Task =>
    ({
      id: 101,
      code: 'TK-0101',
      title: '方案工单',
      type: '工单',
      templateId: 10,
      templateName: '工单-方案工单-调度',
      status: TaskStatus.RUNNING,
      subStatus: TaskSubStatus.EXECUTING,
      agentId: 1001,
      ...over,
    }) as Task;

  let tickets: {
    save: jest.Mock;
    create: jest.Mock;
    findOne: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let configs: { findOne: jest.Mock; find: jest.Mock; save: jest.Mock };
  let tasks: {
    findOne: jest.Mock;
    find: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
  };
  let templates: { findOne: jest.Mock; find: jest.Mock };
  let workers: { find: jest.Mock };
  let tasksService: {
    create: jest.Mock;
    remove: jest.Mock;
    addEvent: jest.Mock;
  };
  let dispatchService: { assign: jest.Mock };
  let service: TicketsService;

  const config = {
    category: '方案工单',
    defaultTemplateId: 10,
    allowedTemplateIds: [1001],
    enabled: true,
  } as TicketConfig;

  beforeEach(() => {
    tickets = {
      save: jest.fn((value: Ticket) => {
        if (!value.id) value.id = 1;
        return Promise.resolve(value);
      }),
      create: jest.fn((value: Partial<Ticket>) => value),
      findOne: jest.fn().mockResolvedValue(null),
      createQueryBuilder: jest.fn(),
    };
    configs = {
      findOne: jest.fn().mockResolvedValue(config),
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn((value: TicketConfig) => Promise.resolve(value)),
    };
    tasks = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn((value: Task) => Promise.resolve(value)),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    templates = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
    };
    workers = { find: jest.fn().mockResolvedValue([]) };
    tasksService = {
      create: jest.fn().mockResolvedValue(task()),
      remove: jest.fn().mockResolvedValue(undefined),
      addEvent: jest.fn().mockResolvedValue(undefined),
    };
    dispatchService = {
      assign: jest.fn().mockResolvedValue(
        task({
          status: TaskStatus.WAITING,
          subStatus: TaskSubStatus.PENDING_ACCEPTANCE,
        }),
      ),
    };
    service = new TicketsService(
      tickets as never,
      configs as never,
      tasks as never,
      templates as never,
      workers as never,
      tasksService as never,
      dispatchService as never,
      { get: jest.fn().mockReturnValue(undefined) } as never,
    );
  });

  it('创建技术工单固定使用 ID=11 定义的首个启用机器人', async () => {
    configs.findOne.mockResolvedValue({
      category: '技术工单',
      defaultTemplateId: 11,
      allowedTemplateIds: [],
      enabled: true,
    });
    templates.findOne.mockResolvedValue({
      id: 11,
      name: '工单-技术工单-调度',
      type: '工单',
      agentIds: [1000, 1001],
    });
    workers.find.mockResolvedValue([
      worker(1000, { enabled: false }),
      worker(1001),
    ]);

    const saved = await service.create(
      {
        category: '技术工单',
        description: '# 需要技术支持\n\n线上问题排查',
      },
      user as never,
    );

    expect(tasksService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: '工单',
        templateId: 11,
        agentId: 1001,
        requesterType: 'user',
        requesterId: 7,
      }),
    );
    expect(tickets.save).toHaveBeenCalled();
    expect(saved).toMatchObject({
      code: 'WO-0001',
      category: '技术工单',
      assigneeType: 'worker',
      assigneeId: 1001,
      assigneeName: '机器人1001',
      taskId: 101,
    });
  });

  it('已关闭的方案工单拒绝创建', async () => {
    await expect(
      service.create(
        {
          category: '方案工单',
          description: '需要设计方案',
        },
        user as never,
      ),
    ).rejects.toThrow('暂未开放创建');
  });

  it('未开放工单类型拒绝创建', async () => {
    await expect(
      service.create(
        {
          category: '数据工单',
          description: '需要数据支持',
        },
        user as never,
      ),
    ).rejects.toThrow('暂未开放创建');
  });

  it('默认任务定义没有启用机器人时拒绝创建', async () => {
    configs.findOne.mockResolvedValue({
      category: '技术工单',
      defaultTemplateId: 11,
      allowedTemplateIds: [],
      enabled: true,
    });
    templates.findOne.mockResolvedValue({
      id: 11,
      name: '工单-技术工单-调度',
      type: '工单',
      agentIds: [1001],
    });
    workers.find.mockResolvedValue([]);

    await expect(
      service.create(
        {
          category: '技术工单',
          description: '需要技术支持',
        },
        user as never,
      ),
    ).rejects.toThrow('没有启用的处理机器人');
    expect(tasksService.create).not.toHaveBeenCalled();
  });

  it('转交工单更新任务定义并强制目标机器人重新接受', async () => {
    tasks.findOne.mockResolvedValue(task({ agentId: 1001 }));
    tickets.findOne.mockResolvedValue({
      id: 1,
      code: 'WO-0001',
      category: '方案工单',
      taskId: 101,
    });
    templates.findOne.mockResolvedValue({
      id: 1001,
      name: '方案设计',
      type: '技术设计',
      agentIds: [1002],
    });
    workers.find.mockResolvedValue([worker(1002)]);

    const routed = await service.routeFromTask(101, worker(1001) as never, {
      templateId: 1001,
      title: '活动方案设计',
      content: '明确后的需求',
      outputSpec: '输出方案文档',
      workPlan: '先分析再设计',
    });

    expect(tasks.save).toHaveBeenCalledWith(
      expect.objectContaining({
        templateId: 1001,
        templateName: '方案设计',
        type: '技术设计',
        content: '明确后的需求',
      }),
    );
    expect(dispatchService.assign).toHaveBeenCalledWith(
      101,
      1002,
      '机器人1001',
      { force: true },
    );
    expect(routed.subStatus).toBe(TaskSubStatus.PENDING_ACCEPTANCE);
  });

  it('转交定义不在配置清单时拒绝', async () => {
    tasks.findOne.mockResolvedValue(task({ agentId: 1001 }));
    tickets.findOne.mockResolvedValue({
      id: 1,
      code: 'WO-0001',
      category: '方案工单',
      taskId: 101,
    });

    await expect(
      service.routeFromTask(101, worker(1001) as never, {
        templateId: 2002,
        title: '标题',
        content: '内容',
        outputSpec: '交付',
        workPlan: '计划',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(dispatchService.assign).not.toHaveBeenCalled();
  });
});
