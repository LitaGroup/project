import { WorkerResourcePermission } from '../common/enums';
import type { Worker } from '../workers/worker.entity';
import { GatewayResourcePermissionService } from './resource-permission.service';

interface WorkersMock {
  findGatewayWorkerByToken: jest.Mock;
}

function buildService(
  mock: (token: string | undefined) => Promise<Partial<Worker> | null>,
) {
  const workers: WorkersMock = {
    findGatewayWorkerByToken: jest.fn((token: string | undefined) =>
      Promise.resolve(mock(token)),
    ),
  };
  return {
    service: new GatewayResourcePermissionService(workers as never),
    workers,
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

  it('有效机器人或真人令牌实时返回当前资源权限', async () => {
    for (const permission of [
      WorkerResourcePermission.NONE,
      WorkerResourcePermission.READ,
      WorkerResourcePermission.WRITE,
    ]) {
      const { service } = buildService(() =>
        Promise.resolve({ id: 1001, resourcePermission: permission }),
      );
      await expect(service.verify('worker-token')).resolves.toEqual({
        workerId: 1001,
        permission,
      });
    }
  });

  it('存量数据缺失权限时按无权限处理', async () => {
    const { service } = buildService(() => Promise.resolve({ id: 1001 }));
    await expect(service.verify('worker-token')).resolves.toEqual({
      workerId: 1001,
      permission: WorkerResourcePermission.NONE,
    });
  });

  it('真人机器人令牌按其 resourcePermission 判定', async () => {
    const { service, workers } = buildService((token) =>
      token === 'human-worker-token'
        ? Promise.resolve({
            id: 3,
            resourcePermission: WorkerResourcePermission.READ,
          })
        : Promise.resolve(null),
    );
    await expect(service.verify('human-worker-token')).resolves.toEqual({
      workerId: 3,
      permission: WorkerResourcePermission.READ,
    });
    expect(workers.findGatewayWorkerByToken).toHaveBeenCalledWith(
      'human-worker-token',
    );
  });
});
