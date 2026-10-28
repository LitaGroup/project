import {
  BadRequestException,
  Body,
  Controller,
  Get,
  MessageEvent,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Sse,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { ScriptLibraryDescriptionService } from './script-library-description.service';
import {
  ScriptLibraryListResponse,
  ScriptLibraryScriptDetail,
  ScriptLibraryService,
} from './script-library.service';
import { ScriptLibraryRun } from './script-library-run.entity';
import { ScriptLibrarySyncService } from './script-library-sync.service';
import type { ScriptLibrarySyncStatus } from './script-library-sync.service';

class StartLibraryRunDto {
  /** 脚本位置：相对脚本根目录的路径（projects/ 下，.check.ts/.test.ts/.export.ts） */
  path?: string;
}

class RegenerateDescriptionDto {
  /** 脚本位置：相对脚本根目录的路径 */
  path?: string;
}

/** 同步状态 + 描述队列统计 */
export type ScriptLibraryStatusResponse = ScriptLibrarySyncStatus & {
  descriptions: {
    pending: number;
    running: number;
    done: number;
    error: number;
  };
};

/**
 * 脚本库：scripts 仓库 main 分支的脚本搜索/详情/直接运行与同步状态。
 * 脚本无需登记到项目即可运行；项目内登记的检查/用例/导出运行不受影响。
 */
@Controller('script-library')
export class ScriptLibraryController {
  constructor(
    private readonly libraryService: ScriptLibraryService,
    private readonly syncService: ScriptLibrarySyncService,
    private readonly descriptionService: ScriptLibraryDescriptionService,
  ) {}

  /** 脚本列表：q 匹配路径或描述，type 过滤类型（check/test/export）；有关键词按相关度、无关键词按路径排序分页 */
  @Get('scripts')
  listScripts(
    @Query('q') q?: string,
    @Query('type') type?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<ScriptLibraryListResponse> {
    return this.libraryService.listScripts(
      q,
      type,
      page === undefined ? 1 : Number(page),
      pageSize === undefined ? 50 : Number(pageSize),
    );
  }

  /** 脚本详情（含源码、描述、main HEAD 与 GitHub 原文链接） */
  @Get('script')
  findScript(@Query('path') path?: string): Promise<ScriptLibraryScriptDetail> {
    if (!path) throw new BadRequestException('缺少 path 参数');
    return this.libraryService.findScript(path);
  }

  /** 同步状态与描述队列统计 */
  @Get('status')
  status(): Promise<ScriptLibraryStatusResponse> {
    return this.composeStatus();
  }

  /** 手动触发一次同步（与每分钟定时同步同一实现；进行中时幂等返回当前状态） */
  @Post('sync')
  async sync(): Promise<ScriptLibraryStatusResponse> {
    await this.syncService.syncOnce('手动同步');
    return this.composeStatus();
  }

  /** 手动重新生成脚本描述：转回待生成队列，由脚本描述机器人（#3）重新分析 */
  @Post('descriptions/regenerate')
  regenerateDescription(
    @Body() dto: RegenerateDescriptionDto,
  ): Promise<ScriptLibraryStatusResponse> {
    if (!dto.path) throw new BadRequestException('缺少 path 参数');
    return this.descriptionService
      .regenerate(dto.path)
      .then(() => this.composeStatus());
  }

  /** 启动一次脚本运行：立即返回 running 记录，脚本后台异步执行 */
  @Post('runs')
  startRun(@Body() dto: StartLibraryRunDto): Promise<ScriptLibraryRun> {
    return this.libraryService.startRun(dto);
  }

  /** 某脚本的运行历史（倒序，上限 50） */
  @Get('runs')
  listRuns(@Query('path') path?: string): Promise<ScriptLibraryRun[]> {
    if (!path) throw new BadRequestException('缺少 path 参数');
    return this.libraryService.listRuns(path);
  }

  /** 单次运行详情（含实时进度与产物清单） */
  @Get('runs/:runId')
  findRun(
    @Param('runId', ParseIntPipe) runId: number,
  ): Promise<ScriptLibraryRun> {
    return this.libraryService.findRun(runId);
  }

  /** 单次运行的 SSE 实时流：先推当前快照，进度变化持续推送，终态推送后自动完成 */
  @Sse('runs/:runId/stream')
  streamRun(
    @Param('runId', ParseIntPipe) runId: number,
  ): Observable<MessageEvent> {
    return this.libraryService.streamRun(runId);
  }

  /** 同步状态快照 + 描述队列统计 */
  private composeStatus(): Promise<ScriptLibraryStatusResponse> {
    return this.descriptionService.getStats().then((descriptions) => ({
      ...this.syncService.getStatus(),
      descriptions,
    }));
  }
}
