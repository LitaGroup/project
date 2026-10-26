import {
  Body,
  Controller,
  Delete,
  Get,
  MessageEvent,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  Sse,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import type { AuthedRequest } from '../auth/auth.guard';
import { TaskStatus, TaskType } from '../common/enums';
import { DispatchPlan } from './dispatch-plan.entity';
import { Task, TaskMissingItem } from './task.entity';
import {
  CreateTaskInput,
  TasksService,
  TaskOverview,
  UpdateTaskInput,
} from './tasks.service';
import { TaskDispatchService } from './task-dispatch.service';

class CreateTaskDto implements CreateTaskInput {
  title: string;
  type?: TaskType;
  description?: string | null;
  input?: string | null;
  outputSpec?: string | null;
  agentId?: number | null;
  schedulerId?: number | null;
  parentId?: number | null;
}

class UpdateTaskDto implements UpdateTaskInput {
  title?: string;
  type?: TaskType;
  description?: string | null;
  input?: string | null;
  outputSpec?: string | null;
  agentId?: number | null;
  result?: string | null;
  missingItems?: TaskMissingItem[] | null;
}

class MarkMissingDto {
  items: TaskMissingItem[];
}

class RejectPlanDto {
  reason?: string;
}

class DeliverDto {
  result?: string;
}

@Controller('tasks')
export class TasksController {
  constructor(
    private readonly tasksService: TasksService,
    private readonly dispatchService: TaskDispatchService,
  ) {}

  /** 概览统计（任务概览页顶部卡片） */
  @Get('overview')
  overview(): Promise<TaskOverview> {
    return this.tasksService.overview();
  }

  /** 任务列表（默认根任务树；q=编号/标题，status/type 筛选，rootOnly=false 展开全部） */
  @Get()
  findAll(
    @Query('q') q?: string,
    @Query('status') status?: TaskStatus,
    @Query('type') type?: TaskType,
    @Query('rootOnly') rootOnly?: string,
  ) {
    return this.tasksService.findAll({
      q,
      status: status || undefined,
      type: type || undefined,
      rootOnly: rootOnly === 'false' ? false : undefined,
    });
  }

  /** 详情：任务 + 子任务 + 事件时间线 + 实时输出行 */
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.tasksService.findOneDetail(id);
  }

  @Post()
  create(@Body() dto: CreateTaskDto, @Req() req: AuthedRequest): Promise<Task> {
    return this.tasksService.create({
      ...dto,
      createdById: req.user?.id ?? null,
    });
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTaskDto,
    @Req() req: AuthedRequest,
  ): Promise<Task> {
    return this.tasksService.update(id, dto, req.user?.name ?? null);
  }

  @Delete(':id')
  remove(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthedRequest,
  ): Promise<void> {
    return this.tasksService.remove(id, req.user?.name ?? null);
  }

  // ===== 流程动作 =====

  /** 提交调度：草稿/待补材料 → 待调度 */
  @Post(':id/submit')
  submit(@Param('id', ParseIntPipe) id: number, @Req() req: AuthedRequest) {
    return this.tasksService.submitForSchedule(id, req.user?.name ?? null);
  }

  /** 标记待补材料（调度器产出，人工亦可） */
  @Post(':id/missing')
  markMissing(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: MarkMissingDto,
  ): Promise<Task> {
    return this.tasksService.markMissing(id, dto.items ?? [], null);
  }

  /** 材料补齐：待补材料 → 待调度 */
  @Post(':id/resolved')
  resolveMissing(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthedRequest,
  ) {
    return this.tasksService.resolveMissing(id, req.user?.name ?? null);
  }

  /** AI 调度：识别/材料审查/拆解/分配 → 待补材料 或 待确认方案 */
  @Post(':id/schedule')
  schedule(@Param('id', ParseIntPipe) id: number, @Req() req: AuthedRequest) {
    return this.tasksService.schedule(id, req.user?.name ?? null);
  }

  /** 派发（人工分配后直接派发；执行中可重新派发） */
  @Post(':id/dispatch')
  dispatch(@Param('id', ParseIntPipe) id: number, @Req() req: AuthedRequest) {
    return this.dispatchService.dispatch(id, req.user?.name ?? null);
  }

  /** 中断执行 */
  @Post(':id/interrupt')
  interrupt(@Param('id', ParseIntPipe) id: number, @Req() req: AuthedRequest) {
    return this.dispatchService.interrupt(id, req.user?.name ?? null);
  }

  /** 验收通过：待验收 → 内部完成 */
  @Post(':id/accept')
  accept(@Param('id', ParseIntPipe) id: number, @Req() req: AuthedRequest) {
    return this.tasksService.accept(id, req.user?.name ?? null);
  }

  /** 交付：内部完成 → 已交付 */
  @Post(':id/deliver')
  deliver(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DeliverDto,
    @Req() req: AuthedRequest,
  ) {
    return this.tasksService.deliver(id, req.user?.name ?? null, dto.result);
  }

  /** 归档：已交付 → 维护中（终态） */
  @Post(':id/archive')
  archive(@Param('id', ParseIntPipe) id: number, @Req() req: AuthedRequest) {
    return this.tasksService.archive(id, req.user?.name ?? null);
  }

  /** 取消（任意非终态） */
  @Post(':id/cancel')
  cancel(@Param('id', ParseIntPipe) id: number, @Req() req: AuthedRequest) {
    return this.tasksService.cancel(id, req.user?.name ?? null);
  }

  // ===== 调度方案 =====

  /** 任务当前待确认方案 */
  @Get(':id/plan')
  pendingPlan(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<DispatchPlan | null> {
    return this.tasksService.pendingPlan(id);
  }

  /** 确认调度方案（物化子任务并派发） */
  @Post('plans/:planId/confirm')
  confirmPlan(
    @Param('planId', ParseIntPipe) planId: number,
    @Req() req: AuthedRequest,
  ) {
    return this.tasksService.confirmPlan(planId, req.user?.name ?? null);
  }

  /** 驳回调度方案（打回待调度） */
  @Post('plans/:planId/reject')
  rejectPlan(
    @Param('planId', ParseIntPipe) planId: number,
    @Body() dto: RejectPlanDto,
    @Req() req: AuthedRequest,
  ) {
    return this.tasksService.rejectPlan(
      planId,
      dto.reason?.trim() || '',
      req.user?.name ?? null,
    );
  }

  /** 实时输出流（SSE）：执行器事件行 + 状态推送 */
  @Sse(':id/stream')
  stream(@Param('id', ParseIntPipe) id: number): Observable<MessageEvent> {
    return this.dispatchService.stream(id);
  }
}
