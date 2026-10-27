import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Req,
  Sse,
} from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import { Observable } from 'rxjs';
import type { AuthedRequest } from '../auth/auth.guard';
import {
  WorkerDebugService,
  WorkerDebugOption,
  WorkerDebugSnapshot,
} from './worker-debug.service';

class SendWorkerDebugMessageDto {
  content?: string;
}

class ReplyWorkerDebugQuestionDto {
  answers?: unknown;
  reject?: boolean;
}

/** 机器人调试对话（独立于任务派发，不产生任务记录） */
@Controller('workers')
export class WorkerDebugController {
  constructor(private readonly debug: WorkerDebugService) {}

  /** 可调试机器人：启用且执行器/供应商/模型配置完整的 Agent */
  @Get('debug/workers')
  listWorkers(): Promise<WorkerDebugOption[]> {
    return this.debug.listWorkers();
  }

  /** 调试会话实时流（SSE）：订阅即收快照，文本/思考/待办/终态变更实时推送 */
  @Sse(':workerId/debug/stream')
  stream(
    @Req() req: AuthedRequest,
    @Param('workerId', ParseIntPipe) workerId: number,
  ): Observable<MessageEvent> {
    return this.debug.stream(req.user!.id, workerId);
  }

  @Get(':workerId/debug')
  snapshot(
    @Req() req: AuthedRequest,
    @Param('workerId', ParseIntPipe) workerId: number,
  ): Promise<WorkerDebugSnapshot> {
    return this.debug.snapshot(req.user!.id, workerId);
  }

  /** 启动一轮回复并立即返回；GET snapshot 轮询至终态 */
  @Post(':workerId/debug/messages')
  send(
    @Req() req: AuthedRequest,
    @Param('workerId', ParseIntPipe) workerId: number,
    @Body() dto: SendWorkerDebugMessageDto,
  ): Promise<WorkerDebugSnapshot> {
    return this.debug.send(req.user!.id, workerId, dto.content ?? '');
  }

  @Post(':workerId/debug/interrupt')
  interrupt(
    @Req() req: AuthedRequest,
    @Param('workerId', ParseIntPipe) workerId: number,
  ): Promise<WorkerDebugSnapshot> {
    return this.debug.interrupt(req.user!.id, workerId);
  }

  /** 回答/跳过机器人提问（answers 与问题顺序一致；reject=true 表示跳过） */
  @Post(':workerId/debug/questions/:questionId/reply')
  replyQuestion(
    @Req() req: AuthedRequest,
    @Param('workerId', ParseIntPipe) workerId: number,
    @Param('questionId') questionId: string,
    @Body() dto: ReplyWorkerDebugQuestionDto,
  ): Promise<WorkerDebugSnapshot> {
    return this.debug.replyQuestion(req.user!.id, workerId, questionId, {
      answers: dto.answers,
      reject: dto.reject === true,
    });
  }

  @Post(':workerId/debug/reset')
  reset(
    @Req() req: AuthedRequest,
    @Param('workerId', ParseIntPipe) workerId: number,
  ): Promise<WorkerDebugSnapshot> {
    return this.debug.reset(req.user!.id, workerId);
  }
}
