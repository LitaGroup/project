import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  Sse,
} from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import { Observable } from 'rxjs';
import type { AuthedRequest } from '../auth/auth.guard';
import type { TaskDeliveryReportInput } from './task-delivery-report';
import type { TaskChatQuestionInfo } from './task-chat.types';
import type { PersonalAgentInfo } from '../workers/personal-agents.service';
import type { WorkerDebugSnapshot } from '../workers/worker-debug.types';
import {
  normalizeAgentPageContext,
  WorkbenchService,
  WorkbenchSummary,
  type AgentPageContext,
  type WorkbenchTask,
} from './workbench.service';
import { Task } from './task.entity';

class WorkbenchRefuseDto {
  reason?: string;
  suggestion?: string;
}

class WorkbenchMessageDto {
  content?: string;
}

class WorkbenchQuestionDto {
  questions?: TaskChatQuestionInfo[];
}

class WorkbenchHandoffDto implements TaskDeliveryReportInput {
  /** 单输入框 Markdown 全文（可带固定小节标题，也兼容只写一段自由文本） */
  content?: string | null;
  /** 以下六个字段保留兼容（AI/旧客户端） */
  delivery?: string | null;
  problems?: string | null;
  detours?: string | null;
  lessons?: string | null;
  followUps?: string | null;
  other?: string | null;
}

class WorkbenchHandoffUpdateDto {
  /** 完整 Markdown 正文（不含平台维护的 Frontmatter） */
  content?: string;
  /** 读取文档时的版本号，用于冲突检测 */
  baseVersion?: number;
}

class WorkbenchSubtaskDto {
  /** 当前操作身份：需求方 / 执行方（双身份用户由前端 Tab 显式指定） */
  perspective?: 'requester' | 'responsible';
  templateId?: number;
  title?: string;
  description?: string | null;
  input?: string | null;
  outputSpec?: string | null;
}

class WorkbenchRejectDto {
  content?: string;
}

class WorkbenchFailDto {
  reason?: string;
}

/** 详情页「我的 AI」上下文字段（文档/脚本等页面） */
class WorkbenchAgentPageContextDto {
  contextType?: string;
  contextId?: string;
  contextTitle?: string;
  contextSummary?: string;
  contextReadUrl?: string;
}

class WorkbenchReplyDto extends WorkbenchAgentPageContextDto {
  answers?: string[][];
  reject?: boolean;
  taskId?: number | null;
}

class WorkbenchAgentMessageDto extends WorkbenchAgentPageContextDto {
  content?: string;
  /** 当前工作台选中任务（作为 AGENT 上下文，不写入用户气泡） */
  taskId?: number | null;
  /** 随消息发送的附件（文件上传后的公开地址） */
  files?: Array<{
    name?: string;
    url?: string;
    size?: number;
    mime?: string;
  }>;
}

class WorkbenchAgentModelDto extends WorkbenchAgentPageContextDto {
  providerId?: string;
  modelId?: string;
  variant?: string | null;
  taskId?: number | null;
}

class WorkbenchAgentTargetDto extends WorkbenchAgentPageContextDto {
  taskId?: number | null;
}

/** query/body 里的 taskId 统一转成正整数或 null */
function parseTaskId(value: unknown): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** 把 query/body 的上下文扁平字段整理为规范化后的详情页上下文 */
function parsePageContext(
  input: WorkbenchAgentPageContextDto | undefined,
): AgentPageContext | null {
  return normalizeAgentPageContext(
    input
      ? {
          type: input.contextType,
          id: input.contextId,
          title: input.contextTitle,
          summary: input.contextSummary,
          readUrl: input.contextReadUrl,
        }
      : null,
  );
}

/** 操作台：无左侧子导航，当前用户通过绑定机器人在一个完整面板中处理任务 */
@Controller('workbench')
export class WorkbenchController {
  constructor(private readonly workbench: WorkbenchService) {}

  /** 操作台初始数据：我的真人机器人 + 我执行/待我答复验收的任务 */
  @Get()
  summary(@Req() req: AuthedRequest): Promise<WorkbenchSummary> {
    this.requireUser(req);
    return this.workbench.summary(req.user!);
  }

  // ===== 我的 AGENT：直接与当前用户的个人 AI AGENT 对话 =====

  /** 我的 AGENT 可用状态（未创建/执行器离线时返回原因） */
  @Get('agent')
  agentInfo(@Req() req: AuthedRequest): Promise<PersonalAgentInfo> {
    return this.workbench.agentInfo(this.requireUser(req));
  }

