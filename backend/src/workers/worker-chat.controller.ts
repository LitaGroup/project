import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  Sse,
} from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import { Observable } from 'rxjs';
import type { AuthedRequest } from '../auth/auth.guard';
import {
  WorkerChatService,
  type WorkerChatSession,
} from './worker-chat.service';
import type {
  WorkerDebugAttachment,
  WorkerDebugOption,
  WorkerDebugSnapshot,
} from './worker-debug.service';

class WorkerChatAttachmentDto {
  name?: string;
  url?: string;
  size?: number;
  mime?: string;
}

class SendWorkerChatMessageDto {
  content?: string;
  files?: WorkerChatAttachmentDto[];
}

class ReplyWorkerChatQuestionDto {
  answers?: unknown;
  reject?: boolean;
}

/** 顶部「机器人」一对一聊天：与机器人调试、我的 AI 使用不同会话范围 */
@Controller('worker-chats')
export class WorkerChatController {
  constructor(private readonly chats: WorkerChatService) {}

  /** 可对话机器人（名称/简介/ID 联想搜索） */
  @Get('workers')
  listWorkers(
    @Req() req: AuthedRequest,
    @Query('q') q?: string,
  ): Promise<WorkerDebugOption[]> {
    return this.chats.listWorkers(req.user!.id, q);
  }

  /** 当前用户已有会话的机器人，按首条消息时间倒序，最多 20 个 */
  @Get('sessions')
  listSessions(@Req() req: AuthedRequest): Promise<WorkerChatSession[]> {
    return this.chats.listSessions(req.user!.id);
  }

  /** 当前用户与指定机器人的唯一聊天会话快照 */
  @Get(':workerId')
  snapshot(
    @Req() req: AuthedRequest,
    @Param('workerId', ParseIntPipe) workerId: number,
  ): Promise<WorkerDebugSnapshot> {
    return this.chats.snapshot(req.user!.id, workerId);
  }

  /** 聊天实时流（SSE）：订阅即收快照，文本/思考/待办/终态实时推送 */
  @Sse(':workerId/stream')
  stream(
    @Req() req: AuthedRequest,
    @Param('workerId', ParseIntPipe) workerId: number,
  ): Observable<MessageEvent> {
    return this.chats.stream(req.user!.id, workerId);
  }

  /** 发送文字与附件；附件沿用平台上传后的公开地址 */
  @Post(':workerId/messages')
  send(
    @Req() req: AuthedRequest,
    @Param('workerId', ParseIntPipe) workerId: number,
    @Body() dto: SendWorkerChatMessageDto,
  ): Promise<WorkerDebugSnapshot> {
    const files: WorkerDebugAttachment[] = (dto.files ?? [])
      .filter((file) => file.url?.trim())
      .slice(0, 10)
      .map((file) => ({
        name: file.name?.trim() || '附件',
        url: file.url!.trim(),
        ...(typeof file.size === 'number' ? { size: file.size } : {}),
        ...(file.mime?.trim() ? { mime: file.mime.trim() } : {}),
      }));
    return this.chats.send(req.user!.id, workerId, dto.content ?? '', files);
  }

  /** 回答/跳过机器人提问 */
  @Post(':workerId/questions/:questionId/reply')
  replyQuestion(
    @Req() req: AuthedRequest,
    @Param('workerId', ParseIntPipe) workerId: number,
    @Param('questionId') questionId: string,
    @Body() dto: ReplyWorkerChatQuestionDto,
  ): Promise<WorkerDebugSnapshot> {
    return this.chats.replyQuestion(req.user!.id, workerId, questionId, {
      answers: dto.answers,
      reject: dto.reject === true,
    });
  }

  /** 重置会话：清空消息并解绑 opencode 会话，下一条消息创建新会话 */
  @Post(':workerId/reset')
  reset(
    @Req() req: AuthedRequest,
    @Param('workerId', ParseIntPipe) workerId: number,
  ): Promise<WorkerDebugSnapshot> {
    return this.chats.reset(req.user!.id, workerId);
  }
}
