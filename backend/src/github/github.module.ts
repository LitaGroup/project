import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Subject } from 'rxjs';
import { ProjectBranch } from './project-branch.entity';
import { CodeEvent } from './code-event.entity';
import { Repo } from './repo.entity';
import { Project } from '../projects/project.entity';
import { GithubController } from './github.controller';
import { CodeBranchesController } from './code-branches.controller';
import {
  CodeEventsController,
  CodeEventsMarkdownController,
} from './code-events.controller';
import { ReposController, ReposMarkdownController } from './repos.controller';
import { GithubService } from './github.service';
import { CodeBranchesService } from './code-branches.service';
import { CodeEventsService } from './code-events.service';
import { ReposService } from './repos.service';
import {
  CODE_EVENT_BUS,
  CodeEventPayload,
  GithubWatchService,
} from './github-watch.service';

/**
 * GitHub 集成：仓库/分支搜索、项目代码分支登记、test/main/stable 等登记分支的
 * 提交/合并监听（轮询 GitHub API，新事件广播到 CODE_EVENT_BUS，供后续动作接入）。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([ProjectBranch, CodeEvent, Repo, Project]),
  ],
  controllers: [
    GithubController,
    CodeBranchesController,
    CodeEventsController,
    CodeEventsMarkdownController,
    ReposController,
    ReposMarkdownController,
  ],
  providers: [
    GithubService,
    CodeBranchesService,
    CodeEventsService,
    ReposService,
    GithubWatchService,
    { provide: CODE_EVENT_BUS, useValue: new Subject<CodeEventPayload>() },
  ],
  exports: [GithubService, CodeBranchesService, ReposService, CODE_EVENT_BUS],
})
export class GithubModule {}
