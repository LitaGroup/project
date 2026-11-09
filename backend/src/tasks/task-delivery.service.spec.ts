import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { TaskStatus, TaskSubStatus } from '../common/enums';
import type { User } from '../auth/user.entity';
import type { Worker } from '../workers/worker.entity';
import { Task } from './task.entity';
import { TaskDeliveryService } from './task-delivery.service';
import { workerRequesterActor } from './task-requester';

describe('TaskDeliveryService 验收 Agent 接口', () => {
  const baseTask = (over: Partial<Task> = {}): Task =>
    ({
      id: 1,
      code: 'TK-0001',
      title: '活动页开发',
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
    notifyRequesterWorkerMessage: jest.Mock;
  };
  let taskChat: { postAssistantMessage: jest.Mock };
  let handoffService: { request: jest.Mock };
  let workerInbox: { completeForChild: jest.Mock };
  let taskDocuments: {
    updateHandoff: jest.Mock;
    readHandoff: jest.Mock;
    renderHandoffMarkdown: jest.Mock;
  };
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
      notifyRequesterWorkerMessage: jest.fn().mockResolvedValue(undefined),
    };
    taskChat = {
      postAssistantMessage: jest
        .fn()
        .mockResolvedValue({ id: 'chat:1:assistant:1' }),
    };
    handoffService = { request: jest.fn().mockResolvedValue({}) };
    workerInbox = {
      completeForChild: jest.fn().mockResolvedValue(undefined),
    };
    taskDocuments = {
      updateHandoff: jest.fn().mockResolvedValue({
        task: baseTask(),
        changed: true,
        document: {
          path: '/task/20261028/TK-0001/HANDOFF',
          url: '/docs/detail/task/20261028/TK-0001/HANDOFF',
          title: 'TK-0001 活动页开发 · 任务交付文档',
          version: 2,
          submittedVersion: null,
          content: '最新正文',
          updatedAt: '2026-10-28T10:00:00+08:00',
          updatedBy: '张三',
        },
      }),
      readHandoff: jest.fn(),
      renderHandoffMarkdown: jest.fn(),
    };
    service = new TaskDeliveryService(
      tasksRepo as never,
      usersRepo as never,
      workersRepo as never,
      tasksService as never,
      dispatchService as never,
      taskChat as never,
      taskDocuments as never,
      handoffService as never,
      taskNotify as never,
      workerInbox as never,
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

  it('需求方编辑交付文档后递增版本并通知 AI 读取最新正文', async () => {
    const task = baseTask({
      status: TaskStatus.RUNNING,
      subStatus: TaskSubStatus.EXECUTING,
    });
    tasksRepo.findOne.mockResolvedValue(task);
    taskDocuments.updateHandoff.mockResolvedValue({
      task,
      changed: true,
      document: {
        path: '/task/20261028/TK-0001/HANDOFF',
        url: '/docs/detail/task/20261028/TK-0001/HANDOFF',
        title: 'TK-0001 活动页开发 · 任务交付文档',
        version: 4,
        submittedVersion: null,
        content: '需求方补充的交付内容',
        updatedAt: '2026-10-28T12:00:00+08:00',
        updatedBy: '张三',
      },
    });

    const document = await service.updateHandoffByUser(1, user(), {
      content: '需求方补充的交付内容',
      baseVersion: 3,
      updatedBy: '张三',
    });

    expect(document.version).toBe(4);
    expect(dispatchService.addEvent).toHaveBeenCalledWith(
      1,
      '操作',
      '交付文档更新至 v4（人工编辑）',
      '张三',
      expect.objectContaining({
        handoffVersion: 4,
        handoffUpdateSource: 'user',
      }),
    );
    expect(dispatchService.continueConversation).toHaveBeenCalledWith(
      1,
      expect.stringContaining('v4'),
      '张三',
      expect.objectContaining({
        perspective: 'requester',
        modelContent: expect.stringContaining('/tasks/1/handoff.md') as string,
      }),
    );
  });

  it('交付文档内容未变化时不重复通知机器人', async () => {
    const task = baseTask({
      status: TaskStatus.RUNNING,
      subStatus: TaskSubStatus.EXECUTING,
    });
    tasksRepo.findOne.mockResolvedValue(task);
    taskDocuments.updateHandoff.mockResolvedValue({
      task,
      changed: false,
      document: {
        path: '/task/20261028/TK-0001/HANDOFF',
        url: '/docs/detail/task/20261028/TK-0001/HANDOFF',
        title: 'TK-0001 活动页开发 · 任务交付文档',
        version: 3,
        submittedVersion: null,
        content: '原内容',
        updatedAt: '2026-10-28T12:00:00+08:00',
        updatedBy: '张三',
      },
    });

    await service.updateHandoffByUser(1, user(), {
      content: '原内容',
      baseVersion: 3,
      updatedBy: '张三',
    });

    expect(dispatchService.addEvent).not.toHaveBeenCalled();
    expect(dispatchService.continueConversation).not.toHaveBeenCalled();
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

  it('机器人需求方验收子任务并结算收件箱事件', async () => {
    tasksRepo.findOne.mockResolvedValue(
      baseTask({ requesterType: 'worker', requesterId: 1001 }),
    );

    await service.acceptHandoff(1, { type: 'worker', worker: worker() });

    expect(tasksService.accept).toHaveBeenCalledWith(1, '前端工程师');
    expect(workerInbox.completeForChild).toHaveBeenCalledWith(1, 'handoff');
    expect(handoffService.request).toHaveBeenCalledWith(1);
    expect(dispatchService.destroyAcceptedSession).toHaveBeenCalledWith(1);
  });

  it('非需求方机器人不能验收子任务', async () => {
    tasksRepo.findOne.mockResolvedValue(
      baseTask({ requesterType: 'worker', requesterId: 1001 }),
    );

    await expect(
      service.acceptHandoff(1, {
        type: 'worker',
        worker: worker({ id: 1002, name: '其他机器人' }),
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(tasksService.accept).not.toHaveBeenCalled();
    expect(workerInbox.completeForChild).not.toHaveBeenCalled();
  });

  it('历史个人 AGENT 需求方由主人的真人机器人验收，操作人记录为真人', async () => {
    tasksRepo.findOne.mockResolvedValue(
      baseTask({ requesterType: 'worker', requesterId: 1036 }),
    );

    await service.acceptHandoff(
      1,
      workerRequesterActor(worker({ id: 1001, name: '张三', humanUserId: 8 }), {
        id: 1036,
        personalAgentUserId: 8,
      }),
    );

    expect(tasksService.accept).toHaveBeenCalledWith(1, '张三');
    expect(workerInbox.completeForChild).toHaveBeenCalledWith(1, 'handoff');
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
      expect.objectContaining({
        modelContent: expect.stringContaining(
          '必须重新调用 POST http://localhost:3100/api/tasks/1/handoff/apply.md',
        ) as string,
      }),
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

  it('执行容量已满时验收返工进入待继续，不并行执行', async () => {
    tasksRepo.findOne.mockResolvedValue(baseTask());
    dispatchService.claimExecution.mockResolvedValue(null);

    const saved = await service.reject(1, user(), '请返工');

    expect(dispatchService.continueConversation).not.toHaveBeenCalled();
    expect(saved.subStatus).toBe(TaskSubStatus.PENDING_RESUME);
    expect(saved.resumePrompt).toContain('请返工');
    expect(saved.resumePrompt).toContain(
      '必须重新调用 POST http://localhost:3100/api/tasks/1/handoff/apply.md',
    );
    expect(dispatchService.addEvent).toHaveBeenCalledWith(
      1,
      '操作',
      '需求方拒绝验收（累计 1 次），机器人执行中任务已达并行上限，已转入等待中-待继续',
      '张三',
      expect.objectContaining({ queued: true }),
    );
  });

  it('累计多次拒绝验收仍退回原执行机器人', async () => {
    tasksRepo.findOne.mockResolvedValue(baseTask({ acceptRejectCount: 3 }));
    const md = await service.reply(1, user(), {
      action: 'refuse',
      content: '仍然缺少错误提示',
    });

    expect(dispatchService.claimExecution).toHaveBeenCalledWith(
      1,
      TaskSubStatus.PENDING_ACCEPT,
    );
    expect(dispatchService.continueConversation).toHaveBeenCalledWith(
      1,
      '仍然缺少错误提示',
      '张三',
      expect.objectContaining({
        modelContent: expect.stringContaining('仍然缺少错误提示') as string,
      }),
    );
    expect(taskNotify.notifyTaskAgentOwner).not.toHaveBeenCalled();
    expect(tasksRepo.update).not.toHaveBeenCalled();
    expect(dispatchService.addEvent).toHaveBeenCalledWith(
      1,
      '操作',
      '需求方拒绝验收（累计 4 次），已退回执行机器人重新处理',
      '张三',
      expect.objectContaining({ acceptRejectCount: 4, queued: false }),
    );
    expect(md).toContain('# 任务验收已拒绝');
    expect(md).not.toContain('转负责人');
    expect(md).toContain('- 累计验收不通过：4 次');
    expect(md).toContain('任务已退回原执行机器人继续处理');
  });

  it('待验收期间发送消息也按验收不通过计数', async () => {
    tasksRepo.findOne.mockResolvedValue(baseTask());
    await service.sendMessage(1, user(), '请补充测试数据');

    expect(dispatchService.continueConversation).toHaveBeenCalledWith(
      1,
      '请补充测试数据',
      '张三',
      expect.objectContaining({
        modelContent: expect.stringContaining(
          '必须重新调用 POST http://localhost:3100/api/tasks/1/handoff/apply.md',
        ) as string,
      }),
    );
    expect(tasksRepo.increment).toHaveBeenCalledWith(
      { id: 1 },
      'acceptRejectCount',
      1,
    );
  });

  it('待验收期间真人执行方仍可发送执行消息并通知机器人需求方', async () => {
    const task = baseTask({
      requesterType: 'worker',
      requesterId: 2002,
      parentId: 9,
    });
    tasksRepo.findOne.mockResolvedValue(task);
    workersRepo.findOne.mockImplementation(
      ({ where }: { where: { humanUserId?: number } }) =>
        Promise.resolve(
          where.humanUserId === 8
            ? { id: 1001, name: '张三', runtime: 'human' }
            : null,
        ),
    );

    const saved = await service.sendMessage(
      1,
      user(),
      '交付后补充说明',
      'responsible',
    );

    expect(taskChat.postAssistantMessage).toHaveBeenCalledWith(
      1,
      '交付后补充说明',
      expect.objectContaining({
        meta: expect.objectContaining({
          humanWorkerMessage: true,
          workerId: 1001,
          perspective: 'responsible',
        }) as unknown,
      }) as unknown,
    );
    expect(dispatchService.addEvent).toHaveBeenCalledWith(
      1,
      '操作',
      '真人机器人在操作台回复',
      '张三',
      { humanWorker: true },
    );
    expect(dispatchService.notifyRequesterWorkerMessage).toHaveBeenCalledWith(
      task,
      '交付后补充说明',
      'chat:1:assistant:1',
    );
    expect(dispatchService.continueConversation).not.toHaveBeenCalled();
    expect(saved.subStatus).toBe(TaskSubStatus.PENDING_ACCEPT);
  });

  it('机器人负责人不能以执行方身份参与任务沟通', async () => {
    tasksRepo.findOne.mockResolvedValue(
      baseTask({
        requesterType: 'worker',
        requesterId: 2002,
        agentId: 2000,
      }),
    );
    workersRepo.findOne.mockImplementation(
      ({ where }: { where: { humanUserId?: number } }) =>
        Promise.resolve(
          where.humanUserId === 8
            ? { id: 1001, name: '张三', runtime: 'human' }
            : null,
        ),
    );

    await expect(
      service.sendMessage(1, user(), '负责人补充说明', 'responsible'),
    ).rejects.toThrow('仅任务的真人执行机器人可以以执行方身份发送消息');
    expect(taskChat.postAssistantMessage).not.toHaveBeenCalled();
  });

  it('无关用户不能以需求方身份参与任务沟通', async () => {
    tasksRepo.findOne.mockResolvedValue(
      baseTask({
        requesterType: 'worker',
        requesterId: 2002,
        agentId: 2000,
      }),
    );
    workersRepo.findOne.mockResolvedValue(null);

    await expect(
      service.sendMessage(1, user(), '无关用户补充需求'),
    ).rejects.toThrow('仅任务需求方可以以需求方身份发送消息');
    expect(dispatchService.continueConversation).not.toHaveBeenCalled();
  });

  it('已结束任务不能发送消息', async () => {
    tasksRepo.findOne.mockResolvedValue(
      baseTask({
        status: TaskStatus.FINISHED,
        subStatus: TaskSubStatus.COMPLETED,
      }),
    );

    await expect(
      service.sendMessage(1, user(), '结束后消息', 'responsible'),
    ).rejects.toThrow('已结束，不能继续发送消息');
  });

  it('非法 action 返回 400', async () => {
    tasksRepo.findOne.mockResolvedValue(baseTask());
    await expect(
      service.reply(1, user(), { action: 'unknown' }),
    ).rejects.toThrow(BadRequestException);
  });
});
