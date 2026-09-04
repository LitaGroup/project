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
import { ExportRun } from './export-run.entity';
import { Export } from './export.entity';
import { ExportsService } from './exports.service';

class CreateExportDto {
  projectId: number;
  /** 编号（手工定义，项目内唯一） */
  code: string;
  /** 描述：脚本导出的内容 */
  description?: string;
  /** 脚本位置：相对脚本根目录的 .export.ts 路径 */
  scriptPath: string;
}

class UpdateExportDto {
  code?: string;
  description?: string;
  scriptPath?: string;
}

class ImportExportsDto {
  projectId: number;
}

@Controller('exports')
export class ExportsController {
  constructor(private readonly exportsService: ExportsService) {}

  /** 脚本自动联想：扫描 .export.ts 文件；传 projectId 时限定在项目脚本目录的 exports 子目录下（须声明在 :id 之前） */
  @Get('scripts')
  listScripts(
    @Query('q') keyword?: string,
    @Query('projectId') projectId?: string,
  ): Promise<string[]> {
    return this.exportsService.listScripts(
      keyword,
      projectId === undefined ? undefined : Number(projectId),
    );
  }

  /** 导出列表：传 projectId 按项目过滤，不传返回全部 */
  @Get()
  findByProject(@Query('projectId') projectId?: string): Promise<Export[]> {
    return this.exportsService.findByProject(
      projectId === undefined ? undefined : Number(projectId),
    );
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number): Promise<Export> {
    return this.exportsService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateExportDto): Promise<Export> {
    return this.exportsService.create(dto);
  }

  /** 自动导入：扫描项目脚本目录 exports 子目录下所有 .export.ts，过滤已登记的，其余全部导入 */
  @Post('import')
  importFromScripts(
    @Body() dto: ImportExportsDto,
  ): Promise<{ created: Export[]; skipped: number }> {
    return this.exportsService.importFromScripts(dto.projectId);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateExportDto,
  ): Promise<Export> {
    return this.exportsService.update(id, dto);
  }

  /** 启动一次脚本运行：立即返回 running 记录，脚本后台异步执行，前端经 SSE 获取进度 */
  @Post(':id/runs')
  startRun(@Param('id', ParseIntPipe) id: number): Promise<ExportRun> {
    return this.exportsService.startRun(id);
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
    const exportItem = await this.exportsService.findOne(id);
    const run = await this.exportsService.startRun(id);
    await streamRunMarkdown(
      res,
      [
        `# 运行导出 \`${exportItem.code}\``,
        '',
        `- 运行 ID：${run.id}`,
        `- 脚本：${exportItem.scriptPath}`,
        `- 详情：/api/exports/runs/${run.id}`,
      ],
      this.exportsService.streamRun(run.id),
    );
  }

  /** 运行历史（倒序，上限 50；须声明在 :id 之前避免路由冲突） */
  @Get(':id/runs')
  listRuns(@Param('id', ParseIntPipe) id: number): Promise<ExportRun[]> {
    return this.exportsService.listRuns(id);
  }

  /** 单次运行详情 Markdown 视图（须声明在 JSON 版之前避免路由冲突） */
  @Get('runs/:runId.md')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  async findRunMarkdown(
    @Param('runId', ParseIntPipe) runId: number,
  ): Promise<string> {
    const run = await this.exportsService.findRun(runId);
    // export 可能已被删除，运行记录仍可单独展示
    const exportItem = await this.exportsService
      .findOne(run.exportId)
      .catch(() => null);
    const files = run.files ?? [];
    return renderRunMarkdown(
      `导出运行 #${run.id}`,
      [
        ...(exportItem
          ? [`- 导出：\`${exportItem.code}\`（脚本：${exportItem.scriptPath}）`]
          : [`- 导出：#${run.exportId}（已删除）`]),
        `- 详情（JSON）：/api/exports/runs/${run.id}`,
        ...(files.length > 0
          ? [
              `- 产物文件（点击下载）：`,
              ...files.map(
                (f) =>
                  `  - [${f.title || f.file}](/export-files/${run.exportId}/${run.id}/${f.file})`,
              ),
            ]
          : []),
      ],
      run,
    );
  }

  /** 单次运行详情（含实时进度与完整结果；须声明在 :id 之前） */
  @Get('runs/:runId')
  findRun(@Param('runId', ParseIntPipe) runId: number): Promise<ExportRun> {
    return this.exportsService.findRun(runId);
  }

  /** 单次运行的 SSE 实时流：先推当前快照，进度变化持续推送，终态推送后自动完成 */
  @Sse('runs/:runId/stream')
  streamRun(
    @Param('runId', ParseIntPipe) runId: number,
  ): Observable<MessageEvent> {
    return this.exportsService.streamRun(runId);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.exportsService.remove(id);
  }
}
