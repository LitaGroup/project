import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../auth/user.entity';
import { ExecutorsModule } from '../executors/executors.module';
import { Executor } from '../executors/executor.entity';
import { Task } from '../tasks/task.entity';
import { TaskTemplate } from '../tasks/task-template.entity';
import { Worker } from './worker.entity';
import { WorkerDebugSession } from './worker-debug-session.entity';
import { SystemWorkersService } from './system-workers.service';
import { WorkerAiService } from './worker-ai.service';
import { WorkerEnvironmentService } from './worker-environment.service';
import { WorkerSkillCatalogService } from './worker-skill-catalog.service';
import { WorkerStandardCatalogService } from './worker-standard-catalog.service';
import { WorkerDebugController } from './worker-debug.controller';
import { WorkerDebugService } from './worker-debug.service';
import { WorkersController } from './workers.controller';
import { WorkersService } from './workers.service';

@Module({
  // 直接注册 Task/TaskTemplate/User/Executor 实体做状态推导与校验（不 import 各自模块，避免循环依赖）
  imports: [
    TypeOrmModule.forFeature([
      Worker,
      Task,
      TaskTemplate,
      User,
      Executor,
      WorkerDebugSession,
    ]),
    ExecutorsModule,
  ],
  controllers: [WorkerDebugController, WorkersController],
  providers: [
    WorkersService,
    SystemWorkersService,
    WorkerAiService,
    WorkerEnvironmentService,
    WorkerSkillCatalogService,
    WorkerStandardCatalogService,
    WorkerDebugService,
  ],
  exports: [WorkersService],
})
export class WorkersModule {}
