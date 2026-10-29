import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
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
import { TaskStatus, TaskSubStatus } from '../common/enums';
import { Task, TaskMissingItem } from './task.entity';
import {
  CreateTaskInput,
  RecognizeTaskInput,
  TasksService,
  TaskOverview,
  UpdateTaskInput,
} from './tasks.service';
import { TaskChatService } from './task-chat.service';
import {
  DeliveryReplyInput,
  TaskDeliveryService,
} from './task-delivery.service';
import { TaskDispatchService } from './task-dispatch.service';
import type { TaskDeliveryReportInput } from './task-delivery-report';
import { TaskHandoffService } from './task-handoff.service';
import {
  AnswerQuestionInput,
  AskQuestionInput,
  CreateSubtaskInput,
  TaskCollaborationService,
} from './task-collaboration.service';
import type { TaskActor } from './task-requester';

class CreateTaskDto implements CreateTaskInput {
  title?: string;
  type?: string;
  description?: string | null;
  input?: string | null;
  outputSpec?: string | null;
  agentId?: number | null;
  schedulerId?: number | null;
  parentId?: number | null;
  templateId?: number | null;
  submitForScheduling?: boolean;
}

class UpdateTaskDto implements UpdateTaskInput {
  title?: string;
  type?: string;
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

class MessageDto {
  content?: string;
}

/** 验收不通过：反馈原因与返工要求（必填） */
class RejectTaskDto {
  content?: string;
}

class AssignTaskDto {
  agentId: number;
}

class ReplyQuestionDto {
  /** 按问题顺序的答案（选项 label + 自定义文本） */
  answers?: string[][];
  /** 跳过本次提问 */
  reject?: boolean;
}

/** AI 技能 task-handoff-apply：执行机器人提交结构化交付说明（可选，兼容旧调用） */
class HandoffApplyDto implements TaskDeliveryReportInput {
  /** 交付结果、代码仓库/分支、文档清单 */
  delivery?: string | null;
  /** 实现问题与解决过程 */
  problems?: string | null;
  /** 走过的弯路 */
  detours?: string | null;
  /** 经验总结 */
  lessons?: string | null;
  /** 遗留建议与后续待办 */
  followUps?: string | null;
  /** 其它需要保留的信息 */
  other?: string | null;
}

/** AI 技能 task-deliver-reply：需求方通过或拒绝验收 */
class DeliveryReplyDto implements DeliveryReplyInput {
  /** accept=通过验收；refuse=拒绝并退回执行 */
  action?: string;
  /** 拒绝验收时的反馈意见（action=refuse 时必填） */
  content?: string;
}

/** AI 任务识别更新入参（task-recognize-update；只保存，不改状态、不派发） */
class CreateSubtaskDto implements CreateSubtaskInput {
  templateId: number;
  title: string;
  description?: string | null;
  input?: string | null;
  outputSpec?: string | null;
}

class RefuseTaskDto {
  reason?: string;
  suggestion?: string;
}

class FailTaskDto {
  reason?: string;
}

class AskTaskQuestionDto implements AskQuestionInput {
  questions: AskQuestionInput['questions'];
}

class AnswerTaskQuestionDto implements AnswerQuestionInput {
  answers?: string[][];
  reject?: boolean;
}

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
    private readonly taskHandoff: TaskHandoffService,
    private readonly deliveryService: TaskDeliveryService,
    private readonly collaboration: TaskCollaborationService,
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
    @Query('type') type?: string,
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

