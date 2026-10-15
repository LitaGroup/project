import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AUTH_COOKIE, AuthService } from './auth.service';
import { readCookie } from './cookies';
import { IS_PUBLIC_KEY } from './public.decorator';

/** 附带了已登录用户的请求类型（req.user） */
export interface AuthedRequest extends Request {
  user?: import('./user.entity').User;
}

/**
 * 全局登录 Guard：网页 JSON 接口一律要求登录（HttpOnly Cookie 会话）。
 * 鉴权例外与特殊路径：
 * - 标记 @Public() 的路由：登录流程本身（/api/auth/*）、自带 X-Agent-Token 鉴权的脚本接口（/api/scripts）
 * - `.md` 后缀端点：面向 AI/agent 的 Markdown 视图/流式接口，凭个人 agent 访问令牌
 *   （X-Agent-Token 头或 ?token= 参数，个人中心可查看/重置）或网页会话放行
 * - WebSocket /api/ws：agent 直连，不走 Nest 路由（自有 token 校验）
 * - /images、/export-files 静态资源：挂载在 main.ts，不经 Guard
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request>();
    // .md 端点面向 AI/agent（curl 直调无 Cookie），凭 agent 访问令牌或会话放行
    const path = (req.originalUrl ?? req.url ?? '').split('?')[0];
    if (path.endsWith('.md')) return this.authorizeMarkdown(req);

    const token = readCookie(req, AUTH_COOKIE);
    const user = token ? await this.authService.getUserByToken(token) : null;
    if (!user) {
      throw new UnauthorizedException('未登录或登录已过期');
    }
    (req as AuthedRequest).user = user;
    return true;
  }

  /**
   * .md 端点鉴权：优先取 X-Agent-Token 头 / ?token= 参数对应的用户 agent 访问令牌
   * （个人中心可查看/重置）；未提供令牌时回退网页会话 Cookie（浏览器直接打开 .md 链接）。
   * 提供了令牌但无效直接 401，不做静默回退。
   */
  private async authorizeMarkdown(req: Request): Promise<boolean> {
    const header = req.headers['x-agent-token'];
    const headerToken = Array.isArray(header) ? header[0] : header;
    const queryToken = new URL(
      req.originalUrl ?? req.url ?? '',
      'http://localhost',
    ).searchParams.get('token');
    const provided = headerToken || queryToken;
    if (provided) {
      const user = await this.authService.getUserByAgentToken(provided);
      if (!user) {
        throw new UnauthorizedException(
          '无效的 agent 访问令牌（可在平台个人中心重置后更新 agent 配置）',
        );
      }
      (req as AuthedRequest).user = user;
      return true;
    }
    const token = readCookie(req, AUTH_COOKIE);
    const user = token ? await this.authService.getUserByToken(token) : null;
    if (!user) {
      throw new UnauthorizedException(
        '缺少鉴权：请在请求头携带 X-Agent-Token（或 ?token= 参数，个人中心可查看令牌），或使用网页登录会话',
      );
    }
    (req as AuthedRequest).user = user;
    return true;
  }
}
