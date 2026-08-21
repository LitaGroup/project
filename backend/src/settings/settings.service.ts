import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile } from 'child_process';
import * as path from 'path';

/** git pull 超时时间（毫秒） */
const PULL_TIMEOUT_MS = 60_000;

export interface Settings {
  /** 脚本根目录（CHECK_SCRIPTS_DIR，只读展示） */
  scriptsDir: string;
  /** 浏览器访问地址（APP_URL） */
  appUrl: string;
  /** 接口访问地址（API_URL） */
  apiUrl: string;
}

export interface PullResult {
  /** git pull 的 stdout+stderr 输出 */
  output: string;
}

@Injectable()
export class SettingsService {
  private readonly scriptsDir: string;
  private readonly appUrl: string;
  private readonly apiUrl: string;

  constructor(config: ConfigService) {
    this.scriptsDir = path.resolve(
      config.get<string>('CHECK_SCRIPTS_DIR') ??
        path.resolve(process.cwd(), '../scripts'),
    );
    const port = config.get<number>('PORT') ?? 3000;
    this.appUrl = config.get<string>('APP_URL') ?? `http://localhost:5173`;
    this.apiUrl =
      config.get<string>('API_URL') ?? `http://localhost:${port}/api`;
  }

  getSettings(): Settings {
    return {
      scriptsDir: this.scriptsDir,
      appUrl: this.appUrl,
      apiUrl: this.apiUrl,
    };
  }

  /** 在脚本根目录执行 git pull，返回合并后的输出 */
  pullScripts(): Promise<PullResult> {
    return new Promise((resolve, reject) => {
      execFile(
        'git',
        ['pull'],
        { cwd: this.scriptsDir, timeout: PULL_TIMEOUT_MS },
        (error, stdout, stderr) => {
          const output = [stdout, stderr]
            .map((s) => s.trim())
            .filter(Boolean)
            .join('\n');
          if (error) {
            reject(
              new InternalServerErrorException(
                output || `git pull 失败: ${error.message}`,
              ),
            );
            return;
          }
          resolve({ output: output || '已是最新' });
        },
      );
    });
  }
}
