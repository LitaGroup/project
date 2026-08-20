import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentsModule } from '../documents/documents.module';
import { ChecksModule } from '../checks/checks.module';
import { TestsModule } from '../tests/tests.module';
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
    TestsModule,
    FeishuModule,
  ],
  controllers: [ProjectsController],
  providers: [ProjectsService, ProjectSyncService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
