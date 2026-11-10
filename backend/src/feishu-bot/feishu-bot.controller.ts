import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { AuthedRequest } from '../auth/auth.guard';
import type { User } from '../auth/user.entity';
import { UserRole } from '../common/enums';
import type {
  FeishuBotConfig,
  FeishuBotConfigView,
  SaveFeishuBotConfigInput,
} from './feishu-bot-config.entity';
import { FeishuBotConfigService } from './feishu-bot-config.service';
import {
  isFeishuBotGroupPolicy,
  type FeishuBotGroupPolicy,
} from './feishu-bot-group.entity';
import type { FeishuBotGroupRecordKind } from './feishu-bot-group-record.entity';
import {
  FeishuBotGroupChatService,
  type FeishuBotGroupRecordView,
  type FeishuBotGroupView,
} from './feishu-bot-group-chat.service';

/** 群记录类型过滤白名单 */
const RECORD_KINDS: readonly FeishuBotGroupRecordKind[] = [
  'message',
  'reply',
  'bot_added',
  'bot_removed',
];

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
  constructor(
    private readonly configs: FeishuBotConfigService,
    private readonly groupChats: FeishuBotGroupChatService,
  ) {}

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

  // ==== 外部群策略与记录 ====

  @Get(':configId/groups')
  async listGroups(
    @Param('configId', ParseIntPipe) configId: number,
    @Req() req: AuthedRequest,
  ): Promise<{
    defaultPolicy: FeishuBotGroupPolicy;
    groups: FeishuBotGroupView[];
  }> {
    assertAdmin(req.user);
    const config = await this.assertWorkerConfig(configId);
    const defaultPolicy = await this.configs.groupDefaultPolicy(config.id);
    return {
      defaultPolicy,
      groups: await this.groupChats.listGroups(config.id, defaultPolicy),
    };
  }

  @Put(':configId/groups/default-policy')
  async saveGroupDefaultPolicy(
    @Param('configId', ParseIntPipe) configId: number,
    @Body() body: { policy?: unknown },
    @Req() req: AuthedRequest,
  ): Promise<{ defaultPolicy: FeishuBotGroupPolicy }> {
    assertAdmin(req.user);
    const config = await this.assertWorkerConfig(configId);
    if (!isFeishuBotGroupPolicy(body?.policy)) {
      throw new BadRequestException('未知的群聊答复策略');
    }
    return {
      defaultPolicy: await this.configs.saveGroupDefaultPolicy(
        config.id,
        body.policy,
      ),
    };
  }

  @Put(':configId/groups/:groupId/policy')
  async saveGroupPolicy(
    @Param('configId', ParseIntPipe) configId: number,
    @Param('groupId', ParseIntPipe) groupId: number,
    @Body() body: { policy?: unknown },
    @Req() req: AuthedRequest,
  ): Promise<{ ok: true }> {
    assertAdmin(req.user);
    const config = await this.assertWorkerConfig(configId);
    const policy =
      body?.policy === null || body?.policy === undefined
        ? null
        : isFeishuBotGroupPolicy(body.policy)
          ? body.policy
          : undefined;
    if (policy === undefined) {
      throw new BadRequestException('未知的群聊答复策略');
    }
    await this.groupChats.setGroupPolicy(config.id, groupId, policy);
    return { ok: true };
  }

  @Get(':configId/groups/:groupId/records')
  async listGroupRecords(
    @Param('configId', ParseIntPipe) configId: number,
    @Param('groupId', ParseIntPipe) groupId: number,
    @Query('page') page: string | undefined,
    @Query('pageSize') pageSize: string | undefined,
    @Query('kind') kind: string | undefined,
    @Req() req: AuthedRequest,
  ): Promise<{
    items: FeishuBotGroupRecordView[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    assertAdmin(req.user);
    const config = await this.assertWorkerConfig(configId);
    const recordKind =
      kind && (RECORD_KINDS as readonly string[]).includes(kind)
        ? (kind as FeishuBotGroupRecordKind)
        : undefined;
    return this.groupChats.listRecords(
      config.id,
      groupId,
      Number(page) || 1,
      Number(pageSize) || 50,
      recordKind,
    );
  }

  /** 群策略只对机器人绑定应用开放（官方机器人只处理任务群） */
  private async assertWorkerConfig(configId: number): Promise<FeishuBotConfig> {
    const config = await this.configs.loadWithSecrets(configId);
    if (config.kind !== 'worker' || config.workerId === null) {
      throw new BadRequestException('仅机器人绑定的飞书应用支持外部群策略');
    }
    return config;
  }
}
