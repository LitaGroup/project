import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WorkerGithubPermission } from '../common/enums';
import { GatewayCredentialService } from './gateway-credential.service';
import { GatewayCredentialError } from './gateway-credential-protocol';
import type { Worker } from '../workers/worker.entity';

describe('GatewayCredentialService', () => {
  const buildService = (
    worker: Partial<Worker> | null,
    decrypt: () => Promise<{
      credentialId: number;
      githubAccount: string;
      pat: string;
    }>,
  ) => {
    const audits = {
      save: jest.fn().mockResolvedValue(undefined),
      create: jest.fn((value: unknown) => value),
    };
    const service = new GatewayCredentialService(
      audits as never,
      {
        findByAgentToken: jest
          .fn()
          .mockResolvedValue(
            worker ? ({ id: 1001, ...worker } as Worker) : null,
          ),
      } as never,
      {
        decryptEnabledPat: jest.fn(decrypt),
      } as never,
      {
        get: (key: string) =>
          key === 'OP_GATEWAY_SHARED_TOKEN' ? 'gateway-token' : undefined,
      } as ConfigService,
    );
    return { service, audits };
  };

  it('缺少 Gateway Token 时拒绝', () => {
    const { service } = buildService(
      { githubPermission: WorkerGithubPermission.DEVELOP },
      () =>
        Promise.resolve({
          credentialId: 1,
          githubAccount: 'ai-developer',
          pat: 'pat',
        }),
    );
    expect(() => service.assertGatewayToken(undefined)).toThrow(
      GatewayCredentialError,
    );
    expect(() => service.assertGatewayToken('bad')).toThrow(
      GatewayCredentialError,
    );
    expect(() => service.assertGatewayToken('gateway-token')).not.toThrow();
  });

  it('开发机器人可获取 git.write，但不能获取审批/合并凭证', async () => {
    const { service } = buildService(
      { githubPermission: WorkerGithubPermission.DEVELOP },
      () =>
        Promise.resolve({
          credentialId: 1,
          githubAccount: 'ai-developer',
          pat: 'pat',
        }),
    );

    const lease = await service.acquire(
      'worker-token',
      {
        credentialType: 'github.pat',
        resource: 'LitaGroup/repo-a.git',
        action: 'git.write',
      },
      'req-1',
    );
    expect(lease.workerId).toBe(1001);
    expect(lease.credential.data).toMatchObject({
      host: 'github.com',
      username: 'ai-developer',
    });
    // 明文不得进入日志可读字段之外的结构说明；这里只确认存在并类型正确
    expect(typeof lease.credential.data.token).toBe('string');
    expect(lease.leaseId).toMatch(/^lease_/);

    await expect(
      service.acquire('worker-token', {
        credentialType: 'github.pat',
        resource: 'LitaGroup/repo-a',
        action: 'gh.pr.approve',
      }),
    ).rejects.toMatchObject({ code: 'ACTION_FORBIDDEN' });
    await expect(
      service.acquire('worker-token', {
        credentialType: 'github.pat',
        resource: 'LitaGroup/repo-a',
        action: 'gh.pr.merge',
      }),
    ).rejects.toMatchObject({ code: 'ACTION_FORBIDDEN' });
  });

  it('发布权限机器人可获取审批/合并凭证', async () => {
    const { service } = buildService(
      { githubPermission: WorkerGithubPermission.RELEASE },
      () =>
        Promise.resolve({
          credentialId: 2,
          githubAccount: 'ai-writer',
          pat: 'pat',
        }),
    );
    for (const action of ['gh.pr.approve', 'gh.pr.merge']) {
      await expect(
        service.acquire('worker-token', {
          credentialType: 'github.pat',
          resource: 'LitaGroup/repo-a',
          action,
        }),
      ).resolves.toMatchObject({ workerId: 1001 });
    }
  });

  it('无权限/未配置凭证/未支持类型分别返回稳定错误码并写审计', async () => {
    const none = buildService(
      { githubPermission: WorkerGithubPermission.NONE },
      () =>
        Promise.resolve({
          credentialId: 1,
          githubAccount: 'ai-developer',
          pat: 'pat',
        }),
    );
    await expect(
      none.service.acquire('worker-token', {
        credentialType: 'github.pat',
        resource: 'LitaGroup/repo-a',
        action: 'git.read',
      }),
    ).rejects.toMatchObject({ code: 'PERMISSION_NONE' });
    expect(none.audits.save).toHaveBeenCalledWith(
      expect.objectContaining({
        allowed: false,
        denyReason: 'PERMISSION_NONE',
      }),
    );

    const missing = buildService(
      { githubPermission: WorkerGithubPermission.DEVELOP },
      () =>
        Promise.reject(
          new ForbiddenException('GITHUB_CREDENTIAL_NOT_CONFIGURED'),
        ),
    );
    await expect(
      missing.service.acquire('worker-token', {
        credentialType: 'github.pat',
        resource: 'LitaGroup/repo-a',
        action: 'git.read',
      }),
    ).rejects.toMatchObject({ code: 'CREDENTIAL_NOT_CONFIGURED' });

    await expect(
      missing.service.acquire('worker-token', {
        credentialType: 'postgresql.account',
        resource: 'project',
        action: 'database.connect',
      }),
    ).rejects.toMatchObject({ code: 'CREDENTIAL_TYPE_UNSUPPORTED' });
  });

  it('非法仓库资源拒绝且不访问凭证', async () => {
    const decrypt = jest.fn();
    const { service } = buildService(
      { githubPermission: WorkerGithubPermission.DEVELOP },
      decrypt as never,
    );
    await expect(
      service.acquire('worker-token', {
        credentialType: 'github.pat',
        resource: 'repo/../../etc',
        action: 'git.read',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(decrypt).not.toHaveBeenCalled();
  });
});
