import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Worker } from '../workers/worker.entity';
import { Task } from '../tasks/task.entity';
import { TaskTemplate } from '../tasks/task-template.entity';
import { TaskType } from './task-type.entity';
import { TaskTypesController } from './task-types.controller';
import { TaskTypesService } from './task-types.service';

@Module({
  imports: [TypeOrmModule.forFeature([TaskType, Task, TaskTemplate, Worker])],
  controllers: [TaskTypesController],
  providers: [TaskTypesService],
  exports: [TaskTypesService],
})
export class TaskTypesModule {}
