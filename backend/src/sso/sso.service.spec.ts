import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import * as jwt from 'jsonwebtoken';
import { UserRole } from '../common/enums';
import { AuthService } from '../auth/auth.service';
import { User } from '../auth/user.entity';
import type { Worker } from '../workers/worker.entity';
import { SsoClient } from './sso-client.entity';
import { SsoCode } from './sso-code.entity';
import { SsoService } from './sso.service';

/** ConfigService 桩：直接读 env 映射 */
function createConfig(env: Record<string, string> = {}) {
  return { get: (key: string) => env[key] } as never;
}

/** where 条件是否全部命中（测试桩用） */
function matches<T extends object>(row: T, where: Partial<T>): boolean {
  return Object.entries(where).every(
    ([k, v]) => (row as Record<string, unknown>)[k] === v,
  );
}

/** SsoClient Repository 桩：内存数组 + 最小查询构建器（同步返回，由服务侧 await） */
function createClientsRepo() {
  const store: SsoClient[] = [];
  let nextId = 1;
  const repo = {
    store,
    findOne: jest.fn(
      ({ where }: { where: Partial<SsoClient> }) =>
        store.find((c) => matches(c, where)) ?? null,
    ),
    create: jest.fn(
      (data: Partial<SsoClient>) =>
        Object.assign(
          {
            id: nextId++,
            enabled: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          data,
        ) as SsoClient,
    ),
    save: jest.fn((client: SsoClient) => {
      if (!store.includes(client)) store.push(client);
      return Promise.resolve(client);
    }),
    update: jest.fn(
      (criteria: Partial<SsoClient>, patch: Partial<SsoClient>) => {
        const row = store.find((c) => matches(c, criteria));
        if (!row) return { affected: 0 };
        Object.assign(row, patch);
        return { affected: 1 };
      },
    ),
    remove: jest.fn((client: SsoClient) => {
      const idx = store.indexOf(client);
      if (idx >= 0) store.splice(idx, 1);
      return Promise.resolve(client);
    }),
    // list/findClientWithSecret 使用查询构建器；测试按需扩展返回值
    createQueryBuilder: jest.fn(() => ({
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn(() => Promise.resolve(store)),
      getOne: jest.fn(() => Promise.resolve(store[0] ?? null)),
    })),
  };
  return repo;
}

/** SsoCode Repository 桩：模拟一次性消费的条件更新 */
function createCodesRepo() {
  const store: SsoCode[] = [];
  let nextId = 1;
  return {
    store,
    findOne: jest.fn(
      ({ where }: { where: Partial<SsoCode> }) =>
        store.find((c) => matches(c, where)) ?? null,
    ),
    create: jest.fn(
      (data: Partial<SsoCode>) =>
        Object.assign(
          { id: nextId++, usedAt: null, createdAt: new Date() },
          data,
        ) as SsoCode,
    ),
    save: jest.fn((row: SsoCode) => {
      if (!store.includes(row)) store.push(row);
      return Promise.resolve(row);
    }),
    // 仅模拟 { id, usedAt: IsNull() } 条件更新的一次性语义
    update: jest.fn((criteria: { id: number }, patch: { usedAt: Date }) => {
      const row = store.find((c) => c.id === criteria.id && c.usedAt === null);
      if (!row) return { affected: 0 };
      row.usedAt = patch.usedAt;
      return { affected: 1 };
    }),
    delete: jest.fn(() => Promise.resolve(undefined)),
  };
}

function createAuthService(users: Partial<User>[]) {
  const store: User[] = users.map(
    (u, i) =>
      Object.assign(
        {
          id: i + 1,
          enabled: true,
          feishuOpenId: null,
          unionId: null,
          name: null,
          avatarUrl: null,
          email: null,
          department: null,
          role: UserRole.MEMBER,
          lastLoginAt: null,
          feishuAccessToken: null,
          feishuRefreshToken: null,
          feishuTokenExpiresAt: null,
        },
        u,
        { id: u.id ?? i + 1 },
      ) as User,
  );
  return {
    store,
    getUserById: jest.fn(
      (userId: number) =>
        store.find((u) => u.id === userId && u.enabled) ?? null,
    ),
    getUserByToken: jest.fn(() => Promise.resolve(null)),
  };
}

/** WorkersService 桩：每个真人幂等绑定一个同名真人机器人（ID 段 >= 1000，与生产一致） */
function createWorkersService() {
  const store: Worker[] = [];
  return {
    store,
    ensureHumanWorker: jest.fn((user: User) => {
      let worker = store.find((w) => w.humanUserId === user.id);
      if (!worker) {
        worker = {
          id: 1000 + user.id,
          name: user.name,
          avatarUrl: user.avatarUrl ?? null,
          humanUserId: user.id,
        } as Worker;
        store.push(worker);
      } else {
        worker.name = user.name;
        worker.avatarUrl = user.avatarUrl ?? null;
      }
      return Promise.resolve(worker);
    }),
  };
}

function createService(
  env: Record<string, string> = {},
  users: Partial<User>[] = [],
) {
  const clientsRepo = createClientsRepo();
  const codesRepo = createCodesRepo();
  const authService = createAuthService(users);
  const workersService = createWorkersService();
  const service = new SsoService(
    createConfig({ AUTH_JWT_SECRET: 'test-secret', ...env }),
    authService as unknown as AuthService,
    workersService as never,
    clientsRepo as never,
    codesRepo as never,
  );
  return { service, clientsRepo, codesRepo, authService, workersService };
}

async function seedClient(
  service: SsoService,
  clientsRepo: ReturnType<typeof createClientsRepo>,
  overrides: Partial<SsoClient> = {},
): Promise<SsoClient> {
  const saved = await service.create({
    name: '内部平台',
    redirectUris: ['https://app.example.com/callback'],
  });
  const row = clientsRepo.store.find((c) => c.id === saved.id)!;
  Object.assign(row, overrides);
  return row;
}

function userOf(id: number): User {
  return {
    id,
    feishuOpenId: `ou_${id}`,
    unionId: `un_${id}`,
    name: `用户${id}`,
    avatarUrl: null,
    email: null,
    department: '研发部',
    role: UserRole.MEMBER,
    enabled: true,
    lastLoginAt: null,
    feishuAccessToken: null,
    feishuRefreshToken: null,
    feishuTokenExpiresAt: null,
  } as User;
}

describe('SsoService（单点登录 OAuth2 IdP）', () => {
  describe('接入方管理', () => {
    it('create：生成 clientId/secret，secret 仅响应一次且视图不含原文', async () => {
      const { service, clientsRepo } = createService();
      const created = await service.create({
        name: '内部平台',
        redirectUris: ['https://app.example.com/callback'],
        remark: '运营后台',
      });
      expect(created.clientId).toMatch(/^sso_[0-9a-f]{24}$/);
      expect(created.clientSecret).toMatch(/^[0-9a-f]{48}$/);
      expect(created.hasSecret).toBe(true);
      expect(created.redirectUris).toEqual([
        'https://app.example.com/callback',
      ]);
      const view: Record<string, unknown> = { ...created };
      delete view.clientSecret;
      expect(JSON.stringify(view)).not.toContain(created.clientSecret);
      expect(clientsRepo.store[0].name).toBe('内部平台');
    });

    it('create：空回调地址与非法 URL 拒绝', async () => {
      const { service } = createService();
      await expect(
        service.create({ name: 'x', redirectUris: [] }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.create({ name: 'x', redirectUris: ['not-a-url'] }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.create({ name: 'x', redirectUris: ['ftp://app.example.com'] }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.create({ name: '  ', redirectUris: ['https://a.com'] }),
      ).rejects.toThrow(BadRequestException);
    });

    it('update：可改名称/回调地址/启用，密钥保持不变', async () => {
      const { service, clientsRepo } = createService();
      const client = await seedClient(service, clientsRepo);
      const originalSecret = client.clientSecret;
      const updated = await service.update(client.id, {
        name: '新名称',
        redirectUris: [
          'https://new.example.com/cb',
          'https://new.example.com/cb',
        ],
        enabled: false,
      });
      expect(updated.name).toBe('新名称');
      expect(updated.enabled).toBe(false);
      expect(updated.redirectUris).toEqual(['https://new.example.com/cb']);
      expect(clientsRepo.store[0].clientSecret).toBe(originalSecret);
    });

    it('resetSecret：旧密钥失效，新密钥可用', async () => {
      const { service, clientsRepo } = createService();
      const client = await seedClient(service, clientsRepo);
      const oldSecret = client.clientSecret;
      const { clientSecret: newSecret } = await service.resetSecret(client.id);
      expect(newSecret).not.toBe(oldSecret);
      expect(clientsRepo.store[0].clientSecret).toBe(newSecret);
    });
  });

  describe('authorize', () => {
    it('已登录用户：签发一次性 code 并 302 到登记的回调地址（带 state）', async () => {
      const { service, clientsRepo, codesRepo } = createService();
      const client = await seedClient(service, clientsRepo);
      const redirect = await service.buildAuthorizeRedirect(userOf(1), {
        clientId: client.clientId,
        redirectUri: 'https://app.example.com/callback',
        state: 'st-123',
      });
      expect(redirect).toMatch(
        /^https:\/\/app\.example\.com\/callback\?code=[0-9a-f]+&state=st-123$/,
      );
      expect(codesRepo.store).toHaveLength(1);
      expect(codesRepo.store[0].userId).toBe(1);
      expect(codesRepo.store[0].usedAt).toBeNull();
    });

    it('回调地址自带 query 时用 & 追加 code', async () => {
      const { service, clientsRepo } = createService();
      const client = await seedClient(service, clientsRepo, {
        redirectUris: ['https://app.example.com/callback?from=sso'],
      });
      const redirect = await service.buildAuthorizeRedirect(userOf(1), {
        clientId: client.clientId,
        redirectUri: 'https://app.example.com/callback?from=sso',
        state: null,
      });
      expect(redirect).toMatch(
        /^https:\/\/app\.example\.com\/callback\?from=sso&code=[0-9a-f]+$/,
      );
    });

    it('redirect_uri 未登记或 client 停用时拒绝（不回跳）', async () => {
      const { service, clientsRepo } = createService();
      const client = await seedClient(service, clientsRepo);
      await expect(
        service.buildAuthorizeRedirect(userOf(1), {
          clientId: client.clientId,
          redirectUri: 'https://evil.example.com/cb',
          state: null,
        }),
      ).rejects.toThrow(BadRequestException);
      await seedClient(service, clientsRepo, {
        clientId: 'sso_off',
        enabled: false,
      });
      await expect(
        service.buildAuthorizeRedirect(userOf(1), {
          clientId: 'sso_off',
          redirectUri: 'https://app.example.com/callback',
          state: null,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('exchangeToken', () => {
    interface Deps {
      service: SsoService;
      clientsRepo: ReturnType<typeof createClientsRepo>;
      codesRepo: ReturnType<typeof createCodesRepo>;
    }

    /** 造一条可用授权码（可覆盖过期时间等字段） */
    async function issueCode(
      deps: Deps,
      overrides: Partial<SsoCode> = {},
    ): Promise<{ client: SsoClient; code: string }> {
      const client = await seedClient(deps.service, deps.clientsRepo);
      const code = `code_${Math.random().toString(16).slice(2)}`;
      deps.codesRepo.store.push({
        id: deps.codesRepo.store.length + 1,
        code,
        clientId: client.clientId,
        userId: 1,
        redirectUri: 'https://app.example.com/callback',
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: null,
        createdAt: new Date(),
        ...overrides,
      });
      return { client, code };
    }

    function secretOf(deps: Deps, clientId: string): string {
      return deps.clientsRepo.store.find((c) => c.clientId === clientId)!
        .clientSecret;
    }

    it('合法授权码换取 access_token（独立 JWT：typ=sso_access、aud=clientId、sub=userId）', async () => {
      const deps = createService({}, [{ id: 1 }]) as Deps;
      const { client, code } = await issueCode(deps);
      const result = await deps.service.exchangeToken({
        grantType: 'authorization_code',
        clientId: client.clientId,
        clientSecret: secretOf(deps, client.clientId),
        code,
        redirectUri: 'https://app.example.com/callback',
      });
      expect(result.token_type).toBe('Bearer');
      expect(result.expires_in).toBe(2 * 60 * 60);
      const payload = jwt.verify(
        result.access_token,
        ssoSecretOf(),
      ) as jwt.JwtPayload;
      expect(payload.typ).toBe('sso_access');
      expect(payload.aud).toBe(client.clientId);
      expect(payload.sub).toBe('1');
    });

    it('授权码一次性：二次消费 invalid_grant', async () => {
      const deps = createService({}, [{ id: 1 }]) as Deps;
      const { client, code } = await issueCode(deps);
      const input = {
        grantType: 'authorization_code' as const,
        clientId: client.clientId,
        clientSecret: secretOf(deps, client.clientId),
        code,
        redirectUri: 'https://app.example.com/callback',
      };
      await deps.service.exchangeToken(input);
      await expect(deps.service.exchangeToken(input)).rejects.toMatchObject({
        error: 'invalid_grant',
      });
    });

    it('过期 / redirect_uri 不一致 / secret 错误 / grant_type 错误均拒绝', async () => {
      const deps = createService({}, [{ id: 1 }]) as Deps;
      const { client, code } = await issueCode(deps);
      const base = {
        grantType: 'authorization_code' as const,
        clientId: client.clientId,
        clientSecret: secretOf(deps, client.clientId),
        code,
        redirectUri: 'https://app.example.com/callback',
      };
      // 过期（独立服务实例，使用对应密钥）
      const expired = createService({}, [{ id: 1 }]) as Deps;
      const { client: client2, code: code2 } = await issueCode(expired, {
        expiresAt: new Date(Date.now() - 1000),
      });
      await expect(
        expired.service.exchangeToken({
          ...base,
          clientId: client2.clientId,
          clientSecret: secretOf(expired, client2.clientId),
          code: code2,
        }),
      ).rejects.toMatchObject({ error: 'invalid_grant' });
      // redirect_uri 不一致
      await expect(
        deps.service.exchangeToken({
          ...base,
          redirectUri: 'https://app.example.com/other',
        }),
      ).rejects.toMatchObject({ error: 'invalid_grant' });
      // secret 错误
      await expect(
        deps.service.exchangeToken({ ...base, clientSecret: 'wrong-secret' }),
      ).rejects.toMatchObject({ error: 'invalid_client' });
      // grant_type 错误
      await expect(
        deps.service.exchangeToken({
          ...base,
          grantType: 'client_credentials',
        }),
      ).rejects.toMatchObject({ error: 'unsupported_grant_type' });
    });

    it('用户被禁用后换码拒绝', async () => {
      const deps = createService({}, [{ id: 1, enabled: false }]) as Deps;
      const { client, code } = await issueCode(deps);
      await expect(
        deps.service.exchangeToken({
          grantType: 'authorization_code',
          clientId: client.clientId,
          clientSecret: secretOf(deps, client.clientId),
          code,
          redirectUri: 'https://app.example.com/callback',
        }),
      ).rejects.toMatchObject({ error: 'invalid_grant' });
    });
  });

  describe('userinfo', () => {
    /** 经 exchangeToken 真实签发 access_token（先造一条可用授权码） */
    async function tokenFor(
      service: SsoService,
      clientsRepo: ReturnType<typeof createClientsRepo>,
      clientId: string,
    ): Promise<string> {
      const code = `code_${Math.random().toString(16).slice(2)}`;
      const repo = (
        service as unknown as { codesRepo: ReturnType<typeof createCodesRepo> }
      ).codesRepo;
      repo.store.push({
        id: repo.store.length + 1,
        code,
        clientId,
        userId: 1,
        redirectUri: 'https://app.example.com/callback',
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: null,
        createdAt: new Date(),
      });
      const secret = clientsRepo.store.find(
        (c) => c.clientId === clientId,
      )!.clientSecret;
      const result = await service.exchangeToken({
        grantType: 'authorization_code',
        clientId,
        clientSecret: secret,
        code,
        redirectUri: 'https://app.example.com/callback',
      });
      return result.access_token;
    }

    function serviceWith(
      users: Partial<User>[],
      env: Record<string, string> = {},
    ) {
      return createService(env, users);
    }

    it('返回登录真人绑定的真人机器人身份（非真人用户本身）', async () => {
      const { service, clientsRepo } = serviceWith([
        {
          feishuOpenId: 'ou_9',
          unionId: 'un_9',
          name: '李四',
          avatarUrl: '/images/l.jpg',
          email: 'l@example.com',
          department: '产品部',
        },
      ]);
      const client = await seedClient(service, clientsRepo);
      const token = await tokenFor(service, clientsRepo, client.clientId);
      const info = await service.getUserInfoByAccessToken(token);
      expect(info).toEqual({
        id: 1001,
        name: '李四',
        avatarUrl: '/images/l.jpg',
        department: '产品部',
        humanUserId: 1,
      });
    });

    it('多次调用复用同一机器人，不重复创建', async () => {
      const { service, clientsRepo, workersService } = serviceWith([
        { name: '王五', department: '测试部' },
      ]);
      const client = await seedClient(service, clientsRepo);
      const token = await tokenFor(service, clientsRepo, client.clientId);
      const first = await service.getUserInfoByAccessToken(token);
      const second = await service.getUserInfoByAccessToken(token);
      expect(second).toEqual(first);
      expect(workersService.ensureHumanWorker).toHaveBeenCalledTimes(2);
      expect(workersService.store).toHaveLength(1);
      expect(workersService.store[0].id).toBe(1001);
    });

    it('平台会话令牌（typ 缺失）不能当 access_token 使用', async () => {
      const { service } = serviceWith([{ id: 1 }]);
      // 用同一派生密钥签发的无 typ 令牌应因类型检查被拒（而非签名失败）
      const sessionLike = jwt.sign({ role: '成员', name: 'x' }, ssoSecretOf(), {
        subject: '1',
        expiresIn: 60,
      });
      await expect(
        service.getUserInfoByAccessToken(sessionLike),
      ).rejects.toMatchObject({ error: 'invalid_token' });
    });

    it('用户禁用后 access_token 失效', async () => {
      // 模拟令牌签发后用户才被禁用：直接用派生密钥签发合法 access_token
      const { service } = serviceWith([{ id: 1, enabled: false }]);
      const token = jwt.sign(
        { typ: 'sso_access', aud: 'sso_client' },
        ssoSecretOf(),
        { subject: '1', expiresIn: 60 },
      );
      await expect(
        service.getUserInfoByAccessToken(token),
      ).rejects.toMatchObject({ error: 'invalid_token' });
    });
  });
});

/** 从派生逻辑复算测试用的 SSO JWT 密钥（与 ssoJwtSecret 保持一致：AUTH_JWT_SECRET=test-secret） */
function ssoSecretOf(): string {
  return createHash('sha256').update('sso-access:test-secret').digest('hex');
}
