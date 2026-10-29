import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Sse,
} from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import { Observable } from 'rxjs';
import { WorkerLiveStatus, WorkerRole, WorkerRuntime } from '../common/enums';
import { Worker } from './worker.entity';
import type { OptimizePromptInput } from './worker-ai.service';
import { WorkerEnvironmentService } from './worker-environment.service';
import type { WorkerInitializeSnapshot } from './worker-environment.service';
import { WorkerOptimizeService } from './worker-optimize.service';
import type { WorkerOptimizeSnapshot } from './worker-optimize.service';
import {
  SkillCatalogItem,
  WorkerSkillCatalogService,
} from './worker-skill-catalog.service';
import {
  StandardCatalogItem,
  WorkerStandardCatalogService,
} from './worker-standard-catalog.service';
import {
  CreateWorkerInput,
  UpdateWorkerInput,
  WorkerView,
  WorkersService,
} from './workers.service';

class CreateWorkerDto implements CreateWorkerInput {
  name: string;
  intro?: string | null;
  avatarUrl?: string | null;
  role?: WorkerRole;
  runtime?: WorkerRuntime;
  executorId?: number | null;
  providerId?: string | null;
  modelId?: string | null;
  prompt?: string | null;
  skills?: Worker['skills'];
  standards?: Worker['standards'];
  taskDefs?: Worker['taskDefs'];
  ownerUserId?: number | null;
  enabled?: boolean;
}

class UpdateWorkerDto implements UpdateWorkerInput {
  name?: string;
  intro?: string | null;
  avatarUrl?: string | null;
  role?: WorkerRole;
  runtime?: WorkerRuntime;
  executorId?: number | null;
  providerId?: string | null;
  modelId?: string | null;
  prompt?: string | null;
  skills?: Worker['skills'];
  standards?: Worker['standards'];
  taskDefs?: Worker['taskDefs'];
  ownerUserId?: number | null;
  enabled?: boolean;
}

class OptimizePromptDto implements OptimizePromptInput {
  prompt?: string;
  workerId?: number | null;
  executorId?: number | null;
  providerId?: string | null;
  modelId?: string | null;
}

/** 工作概览的卡片数据（前端 5s 轮询） */
export interface WorkerLiveCard {
  id: number;
  name: string;
  intro: string | null;
  avatarUrl: string | null;
  role: WorkerRole;
  runtime: WorkerRuntime;
  executorId: number | null;
  providerId: string | null;
  modelId: string | null;
  ownerName: string | null;
  liveStatus: WorkerLiveStatus;
  activeTask: WorkerView['activeTask'];
  workdir: string | null;
  /** 系统机器人（id < 1000，代码内置） */
  system: boolean;
}

@Controller('workers')
export class WorkersController {
  constructor(
    private readonly workersService: WorkersService,
    private readonly workerOptimize: WorkerOptimizeService,
    private readonly workerEnvironment: WorkerEnvironmentService,
    private readonly skillCatalog: WorkerSkillCatalogService,
    private readonly standardCatalog: WorkerStandardCatalogService,
  ) {}

  /**
   * AI 优化机器人 AGENTS.md：异步执行并立即返回运行快照（配置类错误同步 400），
   * 进度与结果经 SSE GET /workers/optimize-prompt/:runId/stream 推送——同步长请求
   * 会被网关（如 ALB 60s）以 504 掐断而后端继续跑完，故刻意异步化。
   */
  @Post('optimize-prompt')
  optimizePrompt(
    @Body() dto: OptimizePromptDto,
  ): Promise<WorkerOptimizeSnapshot> {
    return this.workerOptimize.start(dto);
  }

  /** 优化任务快照（刷新页面/晚订阅时恢复进度与结果） */
  @Get('optimize-prompt/:runId')
  optimizeSnapshot(@Param('runId') runId: string): WorkerOptimizeSnapshot {
    return this.workerOptimize.snapshotOf(runId);
  }

  /** 优化进度实时流（SSE）：订阅即收快照，进度行/终态实时推送，心跳保活 */
  @Sse('optimize-prompt/:runId/stream')
  streamOptimizePrompt(
    @Param('runId') runId: string,
  ): Observable<MessageEvent> {
    return this.workerOptimize.stream(runId);
  }

  /** 工作概览：全部机器人的实时状态卡片（含系统调度机器人） */
  @Get('live')
  live(): Promise<WorkerLiveCard[]> {
    return this.workersService.findAll().then((list) =>
      list.map((w) => ({
        id: w.id,
        name: w.name,
        intro: w.intro,
        avatarUrl: w.avatarUrl,
        role: w.role,
        runtime: w.runtime,
        executorId: w.executorId,
        providerId: w.providerId,
        modelId: w.modelId,
        ownerName: w.ownerName,
        liveStatus: w.liveStatus,
        activeTask: w.activeTask,
        workdir: w.workdir,
        system: w.system,
      })),
    );
  }

  /** 机器人列表（role 筛选，附实时状态与工位路径） */
  @Get()
  findAll(@Query('role') role?: WorkerRole): Promise<WorkerView[]> {
    return this.workersService.findAll({ role: role || undefined });
  }

  /** 技能库目录：从 Gitea docs/skills 发现可选 SKILL.md */
  @Get('skill-catalog')
  listSkillCatalog(@Query('q') q?: string): Promise<SkillCatalogItem[]> {
    return this.skillCatalog.search(q);
  }

  /** 规范库目录：从 Gitea docs/standard 发现可选目录 README.md（不含根目录） */
  @Get('standard-catalog')
  listStandardCatalog(@Query('q') q?: string): Promise<StandardCatalogItem[]> {
    return this.standardCatalog.search(q);
  }

  /**
   * 启动工作环境初始化：异步执行并立即返回运行快照（配置类错误同步 400），
   * 进度经 SSE GET /workers/:id/initialize/stream 推送——同步长请求会被网关
   * （如 ALB 60s）以 504 掐断而后端继续跑完，故刻意异步化。
   */
  @Post(':id/initialize')
  initialize(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<WorkerInitializeSnapshot> {
    return this.workerEnvironment.start(id);
  }

  /** 最近一次初始化快照（无任务为 idle；页面刷新后恢复进度展示用） */
  @Get(':id/initialize')
  initializeSnapshot(
    @Param('id', ParseIntPipe) id: number,
  ): WorkerInitializeSnapshot {
    return this.workerEnvironment.snapshotOf(id);
  }

  /** 初始化进度实时流（SSE）：订阅即收快照，进度行/终态实时推送，心跳保活 */
  @Sse(':id/initialize/stream')
  streamInitialize(
    @Param('id', ParseIntPipe) id: number,
  ): Observable<MessageEvent> {
    return this.workerEnvironment.stream(id);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number): Promise<WorkerView> {
    return this.workersService.findOneView(id);
  }

  @Post()
  create(@Body() dto: CreateWorkerDto): Promise<WorkerView> {
    return this.workersService.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateWorkerDto,
  ): Promise<WorkerView> {
    return this.workersService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.workersService.remove(id);
  }
}
