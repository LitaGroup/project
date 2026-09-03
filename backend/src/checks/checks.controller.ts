import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  MessageEvent,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Res,
  Sse,
} from '@nestjs/common';
import type { Response } from 'express';
import { Observable } from 'rxjs';
import { streamRunMarkdown, renderRunMarkdown } from '../common/run-markdown';
import { CheckRun } from './check-run.entity';
import { Check } from './check.entity';
import { ChecksService } from './checks.service';

class CreateCheckDto {
  projectId: number;
  /** 编号（手工定义，项目内唯一） */
  code: string;
  /** 描述：脚本检查的内容 */
  description?: string;
  /** 脚本位置：相对脚本根目录的 .check.ts 路径 */
  scriptPath: string;
  /** 运行设备/目标：server/h5 本地直跑；android/ios 走 appium-agent 远程 */
  device?: string | null;
}

class UpdateCheckDto {
  code?: string;
  description?: string;
  scriptPath?: string;
  device?: string | null;
}

class ImportChecksDto {
  projectId: number;
}

@Controller('checks')
export class ChecksController {
  constructor(private readonly checksService: ChecksService) {}

  /** 脚本自动联想：扫描 .check.ts 文件；传 projectId 时限定在项目的脚本目录下（须声明在 :id 之前） */
  @Get('scripts')
  listScripts(
    @Query('q') keyword?: string,
    @Query('projectId') projectId?: string,
  ): Promise<string[]> {
    return this.checksService.listScripts(
      keyword,
      projectId === undefined ? undefined : Number(projectId),
    );
  }

  /** 脚本目录自动联想：包含 .check.ts 的目录（含父目录，相对脚本根目录），供设置项目 scriptsPath（须声明在 :id 之前） */
  @Get('script-dirs')
  listScriptDirs(@Query('q') keyword?: string): Promise<string[]> {
    return this.checksService.listScriptDirs(keyword);
  }

  /** 检查列表：传 projectId 按项目过滤，不传返回全部 */
  @Get()
  findByProject(@Query('projectId') projectId?: string): Promise<Check[]> {
    return this.checksService.findByProject(
      projectId === undefined ? undefined : Number(projectId),
    );
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number): Promise<Check> {
    return this.checksService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateCheckDto): Promise<Check> {
    return this.checksService.create(dto);
  }

  /** 自动导入：扫描项目脚本目录下所有 .check.ts，过滤已登记的，其余全部导入 */
  @Post('import')
  importFromScripts(
    @Body() dto: ImportChecksDto,
  ): Promise<{ created: Check[]; skipped: number }> {
    return this.checksService.importFromScripts(dto.projectId);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCheckDto,
  ): Promise<Check> {
    return this.checksService.update(id, dto);
  }

  /** 启动一次脚本运行：立即返回 running 记录，脚本后台异步执行，前端轮询 getRun 获取进度 */
  @Post(':id/runs')
  startRun(@Param('id', ParseIntPipe) id: number): Promise<CheckRun> {
    return this.checksService.startRun(id);
  }

  /**
   * AI 用：启动一次运行并以 Markdown 流式返回结果（text/markdown）。
   * 运行中逐行输出脚本原始输出，结束时附"结果"小节；用法见项目 .md 视图。
   */
  @Post(':id/run.md')
  async runMarkdown(
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ): Promise<void> {
    const check = await this.checksService.findOne(id);
    const run = await this.checksService.startRun(id);
    await streamRunMarkdown(
      res,
      [
        `# 运行检查 \`${check.code}\``,
        '',
        `- 运行 ID：${run.id}`,
        `- 脚本：${check.scriptPath}`,
        `- 详情：/api/checks/runs/${run.id}`,
      ],
      this.checksService.streamRun(run.id),
    );
  }

  /** 运行历史（倒序，上限 50；须声明在 :id 之前避免路由冲突） */
  @Get(':id/runs')
  listRuns(@Param('id', ParseIntPipe) id: number): Promise<CheckRun[]> {
    return this.checksService.listRuns(id);
  }

  /** 单次运行详情 Markdown 视图（须声明在 JSON 版之前避免路由冲突） */
  @Get('runs/:runId.md')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  async findRunMarkdown(
    @Param('runId', ParseIntPipe) runId: number,
  ): Promise<string> {
    const run = await this.checksService.findRun(runId);
    // check 可能已被删除，运行记录仍可单独展示
    const check = await this.checksService
      .findOne(run.checkId)
      .catch(() => null);
    return renderRunMarkdown(
      `检查运行 #${run.id}`,
      [
        ...(check
          ? [`- 检查：\`${check.code}\`（脚本：${check.scriptPath}）`]
          : [`- 检查：#${run.checkId}（已删除）`]),
        `- 详情（JSON）：/api/checks/runs/${run.id}`,
      ],
      run,
    );
  }

  /** 单次运行详情（含实时进度与完整结果；须声明在 :id 之前） */
  @Get('runs/:runId')
  findRun(@Param('runId', ParseIntPipe) runId: number): Promise<CheckRun> {
    return this.checksService.findRun(runId);
  }

  /** 单次运行的 SSE 实时流：先推当前快照，进度变化持续推送，终态推送后自动完成 */
  @Sse('runs/:runId/stream')
  streamRun(
    @Param('runId', ParseIntPipe) runId: number,
  ): Observable<MessageEvent> {
    return this.checksService.streamRun(runId);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.checksService.remove(id);
  }
}
