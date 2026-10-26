import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../auth/user.entity';
import { ExecutorsModule } from '../executors/executors.module';
import { Executor } from '../executors/executor.entity';
import { FeishuModule } from '../feishu/feishu.module';
import { WorkersModule } from '../workers/workers.module';
import { Worker } from '../workers/worker.entity';
import { Task } from './task.entity';
import { TaskEvent } from './task-event.entity';
import { TaskTemplate } from './task-template.entity';
import { TaskChatService } from './task-chat.service';
import { TaskDispatchService } from './task-dispatch.service';
import { TaskIdentifyService } from './task-identify.service';
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
      TaskTemplate,
      Worker,
      User,
      Executor,
    ]),
    WorkersModule,
    ExecutorsModule,
    FeishuModule,
  ],
  controllers: [TasksController, TaskTemplatesController],
  providers: [
    TasksService,
    TaskChatService,
    TaskDispatchService,
    TaskIdentifyService,
    TaskLoopService,
    TaskNotifyService,
    TaskRealtimeService,
    TaskTemplatesService,
  ],
  exports: [
    TasksService,
    TaskChatService,
    TaskDispatchService,
    TaskLoopService,
    TaskNotifyService,
    TaskRealtimeService,
    TaskTemplatesService,
  ],
})
export class TasksModule {}
