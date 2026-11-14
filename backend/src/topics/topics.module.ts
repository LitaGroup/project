import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../auth/user.entity';
import { FeishuModule } from '../feishu/feishu.module';
import { FeishuBotBacklogChat } from '../feishu-bot/feishu-bot-backlog-chat.entity';
import { FeishuBotModule } from '../feishu-bot/feishu-bot.module';
import { FeishuBotProjectChat } from '../feishu-bot/feishu-bot-project-chat.entity';
import { FeishuBotTaskChat } from '../feishu-bot/feishu-bot-task-chat.entity';
import { Idea } from '../ideas/idea.entity';
import { Backlog } from '../iterations/backlog.entity';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { Task } from '../tasks/task.entity';
import { TasksModule } from '../tasks/tasks.module';
import { Ticket } from '../tickets/ticket.entity';
import { Worker } from '../workers/worker.entity';
import { WorkersModule } from '../workers/workers.module';
import { Topic } from './topic.entity';
import { TopicNotification } from './topic-notification.entity';
import { TopicNotifyService } from './topic-notify.service';
import { TopicRead } from './topic-read.entity';
import { TopicRealtimeService } from './topic-realtime.service';
import { TopicReply } from './topic-reply.entity';
import { TopicTaskContext } from './topic-task-context.entity';
import {
  TopicsController,
  TopicsListMarkdownController,
  TopicsMarkdownController,
} from './topics.controller';
import { TopicsService } from './topics.service';

/**
 * 话题（Topic）：灵感 / 迭代项 / 知识 / 任务 / 工单的统一讨论区。
 * 任务消息镜像需要 TaskChatService，任务投递/答复需要 TasksModule；
 * TasksModule 反向注入 TopicsService 做提问答复/验收不通过同步，使用 forwardRef。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Topic,
      TopicReply,
      TopicRead,
      TopicNotification,
      TopicTaskContext,
      Idea,
      Backlog,
      Task,
      Ticket,
      Worker,
      User,
      FeishuBotBacklogChat,
      FeishuBotTaskChat,
      FeishuBotProjectChat,
    ]),
    KnowledgeModule,
    FeishuModule,
    forwardRef(() => FeishuBotModule),
    WorkersModule,
    forwardRef(() => TasksModule),
  ],
  controllers: [
    TopicsListMarkdownController,
    TopicsMarkdownController,
    TopicsController,
  ],
  providers: [TopicsService, TopicNotifyService, TopicRealtimeService],
  exports: [TopicsService, TopicRealtimeService],
})
export class TopicsModule {}
