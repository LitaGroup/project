import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../auth/user.entity';
import { Executor } from '../executors/executor.entity';
import { PiModule } from '../pi/pi.module';
import { Task } from '../tasks/task.entity';
import { TaskTemplate } from '../tasks/task-template.entity';
import { Worker } from './worker.entity';
import { WorkersController } from './workers.controller';
import { WorkersService } from './workers.service';

@Module({
  // 直接注册 Task/TaskTemplate/User/Executor 实体做状态推导与校验（不 import 各自模块，避免循环依赖）
  imports: [
    TypeOrmModule.forFeature([Worker, Task, TaskTemplate, User, Executor]),
    PiModule,
  ],
  controllers: [WorkersController],
  providers: [WorkersService],
  exports: [WorkersService],
})
export class WorkersModule {}
