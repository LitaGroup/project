import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
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
import { TaskStatus, TaskSubStatus, TaskType } from '../common/enums';
import { Task, TaskMissingItem } from './task.entity';
import {
  CreateTaskInput,
  RecognizeTaskInput,
  TasksService,
  TaskOverview,
  UpdateTaskInput,
} from './tasks.service';
import { TaskChatService } from './task-chat.service';
import { TaskDispatchService } from './task-dispatch.service';

class CreateTaskDto implements CreateTaskInput {
  title?: string;
  type?: TaskType;
  description?: string | null;
  input?: string | null;
  outputSpec?: string | null;
  agentId?: number | null;
  schedulerId?: number | null;
  parentId?: number | null;
  submitForScheduling?: boolean;
}

class UpdateTaskDto implements UpdateTaskInput {
  title?: string;
  type?: TaskType;
  description?: string | null;
  input?: string | null;
  outputSpec?: string | null;
  workPlan?: string | null;
  agentId?: number | null;
  result?: string | null;
  missingItems?: TaskMissingItem[] | null;
}

class MarkMissingDto {
  items: TaskMissingItem[];
}

class FeedbackDto {
  content?: string;
}

class ReplyQuestionDto {
  /** 按问题顺序的答案（选项 label + 自定义文本） */
  answers?: string[][];
  /** 跳过本次提问 */
  reject?: boolean;
}

/** AI 任务识别更新入参（task-recognize-update；只保存，不改状态、不派发） */
class RecognizeTaskDto implements RecognizeTaskInput {
  /** 任务标题（必填） */
  title: string;
  /** 用户的原始需求；不传保留原值，传空值/null 清除 */
  input?: string | null;
  /** 需求内容（必填，AI 分析整理后的需求，含需求澄清与补充的详细信息） */
  content: string;
  /** 交付方式（必填，即任务输出要求） */
  outputSpec: string;
  /** 工作计划（必填，Markdown） */
  workPlan: string;
  /** 执行机器人；不传保留原分配，传 null 清除 */
  agentId?: number | null;
}

@Controller('tasks')
export class TasksController {
  constructor(
    private readonly tasksService: TasksService,
    private readonly dispatchService: TaskDispatchService,
    private readonly taskChat: TaskChatService,
  ) {}

  /** 概览统计（任务概览页顶部卡片） */
  @Get('overview')
  overview(): Promise<TaskOverview> {
    return this.tasksService.overview();
  }

  /** 任务列表（默认根任务树；q=编号/标题，status/subStatus/type 筛选，rootOnly=false 展开全部） */
  @Get()
  findAll(
    @Query('q') q?: string,
    @Query('status') status?: TaskStatus,
    @Query('subStatus') subStatus?: TaskSubStatus,
    @Query('type') type?: TaskType,
    @Query('rootOnly') rootOnly?: string,
  ) {
    return this.tasksService.findAll({
      q,
      status: status || undefined,
      subStatus: subStatus || undefined,
      type: type || undefined,
      rootOnly: rootOnly === 'false' ? false : undefined,
    });
  }

  /** 看板实时流（SSE）：初始全量快照 + 任务快照/输出增量/删除事件 */
  @Sse('stream')
  boardStream(): Observable<MessageEvent> {
    return this.tasksService.streamBoard();
  }

  /** 任务详情页聊天快照：当前任务 + 所属 PIPELINE + 对话消息 */
  @Get(':id/chat')
  chatSnapshot(@Param('id', ParseIntPipe) id: number) {
    // 打开对话时补一次提问对账（节流 30s），恢复服务重启/断线期间漏收的提问
    void this.dispatchService.syncPendingQuestions(id);
    return this.taskChat.snapshot(id);
  }

  /** 任务详情页聊天 SSE：机器人输出/工具调用/阶段状态实时推送 */
  @Sse(':id/chat/stream')
  chatStream(@Param('id', ParseIntPipe) id: number): Observable<MessageEvent> {
    return this.taskChat.stream(id);
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

  /**
   * AI 技能 task-recognize-detail：任务识别上下文（text/markdown）。
   * 含任务详情、状态、时间与启用中的工作者机器人清单。
   */
  @Get(':id/recognize.md')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  recognizeDetail(@Param('id', ParseIntPipe) id: number): Promise<string> {
    return this.tasksService.recognizeDetailMarkdown(id);
  }

  /**
   * AI 技能 task-recognize-update：保存识别结果（text/markdown）。
   * 只更新标题/原始需求/需求内容/交付方式/工作计划/机器人分配，不改变状态、不派发。
   */
  @Post(':id/recognize.md')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  recognizeUpdate(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RecognizeTaskDto,
    @Req() req: AuthedRequest,
  ): Promise<string> {
    return this.tasksService.recognizeUpdateMarkdown(
      id,
      dto,
      req.user?.name ?? null,
    );
  }

  @Delete(':id')
  remove(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthedRequest,
  ): Promise<void> {
    return this.tasksService.remove(id, req.user?.name ?? null);
  }

  // ===== 等待中状态动作 =====

  /** 重新识别：待反馈 → 待识别（LOOP 自动处理） */
  @Post(':id/submit')
  submit(@Param('id', ParseIntPipe) id: number, @Req() req: AuthedRequest) {
    return this.tasksService.requeueForIdentify(id, req.user?.name ?? null);
  }

  /** 提交反馈并重新识别（反馈正文追加到任务描述） */
  @Post(':id/feedback')
  feedback(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: FeedbackDto,
    @Req() req: AuthedRequest,
  ) {
    return this.tasksService.provideFeedback(
      id,
      dto.content?.trim() || null,
      req.user?.name ?? null,
    );
  }

  /** 人工标记待反馈（补充需要用户提供/确认的事项） */
  @Post(':id/missing')
  markMissing(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: MarkMissingDto,
  ): Promise<Task> {
    return this.tasksService.markMissing(id, dto.items ?? [], null);
  }

  /** 中断执行中的机器人会话（任务保持进行中-执行中，可重新派发或取消） */
  @Post(':id/interrupt')
  interrupt(@Param('id', ParseIntPipe) id: number, @Req() req: AuthedRequest) {
    return this.dispatchService.interrupt(id, req.user?.name ?? null);
  }

  /** 回答机器人提问（answers 与问题顺序一致；reject=true 表示跳过） */
  @Post(':id/questions/:questionId/reply')
  replyQuestion(
    @Param('id', ParseIntPipe) id: number,
    @Param('questionId') questionId: string,
    @Body() dto: ReplyQuestionDto,
    @Req() req: AuthedRequest,
  ) {
    return this.dispatchService.replyQuestion(
      id,
      questionId,
      { answers: dto.answers, reject: dto.reject === true },
      req.user?.name ?? null,
    );
  }

  /** 验收通过：等待中-待验收 → 已结束-完成 */
  @Post(':id/accept')
  accept(@Param('id', ParseIntPipe) id: number, @Req() req: AuthedRequest) {
    return this.tasksService.accept(id, req.user?.name ?? null);
  }

  /** 取消（任意未结束任务） */
  @Post(':id/cancel')
  cancel(@Param('id', ParseIntPipe) id: number, @Req() req: AuthedRequest) {
    return this.tasksService.cancel(id, req.user?.name ?? null);
  }

  /** 实时输出流（SSE）：执行器事件行 + 状态推送 */
  @Sse(':id/stream')
  stream(@Param('id', ParseIntPipe) id: number): Observable<MessageEvent> {
    return this.dispatchService.stream(id);
  }
}
