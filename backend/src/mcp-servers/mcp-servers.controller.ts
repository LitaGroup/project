import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { AuthedRequest } from '../auth/auth.guard';
import type { User } from '../auth/user.entity';
import { UserRole } from '../common/enums';
import { Worker } from '../workers/worker.entity';
import type { McpServerView, SaveMcpServerInput } from './mcp-server.entity';
import {
  McpServersService,
  type McpServerTestResult,
} from './mcp-servers.service';

/** 管理端点统一要求管理员 */
function assertAdmin(user: User | undefined): void {
  if (user?.role !== UserRole.ADMIN) {
    throw new ForbiddenException('仅管理员可管理 MCP 配置');
  }
}

/**
 * 管理区 MCP 配置：
 * - GET /api/mcp/servers 列表（固定令牌只返回是否已配置）；
 * - POST /api/mcp/servers 新建；
 * - PATCH /api/mcp/servers/:id 编辑（令牌留空表示保持原值）；
 * - POST /api/mcp/servers/:id/test 平台侧连接测试（可传 workerId 借用机器人令牌）；
 * - DELETE /api/mcp/servers/:id 删除并清理机器人选择中的引用。
 */
@Controller('mcp/servers')
export class McpServersController {
  constructor(
    private readonly servers: McpServersService,
    @InjectRepository(Worker)
    private readonly workers: Repository<Worker>,
  ) {}

  @Get()
  list(@Req() req: AuthedRequest): Promise<McpServerView[]> {
    assertAdmin(req.user);
    return this.servers.list();
  }

  @Post()
  create(
    @Req() req: AuthedRequest,
    @Body() body: SaveMcpServerInput,
  ): Promise<McpServerView> {
    assertAdmin(req.user);
    return this.servers.create(body);
  }

  @Patch(':id')
  update(
    @Req() req: AuthedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: SaveMcpServerInput,
  ): Promise<McpServerView> {
    assertAdmin(req.user);
    return this.servers.update(id, body);
  }

  @Post(':id/test')
  async test(
    @Req() req: AuthedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() body?: { workerId?: number | null },
  ): Promise<McpServerTestResult> {
    assertAdmin(req.user);
    let workerToken: string | null = null;
    const workerId = body?.workerId ?? null;
    if (workerId !== null) {
      const worker = await this.workers
        .createQueryBuilder('worker')
        .addSelect('worker.agentToken')
        .where('worker.id = :id', { id: workerId })
        .getOne();
      if (!worker) throw new BadRequestException('机器人不存在');
      // 机器人尚未初始化时可能没有令牌，此时按匿名测试处理
      workerToken = worker.agentToken ?? null;
    }
    return this.servers.test(id, workerToken);
  }

  @Delete(':id')
  async remove(
    @Req() req: AuthedRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<{ ok: true }> {
    assertAdmin(req.user);
    await this.servers.remove(id);
    return { ok: true };
  }
}
