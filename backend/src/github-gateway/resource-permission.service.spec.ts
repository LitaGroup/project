import { WorkerResourcePermission } from '../common/enums';
import type { User } from '../auth/user.entity';
import type { Worker } from '../workers/worker.entity';
import { GatewayResourcePermissionService } from './resource-permission.service';

interface WorkersMock {
  findGatewayWorkerByToken: jest.Mock;
}

/** users 表桩：按 id 查展示列 */
function buildUsersRepo(users: Partial<User>[]) {
  const store = users.map((u, i) => ({ id: i + 1, ...u }) as User);
  return {
    findOne: jest.fn(
      ({ where }: { where: { id: number } }) =>
        store.find((u) => u.id === where.id) ?? null,
    ),
  };
}

function buildService(
  mock: (token: string | undefined) => Promise<Partial<Worker> | null>,
  users: Partial<User>[] = [],
) {
  const workers: WorkersMock = {
    findGatewayWorkerByToken: jest.fn((token: string | undefined) =>
      Promise.resolve(mock(token)),
    ),
  };
  const usersRepo = buildUsersRepo(users);
  return {
    service: new GatewayResourcePermissionService(
      workers as never,
      usersRepo as never,
    ),
    workers,
    usersRepo,
  };
}

describe('GatewayResourcePermissionService', () => {
  it('缺少令牌或令牌无效时返回 WORKER_UNAUTHORIZED', async () => {
    const missing = buildService(() => Promise.resolve(null));
    await expect(missing.service.verify(undefined)).rejects.toMatchObject({
      code: 'WORKER_UNAUTHORIZED',
    });

    const invalid = buildService(() => Promise.resolve(null));
    await expect(invalid.service.verify('bad-token')).rejects.toMatchObject({
      code: 'WORKER_UNAUTHORIZED',
    });
  });

  it('有效机器人实时返回权限与名称（AI 机器人 user=null）', async () => {
    for (const permission of [
      WorkerResourcePermission.NONE,
      WorkerResourcePermission.READ,
      WorkerResourcePermission.WRITE,
    ]) {
      const { service } = buildService(() =>
        Promise.resolve({
          id: 1001,
          name: '数据机器人',
          resourcePermission: permission,
        }),
      );
      await expect(service.verify('worker-token')).resolves.toEqual({
        workerId: 1001,
        workerName: '数据机器人',
        permission,
        user: null,
      });
    }
  });

  it('存量数据缺失权限时按无权限处理', async () => {
    const { service } = buildService(() =>
      Promise.resolve({ id: 1001, name: '数据机器人' }),
    );
    await expect(service.verify('worker-token')).resolves.toEqual({
      workerId: 1001,
      workerName: '数据机器人',
      permission: WorkerResourcePermission.NONE,
      user: null,
    });
  });

  it('真人机器人令牌按其 resourcePermission 判定并返回绑定真人属性', async () => {
    const { service, workers, usersRepo } = buildService(
      (token) =>
        token === 'human-worker-token'
          ? Promise.resolve({
              id: 3,
              name: '张三',
              humanUserId: 1,
              resourcePermission: WorkerResourcePermission.READ,
            })
          : Promise.resolve(null),
      [
        {
          name: '张三',
          avatarUrl: 'https://example.com/a.png',
          email: 'zhangsan@example.com',
          department: '研发部',
        },
      ],
    );
    await expect(service.verify('human-worker-token')).resolves.toEqual({
      workerId: 3,
      workerName: '张三',
      permission: WorkerResourcePermission.READ,
      user: {
        userId: 1,
        name: '张三',
        avatarUrl: 'https://example.com/a.png',
        email: 'zhangsan@example.com',
        department: '研发部',
      },
    });
    expect(workers.findGatewayWorkerByToken).toHaveBeenCalledWith(
      'human-worker-token',
    );
    expect(usersRepo.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 1 } }),
    );
  });

  it('未绑定真人的 AI 机器人不查用户表', async () => {
    const { service, usersRepo } = buildService(() =>
      Promise.resolve({ id: 9, name: 'AI 机器人' }),
    );
    await expect(service.verify('ai-token')).resolves.toMatchObject({
      user: null,
    });
    expect(usersRepo.findOne).not.toHaveBeenCalled();
  });
});
