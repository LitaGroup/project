import { WorkerRuntime } from '../common/enums';
import { Worker } from './worker.entity';
import { WorkersService } from './workers.service';

/** Worker 仓储桩：内存数组模拟 findOne/create/save/update/query */
function createHarness(initial: Array<Partial<Worker>> = []) {
  const store = initial.map(
    (worker) =>
      ({
        id: 1000,
        enabled: true,
        humanUserName: null,
        avatarUrl: null,
        ...worker,
      }) as Worker,
  );
  let nextId = Math.max(...store.map((worker) => worker.id), 999) + 1;
  const workers = {
    store,
    findOne: jest.fn(({ where }: { where: Partial<Worker> }) => {
      return (
        store.find(
          (worker) =>
            (where.id !== undefined && worker.id === where.id) ||
            (where.name !== undefined && worker.name === where.name) ||
            (where.humanUserId !== undefined &&
              worker.humanUserId === where.humanUserId),
        ) ?? null
      );
    }),
    create: jest.fn(
      (data: Partial<Worker>) => ({ ...data, id: nextId++ }) as Worker,
    ),
    save: jest.fn((worker: Worker) => {
      if (!store.includes(worker)) store.push(worker);
      return worker;
    }),
    update: jest.fn((criteria: { id?: number }, patch: Partial<Worker>) => {
      const target = store.find((worker) => worker.id === criteria.id);
      if (!target) return { affected: 0 };
      Object.assign(target, patch);
      return { affected: 1 };
    }),
    query: jest.fn().mockResolvedValue(undefined),
  };
  const service = new WorkersService(
    workers as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { get: () => undefined } as never,
  );
  return { service, workers };
}

describe('WorkersService 真人机器人', () => {
  it('不存在时创建，名称使用飞书中文名', async () => {
    const { service, workers } = createHarness();

    const worker = await service.ensureHumanWorker({
      id: 1,
      name: '张三',
      enabled: true,
      avatarUrl: 'https://example.com/a.png',
    });

    expect(worker).toMatchObject({
      name: '张三',
      humanUserId: 1,
      humanUserName: '张三',
      runtime: WorkerRuntime.HUMAN,
    });
    expect(workers.store).toHaveLength(1);
    expect(workers.save).toHaveBeenCalledTimes(1);
  });

  it('已存在时复用并跟随飞书中文名改名', async () => {
    const { service, workers } = createHarness([
      {
        id: 1000,
        name: '张三的机器人',
        humanUserId: 1,
        humanUserName: '张三',
        runtime: WorkerRuntime.HUMAN,
      },
    ]);

    const worker = await service.ensureHumanWorker({
      id: 1,
      name: '张三',
      enabled: true,
    });

    expect(workers.store).toHaveLength(1);
    expect(workers.create).not.toHaveBeenCalled();
    expect(workers.update).toHaveBeenCalledWith(
      { id: 1000 },
      expect.objectContaining({ name: '张三' }),
    );
    expect(worker.name).toBe('张三');
  });

  it('重复确保绑定时不重复创建', async () => {
    const { service, workers } = createHarness();
    const user = { id: 1, name: '张三', enabled: true };

    const first = await service.ensureHumanWorker(user);
    const second = await service.ensureHumanWorker(user);

    expect(workers.store).toHaveLength(1);
    expect(workers.save).toHaveBeenCalledTimes(1);
    expect(second.id).toBe(first.id);
  });

  it('名称与他人冲突时稳定追加用户 ID', async () => {
    const { service } = createHarness([
      {
        id: 1200,
        name: '张三',
        humanUserId: null,
        runtime: WorkerRuntime.OPENCODE,
      },
    ]);

    const worker = await service.ensureHumanWorker({
      id: 1,
      name: '张三',
      enabled: true,
    });

    expect(worker.name).toBe('张三#1');
  });
});
