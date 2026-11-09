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
 * 鉴权：Authorization: Bearer <token> 或 X-Agent-Token（个人 agent 访问令牌，
 * 公共 Agent 令牌同样可用），复用 `.md` 端点的令牌体系。
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

  /** 令牌提取：Bearer 优先，其次 X-Agent-Token */
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
    const token = bearer || agentToken?.trim() || '';
    if (!token) {
      throw new UnauthorizedException(
        '缺少鉴权：请在 Authorization: Bearer 或 X-Agent-Token 头携带 agent 访问令牌（平台个人中心获取/重置）',
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
