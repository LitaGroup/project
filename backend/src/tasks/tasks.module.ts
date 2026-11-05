import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../auth/user.entity';
import { ExecutorsModule } from '../executors/executors.module';
import { Executor } from '../executors/executor.entity';
import { FeishuModule } from '../feishu/feishu.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { TaskTypesModule } from '../task-types/task-types.module';
import { WorkersModule } from '../workers/workers.module';
import { Worker } from '../workers/worker.entity';
import { Task } from './task.entity';
import { TaskEvent } from './task-event.entity';
import { TaskMessage } from './task-message.entity';
import { TaskTemplateFollow } from './task-template-follow.entity';
import { TaskTemplate } from './task-template.entity';
import { TaskWorkerInbox } from './task-worker-inbox.entity';
import { TaskWorkerInboxService } from './task-worker-inbox.service';
import { TaskCollaborationService } from './task-collaboration.service';
import { TaskAssignmentService } from './task-assignment.service';
import { TaskChatService } from './task-chat.service';
import { TaskDeliveryService } from './task-delivery.service';
import { TaskDispatchService } from './task-dispatch.service';
import { TaskDocumentService } from './task-document.service';
import { TaskHandoffService } from './task-handoff.service';
import { TaskLoopService } from './task-loop.service';
import { TaskNotifyService } from './task-notify.service';
import { TaskQuestionAutoAnswerService } from './task-question-auto-answer.service';
import { TaskRealtimeService } from './task-realtime.service';
import { TaskReleaseNotificationService } from './task-release-notification.service';
import { TaskRequesterReplyService } from './task-requester-reply.service';
import { TaskRequesterVerifyService } from './task-requester-verify.service';
import {
  TaskTemplatesController,
  TaskTemplatesListMarkdownController,
  TaskTemplatesMarkdownController,
} from './task-templates.controller';
import { TaskTemplatesService } from './task-templates.service';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import {
  TasksAgentMarkdownController,
  TasksListMarkdownController,
} from './tasks-agent.controller';
import { TasksAgentService } from './tasks-agent.service';
import { WorkbenchController } from './workbench.controller';
import { WorkbenchService } from './workbench.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Task,
      TaskEvent,
      TaskMessage,
      TaskTemplate,
      TaskTemplateFollow,
      TaskWorkerInbox,
      Worker,
      User,
      Executor,
    ]),
    WorkersModule,
    ExecutorsModule,
    FeishuModule,
    TaskTypesModule,
    KnowledgeModule,
  ],
  controllers: [
    TasksController,
    TaskTemplatesListMarkdownController,
    TaskTemplatesMarkdownController,
    TaskTemplatesController,
    WorkbenchController,
    TasksListMarkdownController,
    TasksAgentMarkdownController,
  ],
  providers: [
    TasksService,
    TasksAgentService,
    TaskAssignmentService,
    TaskChatService,
    TaskDeliveryService,
    TaskDispatchService,
    TaskDocumentService,
    TaskHandoffService,
    TaskLoopService,
    TaskNotifyService,
    TaskQuestionAutoAnswerService,
    TaskRequesterReplyService,
    TaskRequesterVerifyService,
    TaskReleaseNotificationService,
    TaskWorkerInboxService,
    TaskCollaborationService,
    TaskRealtimeService,
    TaskTemplatesService,
    WorkbenchService,
  ],
  exports: [
    TasksService,
    TaskChatService,
    TaskDispatchService,
    TaskDocumentService,
    TaskHandoffService,
    TaskLoopService,
    TaskNotifyService,
    TaskRealtimeService,
    TaskTemplatesService,
    TaskWorkerInboxService,
  ],
})
export class TasksModule {}
