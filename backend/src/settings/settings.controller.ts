import { Controller, Get, Header, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { SettingsService } from './settings.service';
import type { PullResult, Settings } from './settings.service';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  /** 平台配置概览：脚本目录、访问域名（均只读，来源于配置文件） */
  @Get()
  getSettings(): Settings {
    return this.settingsService.getSettings();
  }

  /** 更新脚本仓库：在脚本根目录执行 git pull */
  @Post('scripts/pull')
  pullScripts(): Promise<PullResult> {
    return this.settingsService.pullScripts();
  }

  /**
   * AI 用：更新脚本仓库并以 Markdown 流式返回（text/markdown）。
   * 先头部信息与"输出"小节，git 执行中逐行追加输出，结束附"结果"小节。
   */
  @Post('scripts/pull.md')
  async pullScriptsMarkdown(@Res() res: Response): Promise<void> {
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    // 关闭反向代理缓冲，保证逐行实时到达
    res.setHeader('X-Accel-Buffering', 'no');
    res.write(
      [
        '# 更新脚本仓库',
        '',
        `- 脚本根目录：\`${this.settingsService.getSettings().scriptsDir}\``,
        '',
        '## 输出',
        '',
      ].join('\n'),
    );
    try {
      await this.settingsService.spawnPull((line) => res.write(`${line}\n`));
      res.write('\n## 结果\n\n- 状态：success\n- 消息：脚本仓库已更新\n');
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      res.write(`\n## 结果\n\n- 状态：error\n- 消息：${message}\n`);
    }
    res.end();
  }
}

/** GET /api/settings.md：设置信息的 Markdown 视图（单段路径经独立控制器挂载） */
@Controller('settings.md')
export class SettingsMarkdownController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  getSettingsMarkdown(): string {
    const s = this.settingsService.getSettings();
    return [
      '# 平台设置',
      '',
      '- 运行环境：' + s.environment,
      '- 服务端口：' + s.port,
      `- 脚本根目录：\`${s.scriptsDir}\``,
      `- 图片根目录：\`${s.imageWebroot}\``,
      `- 前端地址：${s.appUrl}`,
      `- 接口地址：${s.apiUrl}`,
      `- Lita API：${s.litaApiHost}`,
      `- 飞书 token 来源：${s.feishuTokenSource}`,
      `- 兜底通知 webhook：${s.feishuWebhookConfigured ? '已配置' : '未配置'}`,
      `- appium-agent：${s.agent.online ? `在线（${s.agent.name ?? '未知'}）` : '离线'}`,
      `- agent appium 地址：${s.agent.appiumUrl ? `\`${s.agent.appiumUrl}\`` : '-'}`,
      '',
      '## AI 操作',
      '',
      '更新脚本仓库（流式返回 git 输出与结果）：',
      '',
      '```bash',
      'curl -N -X POST /api/settings/scripts/pull.md',
      '```',
      '',
    ].join('\n');
  }
}
