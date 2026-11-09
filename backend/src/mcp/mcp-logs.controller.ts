import {
  Controller,
  ForbiddenException,
  Get,
  Query,
  Req,
} from '@nestjs/common';
import type { AuthedRequest } from '../auth/auth.guard';
import { UserRole } from '../common/enums';
import { McpLogsService } from './mcp-logs.service';

/** 管理区 MCP 调用审计列表（仅管理员） */
@Controller('mcp/logs')
export class McpLogsController {
  constructor(private readonly logs: McpLogsService) {}

  @Get()
  list(
    @Req() req: AuthedRequest,
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    if (req.user?.role !== UserRole.ADMIN) {
      throw new ForbiddenException('仅管理员可查看 MCP 调用审计');
    }
    return this.logs.list({
      q,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }
}
