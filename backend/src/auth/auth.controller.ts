import {
  Controller,
  Get,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { AUTH_COOKIE, AuthService, OAUTH_STATE_COOKIE } from './auth.service';
import { readCookie } from './cookies';
import { Public } from './public.decorator';
import { User } from './user.entity';

/** /me 响应的用户子集（不含 open_id 等敏感标识） */
function serializeUser(user: User) {
  return {
    id: user.id,
    name: user.name,
    avatarUrl: user.avatarUrl,
    email: user.email,
    department: user.department,
    role: user.role,
    lastLoginAt: user.lastLoginAt,
  };
}

/**
 * 飞书 OAuth 网页登录端点（标记 @Public：登录流程本身不要求已有会话）。
 * 登录状态经 HttpOnly Cookie 会话保持，其余网页接口由全局 AuthGuard 拦截。
 */
@Public()
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  /** 登录入口：302 到飞书授权页（state 写短效 Cookie，回调时比对防 CSRF） */
  @Get('feishu')
  feishuLogin(@Req() req: Request, @Res() res: Response) {
    try {
      const state = this.authService.generateState();
      res.cookie(
        OAUTH_STATE_COOKIE,
        state,
        this.authService.stateCookieOptions(),
      );
      res.redirect(this.authService.buildAuthorizeUrl(state));
    } catch (e) {
      this.redirectLoginError(res, (e as Error).message);
    }
  }

  /**
   * OAuth 回调：校验 state → 授权码换用户信息 → upsert 用户 → JWT 写 HttpOnly Cookie →
   * 302 回前端首页；失败 302 /login?error=...（授权码一次性，失败需整流程重试）
   */
  @Get('feishu/callback')
  async feishuCallback(@Req() req: Request, @Res() res: Response) {
    try {
      const queryState = req.query.state;
      const cookieState = readCookie(req, OAUTH_STATE_COOKIE);
      res.clearCookie(OAUTH_STATE_COOKIE, { path: '/' });
      if (
        typeof queryState !== 'string' ||
        !cookieState ||
        queryState !== cookieState
      ) {
        throw new Error('登录状态校验失败（state 不匹配），请重试');
      }
      const code = req.query.code;
      if (typeof code !== 'string' || !code) {
        throw new Error('飞书回调缺少授权码，请重试登录');
      }
      const { info, tokens } =
        await this.authService.exchangeCodeForLogin(code);
      const user = await this.authService.upsertFeishuUser(info, tokens);
      res.cookie(
        AUTH_COOKIE,
        this.authService.signSessionToken(user),
        this.authService.sessionCookieOptions(),
      );
      res.redirect(this.appUrl());
    } catch (e) {
      this.redirectLoginError(res, (e as Error).message);
    }
  }

  /** 当前登录用户（未登录 401，前端视为未登录态） */
  @Get('me')
  async me(@Req() req: Request) {
    const user = await this.requireUser(req);
    return { user: serializeUser(user) };
  }

  /** 用户系统全量名单（登录后可看）：项目人员/提测测试人员等场景选择用户（不允许配置用户系统之外的人） */
  @Get('users')
  async listUsers(@Req() req: Request) {
    await this.requireUser(req);
    return { users: await this.authService.listUsers() };
  }

  /**
   * 当前用户的 agent 访问令牌：agent 调 .md 端点的鉴权凭据。
   * 尚未发放则自动生成（首次查看个人中心时发放）。
   */
  @Get('agent-token')
  async getAgentToken(@Req() req: Request) {
    const user = await this.requireUser(req);
    return { token: await this.authService.ensureAgentToken(user.id) };
  }

  /** 重置 agent 访问令牌（旧令牌立即失效，需同步更新 agent 侧配置） */
  @Post('agent-token/reset')
  async resetAgentToken(@Req() req: Request) {
    const user = await this.requireUser(req);
    return { token: await this.authService.resetAgentToken(user.id) };
  }

  /** 会话校验（本控制器整体 @Public，登录后接口在此手动校验 Cookie，与 me 同口径） */
  private async requireUser(req: Request): Promise<User> {
    const token = readCookie(req, AUTH_COOKIE);
    const user = token ? await this.authService.getUserByToken(token) : null;
    if (!user) throw new UnauthorizedException();
    return user;
  }

  /** 登出：清除会话 Cookie（JWT 无服务端状态，无法吊销已签发 token，7 天自然过期） */
  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(AUTH_COOKIE, { path: '/' });
    return { ok: true };
  }

  private appUrl(): string {
    return this.config.get<string>('APP_URL') ?? 'http://localhost:5273';
  }

  private redirectLoginError(res: Response, message: string) {
    res.redirect(
      `${this.appUrl().replace(/\/$/, '')}/login?error=${encodeURIComponent(message)}`,
    );
  }
}
