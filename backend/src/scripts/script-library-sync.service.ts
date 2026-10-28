import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { spawn } from 'child_process';
import * as path from 'path';
import { GithubService } from '../github/github.service';

/** 单次 git 操作的超时时间（毫秒），与设置页 git pull 一致 */
const GIT_TIMEOUT_MS = 60_000;
/** 脚本库仓库名（组织取 GITHUB_ORG，默认 LitaGroup） */
const LIBRARY_REPO_NAME = 'scripts';
/** 脚本库只关注 main 分支（正式分支） */
export const LIBRARY_BRANCH = 'main';
/** 状态里保留的最近 git 输出行数上限 */
const MAX_OUTPUT_LINES = 50;

/** 脚本库同步状态（GET /api/script-library/status 与手动同步返回） */
export interface ScriptLibrarySyncStatus {
  /** 仓库全名（owner/name，如 LitaGroup/scripts） */
  repo: string;
  /** 监听分支（固定 main） */
  branch: string;
  /** GITHUB_TOKEN 是否已配置（未配置时跳过 API 比对，直接 git pull 兜底） */
  githubConfigured: boolean;
  /** 本地 main 分支 HEAD（读取失败为 null） */
  currentRevision: string | null;
  /** 远端 main 分支 HEAD（未比对为 null） */
  remoteRevision: string | null;
  /** 是否正在同步 */
  syncing: boolean;
  /** 最近一次同步时间 */
  lastSyncAt: string | null;
  /** 最近一次同步是否成功（从未执行为 null） */
  lastSyncOk: boolean | null;
  /** 最近一次失败的错误信息 */
  lastError: string | null;
  /** 最近一次同步来源（启动预热/定时同步/手动同步等） */
  lastSource: string | null;
  /** 最近一次同步耗时（毫秒） */
  lastDurationMs: number | null;
  /** 最近一次同步的 git 输出（最多 50 行） */
  lastOutput: string[];
}

/**
 * 脚本库同步：定期监听 scripts 仓库 main 分支更新并同步到本地脚本目录（CHECK_SCRIPTS_DIR）。
 * 策略：经 GitHub API 比对远端 HEAD，有变化才 `git pull --ff-only origin main`；
 * 未配置 GITHUB_TOKEN 时退化为每次直接 pull。本地分支不是 main、有冲突或网络失败时
 * 保留当前可用版本，记录错误下一周期重试；不使用 hard reset，不覆盖本地未提交修改。
 */
@Injectable()
export class ScriptLibrarySyncService implements OnModuleInit {
  private readonly logger = new Logger(ScriptLibrarySyncService.name);
  /** 脚本根目录（CHECK_SCRIPTS_DIR），须为 scripts 仓库的 main 分支工作区 */
  private readonly scriptsDir: string;
  private readonly repoFullName: string;

  /** 上一轮未结束时不重入（cron 触发、启动预热与手动同步可能重叠） */
  private running = false;
  private currentRevision: string | null = null;
  private remoteRevision: string | null = null;
  private lastSyncAt: string | null = null;
  private lastSyncOk: boolean | null = null;
  private lastError: string | null = null;
  private lastSource: string | null = null;
  private lastDurationMs: number | null = null;
  private lastOutput: string[] = [];

  constructor(
    config: ConfigService,
    private readonly github: GithubService,
  ) {
    this.scriptsDir = path.resolve(
      config.get<string>('CHECK_SCRIPTS_DIR') ??
        path.resolve(process.cwd(), '../scripts'),
    );
    this.repoFullName = `${github.orgName}/${LIBRARY_REPO_NAME}`;
  }

