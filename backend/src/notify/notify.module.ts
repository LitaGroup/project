import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Project } from '../projects/project.entity';
import { Task } from '../tasks/task.entity';
import { NotifyService } from './notify.service';

@Module({
  imports: [TypeOrmModule.forFeature([Project, Task])],
  providers: [NotifyService],
  exports: [NotifyService],
})
export class NotifyModule {}
