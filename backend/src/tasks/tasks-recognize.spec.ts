import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  TaskStatus,
  TaskSubStatus,
  TaskType,
  WorkerRole,
} from '../common/enums';
import { Task } from './task.entity';
import { TasksService } from './tasks.service';

describe('TasksService 任务识别技能', () => {
  const baseTask = (over: Partial<Task> = {}): Task =>
    ({
      id: 1,
      code: 'TK-0001',
      title: '待识别任务',
      type: TaskType.OTHER,
      status: TaskStatus.WAITING,
      subStatus: TaskSubStatus.IDENTIFYING,
      description: '帮我做一个活动页',
      input: '活动规则文档链接',
      content: null,
      outputSpec: null,
      workPlan: null,
      missingItems: null,
      agentId: 1001,
      schedulerId: 9,
      remindCount: 0,
      lastRemindedAt: null,
      parentId: null,
      rootId: 1,
      createdAt: new Date('2026-10-27T10:00:00+08:00'),
      updatedAt: new Date('2026-10-27T11:00:00+08:00'),
      ...over,
    }) as Task;

  let tasksRepo: { findOne: jest.Mock; save: jest.Mock };
  let workersRepo: { findOne: jest.Mock };
  let workersService: { findAll: jest.Mock };
  let dispatchService: { addEvent: jest.Mock };
  let service: TasksService;

  beforeEach(() => {
    tasksRepo = {
      findOne: jest.fn(),
      save: jest.fn().mockImplementation((task: Task) => task),
    };
    workersRepo = { findOne: jest.fn() };
    workersService = { findAll: jest.fn().mockResolvedValue([]) };
    dispatchService = { addEvent: jest.fn().mockResolvedValue(undefined) };
    service = new TasksService(
      tasksRepo as never,
      { find: jest.fn().mockResolvedValue([]) } as never,
      {} as never,
      workersRepo as never,
      workersService as never,
      dispatchService as never,
      { taskChanged: jest.fn() } as never,
    );
  });

  describe('recognizeDetailMarkdown', () => {
    it('返回任务识别上下文，并只列出启用中的工作者机器人', async () => {
      const task = baseTask();
      tasksRepo.findOne.mockResolvedValue(task);
      workersService.findAll.mockResolvedValue([
        {
          id: 1001,
          name: '前端工程师',
          intro: '擅长 H5 开发',
          enabled: true,
          role: WorkerRole.WORKER,
        },
        {
          id: 1002,
          name: '已停用机器人',
          intro: '不应出现',
          enabled: false,
          role: WorkerRole.WORKER,
        },
      ]);

      const md = await service.recognizeDetailMarkdown(1);

      expect(md).toContain('update: "2026-10-27 11:00:00"');
      expect(md).toContain('# 待识别任务');
      expect(md).toContain('- 编号：TK-0001');
      expect(md).toContain('- 状态：等待中-识别中');
      expect(md).toContain('- 执行机器人：前端工程师（1001）');
      expect(md).toContain('## 任务输入（用户原始需求）');
      expect(md).toContain('活动规则文档链接');
      expect(md).toContain('## 需求内容（AI 分析整理）');
      expect(md).toContain('## 交付方式');
      expect(md).toContain('（暂无）');
      expect(md).toContain('| 1001 | 前端工程师 | 擅长 H5 开发 |');
      expect(md).not.toContain('已停用机器人');
      expect(workersService.findAll).toHaveBeenCalledWith({
        role: WorkerRole.WORKER,
      });
    });

    it('任务不存在返回 404', async () => {
      tasksRepo.findOne.mockResolvedValue(null);
      await expect(service.recognizeDetailMarkdown(404)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('recognizeUpdateMarkdown', () => {
    it('保存识别字段，不改状态、不清除未传入的机器人和输入', async () => {
      const task = baseTask();
      tasksRepo.findOne.mockResolvedValue(task);
      workersService.findAll.mockResolvedValue([
        { id: 1001, name: '前端工程师', intro: null, enabled: true },
      ]);

      const md = await service.recognizeUpdateMarkdown(
        1,
        {
          title: '活动页开发',
          content: '整理后的需求：开发六一活动页，含登录后跳转与分享埋点',
          outputSpec: '可访问的活动页链接',
          workPlan: '1. 开发页面\n2. 自测',
        },
        '调度机器人负责人',
      );

      expect(task.title).toBe('活动页开发');
      expect(task.content).toBe(
        '整理后的需求：开发六一活动页，含登录后跳转与分享埋点',
      );
      expect(task.outputSpec).toBe('可访问的活动页链接');
      expect(task.workPlan).toBe('1. 开发页面\n2. 自测');
      expect(task.input).toBe('活动规则文档链接');
      expect(task.agentId).toBe(1001);
      expect(task.status).toBe(TaskStatus.WAITING);
      expect(task.subStatus).toBe(TaskSubStatus.IDENTIFYING);
      expect(dispatchService.addEvent).toHaveBeenCalledWith(
        1,
        '操作',
        'AI 更新任务识别信息',
        '调度机器人负责人',
        expect.objectContaining({ agentId: 1001, title: '活动页开发' }),
      );
      expect(md).toContain('# 任务识别信息已更新');
      expect(md).toContain('- 状态：等待中-识别中（识别更新不改变任务状态）');
      expect(md).toContain('- 执行机器人：前端工程师（1001）');
      expect(md).toContain('## 工作计划');
    });

    it('input 传 null 清除输入；agentId 传 null 清除机器人', async () => {
      const task = baseTask({ input: '旧输入' });
      tasksRepo.findOne.mockResolvedValue(task);

      await service.recognizeUpdate(
        1,
        {
          title: '活动页开发',
          content: '整理后的需求',
          input: null,
          outputSpec: '活动页',
          workPlan: '1. 开发',
          agentId: null,
        },
        null,
      );

      expect(task.input).toBeNull();
      expect(task.agentId).toBeNull();
      expect(workersRepo.findOne).not.toHaveBeenCalled();
    });

    it('分配机器人时校验存在、启用且为工作者', async () => {
      const task = baseTask({ agentId: null });
      tasksRepo.findOne.mockResolvedValue(task);

      workersRepo.findOne.mockResolvedValue(null);
      await expect(
        service.recognizeUpdate(
          1,
          {
            title: 'T',
            content: 'C',
            outputSpec: 'O',
            workPlan: 'P',
            agentId: 1002,
          },
          null,
        ),
      ).rejects.toThrow(BadRequestException);

      workersRepo.findOne.mockResolvedValue({ id: 1002, enabled: false });
      await expect(
        service.recognizeUpdate(
          1,
          {
            title: 'T',
            content: 'C',
            outputSpec: 'O',
            workPlan: 'P',
            agentId: 1002,
          },
          null,
        ),
      ).rejects.toThrow(BadRequestException);

      workersRepo.findOne.mockResolvedValue({
        id: 2,
        enabled: true,
        role: WorkerRole.SCHEDULER,
      });
      await expect(
        service.recognizeUpdate(
          1,
          {
            title: 'T',
            content: 'C',
            outputSpec: 'O',
            workPlan: 'P',
            agentId: 2,
          },
          null,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(tasksRepo.save).not.toHaveBeenCalled();
      expect(dispatchService.addEvent).not.toHaveBeenCalled();
    });

    it('必需字段为空返回 400 且不落库', async () => {
      tasksRepo.findOne.mockResolvedValue(baseTask());
      await expect(
        service.recognizeUpdate(
          1,
          { title: '  ', content: 'C', outputSpec: 'O', workPlan: 'P' },
          null,
        ),
      ).rejects.toThrow('任务标题不能为空');
      await expect(
        service.recognizeUpdate(
          1,
          { title: 'T', content: '  ', outputSpec: 'O', workPlan: 'P' },
          null,
        ),
      ).rejects.toThrow('需求内容不能为空');
      await expect(
        service.recognizeUpdate(
          1,
          { title: 'T', content: 'C', outputSpec: '', workPlan: 'P' },
          null,
        ),
      ).rejects.toThrow('交付方式不能为空');
      await expect(
        service.recognizeUpdate(
          1,
          { title: 'T', content: 'C', outputSpec: 'O', workPlan: '   ' },
          null,
        ),
      ).rejects.toThrow('工作计划不能为空');
      expect(tasksRepo.save).not.toHaveBeenCalled();
    });
  });
});