  /** 启动即同步一次（不阻塞模块初始化，失败仅告警） */
  onModuleInit(): void {
    void this.syncOnce('启动预热');
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async scheduledSync(): Promise<void> {
    await this.syncOnce('定时同步');
  }

  /** 当前同步状态（快照） */
  getStatus(): ScriptLibrarySyncStatus {
    return {
      repo: this.repoFullName,
      branch: LIBRARY_BRANCH,
      githubConfigured: this.github.tokenConfigured,
      currentRevision: this.currentRevision,
      remoteRevision: this.remoteRevision,
      syncing: this.running,
      lastSyncAt: this.lastSyncAt,
      lastSyncOk: this.lastSyncOk,
      lastError: this.lastError,
      lastSource: this.lastSource,
      lastDurationMs: this.lastDurationMs,
      lastOutput: this.lastOutput,
    };
  }

  /** 当前本地 main HEAD（运行记录快照用；读取失败回退最近一次已知值） */
  async currentHead(): Promise<string | null> {
    try {
      const head = (
        await this.git(['rev-parse', 'HEAD'], () => undefined)
      ).stdout.trim();
      return head || this.currentRevision;
    } catch {
      return this.currentRevision;
    }
  }

  /**
   * 同步一轮：本地分支校验 → 远端 HEAD 比对（可选）→ ff-only 拉取。
   * onLine 逐行回调 git 输出（设置页流式展示用）。上一轮未结束或另一轮刚启动时
   * 直接返回当前状态（幂等跳过，不报错）。
   */
  async syncOnce(
    source: string,
    onLine?: (line: string) => void,
  ): Promise<ScriptLibrarySyncStatus> {
    if (this.running) return this.getStatus();
    this.running = true;
    const startedAt = Date.now();
    const lines: string[] = [];
    const feed = (line: string) => {
      lines.push(line);
      onLine?.(line);
    };
    let ok = true;
    let error: string | null = null;
    try {
      // 本地分支必须为 main（脚本库只同步正式分支；否则保留现状并报错）
      const branch = (
        await this.git(['rev-parse', '--abbrev-ref', 'HEAD'], feed)
      ).stdout.trim();
      if (branch !== LIBRARY_BRANCH) {
        throw new Error(
          `脚本目录当前分支为 ${branch || '（未知）'}，仅支持 main，请先切换分支`,
        );
      }
      const local = (await this.git(['rev-parse', 'HEAD'], feed)).stdout.trim();
      if (local) this.currentRevision = local;

      // 远端 HEAD 比对：token 未配置时跳过比对，直接 pull 兜底
      let needsPull = !this.github.tokenConfigured;
      if (this.github.tokenConfigured) {
        const commits = await this.github.listCommits(
          this.repoFullName,
          LIBRARY_BRANCH,
          1,
        );
        const remote = commits[0]?.sha ?? null;
        this.remoteRevision = remote;
        needsPull = !remote || remote !== this.currentRevision;
        feed(
          `远端 main：${remote ?? '未知'}，本地：${this.currentRevision ?? '未知'}`,
        );
      }
      if (needsPull) {
        feed(`拉取 ${this.repoFullName}@${LIBRARY_BRANCH} 更新…`);
        await this.git(['pull', '--ff-only', 'origin', LIBRARY_BRANCH], feed);
        const head = (
          await this.git(['rev-parse', 'HEAD'], feed)
        ).stdout.trim();
        if (head) {
          this.currentRevision = head;
          this.remoteRevision = head;
        }
      } else {
        feed('已是最新');
      }
    } catch (e) {
      ok = false;
      error = e instanceof Error ? e.message : String(e);
      this.logger.warn(
        `[${source}] ${this.repoFullName}@${LIBRARY_BRANCH} 同步失败：${error}`,
      );
    } finally {
      this.running = false;
      this.lastSyncAt = new Date().toISOString();
      this.lastSyncOk = ok;
      this.lastError = error;
      this.lastSource = source;
      this.lastDurationMs = Date.now() - startedAt;
      this.lastOutput = lines.slice(-MAX_OUTPUT_LINES);
    }
    return this.getStatus();
  }

  /** 在脚本根目录执行 git 命令：收集 stdout/stderr 行，超时/非零退出 reject */
  private git(
    args: string[],
    onLine: (line: string) => void,
  ): Promise<{ stdout: string }> {
    return new Promise((resolve, reject) => {
      const lines: string[] = [];
      let stdout = '';
      let timedOut = false;
      let settled = false;
      let buffer = '';
      const feed = (chunk: Buffer) => {
        stdout += chunk.toString();
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

      const child = spawn('git', args, { cwd: this.scriptsDir });
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, GIT_TIMEOUT_MS);

      const finalize = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (buffer.trim()) dispatch(buffer);
        if (timedOut) {
          reject(
            new Error(`git ${args[0]} 超时（>${GIT_TIMEOUT_MS / 1000}s）`),
          );
        } else if (error) {
          reject(error);
        } else {
          resolve({ stdout });
        }
      };

      child.stdout.on('data', feed);
      child.stderr.on('data', feed);
      child.on('error', (e) => finalize(e));
      child.on('close', (code) =>
        finalize(
          code === 0
            ? undefined
            : new Error(
                `git ${args.join(' ')} 失败（exit ${code}）：${lines.slice(-5).join(' ') || '无输出'}`,
              ),
        ),
      );
    });
  }
}
