import { Body, Controller, Param, ParseIntPipe, Post } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { FeishuBotEventService } from './feishu-bot-event.service';

/**
 * 飞书事件回调（公开端点，自行验签/解密）：
 * - 每个飞书应用配置一个回调地址 /api/feishu-bot/callback/:configId；
 * - URL verification 返回 challenge；
 * - 事件/卡片动作按 Verification Token + Encrypt Key 校验后异步处理。
 * 回调必须快速返回：消息处理在服务内异步执行。
 */
@Controller('feishu-bot')
export class FeishuBotCallbackController {
  constructor(private readonly events: FeishuBotEventService) {}

  @Public()
  @Post('callback/:configId')
  async callback(
    @Param('configId', ParseIntPipe) configId: number,
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    return this.events.handleCallback(configId, body ?? {});
  }
}
