import {
  Body,
  Controller,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { TaskExternalEventService } from './task-external-event.service';

/**
 * 任务外部事件回调（纯内网信任，公开端点、无鉴权）：
 * lita-proxy 工单状态变更 POST /api/tasks/:id/external-event，
 * 报文校验后立即落库并返回，唤醒任务会话在服务内异步执行；
 * 重复回调按「任务 + 工单 + 状态」幂等，任务已结束时只记录不复活。
 */
@Controller('tasks')
export class TaskExternalEventController {
  constructor(private readonly externalEvents: TaskExternalEventService) {}

  @Public()
  @Post(':id/external-event')
  @HttpCode(200)
  receive(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: Record<string, unknown>,
  ) {
    return this.externalEvents.receive(id, body ?? {});
  }
}
