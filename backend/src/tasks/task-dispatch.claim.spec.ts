import { TaskStatus, TaskSubStatus } from '../common/enums';
import { Task } from './task.entity';
import { TaskDispatchService } from './task-dispatch.service';

describe('TaskDispatchService.claimExecution 机器人占用', () => {
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

  function createService(manager: {
    findOne: jest.Mock;
    query: jest.Mock;
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

  it('机器人空闲时加锁并原子进入执行中', async () => {
    const task = waiting();
    const manager = {
      findOne: jest
        .fn()
        .mockResolvedValueOnce(task)
        .mockResolvedValueOnce(task)
        .mockResolvedValueOnce(null),
      query: jest.fn().mockResolvedValue([]),
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
    expect(claimed?.status).toBe(TaskStatus.RUNNING);
    expect(claimed?.subStatus).toBe(TaskSubStatus.EXECUTING);
    expect(claimed?.resumePrompt).toBeNull();
  });

  it('已有其他进行中任务时返回 null，不覆盖等待任务', async () => {
    const task = waiting();
    const manager = {
      findOne: jest
        .fn()
        .mockResolvedValueOnce(task)
        .mockResolvedValueOnce(task)
        .mockResolvedValueOnce({ id: 2, status: TaskStatus.RUNNING }),
      query: jest.fn().mockResolvedValue([]),
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
});
