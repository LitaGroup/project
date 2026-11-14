import { homedir } from 'os';
import { join } from 'path';
import { WorkerRuntime } from '../common/enums';
import { Worker } from './worker.entity';
import { WorkersService } from './workers.service';

/** Worker 仓储桩：内存数组模拟 findOne/create/save/update/query */
function createHarness(
  initial: Array<Partial<Worker>> = [],
  env: Record<string, string | undefined> = {},
) {
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
    {} as never,
    { normalizeWorkerIds: jest.fn().mockResolvedValue([]) } as never,
    { get: (key: string) => env[key] } as never,
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

describe('WorkersService 工作令牌', () => {
  it('个人 AGENT 使用其主人真人机器人的令牌', async () => {
    const { service } = createHarness([
      { id: 2000, personalAgentUserId: 1 },
      { id: 1000, humanUserId: 1, agentToken: 'human-token' },
    ]);
    const human = { id: 1000 } as Worker;
    const findByHumanUserId = jest
      .spyOn(service, 'findByHumanUserId')
      .mockResolvedValue(human);
    const ensureAgentToken = jest
      .spyOn(service, 'ensureAgentToken')
      .mockResolvedValue('human-token');

    await expect(service.ensureWorkToken(2000)).resolves.toBe('human-token');
    expect(findByHumanUserId).toHaveBeenCalledWith(1);
    expect(ensureAgentToken).toHaveBeenCalledWith(1000);
  });

  it('普通机器人使用自身令牌', async () => {
    const { service } = createHarness([{ id: 1000, humanUserId: null }]);
    const ensureAgentToken = jest
      .spyOn(service, 'ensureAgentToken')
      .mockResolvedValue('worker-token');

    await expect(service.ensureWorkToken(1000)).resolves.toBe('worker-token');
    expect(ensureAgentToken).toHaveBeenCalledWith(1000);
  });

  it('真人用户的平台令牌就是其真人机器人令牌', async () => {
    const { service } = createHarness([{ id: 1000, humanUserId: 1 }]);
    jest
      .spyOn(service, 'ensureHumanWorker')
      .mockResolvedValue({ id: 1000 } as Worker);
    const ensureAgentToken = jest
      .spyOn(service, 'ensureAgentToken')
      .mockResolvedValue('human-token');

    await expect(
      service.ensureHumanWorkerToken({ id: 1, name: '张三', enabled: true }),
    ).resolves.toBe('human-token');
    expect(ensureAgentToken).toHaveBeenCalledWith(1000);
  });

  it('重置真人令牌轮换真人机器人的 workers.agentToken', async () => {
    const { service, workers } = createHarness([
      { id: 1000, humanUserId: 1, agentToken: 'old-token' },
    ]);
    jest
      .spyOn(service, 'ensureHumanWorker')
      .mockResolvedValue({ id: 1000 } as Worker);

    const token = await service.resetHumanWorkerToken({
      id: 1,
      name: '张三',
      enabled: true,
    });

    expect(token).toHaveLength(48);
    expect(token).not.toBe('old-token');
    expect(workers.update).toHaveBeenCalledWith(
      { id: 1000 },
      { agentToken: token },
    );
  });

  it('资源网关验权只接受机器人令牌', async () => {
    const { service } = createHarness();
    const worker = { id: 1000 } as Worker;
    const findByAgentToken = jest
      .spyOn(service, 'findByAgentToken')
      .mockResolvedValue(worker);

    await expect(service.findGatewayWorkerByToken('token')).resolves.toBe(
      worker,
    );
    expect(findByAgentToken).toHaveBeenCalledWith('token');
  });
});

describe('WorkersService 工位目录', () => {
  it('生产环境使用 worker 目录', () => {
    const { service } = createHarness([], {
      NODE_ENV: 'production',
      WORKER_BASE_DIR: '/data/opencode-workers',
    });

    expect(service.workdirOf(1001)).toBe('/data/opencode-workers/worker/1001');
  });

  it('开发环境使用 worker-dev 目录', () => {
    const { service } = createHarness([], {
      NODE_ENV: 'development',
      WORKER_BASE_DIR: '/data/opencode-workers',
    });

    expect(service.workdirOf(1001)).toBe(
      '/data/opencode-workers/worker-dev/1001',
    );
  });

  it('未配置 NODE_ENV 时按开发环境处理', () => {
    const { service } = createHarness([], {
      WORKER_BASE_DIR: '/data/opencode-workers',
    });

    expect(service.workdirOf(1001)).toBe(
      '/data/opencode-workers/worker-dev/1001',
    );
  });

  it('开发环境未配置 WORKER_BASE_DIR 时回退到用户主目录 runtime', () => {
    const { service } = createHarness([], { NODE_ENV: 'development' });

    expect(service.workdirOf(1001)).toBe(
      join(homedir(), 'runtime', 'worker-dev', '1001'),
    );
  });

  it('未配置 NODE_ENV 且未配置 WORKER_BASE_DIR 时同样回退开发目录', () => {
    const { service } = createHarness();

    expect(service.workdirOf(1001)).toBe(
      join(homedir(), 'runtime', 'worker-dev', '1001'),
    );
  });

  it('去除工位根目录尾部斜杠', () => {
    const { service } = createHarness([], {
      NODE_ENV: 'production',
      WORKER_BASE_DIR: '/data/opencode-workers/',
    });

    expect(service.workdirOf(1001)).toBe('/data/opencode-workers/worker/1001');
  });

  it('生产环境未配置 WORKER_BASE_DIR 时返回 null', () => {
    const { service } = createHarness([], { NODE_ENV: 'production' });

    expect(service.workdirOf(1001)).toBeNull();
  });
});
