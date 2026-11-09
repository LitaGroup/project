import { Controller, Get, Header, Query } from '@nestjs/common';
import { FeishuReadResult, FeishuService } from './feishu.service';

@Controller('feishu')
export class FeishuController {
  constructor(private readonly feishuService: FeishuService) {}

  /** 预览一个飞书链接的内容（不落库），用于同步前确认 */
  @Get('read')
  read(@Query('url') url: string): Promise<FeishuReadResult> {
    return this.feishuService.readByUrl(url);
  }

  /**
   * 外部 Agent 用：把飞书文档/表格/多维表格转换为 Markdown。
   * URL 形如 /api/feishu/read.md?url=https%3A%2F%2Fxxx.feishu.cn%2Fdocx%2Fxxx
   */
  @Get('read.md')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  readMarkdown(@Query('url') url: string): Promise<string> {
    return this.feishuService.readMarkdown(url);
  }
}