  /** 我的 AGENT 对话快照（taskId / 详情页上下文：独立会话） */
  @Get('agent/snapshot')
  agentSnapshot(
    @Req() req: AuthedRequest,
    @Query('taskId') taskId?: string,
    @Query() query?: WorkbenchAgentPageContextDto,
  ): Promise<WorkerDebugSnapshot> {
    return this.workbench.agentSnapshot(
      this.requireUser(req),
      parseTaskId(taskId),
      parsePageContext(query),
    );
  }

  /** 我的 AGENT 对话实时流（SSE；taskId / 详情页上下文：独立会话） */
  @Sse('agent/stream')
  agentStream(
    @Req() req: AuthedRequest,
    @Query('taskId') taskId?: string,
    @Query() query?: WorkbenchAgentPageContextDto,
  ): Observable<MessageEvent> {
    return this.workbench.agentStream(
      this.requireUser(req),
      parseTaskId(taskId),
      parsePageContext(query),
    );
  }

  /** 我的 AGENT 发送消息；taskId / 详情页上下文同时隔离会话并作为本轮上下文 */
  @Post('agent/messages')
  agentSend(
    @Req() req: AuthedRequest,
    @Body() dto: WorkbenchAgentMessageDto,
  ): Promise<WorkerDebugSnapshot> {
    return this.workbench.agentSend(
      this.requireUser(req),
      dto.content ?? '',
      parseTaskId(dto.taskId),
      (dto.files ?? [])
        .filter((file) => file.url?.trim())
        .map((file) => ({
          name: file.name?.trim() || '附件',
          url: file.url!.trim(),
          ...(typeof file.size === 'number' ? { size: file.size } : {}),
          ...(file.mime?.trim() ? { mime: file.mime.trim() } : {}),
        })),
      parsePageContext(dto),
    );
  }

  /** 我的 AGENT：模型 + 思考等级清单 */
  @Get('agent/models')
  agentModels(
    @Req() req: AuthedRequest,
    @Query('taskId') taskId?: string,
    @Query() query?: WorkbenchAgentPageContextDto,
  ) {
    return this.workbench.agentModels(
      this.requireUser(req),
      parseTaskId(taskId),
      parsePageContext(query),
    );
  }

  /** 我的 AGENT：切换模型/思考等级 */
  @Post('agent/model')
  agentSetModel(
    @Req() req: AuthedRequest,
    @Body() dto: WorkbenchAgentModelDto,
  ): Promise<WorkerDebugSnapshot> {
    return this.workbench.agentSetModel(
      this.requireUser(req),
      {
        providerId: dto.providerId ?? '',
        modelId: dto.modelId ?? '',
        variant: dto.variant ?? null,
      },
      parseTaskId(dto.taskId),
      parsePageContext(dto),
    );
  }

  /** 我的 AGENT 中断当前轮次 */
  @Post('agent/interrupt')
  agentInterrupt(
    @Req() req: AuthedRequest,
    @Body() dto: WorkbenchAgentTargetDto,
  ): Promise<WorkerDebugSnapshot> {
    return this.workbench.agentInterrupt(
      this.requireUser(req),
      parseTaskId(dto?.taskId),
      parsePageContext(dto),
    );
  }

  /** 我的 AGENT 回答/跳过提问 */
  @Post('agent/questions/:questionId/reply')
  agentReplyQuestion(
    @Req() req: AuthedRequest,
    @Param('questionId') questionId: string,
    @Body() dto: WorkbenchReplyDto,
  ): Promise<WorkerDebugSnapshot> {
    return this.workbench.agentReplyQuestion(
      this.requireUser(req),
      questionId,
      { answers: dto.answers, reject: dto.reject === true },
      parseTaskId(dto.taskId),
      parsePageContext(dto),
    );
  }

  /** 我的 AGENT 重置当前任务/详情页的会话 */
  @Post('agent/reset')
  agentReset(
    @Req() req: AuthedRequest,
    @Body() dto: WorkbenchAgentTargetDto,
  ): Promise<WorkerDebugSnapshot> {
    return this.workbench.agentReset(
      this.requireUser(req),
      parseTaskId(dto?.taskId),
      parsePageContext(dto),
    );
  }

