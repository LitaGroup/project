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
      type: '其它',
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
    save: jest.Mock;
    create: jest.Mock;
  };
  let taskTemplatesRepo: { findOne: jest.Mock };
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
      save: jest.fn((task: Task) => Promise.resolve(task)),
      create: jest.fn((task: Partial<Task>) => task),
    };
    taskTemplatesRepo = { findOne: jest.fn() };
    usersRepo = { findOne: jest.fn() };
    dispatchService = {
      addEvent: jest.fn().mockResolvedValue(undefined),
      continueConversation: jest.fn().mockResolvedValue(baseTask()),
      interrupt: jest.fn().mockResolvedValue(baseTask()),
    };
    service = new TasksService(
      tasksRepo as never,
      { find: jest.fn().mockResolvedValue([]) } as never,
      { delete: jest.fn() } as never,
      taskTemplatesRepo as never,
      usersRepo as never,
      { findOne: jest.fn() } as never,
      { findAll: jest.fn().mockResolvedValue([]) } as never,
      { assertExists: jest.fn().mockResolvedValue('其它') } as never,
      dispatchService as never,
      { taskChanged: jest.fn() } as never,
    );
  });

  it('补充需求后回到待识别，并记录一次人工介入', async () => {
    tasksRepo.findOne.mockResolvedValue(baseTask());

    const saved = await service.supplement(1, '  补充材料  ', '张三');

    expect(saved.description).toBe('原始需求\n\n补充材料');
    expect(saved.status).toBe(TaskStatus.WAITING);
    expect(saved.subStatus).toBe(TaskSubStatus.PENDING_IDENTIFY);
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
      '状态变更：等待中-待反馈 → 等待中-待识别（补充需求后重新识别）',
      '张三',
      undefined,
    );
    expect(dispatchService.addEvent).toHaveBeenCalledTimes(2);
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
    );
    expect(dispatchService.continueConversation).toHaveBeenNthCalledWith(
      2,
      1,
      '继续修改',
      '张三',
    );
  });

  it('创建任务保存任务定义关联与名称快照', async () => {
    taskTemplatesRepo.findOne.mockResolvedValue({
      id: 3,
      name: '前端任务定义',
      type: '前端开发',
    });
    tasksRepo.save.mockImplementation((task: Task) => {
      if (!task.id) task.id = 5;
      return Promise.resolve(task);
    });

    const created = await service.create({
      description: '开发活动页',
      type: '前端开发',
      templateId: 3,
      createdById: 8,
    });

    expect(created.templateId).toBe(3);
    expect(created.templateName).toBe('前端任务定义');
    expect(created.code).toBe('TK-0005');
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
