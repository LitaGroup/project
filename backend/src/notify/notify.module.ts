import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Project } from '../projects/project.entity';
import { Schedule } from '../schedules/schedule.entity';
import { NotifyService } from './notify.service';

@Module({
  imports: [TypeOrmModule.forFeature([Project, Schedule])],
  providers: [NotifyService],
  exports: [NotifyService],
})
export class NotifyModule {}
