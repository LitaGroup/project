import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChecksModule } from '../checks/checks.module';
import { ExportsModule } from '../exports/exports.module';
import { Executor } from '../executors/executor.entity';
import { GithubModule } from '../github/github.module';
import { Project } from '../projects/project.entity';
import { TestsModule } from '../tests/tests.module';
import { Worker } from '../workers/worker.entity';
import { WorkersModule } from '../workers/workers.module';
import { ScriptLibraryController } from './script-library.controller';
import { ScriptLibraryDescription } from './script-library-description.entity';
import { ScriptLibraryDescriptionService } from './script-library-description.service';
import { ScriptLibraryRun } from './script-library-run.entity';
import { ScriptLibraryService } from './script-library.service';
import { ScriptLibrarySyncService } from './script-library-sync.service';
import { ScriptsImportController } from './scripts-import.controller';
import { ScriptsImportService } from './scripts-import.service';
import { ScriptsController } from './scripts.controller';
import { ScriptsService } from './scripts.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Project,
      ScriptLibraryRun,
      ScriptLibraryDescription,
      // 描述生成读取脚本描述机器人（#3）与其执行器配置（不 import 各自模块，避免循环依赖）
      Worker,
      Executor,
    ]),
    ChecksModule,
    TestsModule,
    ExportsModule,
    // 脚本库同步依赖 GitHub API 比对 main 分支 HEAD；描述生成需要机器人工位路径
    GithubModule,
    WorkersModule,
  ],
  controllers: [
    ScriptsController,
    ScriptsImportController,
    ScriptLibraryController,
  ],
  providers: [
    ScriptsService,
    ScriptsImportService,
    ScriptLibraryService,
    ScriptLibrarySyncService,
    ScriptLibraryDescriptionService,
  ],
  exports: [ScriptsService, ScriptLibrarySyncService],
})
export class ScriptsModule {}
