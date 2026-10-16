import { Body, Controller, Header, HttpCode, Post } from '@nestjs/common';
import { ScriptsImportService } from './scripts-import.service';

class ImportScriptsDto {
  /** 所属项目 id（必填；缺失或项目未配置脚本目录时返回带指引的 Markdown） */
  projectId?: number;
}

/**
 * AI 用统一脚本导入（text/markdown）：扫描项目脚本目录下未登记的
 * .check.ts / .test.ts / .export.ts，一次导入为 检查 / 用例 / 导出。
 * 路径以 .md 结尾，由全局 AuthGuard 按个人 agent 访问令牌鉴权（勿加 @Public）。
 */
@Controller('scripts/import.md')
export class ScriptsImportController {
  constructor(private readonly scriptsImportService: ScriptsImportService) {}

  @Post()
  @HttpCode(200)
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  importMarkdown(@Body() dto?: ImportScriptsDto): Promise<string> {
    return this.scriptsImportService.importMarkdown(dto?.projectId);
  }
}
