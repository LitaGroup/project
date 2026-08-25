import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile } from 'child_process';
import * as path from 'path';
import { AgentGateway } from '../agent/agent.gateway';
import { DEFAULT_PROJECT_SOURCE_URL } from '../projects/project-sync.service';

/** git pull 超时时间（毫秒） */
const PULL_TIMEOUT_MS = 60_000;

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
