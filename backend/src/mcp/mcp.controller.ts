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
import { User } from '../auth/user.entity';
import { Public } from '../auth/public.decorator';
import { McpService } from './mcp.service';

/**
 * MCP 开放端点（MCP Streamable HTTP，stateless）：
 * POST /api/mcp —— 外部 AI Agent（opencode / Claude Code 等）经此调用平台机器人。
 * 鉴权：Authorization: Bearer <token> 或 X-Agent-Token 或 ?token= 参数（个人 agent
 * 访问令牌，公共 Agent 令牌同样可用），与 `.md` 端点 / lita-work 技能的令牌体系一致
 * （工位环境变量 LITA_WORK_TOKEN，过渡期旧名 LITA_PROJECT_TOKEN 同值兜底）。
 */
@Controller('mcp')
export class McpController {
  constructor(
    private readonly mcp: McpService,
    private readonly auth: AuthService,
  ) {}

  @Post()
  @Public()
  async handlePost(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: unknown,
  ): Promise<void> {
    const user = await this.authenticate(req);
    await this.mcp.handleRequest(user, req, res, body);
  }

  /** 令牌提取：Bearer 优先，其次 X-Agent-Token，最后 ?token= 参数（与 .md 端点一致） */
  private async authenticate(req: Request): Promise<User> {
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
        '缺少鉴权：请在 Authorization: Bearer 或 X-Agent-Token 头（或 ?token= 参数）携带 agent 访问令牌（个人中心获取；工位环境变量 LITA_WORK_TOKEN，旧名 LITA_PROJECT_TOKEN 兜底）',
      );
    }
    const user = await this.auth.getUserByAgentToken(token);
    if (!user) {
      throw new UnauthorizedException(
        '无效的 agent 访问令牌（可在平台个人中心重置后更新 MCP 配置）',
      );
    }
    return user;
  }
}
