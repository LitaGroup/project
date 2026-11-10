import {
  Controller,
  Post,
  Req,
  Res,
  UnauthorizedException,
  Body,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from '../auth/auth.service';
import { Public } from '../auth/public.decorator';
import { WorkersService } from '../workers/workers.service';
import type { Worker } from '../workers/worker.entity';
import { McpWorkService } from './mcp-work.service';
import type { McpWorkPrincipal } from './work-tools/work-tools.types';

/**
 * lita-work MCP 开放端点（MCP Streamable HTTP，stateless）：
 * POST /api/mcp/work —— 外部 AI Agent 调用平台项目/知识/运行/缺陷等工具。
 * 鉴权（与 `.md` 端点一致）：
 * - X-Worker-Token：机器人令牌 → worker 身份（任务协同等需要机器人身份的接口）；
 * - Authorization: Bearer / X-Agent-Token / ?token=：机器人令牌（真人机器人 / AI 机器人）
 *   或公共 Agent 令牌；真人机器人令牌同时解析出其绑定用户，保持真人身份语义。
 * 真人用户没有独立令牌，个人 AGENT 使用其主人真人机器人的令牌。
 */
@Controller('mcp/work')
export class McpWorkController {
  constructor(
    private readonly mcp: McpWorkService,
    private readonly auth: AuthService,
    private readonly workers: WorkersService,
  ) {}

  @Post()
  @Public()
  async handlePost(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: unknown,
  ): Promise<void> {
    const principal = await this.authenticate(req);
    await this.mcp.handleRequest(principal, req, res, body);
  }

  private async authenticate(req: Request): Promise<McpWorkPrincipal> {
    const workerHeader = req.headers['x-worker-token'];
    const workerToken = (
      Array.isArray(workerHeader) ? workerHeader[0] : workerHeader
    )?.trim();
    if (workerToken) {
      const worker = await this.workers.findByAgentToken(workerToken);
      if (!worker) {
        throw new UnauthorizedException(
          '无效的机器人访问令牌（由平台在初始化或首次派发时生成到工位 .opencode/agent-token）',
        );
      }
      return this.principalOf(worker);
    }

    const header = req.headers['authorization'];
    const bearer =
      typeof header === 'string' && header.toLowerCase().startsWith('bearer ')
        ? header.slice(7).trim()
        : '';
    const agentHeader = req.headers['x-agent-token'];
    const agentToken = Array.isArray(agentHeader)
      ? agentHeader[0]
      : agentHeader;
    const queryToken = new URL(
      req.originalUrl ?? req.url ?? '',
      'http://localhost',
    ).searchParams.get('token');
    const token = bearer || agentToken?.trim() || queryToken?.trim() || '';
    if (!token) {
      throw new UnauthorizedException(
        '缺少鉴权：请在 Authorization: Bearer 或 X-Agent-Token 头（或 ?token= 参数）携带机器人令牌，或使用 X-Worker-Token 携带机器人令牌（工位环境变量 LITA_WORK_TOKEN）',
      );
    }
    const publicAgent = this.auth.getPublicAgentByToken(token);
    if (publicAgent) return { user: publicAgent };
    // 工位 .opencode/.env 的 LITA_WORK_TOKEN 是机器人令牌：
    // 统一按 Bearer / X-Agent-Token 传入时同样识别为机器人身份
    const worker = await this.workers.findByAgentToken(token);
    if (worker) return this.principalOf(worker);
    throw new UnauthorizedException(
      '无效的机器人访问令牌（可在平台个人中心重置后更新 MCP 配置）',
    );
  }

  /** 机器人身份；绑定真人时同时挂载用户，保持真人操作语义 */
  private async principalOf(worker: Worker): Promise<McpWorkPrincipal> {
    if (!worker.humanUserId) return { worker };
    const user = await this.auth.getUserById(worker.humanUserId);
    return user ? { worker, user } : { worker };
  }
}
