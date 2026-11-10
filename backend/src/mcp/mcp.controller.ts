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
import type { Worker } from '../workers/worker.entity';
import { WorkersService } from '../workers/workers.service';
import { McpService } from './mcp.service';
import type { McpBotCaller } from './mcp.types';

/**
 * MCP 机器人开放端点（MCP Streamable HTTP，stateless）：
 * POST /api/mcp/bots —— 外部 AI Agent（opencode / Claude Code 等）经此调用平台机器人。
 * 鉴权（与 lita-work MCP / `.md` 端点同一令牌体系）：
 * - X-Worker-Token：机器人令牌 → 机器人身份；
 * - Authorization: Bearer / X-Agent-Token / ?token=：机器人令牌（真人机器人 / AI 机器人）
 *   或公共 Agent 令牌。真人用户没有独立令牌，个人 AGENT 使用其主人真人机器人的令牌。
 * 机器人身份优先落到其绑定真人（humanUserId / personalAgentUserId），未绑定真人的
 * AI 机器人使用负的机器人 ID 隔离 MCP 会话与审计身份。
 */
@Controller('mcp/bots')
export class McpController {
  constructor(
    private readonly mcp: McpService,
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
    const caller = await this.authenticate(req);
    await this.mcp.handleRequest(caller, req, res, body);
  }

  /** 令牌提取：X-Worker-Token 优先，其次 Bearer / X-Agent-Token / ?token= 参数 */
  private async authenticate(req: Request): Promise<McpBotCaller> {
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
      return this.callerOf(worker);
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
        '缺少鉴权：请在 Authorization: Bearer / X-Agent-Token（或 ?token= 参数）携带机器人令牌，或使用 X-Worker-Token 携带机器人令牌（工位环境变量 LITA_WORK_TOKEN）',
      );
    }
    const publicAgent = this.auth.getPublicAgentByToken(token);
    if (publicAgent) {
      return { id: publicAgent.id, name: publicAgent.name };
    }
    // 工位 .opencode/.env 的 LITA_WORK_TOKEN 是机器人令牌：
    // 统一按 Bearer / X-Agent-Token 传入时同样识别为机器人身份
    const worker = await this.workers.findByAgentToken(token);
    if (worker) return this.callerOf(worker);
    throw new UnauthorizedException(
      '无效的机器人访问令牌（可在平台个人中心重置后更新 MCP 配置）',
    );
  }

  /** 机器人令牌映射调用方：绑定真人时记真人身份，否则用负 ID 隔离 AI 机器人会话 */
  private callerOf(worker: Worker): McpBotCaller {
    const userId = worker.humanUserId ?? worker.personalAgentUserId;
    if (userId != null) {
      return { id: userId, name: worker.humanUserName?.trim() || worker.name };
    }
    return { id: -worker.id, name: `机器人：${worker.name}` };
  }
}
