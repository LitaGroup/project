import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { TaskStatus, TaskSubStatus } from '../common/enums';
import type { User } from '../auth/user.entity';
import type { Worker } from '../workers/worker.entity';
import { Task } from './task.entity';
import { TaskDeliveryService } from './task-delivery.service';

describe('TaskDeliveryService 验收 Agent 接口', () => {
  const baseTask = (over: Partial<Task> = {}): Task =>
    ({
      id: 1,
      code: 'TK-0001',
      title: '活动页开发',
      type: '其它',
      status: TaskStatus.WAITING,
      subStatus: TaskSubStatus.PENDING_ACCEPT,
      description: '开发活动页',
      input: null,
      content: null,
      outputSpec: null,
      workPlan: null,
      missingItems: null,
      result: '活动页已完成',
      agentId: 1001,
      schedulerId: null,
      remindCount: 1,
      firstRemindedAt: new Date(),
      lastRemindedAt: new Date(),
      parentId: null,
      rootId: 1,
      createdById: 8,
      createdAt: new Date('2026-10-27T10:00:00+08:00'),
      updatedAt: new Date('2026-10-27T11:00:00+08:00'),
      ...over,
    }) as Task;

  const worker = (over: Partial<Worker> = {}): Worker =>
    ({ id: 1001, name: '前端工程师', ...over }) as Worker;
  const user = (over: Partial<User> = {}): User =>
    ({ id: 8, name: '张三', ...over }) as User;

  let tasksRepo: { findOne: jest.Mock };
  let usersRepo: { findOne: jest.Mock };
  let tasksService: { accept: jest.Mock };
  let dispatchService: {
    applyForAcceptance: jest.Mock;
    continueConversation: jest.Mock;
    addEvent: jest.Mock;
    destroyAcceptedSession: jest.Mock;
  };
  let handoffService: { request: jest.Mock };
  let service: TaskDeliveryService;

  beforeEach(() => {
    tasksRepo = { findOne: jest.fn() };
    usersRepo = { findOne: jest.fn().mockResolvedValue({ name: '张三' }) };
    tasksService = {
      accept: jest.fn((_id: number, operator: string | null) =>
        Promise.resolve(
          baseTask({
            status: TaskStatus.FINISHED,
            subStatus: TaskSubStatus.COMPLETED,
            acceptedBy: operator,
          }),
        ),
      ),
    };
    dispatchService = {
      applyForAcceptance: jest.fn().mockResolvedValue({
        task: baseTask(),
        handoff: {
          path: '/task/20261028/TK-0001/HANDOFF.md',
          url: '/docs/detail/task/20261028/TK-0001/HANDOFF.md',
          title: 'TK-0001 活动页开发 · 任务交付',
        },
      }),
      continueConversation: jest.fn().mockResolvedValue(
        baseTask({
          status: TaskStatus.RUNNING,
          subStatus: TaskSubStatus.EXECUTING,
        }),
      ),
      addEvent: jest.fn().mockResolvedValue(undefined),
      destroyAcceptedSession: jest.fn().mockResolvedValue(undefined),
    };
    handoffService = { request: jest.fn().mockResolvedValue({}) };
    service = new TaskDeliveryService(
      tasksRepo as never,
      usersRepo as never,
      tasksService as never,
      dispatchService as never,
      handoffService as never,
      { get: jest.fn() } as never,
    );
  });

  it('执行机器人申请验收并返回 Markdown', async () => {
    tasksRepo.findOne.mockResolvedValue(baseTask());
    const md = await service.apply(1, worker());

    expect(dispatchService.applyForAcceptance).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ id: 1001 }),
    );
    expect(md).toContain('# 任务验收申请已提交');
    expect(md).toContain('- 状态：等待中-待验收');
    expect(md).toContain('- 执行机器人：前端工程师（1001）');
    expect(md).toContain('- 交付文档：[/task/20261028/TK-0001/HANDOFF.md]');
  });

  it('非当前执行机器人不能申请验收', async () => {
    tasksRepo.findOne.mockResolvedValue(baseTask());
    await expect(
      service.apply(1, worker({ id: 1002, name: '后端工程师' })),
    ).rejects.toThrow(ForbiddenException);
    expect(dispatchService.applyForAcceptance).not.toHaveBeenCalled();
  });

  it('需求方接受验收：完成任务并异步生成总结、销毁会话', async () => {
    tasksRepo.findOne.mockResolvedValue(baseTask());
    const md = await service.reply(1, user(), { action: 'accept' });

    expect(tasksService.accept).toHaveBeenCalledWith(1, '张三');
    expect(handoffService.request).toHaveBeenCalledWith(1);
    expect(dispatchService.destroyAcceptedSession).toHaveBeenCalledWith(1);
    expect(md).toContain('# 任务验收已通过');
    expect(md).toContain('- 状态：已结束-完成');
  });

  it('非需求方不能处理验收反馈', async () => {
    tasksRepo.findOne.mockResolvedValue(baseTask());
    await expect(
      service.reply(1, user({ id: 9, name: '李四' }), { action: 'accept' }),
    ).rejects.toThrow(ForbiddenException);
    expect(tasksService.accept).not.toHaveBeenCalled();
  });

  it('子任务未记录创建人时回退根任务需求方', async () => {
    tasksRepo.findOne.mockImplementation((args: { where: { id: number } }) =>
      Promise.resolve(
        args.where.id === 2
          ? baseTask({ id: 2, rootId: 1, parentId: 1, createdById: null })
          : baseTask({ id: 1, createdById: 8 }),
      ),
    );
    await service.reply(2, user(), { action: 'accept' });
    expect(tasksService.accept).toHaveBeenCalledWith(2, '张三');
  });

  it('拒绝验收必须提供反馈内容', async () => {
    tasksRepo.findOne.mockResolvedValue(baseTask());
    await expect(
      service.reply(1, user(), { action: 'refuse', content: '  ' }),
    ).rejects.toThrow(BadRequestException);
    expect(dispatchService.continueConversation).not.toHaveBeenCalled();
  });

  it('拒绝验收：反馈写回任务并重新执行', async () => {
    tasksRepo.findOne.mockResolvedValue(baseTask());
    const md = await service.reply(1, user(), {
      action: 'refuse',
      content: '缺少加载状态，请补充',
    });

    expect(dispatchService.continueConversation).toHaveBeenCalledWith(
      1,
      '缺少加载状态，请补充',
      '张三',
    );
    expect(dispatchService.addEvent).toHaveBeenCalledWith(
      1,
      '操作',
      '需求方拒绝验收，已退回执行机器人重新处理',
      '张三',
      expect.objectContaining({ deliveryReply: 'refuse' }),
    );
    expect(md).toContain('# 任务验收已拒绝');
    expect(md).toContain('- 状态：进行中-执行中');
  });

  it('非法 action 返回 400', async () => {
    tasksRepo.findOne.mockResolvedValue(baseTask());
    await expect(
      service.reply(1, user(), { action: 'unknown' }),
    ).rejects.toThrow(BadRequestException);
  });
});
