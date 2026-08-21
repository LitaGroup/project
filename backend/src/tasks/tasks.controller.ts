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
import { CheckRun } from '../checks/check-run.entity';
import { Task } from './task.entity';
import { TaskDetailView, TasksService, TaskView } from './tasks.service';

class CreateTaskDto {
  projectId: number;
  /** 标题 */
  title: string;
  /** crontab 表达式（5 段：分 时 日 月 周），如 0/5 * * * *（每 5 分钟） */
  cron: string;
  /** 使用的检查脚本（checks 表 id，须属于该项目） */
  checkId: number;
}

class UpdateTaskDto {
  title?: string;
  cron?: string;
  checkId?: number;
  enabled?: boolean;
}

@Controller('tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  /** 任务列表：传 projectId 按项目过滤，不传返回全部 */
  @Get()
  findByProject(@Query('projectId') projectId?: string): Promise<TaskView[]> {
    return this.tasksService.findByProject(
      projectId === undefined ? undefined : Number(projectId),
    );
  }

  /** 任务触发的运行历史（倒序，上限 50） */
  @Get(':id/runs')
  listRuns(@Param('id', ParseIntPipe) id: number): Promise<CheckRun[]> {
    return this.tasksService.listRuns(id);
  }

  /** 立即触发一次任务（手动触发不受 enabled 限制），返回启动的运行记录 */
  @Post(':id/run')
  runNow(@Param('id', ParseIntPipe) id: number): Promise<CheckRun> {
    return this.tasksService.runNow(id);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number): Promise<TaskDetailView> {
    return this.tasksService.findOneView(id);
  }

  @Post()
  create(@Body() dto: CreateTaskDto): Promise<Task> {
    return this.tasksService.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTaskDto,
  ): Promise<Task> {
    return this.tasksService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.tasksService.remove(id);
  }
}
