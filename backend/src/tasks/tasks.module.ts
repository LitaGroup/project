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
import { TaskTemplate } from './task-template.entity';
import { TaskAssignmentService } from './task-assignment.service';
import { TaskChatService } from './task-chat.service';
import { TaskDispatchService } from './task-dispatch.service';
import { TaskHandoffService } from './task-handoff.service';
import { TaskLoopService } from './task-loop.service';
import { TaskNotifyService } from './task-notify.service';
import { TaskRealtimeService } from './task-realtime.service';
import { TaskTemplatesController } from './task-templates.controller';
import { TaskTemplatesService } from './task-templates.service';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Task,
      TaskEvent,
      TaskMessage,
      TaskTemplate,
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
  controllers: [TasksController, TaskTemplatesController],
  providers: [
    TasksService,
    TaskAssignmentService,
    TaskChatService,
    TaskDispatchService,
    TaskHandoffService,
    TaskLoopService,
    TaskNotifyService,
    TaskRealtimeService,
    TaskTemplatesService,
  ],
  exports: [
    TasksService,
    TaskChatService,
    TaskDispatchService,
    TaskHandoffService,
    TaskLoopService,
    TaskNotifyService,
    TaskRealtimeService,
    TaskTemplatesService,
  ],
})
export class TasksModule {}
