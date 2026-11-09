import { WorkerResourcePermission } from '../common/enums';
import type { Worker } from '../workers/worker.entity';
import { GatewayResourcePermissionService } from './resource-permission.service';

function buildService(worker: Partial<Worker> | null) {
  return new GatewayResourcePermissionService({
    findByAgentToken: jest
      .fn()
      .mockResolvedValue(worker ? ({ id: 1001, ...worker } as Worker) : null),
  } as never);
}

describe('GatewayResourcePermissionService', () => {
  it('缺少令牌或机器人无效时返回 WORKER_UNAUTHORIZED', async () => {
    const missing = buildService(null);
    await expect(missing.verify(undefined)).rejects.toMatchObject({
      code: 'WORKER_UNAUTHORIZED',
    });

    const invalid = buildService(null);
    await expect(invalid.verify('bad-token')).rejects.toMatchObject({
      code: 'WORKER_UNAUTHORIZED',
    });
  });

  it('有效机器人实时返回当前资源权限', async () => {
    for (const permission of [
      WorkerResourcePermission.NONE,
      WorkerResourcePermission.READ,
      WorkerResourcePermission.WRITE,
    ]) {
      const service = buildService({ resourcePermission: permission });
      await expect(service.verify('worker-token')).resolves.toEqual({
        workerId: 1001,
        permission,
      });
    }
  });

  it('存量数据缺失权限时按无权限处理', async () => {
    const service = buildService({});
    await expect(service.verify('worker-token')).resolves.toEqual({
      workerId: 1001,
      permission: WorkerResourcePermission.NONE,
    });
  });
});
