import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../auth/user.entity';
import { ExecutorsModule } from '../executors/executors.module';
import { Executor } from '../executors/executor.entity';
import { FeishuModule } from '../feishu/feishu.module';
import { PiModule } from '../pi/pi.module';
import { WorkersModule } from '../workers/workers.module';
import { Worker } from '../workers/worker.entity';
import { DispatchPlan } from './dispatch-plan.entity';
import { Task } from './task.entity';
import { TaskEvent } from './task-event.entity';
import { TaskTemplate } from './task-template.entity';
import { TaskDispatchService } from './task-dispatch.service';
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
      DispatchPlan,
      Worker,
      User,
      Executor,
    ]),
    WorkersModule,
    ExecutorsModule,
    FeishuModule,
    PiModule,
  ],
  controllers: [TasksController, TaskTemplatesController],
  providers: [TasksService, TaskDispatchService, TaskTemplatesService],
  exports: [TasksService, TaskDispatchService, TaskTemplatesService],
})
export class TasksModule {}
