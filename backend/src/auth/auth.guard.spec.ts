import 'reflect-metadata';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard, type AuthedRequest } from './auth.guard';
import { AUTH_COOKIE } from './auth.service';
import { IS_PUBLIC_KEY } from './public.decorator';

type Headers = Record<string, string>;

function createContext(
  url: string,
  cookie?: string,
  headers: Headers = {},
  handler = () => {},
) {
  const req: Record<string, unknown> = {
    originalUrl: url,
    headers: { ...headers, ...(cookie ? { cookie } : {}) },
  };
  return {
    req,
    context: {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => handler,
      getClass: () => class {},
    } as unknown as ExecutionContext,
  };
}

describe('AuthGuard（网页接口强制登录）', () => {
  const reflector = new Reflector();
  const getUserByToken = jest.fn();
  const getUserByAgentToken = jest.fn();
  const findByAgentToken = jest.fn();
  const guard = new AuthGuard(
    reflector,
    {
      getUserByToken,
      getUserByAgentToken,
    } as never,
    { findByAgentToken } as never,
  );

  beforeEach(() => {
    getUserByToken.mockReset();
    getUserByAgentToken.mockReset();
    findByAgentToken.mockReset();
  });

  it('@Public() 路由直接放行', async () => {
    const handler = () => {};
    Reflect.defineMetadata(IS_PUBLIC_KEY, true, handler);
    const { context } = createContext('/api/auth/me', undefined, {}, handler);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(getUserByToken).not.toHaveBeenCalled();
  });

  it('.md 端点凭有效 agent token（请求头）放行并挂载 req.user', async () => {
    const user = { id: 2, name: '李四', enabled: true };
    getUserByAgentToken.mockResolvedValue(user);
    const { context, req } = createContext('/api/settings.md', undefined, {
      'x-agent-token': 'valid-agent-token',
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect((req as AuthedRequest).user).toBe(user);
    expect(getUserByAgentToken).toHaveBeenCalledWith('valid-agent-token');
  });

  it('任意 .md 端点均可凭有效机器人 token 放行并挂载 req.worker', async () => {
    const worker = { id: 1001, name: '前端工程师', enabled: true };
    findByAgentToken.mockResolvedValue(worker);
    const { context, req } = createContext('/api/projects/1.md', undefined, {
      'x-worker-token': 'valid-worker-token',
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect((req as AuthedRequest).worker).toBe(worker);
    expect((req as AuthedRequest).user).toBeUndefined();
    expect(findByAgentToken).toHaveBeenCalledWith('valid-worker-token');
    expect(getUserByAgentToken).not.toHaveBeenCalled();
  });

  it('任意 .md 端点机器人 token 无效 401（不回退用户令牌/会话）', async () => {
    findByAgentToken.mockResolvedValue(null);
    const { context } = createContext('/api/projects/1.md', undefined, {
      'x-worker-token': 'stale-worker-token',
    });
    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(getUserByToken).not.toHaveBeenCalled();
  });

  it('.md 端点凭 ?token= 参数放行（query 不影响 .md 判定）', async () => {
    const user = { id: 2, name: '李四', enabled: true };
    getUserByAgentToken.mockResolvedValue(user);
    const { context, req } = createContext(
      '/api/defects.md?status=%E5%BC%80%E6%94%BE&token=query-token',
    );
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect((req as AuthedRequest).user).toBe(user);
    expect(getUserByAgentToken).toHaveBeenCalledWith('query-token');
  });

  it('.md 端点 agent token 无效 401（不回退会话）', async () => {
    getUserByAgentToken.mockResolvedValue(null);
    const { context } = createContext('/api/settings.md', undefined, {
      'x-agent-token': 'stale-token',
    });
    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('.md 端点无令牌但会话有效放行（浏览器直接打开 .md 链接）', async () => {
    const user = { id: 1, name: '张三', enabled: true };
    getUserByToken.mockResolvedValue(user);
    const { context, req } = createContext(
      '/api/projects/1.md',
      `${AUTH_COOKIE}=session-token`,
    );
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect((req as AuthedRequest).user).toBe(user);
    expect(getUserByAgentToken).not.toHaveBeenCalled();
  });

  it('.md 端点无令牌无会话 401', async () => {
    const { context } = createContext('/api/checks/1/run.md');
    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('无 Cookie 的 JSON 接口 401', async () => {
    const { context } = createContext('/api/projects');
    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('有效会话放行并挂载 req.user', async () => {
    const user = { id: 1, name: '张三', enabled: true };
    getUserByToken.mockResolvedValue(user);
    const { context, req } = createContext(
      '/api/projects',
      `${AUTH_COOKIE}=any-token`,
    );
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(req.user).toBe(user);
  });

  it('会话无效（过期/禁用）401', async () => {
    getUserByToken.mockResolvedValue(null);
    const { context } = createContext(
      '/api/projects',
      `${AUTH_COOKIE}=expired`,
    );
    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
