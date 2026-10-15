import 'reflect-metadata';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from './auth.guard';
import { AUTH_COOKIE } from './auth.service';
import { IS_PUBLIC_KEY } from './public.decorator';

function createContext(url: string, cookie?: string, handler = () => {}) {
  const req: Record<string, unknown> = {
    originalUrl: url,
    headers: cookie ? { cookie } : {},
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
  const guard = new AuthGuard(reflector, { getUserByToken } as never);

  beforeEach(() => {
    getUserByToken.mockReset();
  });

  it('@Public() 路由直接放行', async () => {
    const handler = () => {};
    Reflect.defineMetadata(IS_PUBLIC_KEY, true, handler);
    const { context } = createContext('/api/auth/me', undefined, handler);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(getUserByToken).not.toHaveBeenCalled();
  });

  it('.md 后缀端点放行（AI/agent 用，无需 Cookie）', async () => {
    const { context } = createContext('/api/settings.md');
    await expect(guard.canActivate(context)).resolves.toBe(true);
    const { context: ctx2 } = createContext('/api/checks/1/run.md');
    await expect(guard.canActivate(ctx2)).resolves.toBe(true);
    expect(getUserByToken).not.toHaveBeenCalled();
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

  it('query 串不影响 .md 判定', async () => {
    const { context } = createContext('/api/defects.md?status=开放');
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });
});
