import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../auth/user.entity';
import { Executor } from '../executors/executor.entity';
import { Task } from '../tasks/task.entity';
import { TaskTemplate } from '../tasks/task-template.entity';
import { Worker } from './worker.entity';
import { SystemWorkersService } from './system-workers.service';
import { WorkerAiService } from './worker-ai.service';
import { WorkerDebugController } from './worker-debug.controller';
import { WorkerDebugService } from './worker-debug.service';
import { WorkersController } from './workers.controller';
import { WorkersService } from './workers.service';

@Module({
  // 直接注册 Task/TaskTemplate/User/Executor 实体做状态推导与校验（不 import 各自模块，避免循环依赖）
  imports: [
    TypeOrmModule.forFeature([Worker, Task, TaskTemplate, User, Executor]),
  ],
  controllers: [WorkerDebugController, WorkersController],
  providers: [
    WorkersService,
    SystemWorkersService,
    WorkerAiService,
    WorkerDebugService,
  ],
  exports: [WorkersService],
})
export class WorkersModule {}