  /** task-defines：当前系统支持分发的任务定义（机器人或人类 Agent 均可读）。 */
  @Get('defines.md')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  taskDefines(): Promise<string> {
    return this.collaboration.definesMarkdown();
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
      requesterType: req.user ? 'user' : null,
      requesterId: req.user?.id ?? null,
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

  /** task-create：父任务执行机器人创建子任务。 */
  @Post(':id/subtasks/create.md')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  async createSubtask(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateSubtaskDto,
    @Req() req: AuthedRequest,
  ): Promise<string> {
    const task = await this.collaboration.createSubtask(
      id,
      this.requireWorker(req),
      dto,
    );
    return this.collaboration.actionMarkdown('子任务已创建', task, [
      `- 父任务：${id}`,
      `- 需求方机器人：${req.worker!.name}（${req.worker!.id}）`,
    ]);
  }

  /** task-accept：负责机器人接受待接受任务。 */
  @Post(':id/accept-task.md')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  async acceptAssignedTask(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthedRequest,
  ): Promise<string> {
    const task = await this.collaboration.accept(id, this.requireWorker(req));
    return this.collaboration.actionMarkdown('任务已接受', task);
  }

  /** task-refuse：负责机器人在待接受阶段拒绝任务。 */
  @Post(':id/refuse.md')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  async refuseAssignedTask(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RefuseTaskDto,
    @Req() req: AuthedRequest,
  ): Promise<string> {
    const task = await this.collaboration.refuse(
      id,
      this.requireWorker(req),
      dto.reason ?? '',
      dto.suggestion,
    );
    return this.collaboration.actionMarkdown('任务已拒绝承接', task, [
      `- 拒绝理由：${task.refusalReason ?? '-'}`,
      `- 分发建议：${task.dispatchSuggestion ?? '-'}`,
    ]);
  }

  /** task-question-ask：project 接管提问与 UI 状态。 */
  @Post(':id/questions/ask.md')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  async askTaskQuestion(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AskTaskQuestionDto,
    @Req() req: AuthedRequest,
  ): Promise<string> {
    const result = await this.collaboration.ask(
      id,
      this.requireWorker(req),
      dto,
    );
    return this.collaboration.actionMarkdown('任务提问已提交', result.task, [
      `- 提问 ID：${result.questionId}`,
      '- 后续：请停止本轮执行，等待需求方答复后由平台恢复会话。',
    ]);
  }

  /** task-question-answer：人或机器人需求方答复 project 提问。 */
  @Post(':id/questions/:questionId/answer.md')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  async answerTaskQuestion(
    @Param('id', ParseIntPipe) id: number,
    @Param('questionId') questionId: string,
    @Body() dto: AnswerTaskQuestionDto,
    @Req() req: AuthedRequest,
  ): Promise<string> {
    const task = await this.collaboration.answer(
      id,
      questionId,
      this.requireActor(req),
      dto,
    );
    return this.collaboration.actionMarkdown('提问已答复', task);
  }

  /** task-handoff-apply：新验收申请地址，复用交付文档与产出逻辑。 */
  @Post(':id/handoff/apply.md')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  handoffApply(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: HandoffApplyDto,
    @Req() req: AuthedRequest,
  ): Promise<string> {
    return this.deliveryService.apply(id, this.requireWorker(req), dto);
  }

  /** task-handoff-accept：人或机器人需求方验收通过。 */
  @Post(':id/handoff/accept.md')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  async handoffAccept(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthedRequest,
  ): Promise<string> {
    const task = await this.collaboration.acceptHandoff(
      id,
      this.requireActor(req),
    );
    return this.collaboration.actionMarkdown('任务验收已通过', task);
  }

  /** task-handoff-refuse：人或机器人需求方拒绝验收并返工。 */
  @Post(':id/handoff/refuse.md')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  async handoffRefuse(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RejectTaskDto,
    @Req() req: AuthedRequest,
  ): Promise<string> {
    const task = await this.collaboration.refuseHandoff(
      id,
      this.requireActor(req),
      dto.content ?? '',
    );
    return this.collaboration.actionMarkdown('任务验收已拒绝', task);
  }

  /** task-fail：仅需求方在待验收阶段判定任务失败。 */
  @Post(':id/fail.md')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  async failTask(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: FailTaskDto,
    @Req() req: AuthedRequest,
  ): Promise<string> {
    const task = await this.collaboration.fail(
      id,
      this.requireActor(req),
      dto.reason ?? '',
    );
    return this.collaboration.actionMarkdown('任务已判定失败', task, [
      `- 失败原因：${task.failureReason ?? '-'}`,
    ]);
  }

  /**
   * AI 技能 task-deliver-apply：执行机器人申请验收（text/markdown）。
   * 仅接受 X-Worker-Token，且必须是当前任务的执行机器人。
   */
  @Post(':id/deliver/apply.md')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  deliverApply(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: HandoffApplyDto,
    @Req() req: AuthedRequest,
  ): Promise<string> {
    if (!req.worker) {
      throw new ForbiddenException(
        '申请验收仅接受机器人身份（X-Worker-Token）',
      );
    }
    return this.deliveryService.apply(id, req.worker, dto);
  }

  /**
   * AI 技能 task-deliver-reply：任务需求方处理验收反馈（text/markdown）。
   * accept=通过并完成；refuse=拒绝并附反馈，任务退回原机器人重新执行。
   */
  @Post(':id/deliver/reply.md')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  deliverReply(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DeliveryReplyDto,
    @Req() req: AuthedRequest,
  ): Promise<string> {
    if (!req.user) {
      throw new ForbiddenException('处理验收反馈需要用户身份');
    }
    return this.deliveryService.reply(id, req.user, dto);
  }

  @Delete(':id')
  remove(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthedRequest,
  ): Promise<void> {
    return this.tasksService.remove(id, req.user?.name ?? null);
  }

  // ===== 等待中状态动作 =====

  /** 兼容旧提交入口：待反馈 → 待继续；未分配机器人时回到待分配 */
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

  /**
   * 任务对话发送消息：识别阶段作为需求补充重新识别；
   * 已有执行会话时直接续聊，待验收任务会重新进入执行中。
   */
  @Post(':id/messages')
  sendMessage(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: MessageDto,
    @Req() req: AuthedRequest,
  ): Promise<Task> {
    if (!req.user) throw new ForbiddenException('发送消息需要用户身份');
    return this.deliveryService.sendMessage(id, req.user, dto.content ?? '');
  }

  /**
   * 验收不通过：累计计数；前 3 次退回原机器人，
   * 第 4 次起转等待中-待反馈，由执行机器人负责人处理。
   */
  @Post(':id/reject')
  reject(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RejectTaskDto,
    @Req() req: AuthedRequest,
  ): Promise<Task> {
    if (!req.user) throw new ForbiddenException('拒绝验收需要用户身份');
    return this.deliveryService.reject(id, req.user, dto.content ?? '');
  }

  /** 网页任务失败：仅需求方在待验收阶段操作。 */
  @Post(':id/fail')
  failTaskJson(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: FailTaskDto,
    @Req() req: AuthedRequest,
  ): Promise<Task> {
    if (!req.user) throw new ForbiddenException('判定任务失败需要用户身份');
    return this.collaboration.fail(
      id,
      { type: 'user', user: req.user },
      dto.reason ?? '',
    );
  }

  /** 人工分配给其他机器人（执行中会中断旧机器人并重新派发） */
  @Post(':id/assign')
  assign(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AssignTaskDto,
    @Req() req: AuthedRequest,
  ): Promise<Task> {
    return this.dispatchService.assign(id, dto.agentId, req.user?.name ?? null);
  }

  /** 人工标记待反馈（补充需要用户提供/确认的事项） */
  @Post(':id/missing')
  markMissing(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: MarkMissingDto,
    @Req() req: AuthedRequest,
  ): Promise<Task> {
    return this.tasksService.markMissing(
      id,
      dto.items ?? [],
      null,
      req.user?.name ?? null,
    );
  }

  /** 中断执行中的机器人会话（任务保持进行中-执行中，可重新派发或取消） */
  @Post(':id/interrupt')
  interrupt(@Param('id', ParseIntPipe) id: number, @Req() req: AuthedRequest) {
    return this.dispatchService.interrupt(id, req.user?.name ?? null);
  }

  /** 回答机器人提问（answers 与问题顺序一致；reject=true 表示跳过） */
  @Post(':id/questions/:questionId/reply')
  async replyQuestion(
    @Param('id', ParseIntPipe) id: number,
    @Param('questionId') questionId: string,
    @Body() dto: ReplyQuestionDto,
    @Req() req: AuthedRequest,
  ) {
    const task = await this.tasksService.findOneForList(id);
    if (!req.user) throw new ForbiddenException('答复提问需要用户身份');
    if (task?.subStatus === TaskSubStatus.PENDING_FEEDBACK) {
      return this.collaboration.answer(
        id,
        questionId,
        { type: 'user', user: req.user },
        { answers: dto.answers, reject: dto.reject === true },
      );
    }
    // 兼容尚未迁移的 opencode 原生提问。
    return this.dispatchService.replyQuestion(
      id,
      questionId,
      { answers: dto.answers, reject: dto.reject === true },
      req.user.name ?? null,
    );
  }

  /** 验收通过：仅任务需求方操作；异步生成 REVIEW 复盘并销毁执行会话 */
  @Post(':id/accept')
  accept(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthedRequest,
  ): Promise<Task> {
    if (!req.user) throw new ForbiddenException('验收需要用户身份');
    return this.deliveryService.acceptTask(id, req.user);
  }

  /** 重新生成任务复盘（已结束-完成；固定覆盖 REVIEW） */
  @Post(':id/handoff')
  @HttpCode(202)
  regenerateHandoff(@Param('id', ParseIntPipe) id: number) {
    return this.taskHandoff.request(id);
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

  private requireWorker(req: AuthedRequest) {
    if (!req.worker) {
      throw new ForbiddenException('该操作仅接受机器人身份（X-Worker-Token）');
    }
    return req.worker;
  }

  private requireActor(req: AuthedRequest): TaskActor {
    if (req.worker) return { type: 'worker', worker: req.worker };
    if (req.user) return { type: 'user', user: req.user };
    throw new ForbiddenException('缺少任务需求方身份');
  }
}
