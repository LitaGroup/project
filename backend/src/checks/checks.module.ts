import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotifyModule } from '../notify/notify.module';
import { Project } from '../projects/project.entity';
import { TasksModule } from '../tasks/tasks.module';
import { CheckRun } from './check-run.entity';
import { Check } from './check.entity';
import { ChecksController } from './checks.controller';
import { ChecksService } from './checks.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Check, CheckRun, Project]),
    forwardRef(() => TasksModule),
    NotifyModule,
  ],
  controllers: [ChecksController],
  providers: [ChecksService],
  exports: [ChecksService],
})
export class ChecksModule {}
