import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
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
import {
  FeishuBotOfficialMessageService,
  resolveOfficialMessageSender,
  type FeishuOfficialMessagePage,
  type SendOfficialMessageInput,
  type SendOfficialMessageResult,
} from './feishu-bot-official-message.service';

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
 * 「平台名义发消息」是唯一非仅管理员的端点：机器人令牌或管理员可发，审计留痕。
 */
@Controller('feishu-bot')
export class FeishuBotController {
  constructor(
    private readonly configs: FeishuBotConfigService,
    private readonly groupChats: FeishuBotGroupChatService,
    private readonly officialMessages: FeishuBotOfficialMessageService,
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

  // ==== 平台名义消息（官方机器人发送） ====

  /**
   * 以平台官方机器人身份发送 Markdown 卡片消息。
   * 权限：机器人令牌或管理员（含公共 Agent）；每次发送都写审计表。
   * 注意：JSON 接口走网页会话鉴权；机器人请用 POST /api/feishu-bot/messages.md
   * （X-Worker-Token 等令牌体系）或 lita-work MCP `feishu_send_message`。
   */
  @Post('messages')
  async sendMessage(
    @Body() body: SendOfficialMessageInput,
    @Req() req: AuthedRequest,
  ): Promise<SendOfficialMessageResult> {
    const sender = resolveOfficialMessageSender(req);
    return this.officialMessages.send(body ?? { content: '' }, sender);
  }

  /** AI/机器人用：发送平台名义消息并返回 Markdown 结果（body 同 POST /messages） */
  @Post('messages.md')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  async sendMessageMarkdown(
    @Body() body: SendOfficialMessageInput,
    @Req() req: AuthedRequest,
  ): Promise<string> {
    const sender = resolveOfficialMessageSender(req);
    const input = body ?? { content: '' };
    const result = await this.officialMessages.send(input, sender);
    const target = input.userId
      ? `平台用户 #${input.userId}`
      : input.openId
        ? `open_id ${input.openId}`
        : `群 ${input.chatId ?? ''}`;
    return [
      '# 飞书消息已发送',
      '',
      `- 发送方：${sender.name}`,
      `- 收件人：${target}`,
      `- messageId：${result.messageIds.join('、') || '（飞书未返回）'}`,
      '',
    ].join('\n');
  }

  /** 平台名义消息审计列表（仅管理员；不含正文大字段） */
  @Get('messages')
  async listMessages(
    @Query('page') page: string | undefined,
    @Query('pageSize') pageSize: string | undefined,
    @Req() req: AuthedRequest,
  ): Promise<FeishuOfficialMessagePage> {
    assertAdmin(req.user);
    return this.officialMessages.list(
      Number(page) || 1,
      Number(pageSize) || 20,
    );
  }

  // ==== 外部群策略与记录 ====

  @Get(':configId/groups')
  async listGroups(
    @Param('configId', ParseIntPipe) configId: number,
    @Req() req: AuthedRequest,
  ): Promise<{
    defaultPolicy: FeishuBotGroupPolicy;
    groups: FeishuBotGroupView[];
    /** 配置绑定「系统-反馈处理」机器人：群策略页展示「收录群」选择视图 */
    feedbackCollector: boolean;
  }> {
    assertAdmin(req.user);
    const config = await this.assertWorkerConfig(configId);
    const defaultPolicy = await this.configs.groupDefaultPolicy(config.id);
    const [groups, feedbackCollector] = await Promise.all([
      this.groupChats.listGroups(config.id, defaultPolicy),
      this.configs.isFeedbackCollector(config.id),
    ]);
    return { defaultPolicy, groups, feedbackCollector };
  }

  /**
   * 收录群批量配置（仅「系统-反馈处理」机器人）：
   * 选中群置为反馈采集策略，取消选中恢复跟随默认策略。
   */
  @Put(':configId/feedback-groups')
  async saveFeedbackGroups(
    @Param('configId', ParseIntPipe) configId: number,
    @Body() body: { groupIds?: unknown },
    @Req() req: AuthedRequest,
  ): Promise<{ ok: true; collected: number[] }> {
    assertAdmin(req.user);
    const config = await this.assertWorkerConfig(configId);
    if (!(await this.configs.isFeedbackCollector(config.id))) {
      throw new BadRequestException('收录群仅支持「系统-反馈处理」机器人配置');
    }
    if (!Array.isArray(body?.groupIds)) {
      throw new BadRequestException('groupIds 必须为数组');
    }
    const { collected } = await this.groupChats.setFeedbackGroups(
      config.id,
      body.groupIds as number[],
    );
    return { ok: true, collected };
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
