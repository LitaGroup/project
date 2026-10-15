import { BadRequestException } from '@nestjs/common';
import { UserRole } from '../common/enums';
import { AuthService } from './auth.service';
import { User } from './user.entity';

/** ConfigService 桩：直接读 env 映射 */
function createConfig(env: Record<string, string>) {
  return { get: (key: string) => env[key] } as never;
}

/** Repository 桩：内存数组模拟 findOne/count/create/save */
function createRepo() {
  const store: User[] = [];
  let nextId = 1;
  return {
    store,
    findOne: jest.fn(
      ({ where }: { where: Partial<User> }) =>
        store.find(
          (u) =>
            (where.id !== undefined && u.id === where.id) ||
            (where.feishuOpenId !== undefined &&
              u.feishuOpenId === where.feishuOpenId),
        ) ?? null,
    ),
    count: jest.fn(() => store.length),
    create: jest.fn(
      (data: Partial<User>) =>
        Object.assign(
          {
            id: nextId++,
            enabled: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          data,
        ) as User,
    ),
    save: jest.fn((user: User) => {
      if (!store.includes(user)) store.push(user);
      return user;
    }),
  };
}

function createService(env: Record<string, string> = {}) {
  const repo = createRepo();
  const feishu = {
    sendUserText: jest.fn().mockResolvedValue(undefined),
    sendUserCard: jest.fn().mockResolvedValue(undefined),
  };
  const service = new AuthService(
    createConfig({
      FEISHU_APP_ID: 'cli_test',
      FEISHU_APP_SECRET: 'secret_test',
      APP_URL: 'http://localhost:5173',
      ...env,
    }),
    repo as never,
    feishu as never,
  );
  return { service, repo, feishu };
}

const FEISHU_INFO = {
  openId: 'ou_123',
  unionId: 'un_123',
  name: '张三',
  avatarUrl: 'https://example.com/a.png',
  email: 'zhangsan@example.com',
};

describe('AuthService（飞书登录 + 会话）', () => {
  describe('buildAuthorizeUrl', () => {
    it('包含 app_id / redirect_uri / state', () => {
      const { service } = createService();
      const url = service.buildAuthorizeUrl('state-abc');
      expect(url).toContain(
        'https://open.feishu.cn/open-apis/authen/v1/index?',
      );
      expect(url).toContain('app_id=cli_test');
      expect(url).toContain(
        `redirect_uri=${encodeURIComponent('http://localhost:5173/api/auth/feishu/callback')}`,
      );
      expect(url).toContain('state=state-abc');
    });

    it('缺少 FEISHU_APP_ID/SECRET 时报可读错误', () => {
      const { service } = createService({
        FEISHU_APP_ID: '',
        FEISHU_APP_SECRET: '',
      });
      expect(() => service.buildAuthorizeUrl('s')).toThrow(BadRequestException);
      expect(() => service.buildAuthorizeUrl('s')).toThrow(/飞书登录未配置/);
    });
  });

  describe('upsertFeishuUser', () => {
    it('首个登录用户自动授予管理员', async () => {
      const { service, repo } = createService();
      const user = await service.upsertFeishuUser(FEISHU_INFO);
      expect(user.role).toBe(UserRole.ADMIN);
      expect(user.feishuOpenId).toBe('ou_123');
      expect(user.lastLoginAt).toBeInstanceOf(Date);
      expect(repo.store).toHaveLength(1);
    });

    it('后续用户为成员', async () => {
      const { service } = createService();
      await service.upsertFeishuUser(FEISHU_INFO);
      const second = await service.upsertFeishuUser({
        ...FEISHU_INFO,
        openId: 'ou_456',
        name: '李四',
      });
      expect(second.role).toBe(UserRole.MEMBER);
    });

    it('同 open_id 重复登录只更新不新增', async () => {
      const { service, repo } = createService();
      await service.upsertFeishuUser(FEISHU_INFO);
      const again = await service.upsertFeishuUser({
        ...FEISHU_INFO,
        name: '张三改',
        avatarUrl: null,
      });
      expect(repo.store).toHaveLength(1);
      expect(again.name).toBe('张三改');
      // 新值为 null 时不覆盖旧值
      expect(again.avatarUrl).toBe(FEISHU_INFO.avatarUrl);
    });
  });

  describe('登录欢迎消息', () => {
    it('登录成功后经应用机器人发送欢迎卡片（介绍 + SKILL 安装 + 任务流）', async () => {
      const { service, feishu } = createService();
      await service.upsertFeishuUser(FEISHU_INFO);
      expect(feishu.sendUserCard).toHaveBeenCalledTimes(1);
      const [openId, card] = feishu.sendUserCard.mock.calls[0] as [
        string,
        Record<string, unknown>,
      ];
      expect(openId).toBe('ou_123');
      const json = JSON.stringify(card);
      expect(json).toContain('你好，欢迎登录 project');
      expect(json).toContain('Lita 的项目管理系统');
      expect(json).toContain('http://localhost:5173/SKILL.md');
      expect(json).toContain('mkdir -p ~/.opencode/skills/project-manage');
      expect(json).toContain('核心任务流');
      expect(json).toContain('定时任务');
    });

    it('重复登录同样发送', async () => {
      const { service, feishu } = createService();
      await service.upsertFeishuUser(FEISHU_INFO);
      await service.upsertFeishuUser(FEISHU_INFO);
      expect(feishu.sendUserCard).toHaveBeenCalledTimes(2);
    });

    it('发送失败不阻断登录落库', async () => {
      const { service, feishu, repo } = createService();
      feishu.sendUserCard.mockRejectedValue(
        new BadRequestException('无发消息权限'),
      );
      const user = await service.upsertFeishuUser(FEISHU_INFO);
      expect(user.id).toBeTruthy();
      expect(repo.store).toHaveLength(1);
    });
  });

  describe('signSessionToken / getUserByToken', () => {
    it('签发后可解析回同一用户', async () => {
      const { service } = createService({ AUTH_JWT_SECRET: 'test-secret' });
      const user = await service.upsertFeishuUser(FEISHU_INFO);
      const token = service.signSessionToken(user);
      await expect(service.getUserByToken(token)).resolves.toMatchObject({
        id: user.id,
        name: '张三',
        role: UserRole.ADMIN,
      });
    });

    it('enabled=false 视为未登录', async () => {
      const { service } = createService({ AUTH_JWT_SECRET: 'test-secret' });
      const user = await service.upsertFeishuUser(FEISHU_INFO);
      user.enabled = false;
      const token = service.signSessionToken(user);
      await expect(service.getUserByToken(token)).resolves.toBeNull();
    });

    it('非法 token 返回 null 而非抛错', async () => {
      const { service } = createService({ AUTH_JWT_SECRET: 'test-secret' });
      await expect(service.getUserByToken('garbage')).resolves.toBeNull();
    });
  });

  describe('exchangeCodeForUser', () => {
    it('换 token 后取用户信息', async () => {
      const { service } = createService();
      const post = jest
        .spyOn(service['http'], 'post')
        .mockResolvedValue({ data: { access_token: 'u-token' } });
      const get = jest.spyOn(service['http'], 'get').mockResolvedValue({
        data: { code: 0, data: { open_id: 'ou_123', name: '张三' } },
      });
      const info = await service.exchangeCodeForUser('auth-code');
      expect(info.openId).toBe('ou_123');
      expect(info.name).toBe('张三');
      expect(post).toHaveBeenCalledWith(
        '/authen/v2/oauth/token',
        expect.objectContaining({
          grant_type: 'authorization_code',
          client_id: 'cli_test',
          code: 'auth-code',
        }),
      );
      expect(get).toHaveBeenCalledWith('/authen/v1/user_info', {
        headers: { Authorization: 'Bearer u-token' },
      });
    });

    it('授权码无效时报可读错误', async () => {
      const { service } = createService();
      jest
        .spyOn(service['http'], 'post')
        .mockResolvedValue({ data: { code: 20023, msg: 'invalid code' } });
      await expect(service.exchangeCodeForUser('bad')).rejects.toThrow(
        /飞书授权码换取失败/,
      );
    });
  });

  describe('Cookie 选项', () => {
    it('会话与 state Cookie 均为 HttpOnly + SameSite=Lax；COOKIE_SECURE=true 时开启 Secure', () => {
      const { service } = createService({ COOKIE_SECURE: 'true' });
      const session = service.sessionCookieOptions();
      const state = service.stateCookieOptions();
      expect(session.httpOnly).toBe(true);
      expect(session.sameSite).toBe('lax');
      expect(session.secure).toBe(true);
      expect(state.httpOnly).toBe(true);
      expect(state.maxAge).toBe(10 * 60 * 1000);
      expect(state.secure).toBe(true);
    });

    it('默认（内网 http）不开 Secure', () => {
      const { service } = createService();
      expect(service.sessionCookieOptions().secure).toBe(false);
    });
  });
});
