import { Controller, Get, Query } from '@nestjs/common';
import { FeishuReadResult, FeishuService } from './feishu.service';

@Controller('feishu')
export class FeishuController {
  constructor(private readonly feishuService: FeishuService) {}

  /** 预览一个飞书链接的内容（不落库），用于同步前确认 */
  @Get('read')
  read(@Query('url') url: string): Promise<FeishuReadResult> {
    return this.feishuService.readByUrl(url);
  }
}
