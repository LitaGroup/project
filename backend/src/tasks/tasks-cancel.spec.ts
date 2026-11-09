import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { User } from '../auth/user.entity';
import { TaskStatus, TaskSubStatus, UserRole } from '../common/enums';
import { Task } from './task.entity';
import { TasksService } from './tasks.service';

/** 取出 mock 调用的首个任务 ID 参数（避免直接使用 any） */
function callIds(mock: jest.Mock): number[] {
  return (mock.mock.calls as Array<[number]>).map(([id]) => id);
}

describe('TasksService 停止任务', () => {
  const baseTask = (over: Partial<Task> = {}): Task =>
    ({
      id: 1,
      code: 'TK-0001',
      title: '父任务',
      type: '其它',
      parentId: null,
      rootId: 1,
      status: TaskStatus.WAITING,
      subStatus: TaskSubStatus.PENDING_ACCEPT,
      requesterType: 'worker',
      requesterId: 1001,
      createdById: 8,
      agentId: 2001,
      executorId: null,
      opencodeSessionId: null,
      ...over,
    }) as Task;

  const user = (over: Partial<User> = {}): User =>
    ({
      id: 8,
      name: '张三',
      role: UserRole.MEMBER,
      ...over,
    }) as User;

  let tasksRepo: {
    findOne: jest.Mock;
    find: jest.Mock;
    save: jest.Mock;
  };
  let workersRepo: { findOne: jest.Mock };
  let workersService: {
    findByHumanUserId: jest.Mock;
    findAll: jest.Mock;
  };
  let dispatchService: {
    addEvent: jest.Mock;
    interrupt: jest.Mock;
    discardQueuedConversations: jest.Mock;
  };
  let workerInbox: {
    completeForChild: jest.Mock;
    enqueue: jest.Mock;
    deleteForTasks: jest.Mock;
  };
  let service: TasksService;

  beforeEach(() => {
    tasksRepo = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn((task: Task) => Promise.resolve(task)),
    };
    workersRepo = { findOne: jest.fn().mockResolvedValue(null) };
    workersService = {
      findByHumanUserId: jest.fn().mockResolvedValue({ id: 1001 }),
      findAll: jest.fn().mockResolvedValue([]),
    };
    dispatchService = {
      addEvent: jest.fn().mockResolvedValue(undefined),
      interrupt: jest.fn().mockResolvedValue(undefined),
      discardQueuedConversations: jest.fn().mockResolvedValue(undefined),
    };
    workerInbox = {
      completeForChild: jest.fn().mockResolvedValue(undefined),
      enqueue: jest.fn().mockResolvedValue(null),
      deleteForTasks: jest.fn(),
    };
    service = new TasksService(
      tasksRepo as never,
      { find: jest.fn().mockResolvedValue([]) } as never,
      { delete: jest.fn() } as never,
      { findOne: jest.fn() } as never,
      { findOne: jest.fn() } as never,
      workersRepo as never,
      workersService as never,
      { assertExists: jest.fn() } as never,
      dispatchService as never,
      workerInbox as never,
      { taskChanged: jest.fn() } as never,
    );
  });

  it('停止父任务时按任务树取消全部未结束后代，保留已结束后代', async () => {
    const root = baseTask({
      status: TaskStatus.RUNNING,
      subStatus: TaskSubStatus.EXECUTING,
    });
    const waitingChild = baseTask({
      id: 2,
      code: 'TK-0002',
      parentId: 1,
      status: TaskStatus.WAITING,
      subStatus: TaskSubStatus.PENDING_ACCEPT,
    });
    const finishedChild = baseTask({
      id: 3,
      code: 'TK-0003',
      parentId: 1,
      status: TaskStatus.FINISHED,
      subStatus: TaskSubStatus.COMPLETED,
    });
    const executingGrandchild = baseTask({
      id: 4,
      code: 'TK-0004',
      parentId: 2,
      status: TaskStatus.RUNNING,
      subStatus: TaskSubStatus.EXECUTING,
    });
    const activeUnderFinished = baseTask({
      id: 5,
      code: 'TK-0005',
      parentId: 3,
      status: TaskStatus.RUNNING,
      subStatus: TaskSubStatus.EXECUTING,
    });
    const children = new Map<number, Task[]>([
      [1, [waitingChild, finishedChild]],
      [2, [executingGrandchild]],
      [3, [activeUnderFinished]],
    ]);
    tasksRepo.findOne.mockResolvedValue(root);
    tasksRepo.find.mockImplementation(
      ({ where }: { where: { parentId: number } }) =>
        Promise.resolve(children.get(where.parentId) ?? []),
    );

    const saved = await service.cancel(1, '管理员');

    expect(saved.status).toBe(TaskStatus.FINISHED);
    expect(saved.subStatus).toBe(TaskSubStatus.CANCELED);
    expect(root.subStatus).toBe(TaskSubStatus.CANCELED);
    expect(waitingChild.subStatus).toBe(TaskSubStatus.CANCELED);
    expect(executingGrandchild.subStatus).toBe(TaskSubStatus.CANCELED);
    expect(activeUnderFinished.subStatus).toBe(TaskSubStatus.CANCELED);
    expect(finishedChild.status).toBe(TaskStatus.FINISHED);
    expect(finishedChild.subStatus).toBe(TaskSubStatus.COMPLETED);
    expect(callIds(dispatchService.interrupt)).toEqual([1, 4, 5]);
    expect(callIds(dispatchService.discardQueuedConversations)).toEqual([
      1, 2, 4, 5,
    ]);
    expect(callIds(workerInbox.completeForChild)).toEqual([1, 2, 4, 5]);
    // 只向树外父任务通知一次；被级联取消的父子任务不再互相唤醒
    expect(workerInbox.enqueue).toHaveBeenCalledTimes(1);
    const enqueued = workerInbox.enqueue.mock.calls[0] as [
      Task,
      string,
      { payload?: { reason?: string } },
    ];
    expect(enqueued[0].id).toBe(1);
    expect(enqueued[1]).toBe('cancelled');
    expect(enqueued[2].payload?.reason).toContain('级联取消');
    expect(dispatchService.addEvent).toHaveBeenCalledTimes(4);
  });

  it('已结束任务不能停止', async () => {
    tasksRepo.findOne.mockResolvedValue(
      baseTask({
        status: TaskStatus.FINISHED,
        subStatus: TaskSubStatus.COMPLETED,
      }),
    );

    await expect(service.cancel(1, '管理员')).rejects.toThrow(
      BadRequestException,
    );
    expect(tasksRepo.save).not.toHaveBeenCalled();
  });

  it('任务发起者可以停止', async () => {
    tasksRepo.findOne.mockResolvedValue(baseTask());

    const saved = await service.cancelForUser(1, user());

    expect(saved.subStatus).toBe(TaskSubStatus.CANCELED);
    expect(workersService.findByHumanUserId).toHaveBeenCalledWith(8);
  });

  it('管理员可以停止与自己无关的任务', async () => {
    tasksRepo.findOne.mockResolvedValue(
      baseTask({ requesterType: 'worker', requesterId: 2001 }),
    );

    const saved = await service.cancelForUser(
      1,
      user({ role: UserRole.ADMIN }),
    );

    expect(saved.subStatus).toBe(TaskSubStatus.CANCELED);
    expect(workersService.findByHumanUserId).not.toHaveBeenCalled();
  });

  it('非发起者的普通成员不能停止', async () => {
    tasksRepo.findOne.mockResolvedValue(
      baseTask({ requesterType: 'worker', requesterId: 2001 }),
    );

    await expect(service.cancelForUser(1, user())).rejects.toThrow(
      ForbiddenException,
    );
    expect(tasksRepo.save).not.toHaveBeenCalled();
  });
});
