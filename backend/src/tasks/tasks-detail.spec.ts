import { BadRequestException } from '@nestjs/common';
import { TaskStatus, TaskSubStatus } from '../common/enums';
import { Task } from './task.entity';
import { TasksService } from './tasks.service';

describe('TasksService 任务详情与对话', () => {
  const baseTask = (over: Partial<Task> = {}): Task =>
    ({
      id: 1,
      code: 'TK-0001',
      title: '任务标题',
      templateId: null,
      templateName: null,
      status: TaskStatus.WAITING,
      subStatus: TaskSubStatus.PENDING_FEEDBACK,
      description: '原始需求',
      input: null,
      content: null,
      outputSpec: null,
      workPlan: null,
      missingItems: [{ item: '补充链接' }],
      agentId: 1001,
      schedulerId: 9,
      handoffPath: null,
      handoffVersion: 0,
      handoffSubmittedVersion: null,
      remindCount: 2,
      firstRemindedAt: new Date(),
      lastRemindedAt: new Date(),
      parentId: null,
      rootId: 1,
      createdAt: new Date('2026-10-27T10:00:00+08:00'),
      updatedAt: new Date('2026-10-27T11:00:00+08:00'),
      ...over,
    }) as Task;

  let tasksRepo: {
    findOne: jest.Mock;
    find: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  let taskTemplatesRepo: { findOne: jest.Mock };
  let eventsRepo: { find: jest.Mock };
  let usersRepo: { findOne: jest.Mock };
  let dispatchService: {
    addEvent: jest.Mock;
    continueConversation: jest.Mock;
    interrupt: jest.Mock;
  };
  let service: TasksService;

  beforeEach(() => {
    tasksRepo = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn((task: Task) => Promise.resolve(task)),
      create: jest.fn((task: Partial<Task>) => task),
      update: jest
        .fn()
        .mockImplementation(
          async (_criteria: unknown, patch: Partial<Task>) => {
            const current = (await tasksRepo.findOne()) as Task;
            Object.assign(current, patch);
            return { affected: 1 };
          },
        ),
    };
    taskTemplatesRepo = { findOne: jest.fn() };
    eventsRepo = { find: jest.fn().mockResolvedValue([]) };
    usersRepo = { findOne: jest.fn() };
    dispatchService = {
      addEvent: jest.fn().mockResolvedValue(undefined),
      continueConversation: jest.fn().mockResolvedValue(baseTask()),
      interrupt: jest.fn().mockResolvedValue(baseTask()),
    };
    service = new TasksService(
      tasksRepo as never,
      eventsRepo as never,
      { delete: jest.fn() } as never,
      taskTemplatesRepo as never,
      usersRepo as never,
      { findOne: jest.fn() } as never,
      { findAll: jest.fn().mockResolvedValue([]) } as never,
      dispatchService as never,
      {
        deleteForTasks: jest.fn(),
        completeForChild: jest.fn(),
        enqueue: jest.fn(),
      } as never,
      { taskChanged: jest.fn() } as never,
    );
  });

  it('补充需求后进入待继续，并记录一次人工介入', async () => {
    tasksRepo.findOne.mockResolvedValue(baseTask());

    const saved = await service.supplement(1, '  补充材料  ', '张三');

    expect(saved.description).toBe('原始需求\n\n补充材料');
    expect(saved.status).toBe(TaskStatus.WAITING);
    expect(saved.subStatus).toBe(TaskSubStatus.PENDING_RESUME);
    expect(saved.missingItems).toBeNull();
    expect(saved.remindCount).toBe(0);
    expect(saved.firstRemindedAt).toBeNull();
    expect(dispatchService.addEvent).toHaveBeenNthCalledWith(
      1,
      1,
      '反馈',
      '补充材料',
      '张三',
      { intervention: true, chat: true },
    );
    expect(dispatchService.addEvent).toHaveBeenNthCalledWith(
      2,
      1,
      '状态变更',
      '状态变更：等待中-待反馈 → 等待中-待继续（补充需求）',
      '张三',
      undefined,
    );
    expect(dispatchService.addEvent).toHaveBeenCalledTimes(2);
  });

  it('未分配机器人的待反馈任务补充后回到待分配', async () => {
    tasksRepo.findOne.mockResolvedValue(baseTask({ agentId: null }));

    const saved = await service.supplement(1, '补充任务定义', '张三');

    expect(saved.subStatus).toBe(TaskSubStatus.PENDING_ASSIGNMENT);
    expect(saved.resumePrompt).toBeNull();
  });

  it('待申请验收收到补充消息后转入待继续，机器人仍有执行容量时恢复', async () => {
    tasksRepo.findOne.mockResolvedValue(
      baseTask({
        subStatus: TaskSubStatus.PENDING_APPLY,
        resumePrompt: null,
      }),
    );

    const saved = await service.supplement(1, '再补一个验收说明', '张三');

    expect(saved.status).toBe(TaskStatus.WAITING);
    expect(saved.subStatus).toBe(TaskSubStatus.PENDING_RESUME);
    expect(saved.resumePrompt).toContain('再补一个验收说明');
    expect(saved.description).toContain('再补一个验收说明');
  });

  it('待继续状态补充消息并入恢复提示，保持待继续', async () => {
    tasksRepo.findOne.mockResolvedValue(
      baseTask({
        subStatus: TaskSubStatus.PENDING_RESUME,
        resumePrompt: '# 提问答复\n\n继续',
      }),
    );

    const saved = await service.supplement(1, '再补充一点说明', '张三');

    expect(saved.subStatus).toBe(TaskSubStatus.PENDING_RESUME);
    expect(saved.resumePrompt).toContain('# 提问答复');
    expect(saved.resumePrompt).toContain('再补充一点说明');
    expect(saved.description).toContain('再补充一点说明');
  });

  it('已结束任务不能继续发送消息', async () => {
    tasksRepo.findOne.mockResolvedValue(
      baseTask({
        status: TaskStatus.FINISHED,
        subStatus: TaskSubStatus.COMPLETED,
      }),
    );

    await expect(service.sendMessage(1, '继续看看', '张三')).rejects.toThrow(
      BadRequestException,
    );
    expect(dispatchService.continueConversation).not.toHaveBeenCalled();
  });

  it('识别阶段发送消息走补充需求，执行阶段走续聊', async () => {
    tasksRepo.findOne.mockResolvedValue(baseTask());
    await service.sendMessage(1, '补充需求', '张三');

    tasksRepo.findOne.mockResolvedValue(
      baseTask({
        status: TaskStatus.RUNNING,
        subStatus: TaskSubStatus.EXECUTING,
      }),
    );
    await service.sendMessage(1, '继续执行', '张三');

    tasksRepo.findOne.mockResolvedValue(
      baseTask({
        status: TaskStatus.WAITING,
        subStatus: TaskSubStatus.PENDING_ACCEPT,
      }),
    );
    await service.sendMessage(1, '继续修改', '张三');

    expect(dispatchService.continueConversation).toHaveBeenNthCalledWith(
      1,
      1,
      '继续执行',
      '张三',
      { actorWorkerId: undefined },
    );
    expect(dispatchService.continueConversation).toHaveBeenNthCalledWith(
      2,
      1,
      '继续修改',
      '张三',
      { actorWorkerId: undefined },
    );
  });

  it('创建任务保存任务定义关联与名称快照', async () => {
    taskTemplatesRepo.findOne.mockResolvedValue({
      id: 3,
      name: '前端任务定义',
    });
    tasksRepo.save.mockImplementation((task: Task) => {
      if (!task.id) task.id = 5;
      return Promise.resolve(task);
    });

    const created = await service.create({
      description: '开发活动页',
      templateId: 3,
      createdById: 8,
    });

    expect(created.templateId).toBe(3);
    expect(created.templateName).toBe('前端任务定义');
    expect(created.code).toBe('TK-0005');
  });

  it('创建任务时不自动生成交付文档', async () => {
    tasksRepo.save.mockImplementation((task: Task) => {
      if (!task.id) task.id = 6;
      return Promise.resolve(task);
    });

    const created = await service.create({
      description: '新任务描述',
      createdById: 8,
    });

    expect(created.handoffPath).toBeNull();
    expect(created.handoffVersion).toBe(0);
    const calls = dispatchService.addEvent.mock.calls as unknown[][];
    const eventMeta = calls[0]?.[4] as Record<string, unknown>;
    expect(eventMeta).not.toHaveProperty('handoffPath');
    expect(eventMeta).not.toHaveProperty('handoffVersion');
  });

  it('曾申请验收的任务返工后仍可验收', async () => {
    tasksRepo.findOne.mockResolvedValue(
      baseTask({
        status: TaskStatus.RUNNING,
        subStatus: TaskSubStatus.EXECUTING,
      }),
    );
    eventsRepo.find.mockResolvedValue([
      { taskId: 1, meta: { deliveryApply: true } },
    ]);

    const saved = await service.accept(1, '验收人');

    expect(saved.status).toBe(TaskStatus.FINISHED);
    expect(saved.subStatus).toBe(TaskSubStatus.COMPLETED);
    expect(tasksRepo.update).toHaveBeenCalledWith(
      {
        id: 1,
        status: TaskStatus.RUNNING,
        subStatus: TaskSubStatus.EXECUTING,
      },
      expect.objectContaining({
        status: TaskStatus.FINISHED,
        subStatus: TaskSubStatus.COMPLETED,
      }),
    );
    expect(dispatchService.addEvent).toHaveBeenCalledWith(
      1,
      '状态变更',
      '状态变更：进行中-执行中 → 已结束-完成',
      '验收人',
      { intervention: true },
    );
  });

  it('从未申请验收的执行中任务不可验收', async () => {
    tasksRepo.findOne.mockResolvedValue(
      baseTask({
        status: TaskStatus.RUNNING,
        subStatus: TaskSubStatus.EXECUTING,
      }),
    );

    await expect(service.accept(1, '验收人')).rejects.toThrow(
      BadRequestException,
    );
    expect(tasksRepo.update).not.toHaveBeenCalled();
  });

  it('完成与取消记录人工介入标记', async () => {
    tasksRepo.findOne.mockResolvedValue(
      baseTask({
        status: TaskStatus.WAITING,
        subStatus: TaskSubStatus.PENDING_ACCEPT,
      }),
    );
    await service.accept(1, '验收人');
    expect(dispatchService.addEvent).toHaveBeenCalledWith(
      1,
      '状态变更',
      '状态变更：等待中-待验收 → 已结束-完成',
      '验收人',
      { intervention: true },
    );

    dispatchService.addEvent.mockClear();
    tasksRepo.findOne.mockResolvedValue(
      baseTask({
        status: TaskStatus.RUNNING,
        subStatus: TaskSubStatus.EXECUTING,
      }),
    );
    await service.cancel(1, '验收人');
    expect(dispatchService.interrupt).toHaveBeenCalledWith(1, '验收人', false);
    expect(dispatchService.addEvent).toHaveBeenCalledWith(
      1,
      '状态变更',
      expect.stringContaining('已结束-取消'),
      '验收人',
      { intervention: true },
    );
  });
});
