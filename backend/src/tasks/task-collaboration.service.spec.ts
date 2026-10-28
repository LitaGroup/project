import { ConflictException, ForbiddenException } from '@nestjs/common';
import { TaskStatus, TaskSubStatus } from '../common/enums';
import type { User } from '../auth/user.entity';
import type { Worker } from '../workers/worker.entity';
import { Task } from './task.entity';
import { TaskCollaborationService } from './task-collaboration.service';

describe('TaskCollaborationService 多机器人协同动作', () => {
  const worker = { id: 1001, name: '父机器人' } as Worker;
  const user = { id: 8, name: '张三' } as User;
  const baseTask = (over: Partial<Task> = {}): Task =>
    ({
      id: 1,
      code: 'TK-0001',
      title: '协同任务',
      type: '其它',
      status: TaskStatus.WAITING,
      subStatus: TaskSubStatus.PENDING_ACCEPTANCE,
      description: '任务描述',
      input: null,
      outputSpec: null,
      workPlan: null,
      missingItems: null,
      agentId: 1001,
      schedulerId: null,
      parentId: null,
      rootId: 1,
      createdById: 8,
      requesterType: 'user',
      requesterId: 8,
      remindCount: 0,
      firstRemindedAt: null,
      lastRemindedAt: null,
      updatedAt: new Date(),
      ...over,
    }) as Task;

  let task: Task;
  let tasksRepo: {
    findOne: jest.Mock;
    find: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
  };
  let messagesRepo: { findOne: jest.Mock; find: jest.Mock; save: jest.Mock };
  let dispatchService: {
    claimExecution: jest.Mock;
    destroyAcceptedSession: jest.Mock;
  };
  let tasksService: { addEvent: jest.Mock; create: jest.Mock };
  let taskChat: {
    questionAsked: jest.Mock;
    questionSettled: jest.Mock;
  };
  let inbox: { enqueue: jest.Mock; completeForChild: jest.Mock };
  let service: TaskCollaborationService;

  beforeEach(() => {
    task = baseTask();
    tasksRepo = {
      findOne: jest.fn().mockImplementation(() => Promise.resolve(task)),
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn((value: Task) => Promise.resolve(value)),
      update: jest.fn().mockImplementation((_where, patch: Partial<Task>) => {
        Object.assign(task, patch);
        return Promise.resolve({ affected: 1 });
      }),
    };
    messagesRepo = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn((value) => Promise.resolve(value)),
    };
    dispatchService = {
      claimExecution: jest.fn().mockImplementation(() => {
        task.status = TaskStatus.RUNNING;
        task.subStatus = TaskSubStatus.EXECUTING;
        return Promise.resolve(task);
      }),
      destroyAcceptedSession: jest.fn().mockResolvedValue(undefined),
    };
    tasksService = {
      addEvent: jest.fn().mockResolvedValue(undefined),
      create: jest.fn(),
    };
    taskChat = {
      questionAsked: jest.fn().mockResolvedValue(true),
      questionSettled: jest.fn(),
    };
    inbox = {
      enqueue: jest.fn().mockResolvedValue(null),
      completeForChild: jest.fn().mockResolvedValue(undefined),
    };
    service = new TaskCollaborationService(
      tasksRepo as never,
      { find: jest.fn(), findOne: jest.fn() } as never,
      { find: jest.fn(), findOne: jest.fn() } as never,
      messagesRepo as never,
      tasksService as never,
      dispatchService as never,
      {
        acceptHandoff: jest.fn(),
        refuseHandoff: jest.fn(),
      } as never,
      taskChat as never,
      {
        notifyTaskRequester: jest.fn().mockResolvedValue({ sent: true }),
      } as never,
      inbox as never,
    );
  });

  it('负责机器人接受任务后进入执行中', async () => {
    const saved = await service.accept(1, worker);

    expect(saved.status).toBe(TaskStatus.RUNNING);
    expect(saved.subStatus).toBe(TaskSubStatus.EXECUTING);
    expect(dispatchService.claimExecution).toHaveBeenCalledWith(
      1,
      TaskSubStatus.PENDING_ACCEPTANCE,
    );
  });

  it('机器人忙碌时接受返回冲突，不改变等待状态', async () => {
    dispatchService.claimExecution.mockResolvedValue(null);

    await expect(service.accept(1, worker)).rejects.toThrow(ConflictException);
    expect(task.subStatus).toBe(TaskSubStatus.PENDING_ACCEPTANCE);
  });

  it('非负责机器人不能接受任务', async () => {
    await expect(
      service.accept(1, { id: 1002, name: '其他机器人' } as Worker),
    ).rejects.toThrow(ForbiddenException);
  });

  it('待接受拒绝记录理由建议并通知父机器人', async () => {
    task.parentId = 9;
    task.requesterType = 'worker';
    task.requesterId = 9001;

    const saved = await service.refuse(1, worker, '不匹配', '交给后端机器人');

    expect(saved.subStatus).toBe(TaskSubStatus.REFUSED);
    expect(saved.refusalReason).toBe('不匹配');
    expect(saved.dispatchSuggestion).toBe('交给后端机器人');
    expect(inbox.enqueue).toHaveBeenCalledWith(saved, 'refused');
  });

  it('project 提问进入待反馈并写入父机器人收件箱', async () => {
    task.status = TaskStatus.RUNNING;
    task.subStatus = TaskSubStatus.EXECUTING;
    task.parentId = 9;
    task.requesterType = 'worker';
    task.requesterId = 9001;

    const result = await service.ask(1, worker, {
      questions: [{ header: '确认', question: '选择哪个方案？', custom: true }],
    });

    expect(result.questionId).toMatch(/^project-/);
    expect(result.task.subStatus).toBe(TaskSubStatus.PENDING_FEEDBACK);
    expect(taskChat.questionAsked).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ id: result.questionId }),
    );
    expect(inbox.enqueue).toHaveBeenCalledWith(
      result.task,
      'question',
      expect.objectContaining({ referenceId: result.questionId }),
    );
  });

  it('需求方答复后进入待继续并结算问题', async () => {
    task.subStatus = TaskSubStatus.PENDING_FEEDBACK;
    const question = {
      id: 'project-q1',
      sessionId: 'session-1',
      state: 'pending',
      askedAt: new Date().toISOString(),
      questions: [{ header: '确认', question: '继续吗？', custom: true }],
    };
    messagesRepo.findOne.mockResolvedValue({
      taskId: 1,
      messageKey: 'chat:1:question:project-q1',
      question,
      status: 'running',
    });

    const saved = await service.answer(
      1,
      'project-q1',
      { type: 'user', user },
      { answers: [['继续']] },
    );

    expect(saved.subStatus).toBe(TaskSubStatus.PENDING_RESUME);
    expect(saved.resumePrompt).toContain('答：继续');
    expect(messagesRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        question: expect.objectContaining({ state: 'answered' }),
      }),
    );
    expect(taskChat.questionSettled).toHaveBeenCalledWith(
      1,
      'project-q1',
      'answered',
      [['继续']],
    );
  });

  it('非需求方不能答复 project 提问', async () => {
    task.subStatus = TaskSubStatus.PENDING_FEEDBACK;
    await expect(
      service.answer(
        1,
        'project-q1',
        { type: 'user', user: { id: 9, name: '李四' } as User },
        { answers: [['继续']] },
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('仅需求方可将待验收任务判为失败', async () => {
    task.subStatus = TaskSubStatus.PENDING_ACCEPT;
    const saved = await service.fail(1, { type: 'user', user }, '交付不可用');

    expect(saved.status).toBe(TaskStatus.FINISHED);
    expect(saved.subStatus).toBe(TaskSubStatus.FAILED);
    expect(saved.failureReason).toBe('交付不可用');
    expect(inbox.completeForChild).toHaveBeenCalledWith(1, 'handoff');
  });
});
