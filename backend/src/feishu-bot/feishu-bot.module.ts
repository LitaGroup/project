import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../auth/user.entity';
import { Project } from '../projects/project.entity';
import { Task } from '../tasks/task.entity';
import { TasksModule } from '../tasks/tasks.module';
import { TicketsModule } from '../tickets/tickets.module';
import { Worker } from '../workers/worker.entity';
import { WorkersModule } from '../workers/workers.module';
import { FeishuBotApprovalCard } from './feishu-bot-approval-card.entity';
import { FeishuBotApprovalService } from './feishu-bot-approval.service';
import { FeishuBotCard } from './feishu-bot-card.entity';
import { FeishuBotChangeBus } from './feishu-bot-change.service';
import { FeishuBotClientService } from './feishu-bot-client.service';
import { FeishuBotConfig } from './feishu-bot-config.entity';
import { FeishuBotConfigService } from './feishu-bot-config.service';
import { FeishuBotCryptoService } from './feishu-bot-crypto.service';
import { FeishuBotCallbackController } from './feishu-bot-callback.controller';
import { FeishuBotEventService } from './feishu-bot-event.service';
import { FeishuBotIdentity } from './feishu-bot-identity.entity';
import { FeishuBotIdentityService } from './feishu-bot-identity.service';
import { FeishuBotEvent } from './feishu-bot-event.entity';
import { FeishuBotGroup } from './feishu-bot-group.entity';
import { FeishuBotGroupChatService } from './feishu-bot-group-chat.service';
import { FeishuBotGroupRecord } from './feishu-bot-group-record.entity';
import { FeishuBotLongConnectionService } from './feishu-bot-long-connection.service';
import { FeishuBotMessageService } from './feishu-bot-message.service';
import { FeishuBotP2PService } from './feishu-bot-p2p.service';
import { FeishuBotProjectChat } from './feishu-bot-project-chat.entity';
import { FeishuBotProjectChatService } from './feishu-bot-project-chat.service';
import { FeishuBotTaskChat } from './feishu-bot-task-chat.entity';
import { FeishuBotTaskChatService } from './feishu-bot-task-chat.service';
import { FeishuBotController } from './feishu-bot.controller';

/**
 * 飞书 Bot 接入层：
 * - 每个机器人（或平台官方）可绑定独立飞书应用（Secret 加密落库）；
 * - 入站优先 WebSocket 长连接（无需公网回调），同时保留 HTTP 回调端点；
 * - 身份解析 → 私聊桥接（WorkerDebugService / 个人 AGENT）；
 * - 任务群（任务=群）由平台官方机器人代理，经 TaskDeliveryService 走任务中心。
 * 与现有 FeishuModule（文档同步单应用）互不影响。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      FeishuBotConfig,
      FeishuBotIdentity,
      FeishuBotCard,
      FeishuBotEvent,
      FeishuBotTaskChat,
      FeishuBotProjectChat,
      FeishuBotApprovalCard,
      FeishuBotGroup,
      FeishuBotGroupRecord,
      Worker,
      Project,
      Task,
      User,
    ]),
    // WorkerDebugService / PersonalAgentsService（私聊桥接）
    WorkersModule,
    // TaskDeliveryService（群消息走任务中心）
    forwardRef(() => TasksModule),
    // 审批卡片回调：审批任务通过工单运行时推进
    forwardRef(() => TicketsModule),
  ],
  controllers: [FeishuBotController, FeishuBotCallbackController],
  providers: [
    FeishuBotChangeBus,
    FeishuBotCryptoService,
    FeishuBotClientService,
    FeishuBotConfigService,
    FeishuBotIdentityService,
    FeishuBotMessageService,
    FeishuBotP2PService,
    FeishuBotTaskChatService,
    FeishuBotProjectChatService,
    FeishuBotGroupChatService,
    FeishuBotApprovalService,
    FeishuBotEventService,
    FeishuBotLongConnectionService,
  ],
  exports: [
    FeishuBotConfigService,
    FeishuBotClientService,
    FeishuBotIdentityService,
    FeishuBotProjectChatService,
  ],
})
export class FeishuBotModule {}
