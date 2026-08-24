import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentsModule } from '../documents/documents.module';
import { ChecksModule } from '../checks/checks.module';
import { TasksModule } from '../tasks/tasks.module';
import { TestsModule } from '../tests/tests.module';
import { DefectsModule } from '../defects/defects.module';
import { FeishuModule } from '../feishu/feishu.module';
import { Project } from './project.entity';
import { ProjectSyncService } from './project-sync.service';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { SyncState } from './sync-state.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Project, SyncState]),
    DocumentsModule,
    ChecksModule,
    TasksModule,
    TestsModule,
    DefectsModule,
    FeishuModule,
  ],
  controllers: [ProjectsController],
  providers: [ProjectsService, ProjectSyncService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
