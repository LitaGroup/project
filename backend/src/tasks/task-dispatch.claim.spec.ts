import { TaskStatus, TaskSubStatus, WorkerRuntime } from '../common/enums';
import { Task } from './task.entity';
import { TaskDispatchService } from './task-dispatch.service';

describe('TaskDispatchService.claimExecution 执行容量', () => {
  const waiting = (): Task =>
    ({
      id: 1,
      code: 'TK-0001',
      title: '任务',
      agentId: 1001,
      status: TaskStatus.WAITING,
      subStatus: TaskSubStatus.PENDING_ACCEPTANCE,
      remindCount: 1,
      firstRemindedAt: new Date(),
      lastRemindedAt: new Date(),
      resumePrompt: '继续',
    }) as Task;

  const worker = (over?: {
    runtime?: WorkerRuntime;
    maxParallelTasks?: number;
  }) => ({
    id: 1001,
    runtime: WorkerRuntime.OPENCODE,
    maxParallelTasks: 3,
    ...over,
  });

  function createService(manager: {
    findOne: jest.Mock;
    query: jest.Mock;
    count: jest.Mock;
    save: jest.Mock;
  }): TaskDispatchService {
    return new TaskDispatchService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {
        transaction: jest.fn((callback: (value: unknown) => unknown) =>
          Promise.resolve(callback(manager)),
        ),
      } as never,
      { get: jest.fn() } as never,
    );
  }

  it('未达并行上限时加锁并原子进入执行中', async () => {
    const task = waiting();
    const manager = {
      findOne: jest
        .fn()
        .mockResolvedValueOnce(task)
        .mockResolvedValueOnce(worker())
        .mockResolvedValueOnce(task),
      query: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(2),
      save: jest.fn((value: Task) => Promise.resolve(value)),
    };

    const claimed = await createService(manager).claimExecution(
      1,
      TaskSubStatus.PENDING_ACCEPTANCE,
    );

    expect(manager.query).toHaveBeenCalledWith(
      'SELECT id FROM workers WHERE id = $1 FOR UPDATE',
      [1001],
    );
    expect(manager.count).toHaveBeenCalledWith(Task, {
      where: { agentId: 1001, status: TaskStatus.RUNNING },
    });
    expect(claimed?.status).toBe(TaskStatus.RUNNING);
    expect(claimed?.subStatus).toBe(TaskSubStatus.EXECUTING);
    expect(claimed?.resumePrompt).toBeNull();
  });

  it('达到并行上限时返回 null，不覆盖等待任务', async () => {
    const task = waiting();
    const manager = {
      findOne: jest
        .fn()
        .mockResolvedValueOnce(task)
        .mockResolvedValueOnce(worker())
        .mockResolvedValueOnce(task),
      query: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(3),
      save: jest.fn(),
    };

    const claimed = await createService(manager).claimExecution(
      1,
      TaskSubStatus.PENDING_ACCEPTANCE,
    );

    expect(claimed).toBeNull();
    expect(manager.save).not.toHaveBeenCalled();
    expect(task.status).toBe(TaskStatus.WAITING);
  });

  it('自定义并行上限按配置生效', async () => {
    const task = waiting();
    const manager = {
      findOne: jest
        .fn()
        .mockResolvedValueOnce(task)
        .mockResolvedValueOnce(worker({ maxParallelTasks: 1 }))
        .mockResolvedValueOnce(task),
      query: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(1),
      save: jest.fn(),
    };

    const claimed = await createService(manager).claimExecution(
      1,
      TaskSubStatus.PENDING_ACCEPTANCE,
    );

    expect(claimed).toBeNull();
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('真人机器人不受并行上限约束', async () => {
    const task = waiting();
    const manager = {
      findOne: jest
        .fn()
        .mockResolvedValueOnce(task)
        .mockResolvedValueOnce(
          worker({ runtime: WorkerRuntime.HUMAN, maxParallelTasks: 1 }),
        )
        .mockResolvedValueOnce(task),
      query: jest.fn().mockResolvedValue([]),
      count: jest.fn(),
      save: jest.fn((value: Task) => Promise.resolve(value)),
    };

    const claimed = await createService(manager).claimExecution(
      1,
      TaskSubStatus.PENDING_ACCEPTANCE,
    );

    expect(manager.count).not.toHaveBeenCalled();
    expect(claimed?.status).toBe(TaskStatus.RUNNING);
  });
});
