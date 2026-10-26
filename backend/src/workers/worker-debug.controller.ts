import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Req,
} from '@nestjs/common';
import type { AuthedRequest } from '../auth/auth.guard';
import {
  WorkerDebugService,
  WorkerDebugOption,
  WorkerDebugSnapshot,
} from './worker-debug.service';

class SendWorkerDebugMessageDto {
  content?: string;
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

  @Post(':workerId/debug/reset')
  reset(
    @Req() req: AuthedRequest,
    @Param('workerId', ParseIntPipe) workerId: number,
  ): Promise<WorkerDebugSnapshot> {
    return this.debug.reset(req.user!.id, workerId);
  }
}
