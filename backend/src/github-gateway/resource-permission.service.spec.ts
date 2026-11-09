import { UserRole, WorkerResourcePermission } from '../common/enums';
import type { User } from '../auth/user.entity';
import type { Worker } from '../workers/worker.entity';
import { GatewayResourcePermissionService } from './resource-permission.service';

function buildService(options: {
  worker?: Partial<Worker> | null;
  user?: Partial<User> | null;
  humanWorker?: Partial<Worker> | null;
}) {
  const workers = {
    findByAgentToken: jest
      .fn()
      .mockResolvedValue(
        options.worker ? ({ id: 1001, ...options.worker } as Worker) : null,
      ),
    findByHumanUserId: jest
      .fn()
      .mockResolvedValue(
        options.humanWorker
          ? ({ id: 1006, ...options.humanWorker } as Worker)
          : null,
      ),
  };
  const auth = {
    getUserByPersonalAgentToken: jest
      .fn()
      .mockResolvedValue(
        options.user ? ({ id: 7, ...options.user } as User) : null,
      ),
  };
  const service = new GatewayResourcePermissionService(
    workers as never,
    auth as never,
  );
  return { service, workers, auth };
}

describe('GatewayResourcePermissionService', () => {
  it('缺少令牌或令牌无效时返回 WORKER_UNAUTHORIZED', async () => {
    const missing = buildService({});
    await expect(missing.service.verify(undefined)).rejects.toMatchObject({
      code: 'WORKER_UNAUTHORIZED',
    });

    const invalid = buildService({});
    await expect(invalid.service.verify('bad-token')).rejects.toMatchObject({
      code: 'WORKER_UNAUTHORIZED',
    });
  });

  it('有效机器人实时返回当前资源权限，身份为 worker', async () => {
    for (const permission of [
      WorkerResourcePermission.NONE,
      WorkerResourcePermission.READ,
      WorkerResourcePermission.WRITE,
    ]) {
      const { service } = buildService({
        worker: { resourcePermission: permission },
      });
      await expect(service.verify('worker-token')).resolves.toEqual({
        workerId: 1001,
        permission,
        identityType: 'worker',
        userId: null,
      });
    }
  });

  it('存量机器人缺失权限时按无权限处理', async () => {
    const { service } = buildService({ worker: {} });
    await expect(service.verify('worker-token')).resolves.toEqual({
      workerId: 1001,
      permission: WorkerResourcePermission.NONE,
      identityType: 'worker',
      userId: null,
    });
  });

  it('管理员真人令牌映射为 write，并返回真人机器人 ID', async () => {
    const { service } = buildService({
      user: { role: UserRole.ADMIN },
      humanWorker: {},
    });
    await expect(service.verify('user-token')).resolves.toEqual({
      workerId: 1006,
      permission: WorkerResourcePermission.WRITE,
      identityType: 'user',
      userId: 7,
    });
  });

  it('成员真人令牌映射为 read', async () => {
    const { service } = buildService({
      user: { role: UserRole.MEMBER },
      humanWorker: {},
    });
    await expect(service.verify('user-token')).resolves.toEqual({
      workerId: 1006,
      permission: WorkerResourcePermission.READ,
      identityType: 'user',
      userId: 7,
    });
  });

  it('真人令牌未命中或用户已停用时返回 WORKER_UNAUTHORIZED', async () => {
    const disabled = buildService({ user: null });
    await expect(
      disabled.service.verify('disabled-token'),
    ).rejects.toMatchObject({ code: 'WORKER_UNAUTHORIZED' });
  });

  it('有效真人缺少真人机器人绑定时返回 WORKER_UNAUTHORIZED', async () => {
    const { service } = buildService({
      user: { role: UserRole.MEMBER },
      humanWorker: null,
    });
    await expect(service.verify('user-token')).rejects.toMatchObject({
      code: 'WORKER_UNAUTHORIZED',
    });
  });

  it('机器人令牌与真人令牌同时命中时机器人优先', async () => {
    const { service, auth } = buildService({
      worker: { resourcePermission: WorkerResourcePermission.READ },
      user: { role: UserRole.ADMIN },
      humanWorker: {},
    });
    await expect(service.verify('shared-token')).resolves.toMatchObject({
      workerId: 1001,
      permission: WorkerResourcePermission.READ,
      identityType: 'worker',
    });
    expect(auth.getUserByPersonalAgentToken).not.toHaveBeenCalled();
  });
});
