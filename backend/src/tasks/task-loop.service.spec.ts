import { TaskStatus, TaskSubStatus } from '../common/enums';
import { Task } from './task.entity';
import { TaskLoopService } from './task-loop.service';
import {
  TASK_REMIND_INTERVAL_MS,
  TASK_REMIND_TIMEOUT_MS,
} from './task-loop.rules';
import type { TaskWorkerInbox } from './task-worker-inbox.entity';

describe('TaskLoopService 多机器人协同', () => {
  const baseTask = (over: Partial<Task> = {}): Task =>
    ({
      id: 1,
      code: 'TK-0001',
      title: '协同任务',
      status: TaskStatus.WAITING,
      subStatus: TaskSubStatus.PENDING_ASSIGNMENT,
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
      assignedAt: null,
      offerAttemptAt: null,
      offerStallRemindCount: 0,
      parentId: null,
      rootId: 1,
      requesterType: 'user',
      requesterId: 8,
      ...over,
    }) as Task;

  let tasksRepo: { find: jest.Mock; findOne: jest.Mock; update: jest.Mock };
  let messagesRepo: { find: jest.Mock };
  let tasksService: { addEvent: jest.Mock };
  let assignmentService: { assign: jest.Mock };
  let dispatchService: {
    dispatch: jest.Mock;
    offer: jest.Mock;
    hasExecutionCapacity: jest.Mock;
    taskChatRunning: jest.Mock;
    claimExecution: jest.Mock;
    isHumanWorker: jest.Mock;
  };
  let taskNotify: {
    notifyTaskOwner: jest.Mock;
    notifyTaskRequester: jest.Mock;
    notifyTaskAgentOwner: jest.Mock;
    notifyTaskHumanAssignee: jest.Mock;
  };
  let inbox: {
    listActionable: jest.Mock;
    markQueued: jest.Mock;
    markDelivered: jest.Mock;
    markDead: jest.Mock;
    markDone: jest.Mock;
    completeForChild: jest.Mock;
    reopen: jest.Mock;
    defer: jest.Mock;
    enqueue: jest.Mock;
    hasOpenReference: jest.Mock;
  };
  let requesterVerify: {
    isActive: jest.Mock;
    verify: jest.Mock;
  };
  let requesterReply: {
    isActive: jest.Mock;
    reply: jest.Mock;
  };
  let requesterAnswer: {
    isActive: jest.Mock;
    answer: jest.Mock;
  };
  let releaseNotification: {
    handle: jest.Mock;
  };
  let service: TaskLoopService;

  beforeEach(() => {
    tasksRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    messagesRepo = { find: jest.fn().mockResolvedValue([]) };
    tasksService = { addEvent: jest.fn().mockResolvedValue(undefined) };
    assignmentService = { assign: jest.fn() };
    dispatchService = {
      dispatch: jest.fn().mockResolvedValue(undefined),
      offer: jest.fn().mockResolvedValue(undefined),
      hasExecutionCapacity: jest.fn().mockResolvedValue(true),
      taskChatRunning: jest.fn().mockReturnValue(false),
      claimExecution: jest.fn().mockResolvedValue(
        baseTask({
          status: TaskStatus.RUNNING,
          subStatus: TaskSubStatus.EXECUTING,
          agentId: 1001,
        }),
      ),
      isHumanWorker: jest.fn().mockResolvedValue(false),
    };
    taskNotify = {
      notifyTaskOwner: jest.fn().mockResolvedValue({ sent: true }),
      notifyTaskRequester: jest
        .fn()
        .mockResolvedValue({ sent: true, ownerName: '需求方' }),
      notifyTaskAgentOwner: jest
        .fn()
        .mockResolvedValue({ sent: true, ownerName: '机器人负责人' }),
      notifyTaskHumanAssignee: jest
        .fn()
        .mockResolvedValue({ sent: true, ownerName: '真人执行人' }),
    };
    inbox = {
      listActionable: jest.fn().mockResolvedValue([]),
      markQueued: jest.fn().mockResolvedValue(undefined),
      markDelivered: jest.fn().mockResolvedValue(undefined),
      markDead: jest.fn().mockResolvedValue(undefined),
      markDone: jest.fn().mockResolvedValue(undefined),
      completeForChild: jest.fn().mockResolvedValue(undefined),
      reopen: jest.fn().mockResolvedValue(true),
      defer: jest.fn().mockResolvedValue(undefined),
      enqueue: jest.fn().mockResolvedValue(null),
      hasOpenReference: jest.fn().mockResolvedValue(false),
    };
    requesterVerify = {
      isActive: jest.fn().mockReturnValue(false),
      verify: jest.fn().mockResolvedValue(false),
    };
    requesterReply = {
      isActive: jest.fn().mockReturnValue(false),
      reply: jest.fn().mockResolvedValue(true),
    };
    requesterAnswer = {
      isActive: jest.fn().mockReturnValue(false),
      answer: jest.fn().mockResolvedValue(true),
    };
    releaseNotification = {
      handle: jest.fn().mockResolvedValue(undefined),
    };
    service = new TaskLoopService(
      tasksRepo as never,
      messagesRepo as never,
      tasksService as never,
      assignmentService as never,
      dispatchService as never,
      taskNotify as never,
      inbox as never,
      requesterVerify as never,
      requesterReply as never,
      requesterAnswer as never,
      releaseNotification as never,
      {
        get: jest.fn().mockReturnValue('http://api.example/api'),
      } as never,
    );
    (service as unknown as { ready: boolean }).ready = true;
  });

  function returnForStatus(status: TaskSubStatus, task: Task): void {
    tasksRepo.find.mockImplementation(
      (args?: { where?: { subStatus?: TaskSubStatus } }) =>
        Promise.resolve(args?.where?.subStatus === status ? [task] : []),
    );
  }

  /** 带待接受提醒计数的 update 补丁（用于断言「未计数」） */
  function stallCountPatches(): unknown[][] {
    return (tasksRepo.update.mock.calls as unknown[][]).filter(
      (call) =>
        typeof call[1] === 'object' &&
        call[1] !== null &&
        'offerStallRemindCount' in (call[1] as Record<string, unknown>),
    );
  }

  it('待分配 → 待接受，不直接执行', async () => {
    const task = baseTask();
    returnForStatus(TaskSubStatus.PENDING_ASSIGNMENT, task);
    assignmentService.assign.mockResolvedValue({
      agentId: 3,
      agentName: '前端工程师',
      templateId: 11,
      templateName: '前端任务定义',
      source: 'definition',
    });

    await service.tick();

    expect(tasksRepo.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 1,
        subStatus: TaskSubStatus.PENDING_ASSIGNMENT,
      }),
      expect.objectContaining({
        subStatus: TaskSubStatus.PENDING_ACCEPTANCE,
        templateId: 11,
        agentId: 3,
      }),
    );
    expect(dispatchService.dispatch).not.toHaveBeenCalled();
  });

  it('机器人执行容量已满时保留待分配', async () => {
    const task = baseTask();
    returnForStatus(TaskSubStatus.PENDING_ASSIGNMENT, task);
    assignmentService.assign.mockResolvedValue({
      agentId: 3,
      agentName: '前端工程师',
      templateId: 11,
      templateName: '前端任务定义',
      source: 'definition',
    });
    dispatchService.hasExecutionCapacity.mockResolvedValue(false);

    await service.tick();

    expect(tasksRepo.update).not.toHaveBeenCalled();
    expect(dispatchService.offer).not.toHaveBeenCalled();
  });

  it('待接受任务只发送邀约，不自动进入执行中', async () => {
    const task = baseTask({
      subStatus: TaskSubStatus.PENDING_ACCEPTANCE,
      agentId: 1001,
    });
    returnForStatus(TaskSubStatus.PENDING_ACCEPTANCE, task);

    await service.tick();

    expect(dispatchService.offer).toHaveBeenCalledWith(1);
    expect(dispatchService.dispatch).not.toHaveBeenCalled();
    expect(taskNotify.notifyTaskHumanAssignee).toHaveBeenCalledWith(
      task,
      'notice',
      expect.stringContaining('新任务待处理'),
      expect.stringContaining('工作台'),
    );
  });

  it('待接受邀约重试时不重复通知真人执行人', async () => {
    const task = baseTask({
      subStatus: TaskSubStatus.PENDING_ACCEPTANCE,
      agentId: 1001,
      offerAttemptAt: new Date(Date.now() - 60_000),
    });
    returnForStatus(TaskSubStatus.PENDING_ACCEPTANCE, task);

    await service.tick();

    expect(dispatchService.offer).toHaveBeenCalledWith(1);
    expect(taskNotify.notifyTaskHumanAssignee).not.toHaveBeenCalled();
  });

  // ===== 待接受卡住提醒：只提醒机器人本身、最多 3 次、22:00~08:00 北京时间静默 =====
  // 固定时钟到北京时间 11:00（提醒活跃窗口），避免真实运行时刻影响用例
  const ACTIVE_NOW = new Date('2026-11-11T03:00:00Z');
  const QUIET_NOW = new Date('2026-11-10T15:00:00Z'); // 北京时间 23:00

  it('待接受超过 10 分钟仍未接受：AI 机器人收到重发邀约提醒并计数，不通知负责人', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(ACTIVE_NOW);
    try {
      const task = baseTask({
        subStatus: TaskSubStatus.PENDING_ACCEPTANCE,
        agentId: 1001,
        assignedAt: new Date('2026-11-11T02:49:00Z'),
        offerAttemptAt: new Date('2026-11-11T02:59:50Z'), // 30 秒内，常规重试被节流
      });
      returnForStatus(TaskSubStatus.PENDING_ACCEPTANCE, task);

      await service.tick();

      expect(dispatchService.offer).toHaveBeenCalledWith(1, {
        reminder: true,
      });
      expect(taskNotify.notifyTaskAgentOwner).not.toHaveBeenCalled();
      expect(taskNotify.notifyTaskRequester).not.toHaveBeenCalled();
      expect(tasksRepo.update).toHaveBeenCalledWith(
        {
          id: 1,
          status: TaskStatus.WAITING,
          subStatus: TaskSubStatus.PENDING_ACCEPTANCE,
        },
        { offerStallRemindCount: 1 },
      );
      expect(tasksService.addEvent).toHaveBeenCalledWith(
        1,
        '系统',
        expect.stringContaining('第 1/3 次待接受提醒'),
        null,
        expect.objectContaining({ reason: 'offer-accept-timeout' }),
      );
      expect(tasksRepo.update).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ status: TaskStatus.RUNNING }),
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('待接受卡住提醒最多 3 次，达上限后不再发送也不计数', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(ACTIVE_NOW);
    try {
      const task = baseTask({
        subStatus: TaskSubStatus.PENDING_ACCEPTANCE,
        agentId: 1001,
        assignedAt: new Date('2026-11-11T02:49:00Z'),
        offerAttemptAt: new Date('2026-11-11T02:59:50Z'),
        offerStallRemindCount: 3,
      });
      returnForStatus(TaskSubStatus.PENDING_ACCEPTANCE, task);

      await service.tick();

      expect(dispatchService.offer).not.toHaveBeenCalled();
      expect(taskNotify.notifyTaskHumanAssignee).not.toHaveBeenCalled();
      expect(stallCountPatches()).toHaveLength(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('北京时间 22:00~08:00 静默：卡住提醒不发送、不计数', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(QUIET_NOW);
    try {
      const task = baseTask({
        subStatus: TaskSubStatus.PENDING_ACCEPTANCE,
        agentId: 1001,
        assignedAt: new Date('2026-11-10T14:49:00Z'),
        offerAttemptAt: new Date('2026-11-10T14:59:50Z'),
      });
      returnForStatus(TaskSubStatus.PENDING_ACCEPTANCE, task);

      await service.tick();

      expect(dispatchService.offer).not.toHaveBeenCalled();
      expect(taskNotify.notifyTaskHumanAssignee).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('真人执行机器人卡住：发工作台卡片提醒绑定真人', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(ACTIVE_NOW);
    try {
      dispatchService.isHumanWorker.mockResolvedValue(true);
      const task = baseTask({
        subStatus: TaskSubStatus.PENDING_ACCEPTANCE,
        agentId: 1001,
        assignedAt: new Date('2026-11-11T02:49:00Z'),
        offerAttemptAt: new Date('2026-11-11T02:59:50Z'),
      });
      returnForStatus(TaskSubStatus.PENDING_ACCEPTANCE, task);

      await service.tick();

      expect(taskNotify.notifyTaskHumanAssignee).toHaveBeenCalledWith(
        task,
        'notice',
        expect.stringContaining('任务待接受提醒'),
        expect.stringContaining('工作台'),
      );
      expect(dispatchService.offer).not.toHaveBeenCalled();
      expect(tasksRepo.update).toHaveBeenCalledWith(expect.anything(), {
        offerStallRemindCount: 1,
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('卡住提醒发送失败不计数，仅记日志重试', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(ACTIVE_NOW);
    try {
      dispatchService.offer.mockRejectedValue(new Error('执行器离线'));
      const task = baseTask({
        subStatus: TaskSubStatus.PENDING_ACCEPTANCE,
        agentId: 1001,
        assignedAt: new Date('2026-11-11T02:49:00Z'),
        offerAttemptAt: new Date('2026-11-11T02:59:50Z'),
      });
      returnForStatus(TaskSubStatus.PENDING_ACCEPTANCE, task);

      await service.tick();

      expect(stallCountPatches()).toHaveLength(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('没有可用机器人时进入待反馈', async () => {
    const task = baseTask();
    returnForStatus(TaskSubStatus.PENDING_ASSIGNMENT, task);
    assignmentService.assign.mockResolvedValue({
      agentId: null,
      agentName: null,
      templateId: 6,
      templateName: '未知任务',
      source: 'unknown',
    });

    await service.tick();

    expect(tasksRepo.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      expect.objectContaining({
        subStatus: TaskSubStatus.PENDING_FEEDBACK,
        missingItems: [
          expect.objectContaining({
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            item: expect.stringContaining('未知任务定义（ID=6）'),
          }),
        ],
      }),
    );
  });

  it('子任务待反馈但收件箱缺失时按持久化提问补建事件', async () => {
    const child = baseTask({
      id: 2,
      code: 'TK-0002',
      parentId: 1,
      rootId: 1,
      status: TaskStatus.WAITING,
      subStatus: TaskSubStatus.PENDING_FEEDBACK,
      requesterType: 'worker',
      requesterId: 1001,
    });
    tasksRepo.find.mockImplementation(
      (args?: { where?: { subStatus?: { value?: unknown[] } } }) =>
        Promise.resolve(
          args?.where?.subStatus?.value?.includes(
            TaskSubStatus.PENDING_FEEDBACK,
          )
            ? [child]
            : [],
        ),
    );
    messagesRepo.find.mockResolvedValue([
      {
        taskId: 2,
        kind: 'question',
        question: {
          id: 'project-q1',
          state: 'pending',
          questions: [{ header: '确认', question: '选择哪个方案？' }],
        },
      },
    ]);

    await service.tick();

    expect(inbox.enqueue).toHaveBeenCalledWith(child, 'question', {
      referenceId: 'project-q1',
      payload: {
        questions: [{ header: '确认', question: '选择哪个方案？' }],
      },
    });
  });

  it('待继续任务在机器人仍有执行容量时恢复并投递父机器人事件', async () => {
    const task = baseTask({
      subStatus: TaskSubStatus.PENDING_RESUME,
      agentId: 1001,
      resumePrompt: '# 提问答复\n\n继续',
    });
    returnForStatus(TaskSubStatus.PENDING_RESUME, task);

    await service.tick();

    expect(dispatchService.claimExecution).toHaveBeenCalledWith(
      1,
      TaskSubStatus.PENDING_RESUME,
      { nullIfStateChanged: true },
    );
    expect(dispatchService.dispatch).toHaveBeenCalledWith(
      1,
      null,
      '# 提问答复\n\n继续',
    );
    expect(inbox.markDelivered).toHaveBeenCalledWith(1);
  });

  it('父机器人子任务事件进入待继续上下文', async () => {
    const entry = {
      id: 9,
      parentTaskId: 1,
      workerId: 1001,
      childTaskId: 2,
      kind: 'handoff',
      referenceId: null,
      status: 'pending',
    } as unknown as TaskWorkerInbox;
    const parent = baseTask({
      id: 1,
      agentId: 1001,
      subStatus: TaskSubStatus.PENDING_ACCEPT,
    });
    const child = baseTask({
      id: 2,
      code: 'TK-0002',
      parentId: 1,
      rootId: 1,
      requesterType: 'worker',
      requesterId: 1001,
      subStatus: TaskSubStatus.PENDING_ACCEPT,
    });
    inbox.listActionable.mockResolvedValue([entry]);
    tasksRepo.findOne.mockImplementation(
      ({ where }: { where: { id: number } }) =>
        Promise.resolve(where.id === 1 ? parent : child),
    );

    await service.tick();

    expect(tasksRepo.update).toHaveBeenCalledWith(
      {
        id: 1,
        status: TaskStatus.WAITING,
        subStatus: TaskSubStatus.PENDING_ACCEPT,
      },
      expect.objectContaining({
        subStatus: TaskSubStatus.PENDING_RESUME,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        resumePrompt: expect.stringContaining('子任务协同事件'),
      }),
    );
    expect(inbox.markQueued).toHaveBeenCalledWith(9);
  });

  it('执行中的父任务当前回合已结束时，子任务验收事件会唤醒父机器人', async () => {
    const entry = {
      id: 11,
      parentTaskId: 1,
      workerId: 1001,
      childTaskId: 2,
      kind: 'handoff',
      referenceId: null,
      payload: {
        handoffUrl: '/docs/detail/task/20261103/TK-0002/HANDOFF',
        acceptUrl: 'http://localhost:3100/api/tasks/2/handoff/accept.md',
      },
      status: 'pending',
    } as unknown as TaskWorkerInbox;
    const parent = baseTask({
      id: 1,
      status: TaskStatus.RUNNING,
      subStatus: TaskSubStatus.EXECUTING,
      agentId: 1001,
    });
    const child = baseTask({
      id: 2,
      code: 'TK-0002',
      parentId: 1,
      rootId: 1,
      requesterType: 'worker',
      requesterId: 1001,
      subStatus: TaskSubStatus.PENDING_ACCEPT,
    });
    inbox.listActionable.mockResolvedValue([entry]);
    tasksRepo.findOne.mockImplementation(
      ({ where }: { where: { id: number } }) =>
        Promise.resolve(where.id === 1 ? parent : child),
    );

    await service.tick();

    expect(dispatchService.taskChatRunning).toHaveBeenCalledWith(1);
    expect(tasksRepo.update).toHaveBeenCalledWith(
      {
        id: 1,
        status: TaskStatus.RUNNING,
        subStatus: TaskSubStatus.EXECUTING,
      },
      expect.objectContaining({
        status: TaskStatus.WAITING,
        subStatus: TaskSubStatus.PENDING_RESUME,
        resumePrompt: expect.stringContaining(
          'http://api.example/api/tasks/2/handoff/accept.md',
        ) as string,
      }),
    );
    expect(inbox.markQueued).toHaveBeenCalledWith(11);
    expect(tasksService.addEvent).toHaveBeenCalledWith(
      1,
      '系统',
      expect.stringContaining('子任务 TK-0002 的 handoff 事件已入队'),
      null,
      expect.objectContaining({ childTaskId: 2, inboxId: 11 }),
    );
  });

  it('待申请验收的父任务收到子任务事件后转入待继续', async () => {
    const entry = {
      id: 12,
      parentTaskId: 1,
      workerId: 1001,
      childTaskId: 2,
      kind: 'handoff',
      referenceId: null,
      status: 'pending',
    } as unknown as TaskWorkerInbox;
    const parent = baseTask({
      id: 1,
      status: TaskStatus.WAITING,
      subStatus: TaskSubStatus.PENDING_APPLY,
      agentId: 1001,
    });
    const child = baseTask({
      id: 2,
      code: 'TK-0002',
      parentId: 1,
      rootId: 1,
      requesterType: 'worker',
      requesterId: 1001,
      subStatus: TaskSubStatus.PENDING_ACCEPT,
    });
    inbox.listActionable.mockResolvedValue([entry]);
    tasksRepo.findOne.mockImplementation(
      ({ where }: { where: { id: number } }) =>
        Promise.resolve(where.id === 1 ? parent : child),
    );

    await service.tick();

    expect(tasksRepo.update).toHaveBeenCalledWith(
      {
        id: 1,
        status: TaskStatus.WAITING,
        subStatus: TaskSubStatus.PENDING_APPLY,
      },
      expect.objectContaining({
        subStatus: TaskSubStatus.PENDING_RESUME,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        resumePrompt: expect.stringContaining('子任务协同事件'),
      }),
    );
    expect(inbox.markQueued).toHaveBeenCalledWith(12);
  });

  it('执行中父任务会收到子任务提问正文和完整答复地址', async () => {
    const entry = {
      id: 14,
      parentTaskId: 1,
      workerId: 1001,
      childTaskId: 2,
      kind: 'question',
      referenceId: 'project-q1',
      payload: {
        questions: [
          {
            header: '方案确认',
            question: '使用哪个活动方案？',
            options: [{ label: 'A 方案' }, { label: 'B 方案' }],
            multiple: false,
            custom: true,
          },
        ],
      },
      status: 'pending',
    } as unknown as TaskWorkerInbox;
    const parent = baseTask({
      id: 1,
      status: TaskStatus.RUNNING,
      subStatus: TaskSubStatus.EXECUTING,
      agentId: 1001,
    });
    const child = baseTask({
      id: 2,
      parentId: 1,
      rootId: 1,
      requesterType: 'worker',
      requesterId: 1001,
      subStatus: TaskSubStatus.PENDING_FEEDBACK,
    });
    inbox.listActionable.mockResolvedValue([entry]);
    tasksRepo.findOne.mockImplementation(
      ({ where }: { where: { id: number } }) =>
        Promise.resolve(where.id === 1 ? parent : child),
    );
    let resumePrompt = '';
    tasksRepo.update.mockImplementation(
      (_criteria: unknown, patch: Partial<Task>) => {
        if (patch.resumePrompt) resumePrompt = patch.resumePrompt;
        return Promise.resolve({ affected: 1 });
      },
    );

    await service.tick();

    expect(tasksRepo.update).toHaveBeenCalledWith(
      {
        id: 1,
        status: TaskStatus.RUNNING,
        subStatus: TaskSubStatus.EXECUTING,
      },
      expect.objectContaining({
        status: TaskStatus.WAITING,
        subStatus: TaskSubStatus.PENDING_RESUME,
      }),
    );
    expect(resumePrompt).toContain('使用哪个活动方案？');
    expect(resumePrompt).toContain('A 方案 / B 方案');
    expect(resumePrompt).toContain('允许自由输入');
    expect(resumePrompt).toContain(
      'http://api.example/api/tasks/2/questions/project-q1/answer.md',
    );
    expect(resumePrompt).toContain('只回复消息不会解除');
    expect(inbox.markQueued).toHaveBeenCalledWith(14);
  });

  it('执行中父任务收到子任务执行方消息后注入回复接口并唤醒父机器人', async () => {
    const entry = {
      id: 18,
      parentTaskId: 1,
      workerId: 1001,
      childTaskId: 2,
      kind: 'message',
      referenceId: 'chat:2:assistant:1',
      payload: { content: '需求方请确认这个方案是否可以' },
      status: 'pending',
    } as unknown as TaskWorkerInbox;
    const parent = baseTask({
      id: 1,
      status: TaskStatus.RUNNING,
      subStatus: TaskSubStatus.EXECUTING,
      agentId: 1001,
    });
    const child = baseTask({
      id: 2,
      code: 'TK-0002',
      parentId: 1,
      rootId: 1,
      status: TaskStatus.RUNNING,
      subStatus: TaskSubStatus.EXECUTING,
      agentId: 2002,
      requesterType: 'worker',
      requesterId: 1001,
    });
    inbox.listActionable.mockResolvedValue([entry]);
    tasksRepo.findOne.mockImplementation(
      ({ where }: { where: { id: number } }) =>
        Promise.resolve(where.id === 1 ? parent : child),
    );

    await service.tick();

    expect(tasksRepo.update).toHaveBeenCalledWith(
      {
        id: 1,
        status: TaskStatus.RUNNING,
        subStatus: TaskSubStatus.EXECUTING,
      },
      expect.objectContaining({
        subStatus: TaskSubStatus.PENDING_RESUME,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        resumePrompt: expect.stringContaining('需求方请确认这个方案是否可以'),
      }),
    );
    expect(inbox.markQueued).toHaveBeenCalledWith(18);
  });

  it('根任务执行方消息交给需求方机器人一次性会话回复', async () => {
    const entry = {
      id: 21,
      parentTaskId: 54,
      workerId: 1002,
      childTaskId: 54,
      kind: 'message',
      referenceId: 'chat:54:assistant:1',
      payload: { content: '你问的是 Lita' },
      status: 'pending',
      attempts: 0,
    } as unknown as TaskWorkerInbox;
    const root = baseTask({
      id: 54,
      code: 'TK-0054',
      status: TaskStatus.WAITING,
      subStatus: TaskSubStatus.PENDING_ACCEPTANCE,
      agentId: 1035,
      requesterType: 'worker',
      requesterId: 1002,
    });
    inbox.listActionable.mockResolvedValue([entry]);
    tasksRepo.findOne.mockResolvedValue(root);

    await service.tick();

    expect(requesterReply.reply).toHaveBeenCalledWith(root, entry);
    expect(inbox.markQueued).not.toHaveBeenCalledWith(21);
  });

  it('根任务提问交给需求方机器人一次性会话答复', async () => {
    const entry = {
      id: 31,
      parentTaskId: 54,
      workerId: 1002,
      childTaskId: 54,
      kind: 'question',
      referenceId: 'project-q1',
      payload: { questions: [{ header: '确认', question: '选哪个方案？' }] },
      status: 'pending',
      attempts: 0,
    } as unknown as TaskWorkerInbox;
    const root = baseTask({
      id: 54,
      code: 'TK-0054',
      status: TaskStatus.WAITING,
      subStatus: TaskSubStatus.PENDING_FEEDBACK,
      agentId: 1035,
      requesterType: 'worker',
      requesterId: 1002,
    });
    inbox.listActionable.mockResolvedValue([entry]);
    tasksRepo.findOne.mockResolvedValue(root);

    await service.tick();

    expect(requesterAnswer.answer).toHaveBeenCalledWith(root, entry);
    expect(inbox.markDead).not.toHaveBeenCalledWith(31);
  });

  it('子任务需求方不是父任务执行方时提问走一次性会话而不是丢弃', async () => {
    const entry = {
      id: 32,
      parentTaskId: 1,
      workerId: 1002,
      childTaskId: 2,
      kind: 'question',
      referenceId: 'project-q2',
      payload: { questions: [{ header: '确认', question: '什么时候部署？' }] },
      status: 'pending',
      attempts: 0,
    } as unknown as TaskWorkerInbox;
    const parent = baseTask({
      id: 1,
      status: TaskStatus.WAITING,
      subStatus: TaskSubStatus.PENDING_FEEDBACK,
      agentId: 1001,
    });
    const child = baseTask({
      id: 2,
      code: 'TK-0002',
      parentId: 1,
      rootId: 1,
      status: TaskStatus.WAITING,
      subStatus: TaskSubStatus.PENDING_FEEDBACK,
      agentId: 1082,
      requesterType: 'worker',
      requesterId: 1002,
    });
    inbox.listActionable.mockResolvedValue([entry]);
    tasksRepo.findOne.mockImplementation(
      ({ where }: { where: { id: number } }) =>
        Promise.resolve(where.id === 1 ? parent : child),
    );

    await service.tick();

    expect(requesterAnswer.answer).toHaveBeenCalledWith(child, entry);
    expect(inbox.markDead).not.toHaveBeenCalledWith(32);
  });

  it('父任务已结束的子任务消息仍由需求方机器人一次性会话回复', async () => {
    const entry = {
      id: 33,
      parentTaskId: 1,
      workerId: 1002,
      childTaskId: 2,
      kind: 'message',
      referenceId: 'chat:2:assistant:9',
      payload: { content: '需要你确认下一步' },
      status: 'pending',
      attempts: 0,
    } as unknown as TaskWorkerInbox;
    const parent = baseTask({
      id: 1,
      status: TaskStatus.FINISHED,
      subStatus: TaskSubStatus.COMPLETED,
      agentId: 1001,
    });
    const child = baseTask({
      id: 2,
      code: 'TK-0002',
      parentId: 1,
      rootId: 1,
      status: TaskStatus.RUNNING,
      subStatus: TaskSubStatus.EXECUTING,
      agentId: 1082,
      requesterType: 'worker',
      requesterId: 1002,
    });
    inbox.listActionable.mockResolvedValue([entry]);
    tasksRepo.findOne.mockImplementation(
      ({ where }: { where: { id: number } }) =>
        Promise.resolve(where.id === 1 ? parent : child),
    );

    await service.tick();

    expect(requesterReply.reply).toHaveBeenCalledWith(child, entry);
    expect(inbox.markDead).not.toHaveBeenCalledWith(33);
  });

  it('根任务真人执行方消息缺失收件箱事件时自动补建', async () => {
    const root = baseTask({
      id: 54,
      code: 'TK-0054',
      status: TaskStatus.WAITING,
      subStatus: TaskSubStatus.PENDING_ACCEPTANCE,
      agentId: 1035,
      requesterType: 'worker',
      requesterId: 1002,
    });
    tasksRepo.find.mockResolvedValue([root]);
    messagesRepo.find.mockResolvedValue([
      {
        id: 433,
        taskId: 54,
        messageKey: 'chat:54:assistant:1',
        role: 'assistant',
        sender: { name: '胡峰' },
        content: '你问的是 Lita',
        meta: { humanWorkerMessage: true },
        createdAt: new Date(),
      },
    ]);

    await (
      service as unknown as {
        repairRequesterMessages: () => Promise<void>;
      }
    ).repairRequesterMessages();

    expect(inbox.hasOpenReference).toHaveBeenCalledWith(
      54,
      'message',
      'chat:54:assistant:1',
    );
    expect(inbox.enqueue).toHaveBeenCalledWith(root, 'message', {
      referenceId: 'chat:54:assistant:1',
      payload: { content: '你问的是 Lita' },
    });
  });

  it('子任务提交验收后执行方消息仍会唤醒机器人需求方', async () => {
    const entry = {
      id: 20,
      parentTaskId: 1,
      workerId: 1001,
      childTaskId: 2,
      kind: 'message',
      referenceId: 'chat:2:assistant:3',
      payload: { content: '交付后补充说明' },
      status: 'pending',
    } as unknown as TaskWorkerInbox;
    const parent = baseTask({
      id: 1,
      status: TaskStatus.RUNNING,
      subStatus: TaskSubStatus.EXECUTING,
      agentId: 1001,
    });
    const child = baseTask({
      id: 2,
      code: 'TK-0002',
      parentId: 1,
      rootId: 1,
      status: TaskStatus.WAITING,
      subStatus: TaskSubStatus.PENDING_ACCEPT,
      requesterType: 'worker',
      requesterId: 1001,
    });
    inbox.listActionable.mockResolvedValue([entry]);
    tasksRepo.findOne.mockImplementation(
      ({ where }: { where: { id: number } }) =>
        Promise.resolve(where.id === 1 ? parent : child),
    );

    await service.tick();

    expect(tasksRepo.update).toHaveBeenCalledWith(
      {
        id: 1,
        status: TaskStatus.RUNNING,
        subStatus: TaskSubStatus.EXECUTING,
      },
      expect.objectContaining({
        subStatus: TaskSubStatus.PENDING_RESUME,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        resumePrompt: expect.stringContaining('交付后补充说明'),
      }),
    );
    expect(inbox.markQueued).toHaveBeenCalledWith(20);
  });

  it('子任务已结束时不再唤醒父机器人回复历史消息', async () => {
    const entry = {
      id: 19,
      parentTaskId: 1,
      workerId: 1001,
      childTaskId: 2,
      kind: 'message',
      referenceId: 'chat:2:assistant:2',
      payload: { content: '已结束任务的消息' },
      status: 'pending',
    } as unknown as TaskWorkerInbox;
    const parent = baseTask({
      id: 1,
      status: TaskStatus.RUNNING,
      subStatus: TaskSubStatus.EXECUTING,
      agentId: 1001,
    });
    const child = baseTask({
      id: 2,
      code: 'TK-0002',
      parentId: 1,
      rootId: 1,
      status: TaskStatus.FINISHED,
      subStatus: TaskSubStatus.COMPLETED,
      requesterType: 'worker',
      requesterId: 1001,
    });
    inbox.listActionable.mockResolvedValue([entry]);
    tasksRepo.findOne.mockImplementation(
      ({ where }: { where: { id: number } }) =>
        Promise.resolve(where.id === 1 ? parent : child),
    );

    await service.tick();

    expect(inbox.markDone).toHaveBeenCalledWith(19);
    expect(inbox.markQueued).not.toHaveBeenCalledWith(19);
  });

  it('执行中的父任务当前回合仍在输出时不注入子任务事件', async () => {
    const entry = {
      id: 12,
      parentTaskId: 1,
      workerId: 1001,
      childTaskId: 2,
      kind: 'handoff',
      referenceId: null,
      status: 'pending',
    } as unknown as TaskWorkerInbox;
    const parent = baseTask({
      id: 1,
      status: TaskStatus.RUNNING,
      subStatus: TaskSubStatus.EXECUTING,
      agentId: 1001,
    });
    const child = baseTask({
      id: 2,
      parentId: 1,
      rootId: 1,
      requesterType: 'worker',
      requesterId: 1001,
      subStatus: TaskSubStatus.PENDING_ACCEPT,
    });
    inbox.listActionable.mockResolvedValue([entry]);
    tasksRepo.findOne.mockImplementation(
      ({ where }: { where: { id: number } }) =>
        Promise.resolve(where.id === 1 ? parent : child),
    );
    dispatchService.taskChatRunning.mockReturnValue(true);

    await service.tick();

    expect(tasksRepo.update).not.toHaveBeenCalled();
    expect(inbox.markQueued).not.toHaveBeenCalled();
  });

  it('父任务自身待反馈时不覆盖状态，但记录阻塞并退避重试', async () => {
    const entry = {
      id: 13,
      parentTaskId: 1,
      workerId: 1001,
      childTaskId: 2,
      kind: 'handoff',
      referenceId: null,
      status: 'pending',
    } as unknown as TaskWorkerInbox;
    const parent = baseTask({
      id: 1,
      status: TaskStatus.WAITING,
      subStatus: TaskSubStatus.PENDING_FEEDBACK,
      agentId: 1001,
    });
    const child = baseTask({
      id: 2,
      parentId: 1,
      rootId: 1,
      requesterType: 'worker',
      requesterId: 1001,
      subStatus: TaskSubStatus.PENDING_ACCEPT,
    });
    inbox.listActionable.mockResolvedValue([entry]);
    tasksRepo.findOne.mockImplementation(
      ({ where }: { where: { id: number } }) =>
        Promise.resolve(where.id === 1 ? parent : child),
    );

    await service.tick();

    expect(tasksRepo.update).not.toHaveBeenCalled();
    expect(inbox.markQueued).not.toHaveBeenCalled();
    expect(inbox.defer).toHaveBeenCalledWith(
      13,
      expect.any(Date),
      expect.stringContaining('父任务当前为 等待中-待反馈'),
    );
    expect(tasksService.addEvent).toHaveBeenCalledWith(
      2,
      '系统',
      expect.stringContaining('继续重试'),
      null,
      expect.objectContaining({ watchdog: true, inboxId: 13 }),
    );
  });

  it('父任务待反馈且子任务事件已多次尝试时仍继续等待，不转移需求方', async () => {
    const entry = {
      id: 14,
      parentTaskId: 1,
      workerId: 1001,
      childTaskId: 2,
      kind: 'question',
      referenceId: 'project-q2',
      attempts: 3,
      status: 'pending',
    } as unknown as TaskWorkerInbox;
    const parent = baseTask({
      id: 1,
      status: TaskStatus.WAITING,
      subStatus: TaskSubStatus.PENDING_FEEDBACK,
      agentId: 1001,
    });
    const child = baseTask({
      id: 2,
      parentId: 1,
      rootId: 1,
      requesterType: 'worker',
      requesterId: 1001,
      subStatus: TaskSubStatus.PENDING_FEEDBACK,
    });
    inbox.listActionable.mockResolvedValue([entry]);
    tasksRepo.findOne.mockImplementation(
      ({ where }: { where: { id: number } }) =>
        Promise.resolve(where.id === 1 ? parent : child),
    );

    await service.tick();

    expect(inbox.defer).toHaveBeenCalledWith(
      14,
      expect.any(Date),
      expect.stringContaining('父任务当前为 等待中-待反馈'),
    );
    expect(inbox.markDead).not.toHaveBeenCalledWith(14);
    expect(tasksRepo.update).not.toHaveBeenCalled();
    expect(taskNotify.notifyTaskRequester).not.toHaveBeenCalled();
  });

  it('历史尝试次数超过旧阈值后仍交给父任务处理，不转移需求方', async () => {
    const entry = {
      id: 15,
      parentTaskId: 1,
      workerId: 1001,
      childTaskId: 2,
      kind: 'question',
      referenceId: 'project-q1',
      attempts: 3,
      status: 'pending',
    } as unknown as TaskWorkerInbox;
    const parent = baseTask({
      id: 1,
      status: TaskStatus.RUNNING,
      subStatus: TaskSubStatus.EXECUTING,
      agentId: 1001,
    });
    const child = baseTask({
      id: 2,
      code: 'TK-0002',
      parentId: 1,
      rootId: 3,
      requesterType: 'worker',
      requesterId: 1001,
      subStatus: TaskSubStatus.PENDING_FEEDBACK,
    });
    inbox.listActionable.mockResolvedValue([entry]);
    tasksRepo.findOne.mockImplementation(
      ({ where }: { where: { id: number } }) =>
        Promise.resolve(where.id === 1 ? parent : child),
    );

    await service.tick();

    expect(tasksRepo.update).toHaveBeenCalledWith(
      {
        id: 1,
        status: TaskStatus.RUNNING,
        subStatus: TaskSubStatus.EXECUTING,
      },
      expect.objectContaining({
        status: TaskStatus.WAITING,
        subStatus: TaskSubStatus.PENDING_RESUME,
        resumePrompt: expect.stringContaining('# 子任务协同事件') as string,
      }),
    );
    expect(inbox.markQueued).toHaveBeenCalledWith(15);
    expect(inbox.markDead).not.toHaveBeenCalledWith(15);
    expect(taskNotify.notifyTaskRequester).not.toHaveBeenCalled();
  });

  it('父任务不可用时改用需求方一次性会话推进验收，不转移子任务需求方', async () => {
    const entry = {
      id: 10,
      parentTaskId: 1,
      workerId: 1001,
      childTaskId: 2,
      kind: 'handoff',
      referenceId: null,
      status: 'pending',
      attempts: 0,
    } as unknown as TaskWorkerInbox;
    const child = baseTask({
      id: 2,
      code: 'TK-0002',
      parentId: 1,
      rootId: 3,
      requesterType: 'worker',
      requesterId: 1001,
      subStatus: TaskSubStatus.PENDING_ACCEPT,
    });
    inbox.listActionable.mockResolvedValue([entry]);
    tasksRepo.findOne.mockImplementation(
      ({ where }: { where: { id: number } }) =>
        Promise.resolve(where.id === 2 ? child : null),
    );
    requesterVerify.verify.mockResolvedValue(false);

    await service.tick();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(requesterVerify.verify).toHaveBeenCalledWith(child);
    expect(inbox.markDead).not.toHaveBeenCalledWith(10);
    expect(inbox.defer).toHaveBeenCalledWith(
      10,
      expect.any(Date),
      '需求方机器人自动验收未完成',
    );
    expect(tasksRepo.update).not.toHaveBeenCalled();
    expect(taskNotify.notifyTaskRequester).not.toHaveBeenCalled();
  });

  it('待反馈提醒按 30 分钟节流并通知需求方', async () => {
    const task = baseTask({
      subStatus: TaskSubStatus.PENDING_FEEDBACK,
      missingItems: [{ item: '请提供活动规则' }],
    });
    returnForStatus(TaskSubStatus.PENDING_FEEDBACK, task);

    await service.tick();
    expect(taskNotify.notifyTaskRequester).toHaveBeenCalledTimes(1);

    task.remindCount = 1;
    task.firstRemindedAt = new Date(Date.now() - TASK_REMIND_INTERVAL_MS * 2);
    task.lastRemindedAt = new Date();
    await service.tick();
    expect(taskNotify.notifyTaskRequester).toHaveBeenCalledTimes(1);

    task.lastRemindedAt = new Date(Date.now() - TASK_REMIND_INTERVAL_MS - 1);
    await service.tick();
    expect(taskNotify.notifyTaskRequester).toHaveBeenCalledTimes(2);
  });

  it('待反馈首次提醒满 7 天仍未处理 → 取消', async () => {
    const task = baseTask({
      subStatus: TaskSubStatus.PENDING_FEEDBACK,
      remindCount: 42,
      firstRemindedAt: new Date(Date.now() - TASK_REMIND_TIMEOUT_MS),
      lastRemindedAt: new Date(Date.now() - TASK_REMIND_INTERVAL_MS + 1),
    });
    returnForStatus(TaskSubStatus.PENDING_FEEDBACK, task);

    await service.tick();

    expect(tasksRepo.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      expect.objectContaining({
        status: TaskStatus.FINISHED,
        subStatus: TaskSubStatus.CANCELED,
      }),
    );
  });

  it('待验收提醒发送给任务需求方', async () => {
    const task = baseTask({
      subStatus: TaskSubStatus.PENDING_ACCEPT,
      agentId: 1001,
    });
    returnForStatus(TaskSubStatus.PENDING_ACCEPT, task);

    await service.tick();

    expect(taskNotify.notifyTaskRequester).toHaveBeenCalledWith(
      task,
      'accept',
      expect.stringContaining('任务待验收'),
      expect.any(String),
    );
  });

  it('待验收首次提醒满 7 天仍未处理 → 完成', async () => {
    const task = baseTask({
      subStatus: TaskSubStatus.PENDING_ACCEPT,
      remindCount: 42,
      firstRemindedAt: new Date(Date.now() - TASK_REMIND_TIMEOUT_MS - 1),
      lastRemindedAt: new Date(Date.now() - TASK_REMIND_INTERVAL_MS + 1),
    });
    returnForStatus(TaskSubStatus.PENDING_ACCEPT, task);

    await service.tick();

    expect(tasksRepo.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      expect.objectContaining({
        status: TaskStatus.FINISHED,
        subStatus: TaskSubStatus.COMPLETED,
      }),
    );
  });
});