  /** 单个任务在当前用户视角下的工作台角色（详情页复用身份对话） */
  @Get('tasks/:id')
  taskDetail(
    @Req() req: AuthedRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<WorkbenchTask> {
    return this.workbench.taskDetail(this.requireUser(req), id);
  }

  /** 接受任务 */
  @Post('tasks/:id/accept')
  accept(
    @Req() req: AuthedRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<Task> {
    return this.workbench.acceptTask(this.requireUser(req), id);
  }

  /** 拒绝任务 */
  @Post('tasks/:id/refuse')
  refuse(
    @Req() req: AuthedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: WorkbenchRefuseDto,
  ): Promise<Task> {
    return this.workbench.refuseTask(
      this.requireUser(req),
      id,
      dto.reason ?? '',
      dto.suggestion,
    );
  }

  /** 停止任务：发起者或管理员；级联取消全部未结束子任务 */
  @Post('tasks/:id/cancel')
  cancel(
    @Req() req: AuthedRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<Task> {
    return this.workbench.cancelTask(this.requireUser(req), id);
  }

  /** 真人执行回复 */
  @Post('tasks/:id/messages')
  sendMessage(
    @Req() req: AuthedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: WorkbenchMessageDto,
  ): Promise<Task> {
    return this.workbench.sendMessage(
      this.requireUser(req),
      id,
      dto.content ?? '',
    );
  }

  /** 机器人提问 */
  @Post('tasks/:id/questions')
  askQuestion(
    @Req() req: AuthedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: WorkbenchQuestionDto,
  ) {
    return this.workbench.askQuestion(
      this.requireUser(req),
      id,
      dto.questions ?? [],
    );
  }

  /** 读取交付文档（正文 + 当前版本） */
  @Get('tasks/:id/handoff')
  getHandoff(@Req() req: AuthedRequest, @Param('id', ParseIntPipe) id: number) {
    return this.workbench.getHandoff(this.requireUser(req), id);
  }

  /** 需求方/真人执行者更新交付文档 */
  @Patch('tasks/:id/handoff')
  updateHandoff(
    @Req() req: AuthedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: WorkbenchHandoffUpdateDto,
  ) {
    return this.workbench.updateHandoff(this.requireUser(req), id, {
      content: dto.content ?? '',
      baseVersion: Number(dto.baseVersion),
      updatedBy: this.requireUser(req).name ?? '需求方',
    });
  }

  /** 申请验收 */
  @Post('tasks/:id/handoff/apply')
  applyHandoff(
    @Req() req: AuthedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: WorkbenchHandoffDto,
  ): Promise<Task> {
    return this.workbench.applyHandoff(this.requireUser(req), id, dto);
  }

  /** 撤销交付 */
  @Post('tasks/:id/handoff/revoke')
  revokeHandoff(
    @Req() req: AuthedRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<Task> {
    return this.workbench.revokeHandoff(this.requireUser(req), id);
  }

  /** 创建子任务 */
  @Post('tasks/:id/subtasks')
  createSubtask(
    @Req() req: AuthedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: WorkbenchSubtaskDto,
  ): Promise<Task> {
    if (!dto.templateId || !dto.title?.trim()) {
      throw new ForbiddenException('templateId 与 title 不能为空');
    }
    if (
      dto.perspective &&
      dto.perspective !== 'requester' &&
      dto.perspective !== 'responsible'
    ) {
      throw new ForbiddenException(
        'perspective 必须为 requester 或 responsible',
      );
    }
    return this.workbench.createSubtask(this.requireUser(req), id, {
      perspective: dto.perspective,
      templateId: dto.templateId,
      title: dto.title,
      description: dto.description ?? null,
      input: dto.input ?? null,
      outputSpec: dto.outputSpec ?? null,
    });
  }

  /** 验收通过 */
  @Post('tasks/:id/handoff/accept')
  acceptHandoff(
    @Req() req: AuthedRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<Task> {
    return this.workbench.acceptHandoff(this.requireUser(req), id);
  }

  /** 验收不通过 */
  @Post('tasks/:id/handoff/reject')
  rejectHandoff(
    @Req() req: AuthedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: WorkbenchRejectDto,
  ): Promise<Task> {
    return this.workbench.rejectHandoff(
      this.requireUser(req),
      id,
      dto.content ?? '',
    );
  }

  /** 判定失败 */
  @Post('tasks/:id/fail')
  fail(
    @Req() req: AuthedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: WorkbenchFailDto,
  ): Promise<Task> {
    return this.workbench.failTask(this.requireUser(req), id, dto.reason ?? '');
  }

  /** 答复提问 */
  @Post('tasks/:id/questions/:questionId/reply')
  replyQuestion(
    @Req() req: AuthedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Param('questionId') questionId: string,
    @Body() dto: WorkbenchReplyDto,
  ): Promise<Task> {
    return this.workbench.replyQuestion(this.requireUser(req), id, questionId, {
      answers: dto.answers,
      reject: dto.reject === true,
    });
  }

  private requireUser(req: AuthedRequest) {
    if (!req.user) throw new ForbiddenException('操作台需要用户登录');
    return req.user;
  }
}
