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
      acceptRejectCount: 0,
      ownerTakeoverAt: null,
      ownerTakeoverUserId: null,
      ownerTakeoverName: null,
      createdAt: new Date('2026-10-27T10:00:00+08:00'),
      updatedAt: new Date('2026-10-27T11:00:00+08:00'),
      ...over,
    }) as Task;

  const worker = (over: Partial<Worker> = {}): Worker =>
    ({ id: 1001, name: '前端工程师', ...over }) as Worker;
  const user = (over: Partial<User> = {}): User =>
    ({ id: 8, name: '张三', ...over }) as User;

  let tasksRepo: {
    findOne: jest.Mock;
    increment: jest.Mock;
    update: jest.Mock;
  };
  let usersRepo: { findOne: jest.Mock };
  let workersRepo: { findOne: jest.Mock };
  let taskNotify: {
    notifyTaskAgentOwner: jest.Mock;
    notifyTaskRequester: jest.Mock;
  };
  let tasksService: { accept: jest.Mock };
  let dispatchService: {
    applyForAcceptance: jest.Mock;
    continueConversation: jest.Mock;
    claimExecution: jest.Mock;
    addEvent: jest.Mock;
    destroyAcceptedSession: jest.Mock;
  };
  let handoffService: { request: jest.Mock };
  let service: TaskDeliveryService;

  beforeEach(() => {
    tasksRepo = {
      findOne: jest.fn(),
      increment: jest.fn().mockResolvedValue({ affected: 1 }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    tasksRepo.increment.mockImplementation(async () => {
      const task = (await tasksRepo.findOne()) as Task;
      task.acceptRejectCount = (task.acceptRejectCount ?? 0) + 1;
      return { affected: 1 };
    });
    tasksRepo.update.mockImplementation(
      async (_criteria: unknown, patch: Partial<Task>) => {
        const task = (await tasksRepo.findOne()) as Task;
        Object.assign(task, patch);
        return { affected: 1 };
      },
    );
    usersRepo = { findOne: jest.fn().mockResolvedValue({ name: '张三' }) };
    workersRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 1001,
        name: '前端工程师',
        ownerUserId: 9,
        ownerName: '王五',
      }),
    };
    taskNotify = {
      notifyTaskAgentOwner: jest.fn().mockResolvedValue({
        sent: true,
        ownerName: '王五',
      }),
      notifyTaskRequester: jest.fn().mockResolvedValue({ sent: true }),
    };
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
          path: '/task/20261028/TK-0001/HANDOFF',
          url: '/docs/detail/task/20261028/TK-0001/HANDOFF',
          title: 'TK-0001 活动页开发 · 任务交付',
        },
      }),
      continueConversation: jest.fn().mockResolvedValue(
        baseTask({
          status: TaskStatus.RUNNING,
          subStatus: TaskSubStatus.EXECUTING,
        }),
      ),
      claimExecution: jest.fn().mockResolvedValue(
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
      workersRepo as never,
      tasksService as never,
      dispatchService as never,
      handoffService as never,
      taskNotify as never,
      {
        completeForChild: jest.fn().mockResolvedValue(undefined),
      } as never,
      { get: jest.fn() } as never,
    );
  });

  it('执行机器人申请验收并返回 Markdown', async () => {
    tasksRepo.findOne.mockResolvedValue(baseTask());
    const md = await service.apply(1, worker());

    expect(dispatchService.applyForAcceptance).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ id: 1001 }),
      {
        requesterName: '张三',
        report: {},
      },
    );
    expect(md).toContain('# 任务验收申请已提交');
    expect(md).toContain('- 状态：等待中-待验收');
    expect(md).toContain('- 执行机器人：前端工程师（1001）');
    expect(md).toContain('- 交付文档：[/task/20261028/TK-0001/HANDOFF]');
  });

  it('申请验收将结构化交付说明透传给交付文档', async () => {
    tasksRepo.findOne.mockResolvedValue(baseTask());
    await service.apply(1, worker(), {
      delivery: '分支 test',
      followUps: '补充埋点',
    });

    expect(dispatchService.applyForAcceptance).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ id: 1001 }),
      {
        requesterName: '张三',
        report: { delivery: '分支 test', followUps: '补充埋点' },
      },
    );
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
      '需求方拒绝验收（累计 1 次），已退回执行机器人重新处理',
      '张三',
      expect.objectContaining({
        deliveryReply: 'refuse',
        acceptRejectCount: 1,
      }),
    );
    expect(md).toContain('# 任务验收已拒绝');
    expect(md).toContain('- 状态：进行中-执行中');
    expect(md).toContain('- 累计验收不通过：1 次');
  });

  it('机器人忙碌时验收返工进入待继续，不并行执行', async () => {
    tasksRepo.findOne.mockResolvedValue(baseTask());
    dispatchService.claimExecution.mockResolvedValue(null);

    const saved = await service.reject(1, user(), '请返工');

    expect(dispatchService.continueConversation).not.toHaveBeenCalled();
    expect(saved.subStatus).toBe(TaskSubStatus.PENDING_RESUME);
    expect(saved.resumePrompt).toContain('请返工');
    expect(dispatchService.addEvent).toHaveBeenCalledWith(
      1,
      '操作',
      '需求方拒绝验收（累计 1 次），机器人忙碌，已转入等待中-待继续',
      '张三',
      expect.objectContaining({ queued: true }),
    );
  });

  it('第 4 次拒绝验收转负责人待反馈，不再自动派发机器人', async () => {
    tasksRepo.findOne.mockResolvedValue(baseTask({ acceptRejectCount: 3 }));
    const md = await service.reply(1, user(), {
      action: 'refuse',
      content: '仍然缺少错误提示',
    });

    expect(dispatchService.continueConversation).not.toHaveBeenCalled();
    expect(tasksRepo.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 1,
        status: TaskStatus.WAITING,
        subStatus: TaskSubStatus.PENDING_ACCEPT,
      }),
      expect.objectContaining({
        status: TaskStatus.WAITING,
        subStatus: TaskSubStatus.PENDING_FEEDBACK,
        ownerTakeoverUserId: 9,
        ownerTakeoverName: '王五',
        acceptRejectCount: 4,
      }),
    );
    expect(taskNotify.notifyTaskAgentOwner).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, acceptRejectCount: 4 }),
      'feedback',
      expect.stringContaining('任务待负责人处理'),
      expect.stringContaining('仍然缺少错误提示'),
    );
    expect(dispatchService.addEvent).toHaveBeenCalledWith(
      1,
      '状态变更',
      expect.stringContaining('转任务负责人「王五」处理'),
      '张三',
      expect.objectContaining({
        acceptRejectCount: 4,
        ownerTakeover: true,
      }),
    );
    expect(md).toContain('# 任务验收已拒绝并转负责人');
    expect(md).toContain('- 状态：等待中-待反馈');
    expect(md).toContain('- 累计验收不通过：4 次');
  });

  it('待验收期间发送消息也按验收不通过计数', async () => {
    tasksRepo.findOne.mockResolvedValue(baseTask());
    await service.sendMessage(1, user(), '请补充测试数据');

    expect(dispatchService.continueConversation).toHaveBeenCalledWith(
      1,
      '请补充测试数据',
      '张三',
    );
    expect(tasksRepo.increment).toHaveBeenCalledWith(
      { id: 1 },
      'acceptRejectCount',
      1,
    );
  });

  it('非法 action 返回 400', async () => {
    tasksRepo.findOne.mockResolvedValue(baseTask());
    await expect(
      service.reply(1, user(), { action: 'unknown' }),
    ).rejects.toThrow(BadRequestException);
  });
});
