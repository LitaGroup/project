import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import { mdFrontmatter } from '../common/frontmatter';
import { AgentGateway } from '../agent/agent.gateway';
import { DEFAULT_PROJECT_SOURCE_URL } from '../projects/project-sync.service';
import { ScriptLibrarySyncService } from '../scripts/script-library-sync.service';

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
  /** GitHub 集成：token 配置状态（不回显明文）与组织名 */
  github: {
    tokenConfigured: boolean;
    org: string;
  };
  /** 公共 Agent 访问令牌是否已配置（不暴露明文） */
  publicAgentTokenConfigured: boolean;
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
  private readonly githubTokenConfigured: boolean;
  private readonly githubOrg: string;
  private readonly publicAgentTokenConfigured: boolean;

  constructor(
    config: ConfigService,
    private readonly agentGateway: AgentGateway,
    /** 脚本仓库更新复用脚本库 main 分支同步（同一定时任务的实现） */
    private readonly scriptLibrarySync: ScriptLibrarySyncService,
  ) {
    this.environment = config.get<string>('NODE_ENV') ?? 'development';
    this.port = config.get<number>('PORT') ?? 3100;
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
    this.githubTokenConfigured = !!config.get<string>('GITHUB_TOKEN')?.trim();
    this.githubOrg = config.get<string>('GITHUB_ORG')?.trim() || 'LitaGroup';
    this.publicAgentTokenConfigured = !!config
      .get<string>('PUBLIC_AGENT_TOKEN')
      ?.trim();
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
      github: {
        tokenConfigured: this.githubTokenConfigured,
        org: this.githubOrg,
      },
      publicAgentTokenConfigured: this.publicAgentTokenConfigured,
      agent: this.agentGateway.getAgentInfo(),
    };
  }

  /**
   * 更新脚本仓库：复用脚本库 main 分支同步（GitHub API 比对 + ff-only 拉取，仅 main），
   * 返回合并后的输出（前端 JSON 接口用）。
   */
  async pullScripts(): Promise<PullResult> {
    const status = await this.scriptLibrarySync.syncOnce('设置页手动');
    if (!status.lastSyncOk) {
      throw new InternalServerErrorException(
        status.lastError ?? '脚本仓库更新失败',
      );
    }
    return { output: status.lastOutput.join('\n') || '已是最新' };
  }

  /**
   * 更新脚本仓库（流式版本）：onLine 逐行回调 git 输出。
   * 成功 resolve；失败 reject（携带错误信息，流式接口仍可展示已收集的输出）。
   */
  async spawnPull(onLine: (line: string) => void): Promise<void> {
    const status = await this.scriptLibrarySync.syncOnce('设置页手动', onLine);
    if (!status.lastSyncOk) {
      throw new Error(status.lastError ?? '脚本仓库更新失败');
    }
  }

  /** 平台设置的 Markdown 视图（`/api/settings.md` 与 lita-work MCP 工具共用） */
  renderMarkdown(): string {
    const s = this.getSettings();
    return [
      mdFrontmatter({ title: '平台设置' }),
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
      `- GitHub：${s.github.tokenConfigured ? `已配置（组织 ${s.github.org}，每分钟监听项目登记分支的新提交）` : '未配置 GITHUB_TOKEN（代码监听停用）'}`,
      `- 公共 Agent 令牌：${s.publicAgentTokenConfigured ? '已配置（管理员权限，X-Agent-Token 调用 .md 端点，操作人记「公共 Agent」）' : '未配置 PUBLIC_AGENT_TOKEN'}`,
      `- appium-agent：${s.agent.online ? `在线（${s.agent.name ?? '未知'}）` : '离线'}`,
      `- agent appium 地址：${s.agent.appiumUrl ? `\`${s.agent.appiumUrl}\`` : '-'}`,
      '',
      '## AI 操作',
      '',
      '更新脚本仓库（MCP 工具 `pull_scripts`，或流式接口）：',
      '',
      '```bash',
      'curl -N -X POST /api/settings/scripts/pull.md',
      '```',
      '',
    ].join('\n');
  }
}
