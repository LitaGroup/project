import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Subject } from 'rxjs';
import { In, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { GithubService, GithubCommit } from './github.service';
import { CodeEvent } from './code-event.entity';
import { ProjectBranch } from './project-branch.entity';

export const CODE_EVENT_BUS = Symbol('CODE_EVENT_BUS');

/** 代码事件总线上的消息名（后续动作——代码 review / 自动化测试等——订阅它即可） */
export const CODE_EVENT_EMITTED = 'code.event';

/** 新事件负载：baseline=true 表示首次登记该 仓库+分支 时的历史补录，后续动作可据此跳过 */
export interface CodeEventPayload {
  event: CodeEvent;
  baseline: boolean;
}

/** 单次轮询的 (repo, branch) 目标 */
interface WatchTarget {
  repo: string;
  branch: string;
}

/**
 * GitHub 代码监听：每分钟轮询全平台项目登记的 (repo, branch) 去重集合，
 * 与库内已记录的 sha 比对，新提交/合并落 code_events 并向事件总线广播。
 * 首次见到的目标拉最近 20 条作基线（baseline 事件，不触发动作）。
 * 后续动作（代码 review / 跑自动化测试等）订阅 CODE_EVENT_BUS 的 code.event 事件即可。
 */
@Injectable()
export class GithubWatchService implements OnModuleInit {
  private readonly logger = new Logger(GithubWatchService.name);
  /** 上一轮未结束时不重入（cron 触发与启动预热可能重叠） */
  private running = false;
  private warnedNoToken = false;
  /** 连续失败的目标：目标 → 上次失败原因。同一目标持续失败只告警一次（恢复后清除），避免每分钟刷屏 */
  private readonly failures = new Map<string, string>();

  constructor(
    @InjectRepository(ProjectBranch)
    private readonly branches: Repository<ProjectBranch>,
    @InjectRepository(CodeEvent)
    private readonly events: Repository<CodeEvent>,
    private readonly github: GithubService,
    @Inject(CODE_EVENT_BUS)
    private readonly bus: Subject<CodeEventPayload>,
  ) {}

  /** 启动即跑一轮（不阻塞模块初始化，失败仅告警） */
  onModuleInit(): void {
    void this.pollOnce('启动预热');
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async scheduledPoll(): Promise<void> {
    await this.pollOnce('定时轮询');
  }

  /** 轮询一轮全部监听目标；单目标失败不影响其余 */
  async pollOnce(source: string): Promise<void> {
    if (!this.github.tokenConfigured) {
      if (!this.warnedNoToken) {
        this.warnedNoToken = true;
        this.logger.warn('未配置 GITHUB_TOKEN，代码监听停用');
      }
      return;
    }
    if (this.running) return;
    this.running = true;
    try {
      const records = await this.branches.find();
      const targets = new Map<string, WatchTarget>();
      for (const r of records) {
        targets.set(`${r.repo}@${r.branch}`, {
          repo: r.repo,
          branch: r.branch,
        });
      }
      for (const target of targets.values()) {
        const key = `${target.repo}@${target.branch}`;
        try {
          await this.pollTarget(target, source);
          if (this.failures.delete(key)) {
            this.logger.log(`[${source}] ${key} 恢复正常`);
          }
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          if (this.failures.get(key) !== message) {
            this.failures.set(key, message);
            this.logger.warn(`[${source}] ${key} 拉取失败：${message}`);
          }
        }
      }
    } finally {
      this.running = false;
    }
  }

  /** 拉取单个目标的最近提交并入库去重；向事件总线广播新事件 */
  private async pollTarget(target: WatchTarget, source: string): Promise<void> {
    const commits = await this.github.listCommits(
      target.repo,
      target.branch,
      20,
    );
    if (commits.length === 0) return;
    const existing = await this.events.find({
      where: { repo: target.repo, branch: target.branch },
      select: { sha: true },
    });
    // 首次见到的目标：本批为基线补录（历史近期提交），不触发后续动作
    const baseline = existing.length === 0;
    const known = new Set(existing.map((e) => e.sha));
    const fresh = commits.filter((c) => !known.has(c.sha));
    if (fresh.length === 0) return;
    await this.events
      .createQueryBuilder()
      .insert()
      .into(CodeEvent)
      .values(fresh.map((c) => this.toEntity(target, c)))
      .orIgnore()
      .execute();
    // 回读取 id/createdAt 组成完整事件再广播（并发下重复 sha 已被 orIgnore 挡掉）
    const saved = await this.events.find({
      where: {
        repo: target.repo,
        branch: target.branch,
        sha: In(fresh.map((c) => c.sha)),
      },
    });
    const savedBySha = new Map(saved.map((e) => [e.sha, e]));
    for (const commit of fresh) {
      const event = savedBySha.get(commit.sha);
      if (!event) continue;
      this.bus.next({ event, baseline });
    }
    this.logger.log(
      `[${source}] ${target.repo}@${target.branch} 新增 ${fresh.length} 条提交记录${baseline ? '（基线）' : ''}`,
    );
  }

  private toEntity(target: WatchTarget, commit: GithubCommit): CodeEvent {
    return this.events.create({
      repo: target.repo,
      branch: target.branch,
      sha: commit.sha,
      message: commit.message,
      author: commit.author,
      isMerge: commit.isMerge,
      url: commit.url,
      committedAt: commit.committedAt,
    });
  }
}
