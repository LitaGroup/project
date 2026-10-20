import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../auth/user.entity';
import { FeishuModule } from '../feishu/feishu.module';
import { Project } from '../projects/project.entity';
import { ProjectRelease } from './project-release.entity';
import {
  ReleaseRecordsController,
  ReleasesController,
  ReleasesMarkdownController,
} from './releases.controller';
import { ReleasesService } from './releases.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ProjectRelease, Project, User]),
    FeishuModule,
  ],
  controllers: [
    ReleasesController,
    ReleasesMarkdownController,
    ReleaseRecordsController,
  ],
  providers: [ReleasesService],
  exports: [ReleasesService],
})
export class ReleasesModule {}
