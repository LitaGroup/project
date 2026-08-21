import { Controller, Get, Post } from '@nestjs/common';
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
}
