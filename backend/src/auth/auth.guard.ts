import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { WorkersService } from '../workers/workers.service';
import type { Worker } from '../workers/worker.entity';
import { AUTH_COOKIE, AuthService } from './auth.service';
import { readCookie } from './cookies';
import { IS_PUBLIC_KEY } from './public.decorator';

/** 附带了已登录用户或执行机器人的请求类型 */
export interface AuthedRequest extends Request {
  user?: import('./user.entity').User;
  /** X-Worker-Token 命中的机器人身份（仅 .md 端点） */
  worker?: import('../workers/worker.entity').Worker;
}

/**
 * 全局登录 Guard：网页 JSON 接口一律要求登录（HttpOnly Cookie 会话）。
 * 鉴权例外与特殊路径：
 * - 标记 @Public() 的路由：登录流程本身（/api/auth/*）、自带 X-Agent-Token 鉴权的脚本接口（/api/scripts）
 * - `.md` 后缀端点：面向 AI/agent 的 Markdown 视图/流式接口，凭机器人令牌
 *   （X-Worker-Token，或放在 X-Agent-Token / ?token= 中）或公共 Agent 令牌放行。
 *   真人用户没有独立令牌，其令牌就是绑定真人机器人的 workers.agentToken；
 *   命中真人机器人时同时挂载 req.worker 与 req.user，保持真人身份语义。
 * - WebSocket /api/ws：agent 直连，不走 Nest 路由（自有 token 校验）
 * - /images、/export-files、/files 静态资源：挂载在 main.ts，不经 Guard
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService,
    private readonly workersService: WorkersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request>();
    // .md 端点面向 AI/agent（curl 直调无 Cookie），凭机器人令牌或会话放行
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
   * .md 端点鉴权：
   * - X-Worker-Token：机器人令牌，命中后挂载 req.worker（用于严格校验执行方）；
   * - X-Agent-Token / ?token=：机器人令牌（真人机器人 / AI 机器人）或公共 Agent 令牌；
   *   命中真人机器人时同时挂载 req.user，保持真人操作身份；
   * - 未提供令牌时回退网页会话 Cookie（浏览器直接打开 .md 链接）。
   * 提供了令牌但无效直接 401，不做静默回退。
   */
  private async authorizeMarkdown(req: Request): Promise<boolean> {
    const workerHeader = req.headers['x-worker-token'];
    const workerToken = Array.isArray(workerHeader)
      ? workerHeader[0]
      : workerHeader;
    if (workerToken) {
      const worker = await this.workersService.findByAgentToken(workerToken);
      if (!worker) {
        throw new UnauthorizedException(
          '无效的机器人访问令牌（由平台在初始化或首次派发时生成到工位 .opencode/agent-token）',
        );
      }
      await this.attachWorker(req, worker);
      return true;
    }

    const header = req.headers['x-agent-token'];
    const headerToken = Array.isArray(header) ? header[0] : header;
    const queryToken = new URL(
      req.originalUrl ?? req.url ?? '',
      'http://localhost',
    ).searchParams.get('token');
    const provided = headerToken || queryToken;
    if (provided) {
      const publicAgent = this.authService.getPublicAgentByToken(provided);
      if (publicAgent) {
        (req as AuthedRequest).user = publicAgent;
        return true;
      }
      // 工位 .opencode/.env 的 LITA_WORK_TOKEN 是机器人令牌，
      // 统一按 X-Agent-Token（项目 SKILL 约定）传入时同样识别为机器人身份
      const worker = await this.workersService.findByAgentToken(provided);
      if (worker) {
        await this.attachWorker(req, worker);
        return true;
      }
      throw new UnauthorizedException(
        '无效的机器人访问令牌（可在平台个人中心重置后更新 agent 配置）',
      );
    }
    const token = readCookie(req, AUTH_COOKIE);
    const user = token ? await this.authService.getUserByToken(token) : null;
    if (!user) {
      throw new UnauthorizedException(
        '缺少鉴权：请在请求头携带 X-Worker-Token 或 X-Agent-Token（或 ?token= 参数；令牌在个人中心「机器人令牌」查看，公共 Agent 令牌由管理员下发），或使用网页登录会话',
      );
    }
    (req as AuthedRequest).user = user;
    return true;
  }

  /**
   * 挂载机器人身份；真人机器人额外挂载其绑定用户，
   * 兼容 `.md` 端点里“处理验收反馈”等需要 req.user 的真人动作。
   */
  private async attachWorker(req: Request, worker: Worker): Promise<void> {
    (req as AuthedRequest).worker = worker;
    if (!worker.humanUserId) return;
    const user = await this.authService.getUserById(worker.humanUserId);
    if (user) (req as AuthedRequest).user = user;
  }
}
