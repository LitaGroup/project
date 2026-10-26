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
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { CheckRun } from '../checks/check-run.entity';
import { streamRunMarkdown } from '../common/run-markdown';
import { Schedule } from './schedule.entity';
import {
  ScheduleDetailView,
  SchedulesService,
  ScheduleView,
} from './schedules.service';

class CreateScheduleDto {
  projectId: number;
  /** 标题 */
  title: string;
  /** crontab 表达式（5 段：分 时 日 月 周），如 0/5 * * * *（每 5 分钟） */
  cron: string;
  /** 使用的检查脚本（checks 表 id，须属于该项目） */
  checkId: number;
}

class UpdateScheduleDto {
  title?: string;
  cron?: string;
  checkId?: number;
  enabled?: boolean;
}

@Controller('schedules')
export class SchedulesController {
  constructor(private readonly schedulesService: SchedulesService) {}

  /** 定时任务列表：传 projectId 按项目过滤，不传返回全部 */
  @Get()
  findByProject(
    @Query('projectId') projectId?: string,
  ): Promise<ScheduleView[]> {
    return this.schedulesService.findByProject(
      projectId === undefined ? undefined : Number(projectId),
    );
  }

  /** 任务触发的运行历史（倒序，上限 50） */
  @Get(':id/runs')
  listRuns(@Param('id', ParseIntPipe) id: number): Promise<CheckRun[]> {
    return this.schedulesService.listRuns(id);
  }

  /** 立即触发一次任务（手动触发不受 enabled 限制），返回启动的运行记录 */
  @Post(':id/run')
  runNow(@Param('id', ParseIntPipe) id: number): Promise<CheckRun> {
    return this.schedulesService.runNow(id);
  }

  /**
   * AI 用：手动触发任务并以 Markdown 流式返回结果（text/markdown）。
   * 运行中逐行输出脚本原始输出，结束时附"结果"小节。
   */
  @Post(':id/run.md')
  async runMarkdown(
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ): Promise<void> {
    const schedule = await this.schedulesService.findOne(id);
    const run = await this.schedulesService.runNow(id);
    await streamRunMarkdown(
      res,
      [
        `# 运行定时任务 \`${schedule.title}\``,
        '',
        `- 运行 ID：${run.id}`,
        `- 触发方式：手动`,
        `- 详情：/api/checks/runs/${run.id}.md`,
      ],
      this.schedulesService.streamRun(run.id),
      run.startedAt,
    );
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number): Promise<ScheduleDetailView> {
    return this.schedulesService.findOneView(id);
  }

  @Post()
  create(@Body() dto: CreateScheduleDto): Promise<Schedule> {
    return this.schedulesService.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateScheduleDto,
  ): Promise<Schedule> {
    return this.schedulesService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.schedulesService.remove(id);
  }
}
