import {
  Controller,
  Get,
  Headers,
  NotFoundException,
  Query,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { ScriptsService } from './scripts.service';

/**
 * 脚本下载端点：供 appium-agent 拉取脚本文件内容。
 * 鉴权：请求须带 X-Agent-Token header（或 ?token=）与 AGENT_TOKEN 一致。
 */
@Controller('scripts')
export class ScriptsController {
  private readonly agentToken: string | null;

  constructor(
    private readonly scriptsService: ScriptsService,
    config: ConfigService,
  ) {
    this.agentToken = config.get<string>('AGENT_TOKEN') || null;
  }

  @Get()
  async download(
    @Query('path') relPath: string | undefined,
    @Query('token') token: string | undefined,
    @Headers('x-agent-token') headerToken: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const provided = headerToken || token;
    if (!this.agentToken || provided !== this.agentToken) {
      throw new UnauthorizedException('无效的 agent token');
    }
    if (!relPath) {
      throw new NotFoundException('缺少 path 参数');
    }
    const content = await this.scriptsService.readScript(relPath);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(content);
  }
}
