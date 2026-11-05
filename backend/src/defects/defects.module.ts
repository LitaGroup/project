import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../auth/user.entity';
import { Project } from '../projects/project.entity';
import { ProjectRelease } from '../releases/project-release.entity';
import { Task } from '../tasks/task.entity';
import { TasksModule } from '../tasks/tasks.module';
import { TestsModule } from '../tests/tests.module';
import { Worker } from '../workers/worker.entity';
import { DefectChangeRecord } from './defect-change-record.entity';
import { Defect } from './defect.entity';
import {
  DefectsController,
  DefectsMarkdownController,
} from './defects.controller';
import { DefectsService } from './defects.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Defect,
      DefectChangeRecord,
      Project,
      ProjectRelease,
      Worker,
      User,
      Task,
    ]),
    TestsModule,
    TasksModule,
  ],
  controllers: [DefectsController, DefectsMarkdownController],
  providers: [DefectsService],
  exports: [DefectsService],
})
export class DefectsModule {}
