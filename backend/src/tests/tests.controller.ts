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
import { TestRun } from './test-run.entity';
import { Test } from './test.entity';
import { TestsService } from './tests.service';

class CreateTestDto {
  projectId: number;
  /** 编号（手工定义，项目内唯一） */
  code: string;
  /** 描述：脚本测试的内容 */
  description?: string;
  /** 脚本位置：相对脚本根目录的 .test.ts 路径 */
  scriptPath: string;
  /** 运行设备/目标：server/h5 本地直跑；android/ios 走 appium-agent 远程 */
  device?: string | null;
}

class UpdateTestDto {
  code?: string;
  description?: string;
  scriptPath?: string;
  device?: string | null;
}

class ImportTestsDto {
  projectId: number;
}

/** 启动运行参数：APP 测试指定使用的 app 版本（app_versions.id） */
class StartRunDto {
  appVersionId?: number;
}

@Controller('tests')
export class TestsController {
  constructor(private readonly testsService: TestsService) {}

  /** 脚本自动联想：扫描 .test.ts 文件；传 projectId 时限定在项目的脚本目录下（须声明在 :id 之前） */
  @Get('scripts')
  listScripts(
    @Query('q') keyword?: string,
    @Query('projectId') projectId?: string,
  ): Promise<string[]> {
    return this.testsService.listScripts(
      keyword,
      projectId === undefined ? undefined : Number(projectId),
    );
  }

  /** 测试列表：传 projectId 按项目过滤，不传返回全部 */
  @Get()
  findByProject(@Query('projectId') projectId?: string): Promise<Test[]> {
    return this.testsService.findByProject(
      projectId === undefined ? undefined : Number(projectId),
    );
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number): Promise<Test> {
    return this.testsService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateTestDto): Promise<Test> {
    return this.testsService.create(dto);
  }

  /** 自动导入：扫描项目脚本目录下所有 .test.ts，过滤已登记的，其余全部导入 */
  @Post('import')
  importFromScripts(
    @Body() dto: ImportTestsDto,
  ): Promise<{ created: Test[]; skipped: number }> {
    return this.testsService.importFromScripts(dto.projectId);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTestDto,
  ): Promise<Test> {
    return this.testsService.update(id, dto);
  }

  /** 启动一次脚本运行：立即返回 running/queued 记录，脚本后台异步执行，前端通过 SSE 获取进度 */
  @Post(':id/runs')
  startRun(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto?: StartRunDto,
  ): Promise<TestRun> {
    return this.testsService.startRun(id, dto?.appVersionId);
  }

  /**
   * AI 用：启动一次运行并以 Markdown 流式返回结果（text/markdown）。
   * 运行中逐行输出脚本原始输出，结束时附"结果"小节；用法见项目 .md 视图。
   */
  @Post(':id/run.md')
  async runMarkdown(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: StartRunDto | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const test = await this.testsService.findOne(id);
    const run = await this.testsService.startRun(id, dto?.appVersionId);
    await streamRunMarkdown(
      res,
      [
        `# 运行测试 \`${test.code}\``,
        '',
        `- 运行 ID：${run.id}`,
        `- 脚本：${test.scriptPath}`,
        `- 状态：${run.status}`,
        `- 详情：/api/tests/runs/${run.id}`,
      ],
      this.testsService.streamRun(run.id),
    );
  }

  /** 运行历史（倒序，上限 50；须声明在 :id 之前避免路由冲突） */
  @Get(':id/runs')
  listRuns(@Param('id', ParseIntPipe) id: number): Promise<TestRun[]> {
    return this.testsService.listRuns(id);
  }

  /** 单次运行详情 Markdown 视图（须声明在 JSON 版之前避免路由冲突） */
  @Get('runs/:runId.md')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  async findRunMarkdown(
    @Param('runId', ParseIntPipe) runId: number,
  ): Promise<string> {
    const run = await this.testsService.findRun(runId);
    // test 可能已被删除，运行记录仍可单独展示
    const test = await this.testsService.findOne(run.testId).catch(() => null);
    return renderRunMarkdown(
      `测试运行 #${run.id}`,
      [
        ...(test
          ? [`- 测试：\`${test.code}\`（脚本：${test.scriptPath}）`]
          : [`- 测试：#${run.testId}（已删除）`]),
        `- 详情（JSON）：/api/tests/runs/${run.id}`,
      ],
      run,
    );
  }

  /** 单次运行详情（含实时进度与完整结果；须声明在 :id 之前） */
  @Get('runs/:runId')
  findRun(@Param('runId', ParseIntPipe) runId: number): Promise<TestRun> {
    return this.testsService.findRun(runId);
  }

  /** 单次运行的 SSE 实时流：先推当前快照，进度变化持续推送，终态推送后自动完成 */
  @Sse('runs/:runId/stream')
  streamRun(
    @Param('runId', ParseIntPipe) runId: number,
  ): Observable<MessageEvent> {
    return this.testsService.streamRun(runId);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.testsService.remove(id);
  }
}
