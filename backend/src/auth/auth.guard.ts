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
 * 保持开放的例外（平台为 AI 优先设计，agent 用法不受影响）：
 * - 标记 @Public() 的路由：登录流程本身（/api/auth/*）、自带 X-Agent-Token 鉴权的脚本接口（/api/scripts）
 * - `.md` 后缀端点：面向 AI/agent 的 Markdown 视图/流式接口（curl 直调无 Cookie）
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
    // .md 端点面向 AI/agent（curl 直调无 Cookie），保持开放
    const path = (req.originalUrl ?? req.url ?? '').split('?')[0];
    if (path.endsWith('.md')) return true;

    const token = readCookie(req, AUTH_COOKIE);
    const user = token ? await this.authService.getUserByToken(token) : null;
    if (!user) {
      throw new UnauthorizedException('未登录或登录已过期');
    }
    (req as AuthedRequest).user = user;
    return true;
  }
}
