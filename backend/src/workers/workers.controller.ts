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
} from '@nestjs/common';
import {
  WorkerKind,
  WorkerLiveStatus,
  WorkerRole,
  WorkerRuntime,
} from '../common/enums';
import { Worker } from './worker.entity';
import { OptimizePromptInput, WorkerAiService } from './worker-ai.service';
import {
  CreateWorkerInput,
  UpdateWorkerInput,
  WorkerView,
  WorkersService,
} from './workers.service';

class CreateWorkerDto implements CreateWorkerInput {
  name: string;
  intro?: string | null;
  kind?: WorkerKind;
  role?: WorkerRole;
  runtime?: WorkerRuntime;
  executorId?: number | null;
  providerId?: string | null;
  modelId?: string | null;
  prompt?: string | null;
  skills?: Worker['skills'];
  taskDefs?: Worker['taskDefs'];
  ownerUserId?: number | null;
  materials?: string | null;
  enabled?: boolean;
}

class UpdateWorkerDto implements UpdateWorkerInput {
  name?: string;
  intro?: string | null;
  kind?: WorkerKind;
  role?: WorkerRole;
  runtime?: WorkerRuntime;
  executorId?: number | null;
  providerId?: string | null;
  modelId?: string | null;
  prompt?: string | null;
  skills?: Worker['skills'];
  taskDefs?: Worker['taskDefs'];
  ownerUserId?: number | null;
  materials?: string | null;
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
    private readonly workerAi: WorkerAiService,
  ) {}

  /** AI 优化角色 PROMPT：结构补全 + 清晰化，返回 Markdown 正文（走执行器） */
  @Post('optimize-prompt')
  async optimizePrompt(
    @Body() dto: OptimizePromptDto,
  ): Promise<{ prompt: string }> {
    return { prompt: await this.workerAi.optimizePrompt(dto) };
  }

  /** 工作概览：全部机器人的实时状态卡片（含系统调度机器人） */
  @Get('live')
  live(): Promise<WorkerLiveCard[]> {
    return this.workersService.findAll().then((list) =>
      list.map((w) => ({
        id: w.id,
        name: w.name,
        intro: w.intro,
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

  /** 机器人列表（kind/role 筛选，附实时状态与工位路径） */
  @Get()
  findAll(
    @Query('kind') kind?: WorkerKind,
    @Query('role') role?: WorkerRole,
  ): Promise<WorkerView[]> {
    return this.workersService.findAll({
      kind: kind || undefined,
      role: role || undefined,
    });
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
