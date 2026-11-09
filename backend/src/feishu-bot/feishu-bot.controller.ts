import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import type { AuthedRequest } from '../auth/auth.guard';
import type { User } from '../auth/user.entity';
import { UserRole } from '../common/enums';
import type {
  FeishuBotConfigView,
  SaveFeishuBotConfigInput,
} from './feishu-bot-config.entity';
import { FeishuBotConfigService } from './feishu-bot-config.service';

/** 管理端点统一要求管理员 */
function assertAdmin(user: User | undefined): void {
  if (user?.role !== UserRole.ADMIN) {
    throw new ForbiddenException('仅管理员可管理飞书配置');
  }
}

/**
 * 飞书机器人配置（管理区）：
 * - GET /api/feishu-bot 全部配置；
 * - PUT /api/feishu-bot/official 平台官方机器人；
 * - PUT /api/feishu-bot/workers/:workerId 机器人绑定；
 * - POST /api/feishu-bot/:id/test 连接验证；
 * - DELETE /api/feishu-bot/:id 删除。
 * Secret 只写不读；回调为公开端点（自行验签）。
 */
@Controller('feishu-bot')
export class FeishuBotController {
  constructor(private readonly configs: FeishuBotConfigService) {}

  @Get()
  async list(@Req() req: AuthedRequest): Promise<{
    official: FeishuBotConfigView | null;
    workers: FeishuBotConfigView[];
  }> {
    assertAdmin(req.user);
    const rows = await this.configs.list();
    return {
      official: rows.find((row) => row.kind === 'official') ?? null,
      workers: rows.filter((row) => row.kind === 'worker'),
    };
  }

  @Put('official')
  async saveOfficial(
    @Body() body: SaveFeishuBotConfigInput,
    @Req() req: AuthedRequest,
  ): Promise<FeishuBotConfigView> {
    assertAdmin(req.user);
    return this.configs.saveOfficial(body);
  }

  @Put('workers/:workerId')
  async saveWorker(
    @Param('workerId', ParseIntPipe) workerId: number,
    @Body() body: SaveFeishuBotConfigInput,
    @Req() req: AuthedRequest,
  ): Promise<FeishuBotConfigView> {
    assertAdmin(req.user);
    return this.configs.saveForWorker(workerId, body);
  }

  @Post(':id/test')
  async test(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthedRequest,
  ): Promise<FeishuBotConfigView> {
    assertAdmin(req.user);
    return this.configs.test(id);
  }

  @Delete(':id')
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthedRequest,
  ): Promise<{ ok: true }> {
    assertAdmin(req.user);
    await this.configs.remove(id);
    return { ok: true };
  }
}
