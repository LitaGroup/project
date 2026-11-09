import {
  BadRequestException,
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
import { beijingTime, mdFrontmatter } from '../common/frontmatter';
import { WorkersService } from '../workers/workers.service';
import { Task, TaskMissingItem } from './task.entity';
import {
  CreateTaskInput,
  RecognizeTaskInput,
  TasksService,
  TaskOverview,
  UpdateTaskInput,
} from './tasks.service';
import { TaskChatService } from './task-chat.service';
import type { TaskChatPerspective } from './task-chat.types';
import {
  DeliveryReplyInput,
  TaskDeliveryService,
} from './task-delivery.service';
import { TaskDispatchService } from './task-dispatch.service';
import type { TaskDeliveryReportInput } from './task-delivery-report';
import { TaskDocumentService } from './task-document.service';
import type { TaskDocumentsView } from './task-document.service';
import { TaskHandoffService } from './task-handoff.service';
import {
  AnswerQuestionInput,
  AskQuestionInput,
  CreateSubtaskInput,
  TaskCollaborationService,
} from './task-collaboration.service';
import {
  isTaskRequester,
  type TaskActor,
  workerRequesterActor,
} from './task-requester';
import { TasksAgentService } from './tasks-agent.service';
import { PersonalAgentsService } from '../workers/personal-agents.service';

class CreateTaskDto implements CreateTaskInput {
  title?: string;
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
  /** 双角色用户显式指定发送身份；缺省按需求方兼容旧调用 */
  perspective?: TaskChatPerspective;
}

/** 需求方机器人/用户在子任务对话中回复执行方消息 */
class ReplyTaskMessageDto {
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

/** 执行机器人更新交付文档：完整正文 + 读取时的版本号 */
class HandoffUpdateDto {
  /** 完整正文；与 append 二选一 */
  content?: string;
  /** 追加到当前正文末尾 */
  append?: string;
  baseVersion?: number;
}

/** 任务目录下的普通文档（API.md / TECH_DESIGN.md 等） */
class TaskDocumentUpsertDto {
  /** 文档名，支持 API / API.md / TECH_DESIGN.md */
  name?: string;
  /** 完整 Markdown 正文 */
  content?: string;
  /** 文档标题，缺省为「编号 标题 · 文档名.md」 */
  title?: string;
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
    private readonly taskDocuments: TaskDocumentService,
    private readonly collaboration: TaskCollaborationService,
    private readonly workersService: WorkersService,
    private readonly tasksAgent: TasksAgentService,
    private readonly personalAgents: PersonalAgentsService,
  ) {}

  /** 概览统计（任务概览页顶部卡片） */
  @Get('overview')
  overview(): Promise<TaskOverview> {
    return this.tasksService.overview();
  }

  /** 任务列表（默认根任务树；q=编号/标题，status/subStatus 筛选，rootOnly=false 展开全部） */
  @Get()
  findAll(
    @Query('q') q?: string,
    @Query('status') status?: TaskStatus,
    @Query('subStatus') subStatus?: TaskSubStatus,
    @Query('rootOnly') rootOnly?: string,
  ) {
    return this.tasksService.findAll({
      q,
      status: status || undefined,
      subStatus: subStatus || undefined,
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

  /** Agent 用任务详情：按需求方/执行方身份收敛，返回 Markdown。 */
  @Get(':id.md')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  async taskDetailMarkdown(
    @Req() req: AuthedRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<string> {
    const scope = await this.tasksAgent.resolveScope(req);
    return this.tasksAgent.detailMarkdown(scope, id);
  }

  /** 详情：任务 + 子任务 + 事件时间线 + 实时输出行 */
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.tasksService.findOneDetail(id);
  }

  @Post()
  async create(
    @Body() dto: CreateTaskDto,
    @Req() req: AuthedRequest,
  ): Promise<Task> {
    // 新流程里人类也是通过“个人真人机器人”参与协作；createdById 继续保留真实操作人。
    const humanWorker = req.user
      ? await this.workersService.findByHumanUserId(req.user.id)
      : null;
    return this.tasksService.create({
      ...dto,
      createdById: req.user?.id ?? null,
      requesterType: humanWorker ? 'worker' : req.user ? 'user' : null,
      requesterId: humanWorker?.id ?? req.user?.id ?? null,
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
      await this.requireRequesterActor(req, id),
      dto,
    );
    return this.collaboration.actionMarkdown('提问已答复', task);
  }

  /**
   * task-message-reply：需求方（机器人/用户）回复子任务执行方消息。
   * 只写入对话不改任务状态，供父机器人处理收件箱 message 事件。
   */
  @Post(':id/messages/reply.md')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  async replyTaskMessage(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReplyTaskMessageDto,
    @Req() req: AuthedRequest,
  ): Promise<string> {
    const task = await this.collaboration.replyMessage(
      id,
      await this.requireRequesterActor(req, id),
      dto.content ?? '',
    );
    return this.collaboration.actionMarkdown('消息已回复', task);
  }

  /**
   * 任务文档目录清单（含 HANDOFF，验收后含 REVIEW）。
   * 任务相关文档默认归档到 /task/{yyyyMMdd}/{任务编号}/。
   */
  @Get(':id/documents.md')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  async taskDocumentsIndex(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<string> {
    const task = await this.tasksService.mustFind(id);
    const documents = await this.taskDocuments.listTaskDocuments(task);
    return this.taskDocuments.taskDocumentsMarkdown(task, documents);
  }

  /**
   * 写入任务目录下的普通文档（API.md / TECH_DESIGN.md 等）。
   * HANDOFF / REVIEW 由任务流程维护，须走对应 handoff 接口。
   */
  @Post(':id/documents.md')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  async upsertTaskDocument(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: TaskDocumentUpsertDto,
    @Req() req: AuthedRequest,
  ): Promise<string> {
    const task = await this.tasksService.mustFind(id);
    const updatedBy = await this.assertTaskDocumentAuthor(task, req);
    const entry = await this.taskDocuments.upsertTaskDocument(task, {
      name: dto.name ?? '',
      content: dto.content,
      title: dto.title,
      updatedBy,
    });
    return [
      mdFrontmatter({
        title: `任务 ${task.code} 文档已更新`,
        update: new Date(),
      }),
      `# 任务文档已更新`,
      '',
      `- 文档：\`${entry.name}\``,
      `- 知识路径：\`${entry.path}\``,
      `- 阅读地址：\`/api${entry.markdownUrl}\``,
      `- 更新时间：${beijingTime(new Date())}`,
      '',
      `> 任务文档目录：\`${this.taskDocuments.taskDirectory(task)}\`。HANDOFF 请使用 \`POST /api/tasks/${task.id}/handoff/update.md\` 维护。`,
      '',
    ].join('\n');
  }

  /** 任务详情「文档」Tab：文档清单 + 文档中引用的站内图片/文件。 */
  @Get(':id/documents')
  taskDocumentsView(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<TaskDocumentsView> {
    return this.tasksService
      .mustFind(id)
      .then((task) => this.taskDocuments.taskDocumentsView(task));
  }

  /** 任务详情「文档」Tab：读取某篇任务文档的 Markdown 正文。 */
  @Get(':id/documents/:name')
  taskDocumentContent(
    @Param('id', ParseIntPipe) id: number,
    @Param('name') name: string,
  ) {
    return this.tasksService
      .mustFind(id)
      .then((task) => this.taskDocuments.readTaskDocument(task, name));
  }

  /** 任务详情「交付」Tab：交付文档正文与版本信息。 */
  @Get(':id/handoff')
  taskHandoffDocument(@Param('id', ParseIntPipe) id: number) {
    return this.deliveryService.getHandoff(id);
  }

  /** 任务详情「复盘」Tab：复盘文档；任务尚未生成时返回 null。 */
  @Get(':id/review')
  taskReview(@Param('id', ParseIntPipe) id: number) {
    return this.tasksService
      .mustFind(id)
      .then((task) => this.taskDocuments.readReview(task));
  }

  /** 读取任务交付文档（任务全生命周期文档，Frontmatter 含平台维护的版本号）。 */
  @Get(':id/handoff.md')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  handoffRead(@Param('id', ParseIntPipe) id: number): Promise<string> {
    return this.deliveryService.getHandoffMarkdown(id);
  }

  /** 执行机器人维护交付文档：提交完整正文与 baseVersion。 */
  @Post(':id/handoff/update.md')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  async handoffUpdate(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: HandoffUpdateDto,
    @Req() req: AuthedRequest,
  ): Promise<string> {
    const worker = this.requireWorker(req);
    await this.deliveryService.updateHandoffByWorker(id, worker, {
      content: dto.content,
      append: dto.append,
      baseVersion: Number(dto.baseVersion),
      updatedBy: worker.name,
    });
    return this.deliveryService.getHandoffMarkdown(id);
  }

  /** task-handoff-apply：新验收申请地址，交付文档必须已在执行期间维护完成。 */
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
      await this.requireRequesterActor(req, id),
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
      await this.requireRequesterActor(req, id),
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
      await this.requireRequesterActor(req, id),
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
    if (
      dto.perspective !== undefined &&
      dto.perspective !== 'requester' &&
      dto.perspective !== 'responsible'
    ) {
      throw new BadRequestException(
        'perspective 必须为 requester 或 responsible',
      );
    }
    return this.deliveryService.sendMessage(
      id,
      req.user,
      dto.content ?? '',
      dto.perspective,
    );
  }

  /** 验收不通过：累计计数并始终退回原执行机器人（忙碌时进入待继续）。 */
  @Post(':id/reject')
  async reject(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RejectTaskDto,
    @Req() req: AuthedRequest,
  ): Promise<Task> {
    if (!req.user) throw new ForbiddenException('拒绝验收需要用户身份');
    return this.collaboration.refuseHandoff(
      id,
      await this.requireRequesterActor(req, id),
      dto.content ?? '',
    );
  }

  /** 网页任务失败：仅需求方在待验收阶段操作。 */
  @Post(':id/fail')
  async failTaskJson(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: FailTaskDto,
    @Req() req: AuthedRequest,
  ): Promise<Task> {
    if (!req.user) throw new ForbiddenException('判定任务失败需要用户身份');
    return this.collaboration.fail(
      id,
      await this.requireRequesterActor(req, id),
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
        await this.requireRequesterActor(req, id),
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
  async accept(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthedRequest,
  ): Promise<Task> {
    return this.collaboration.acceptHandoff(
      id,
      await this.requireRequesterActor(req, id),
    );
  }

  /** 重新生成任务复盘（已结束-完成；固定覆盖 REVIEW） */
  @Post(':id/handoff')
  @HttpCode(202)
  regenerateHandoff(@Param('id', ParseIntPipe) id: number) {
    return this.taskHandoff.request(id);
  }

  /** 停止任务：仅发起者或管理员；级联取消全部未结束子任务 */
  @Post(':id/cancel')
  cancel(@Param('id', ParseIntPipe) id: number, @Req() req: AuthedRequest) {
    if (!req.user) throw new ForbiddenException('停止任务需要用户身份');
    return this.tasksService.cancelForUser(id, req.user);
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

  /** 机器人令牌只能维护自己执行或自己作为需求方的任务文档；用户令牌按平台既有权限处理。 */
  private async assertTaskDocumentAuthor(
    task: Task,
    req: AuthedRequest,
  ): Promise<string> {
    if (!req.worker) return req.user?.name ?? '系统';
    // 个人 AGENT 仅是用户的 AI 对话通道：文档作者统一按主人的真人机器人身份校验
    const actorWorker = req.worker.personalAgentUserId
      ? ((await this.workersService.findByHumanUserId(
          req.worker.personalAgentUserId,
        )) ?? req.worker)
      : req.worker;
    const actor = workerRequesterActor(
      actorWorker,
      req.worker.personalAgentUserId ? req.worker : null,
    );
    const isExecutor = task.agentId === actorWorker.id;
    const isRequester = isTaskRequester(task, actor);
    if (!isExecutor && !isRequester) {
      throw new ForbiddenException(
        '仅任务执行机器人或需求方机器人可以维护任务文档',
      );
    }
    return actorWorker.name;
  }

  /**
   * 需求方身份解析：机器人令牌优先；登录用户在“新流程需求方=个人真人机器人”时
   * 自动映射为绑定机器人，历史 user 需求方仍按用户本人校验。
   */
  private async requireRequesterActor(
    req: AuthedRequest,
    taskId: number,
  ): Promise<TaskActor> {
    if (req.worker) {
      // 个人 AGENT 只作「我的 AI」通道：需求方动作统一按主人的真人机器人执行
      if (req.worker.personalAgentUserId) {
        const human = await this.workersService.findByHumanUserId(
          req.worker.personalAgentUserId,
        );
        if (human) {
          return workerRequesterActor(human, req.worker);
        }
      }
      return workerRequesterActor(req.worker);
    }
    if (!req.user) throw new ForbiddenException('缺少任务需求方身份');
    const task = await this.tasksService.mustFind(taskId);
    const humanWorker = await this.workersService.findByHumanUserId(
      req.user.id,
    );
    if (
      humanWorker &&
      task.requesterType === 'worker' &&
      task.requesterId === humanWorker.id
    ) {
      return workerRequesterActor(humanWorker);
    }
    const personalAgent = await this.personalAgents.findForUser(req.user.id);
    if (
      personalAgent &&
      task.requesterType === 'worker' &&
      task.requesterId === personalAgent.id
    ) {
      // 历史任务需求方是个人 AGENT：由主人的真人机器人操作，
      // 并保留个人 AGENT Worker ID 作为需求方归属校验别名。
      return humanWorker
        ? workerRequesterActor(humanWorker, personalAgent)
        : workerRequesterActor(personalAgent);
    }
    return { type: 'user', user: req.user };
  }
}
