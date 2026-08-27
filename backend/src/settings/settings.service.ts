import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'child_process';
import * as path from 'path';
import { AgentGateway } from '../agent/agent.gateway';
import { DEFAULT_PROJECT_SOURCE_URL } from '../projects/project-sync.service';

/** git pull 超时时间（毫秒） */
const PULL_TIMEOUT_MS = 60_000;

/** git pull 失败（非零退出/超时/进程错误），携带已收集的输出供流式返回 */
export class PullError extends Error {
  constructor(
    message: string,
    readonly output: string[],
  ) {
    super(message);
  }
}

export interface Settings {
  /** 运行环境（NODE_ENV） */
  environment: string;
  /** 服务端口（PORT） */
  port: number;
  /** 脚本根目录（CHECK_SCRIPTS_DIR，只读展示） */
  scriptsDir: string;
  /** 图片根目录（DIR_IMAGE_WEBROOT，经 /images 静态对外） */
  imageWebroot: string;
  /** 浏览器访问地址（APP_URL） */
  appUrl: string;
  /** 接口访问地址（API_URL） */
  apiUrl: string;
  /** Lita 平台 API 地址（LITA_API_HOST，飞书 token 服务） */
  litaApiHost: string;
  /** 项目同步源多维表格地址（FEISHU_PROJECT_SOURCE_URL，未配置用内置默认） */
  feishuProjectSourceUrl: string;
  /** 飞书 token 来源：lita（LITA_USER_TOKEN 已配置）/ app-credential（自建应用凭据兜底） */
  feishuTokenSource: 'lita' | 'app-credential';
  /** 兜底通知 webhook 是否已配置（不暴露 secret） */
  feishuWebhookConfigured: boolean;
  /** appium-agent 连接信息（实时：离线时 name/appiumUrl 为 null） */
  agent: {
    online: boolean;
    name: string | null;
    /** agent 本机 appium server 的内网地址（回环地址已替换为内网 IP） */
    appiumUrl: string | null;
  };
}

export interface PullResult {
  /** git pull 的 stdout+stderr 输出 */
  output: string;
}

@Injectable()
export class SettingsService {
  private readonly environment: string;
  private readonly port: number;
  private readonly scriptsDir: string;
  private readonly imageWebroot: string;
  private readonly appUrl: string;
  private readonly apiUrl: string;
  private readonly litaApiHost: string;
  private readonly feishuProjectSourceUrl: string;
  private readonly feishuTokenSource: 'lita' | 'app-credential';
  private readonly feishuWebhookConfigured: boolean;

  constructor(
    config: ConfigService,
    private readonly agentGateway: AgentGateway,
  ) {
    this.environment = config.get<string>('NODE_ENV') ?? 'development';
    this.port = config.get<number>('PORT') ?? 3000;
    this.scriptsDir = path.resolve(
      config.get<string>('CHECK_SCRIPTS_DIR') ??
        path.resolve(process.cwd(), '../scripts'),
    );
    this.imageWebroot = path.resolve(
      config.get<string>('DIR_IMAGE_WEBROOT') ??
        path.resolve(process.cwd(), '../images'),
    );
    this.appUrl = config.get<string>('APP_URL') ?? `http://localhost:5173`;
    const port = this.port;
    this.apiUrl =
      config.get<string>('API_URL') ?? `http://localhost:${port}/api`;
    this.litaApiHost =
      config.get<string>('LITA_API_HOST') ?? 'https://api.cinta.team';
    this.feishuProjectSourceUrl =
      config.get<string>('FEISHU_PROJECT_SOURCE_URL') ??
      DEFAULT_PROJECT_SOURCE_URL;
    this.feishuTokenSource = config.get<string>('LITA_USER_TOKEN')
      ? 'lita'
      : 'app-credential';
    this.feishuWebhookConfigured = !!config.get<string>('FEISHU_WEBHOOK_URL');
  }

  /** 平台配置概览：运行环境、脚本/图片目录、访问域名、飞书相关、appium-agent 连接信息（均只读，不含密钥） */
  getSettings(): Settings {
    return {
      environment: this.environment,
      port: this.port,
      scriptsDir: this.scriptsDir,
      imageWebroot: this.imageWebroot,
      appUrl: this.appUrl,
      apiUrl: this.apiUrl,
      litaApiHost: this.litaApiHost,
      feishuProjectSourceUrl: this.feishuProjectSourceUrl,
      feishuTokenSource: this.feishuTokenSource,
      feishuWebhookConfigured: this.feishuWebhookConfigured,
      agent: this.agentGateway.getAgentInfo(),
    };
  }

  /** 在脚本根目录执行 git pull，返回合并后的输出（前端 JSON 接口用） */
  async pullScripts(): Promise<PullResult> {
    const lines: string[] = [];
    try {
      await this.spawnPull((line) => lines.push(line));
    } catch (e) {
      if (e instanceof PullError) {
        throw new InternalServerErrorException(
          e.output.join('\n') || e.message,
        );
      }
      throw e;
    }
    return { output: lines.join('\n') || '已是最新' };
  }

  /**
   * 在脚本根目录执行 git pull（spawn 流式）：onLine 逐行回调 stdout/stderr。
   * 成功 resolve；失败/超时 reject PullError（携带已收集的输出，流式接口仍可展示过程）。
   */
  spawnPull(onLine: (line: string) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const lines: string[] = [];
      let timedOut = false;
      let settled = false;
      // 兼容 CRLF 与无换行结尾的最后一段
      let buffer = '';
      const feed = (chunk: Buffer) => {
        buffer += chunk.toString();
        let idx = buffer.indexOf('\n');
        while (idx >= 0) {
          dispatch(buffer.slice(0, idx));
          buffer = buffer.slice(idx + 1);
          idx = buffer.indexOf('\n');
        }
      };
      const dispatch = (raw: string) => {
        const line = raw.trim();
        if (!line) return;
        lines.push(line);
        onLine(line);
      };

      const child = spawn('git', ['pull'], { cwd: this.scriptsDir });
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, PULL_TIMEOUT_MS);

      const finalize = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (buffer.trim()) dispatch(buffer);
        if (timedOut) {
          reject(
            new PullError(`脚本更新超时（>${PULL_TIMEOUT_MS / 1000}s）`, lines),
          );
        } else if (error) {
          reject(new PullError(`git pull 失败: ${error.message}`, lines));
        } else {
          resolve();
        }
      };

      child.stdout.on('data', feed);
      child.stderr.on('data', feed);
      child.on('error', (e) => finalize(e));
      child.on('close', (code) =>
        finalize(code === 0 ? undefined : new Error(`exit ${code}`)),
      );
    });
  }
}
