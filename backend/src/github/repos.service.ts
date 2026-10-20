import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Like, Repository } from 'typeorm';
import { RepoPlatform, RepoStatus } from '../common/enums';
import { mdFrontmatter } from '../common/frontmatter';
import { GithubRepo, GithubService } from './github.service';
import { Repo } from './repo.entity';

export interface ListReposQuery {
  platform?: string;
  status?: string;
  q?: string;
}

export interface UpdateRepoInput {
  platform?: RepoPlatform;
  status?: RepoStatus;
  remark?: string;
}

export interface RepoSyncResult {
  created: number;
  updated: number;
  total: number;
}

/**
 * 代码仓库登记：GitHub 组织仓库清单的本地视图 + 平台侧维护的端/状态。
 * 组织仓库清单随 GithubService 内存缓存（5 分钟）同步入库，每小时自动刷新一次；
 * 表为空时首个列表请求会触发一次同步（首次部署免手工操作）。
 */
@Injectable()
export class ReposService {
  private readonly logger = new Logger(ReposService.name);
  private syncing = false;

  constructor(
    @InjectRepository(Repo)
    private readonly repos: Repository<Repo>,
    private readonly github: GithubService,
  ) {}

  /**
   * 仓库列表：platform/status 精确筛选 + q 匹配 仓库名/全名/描述，按最后更新时间倒序。
   * 首次（表为空）自动从 GitHub 同步一次；同步失败仅告警，不阻断列表。
   */
  async list(query: ListReposQuery = {}): Promise<Repo[]> {
    if ((await this.repos.count()) === 0) {
      await this.syncSafely('首次同步');
    }
    const where: FindOptionsWhere<Repo>[] = [];
    const base: FindOptionsWhere<Repo> = {};
    if (query.platform !== undefined && query.platform !== '') {
      base.platform = this.normalizePlatform(query.platform);
    }
    if (query.status !== undefined && query.status !== '') {
      base.status = this.normalizeStatus(query.status);
    }
    const q = query.q?.trim();
    if (q) {
      where.push(
        { ...base, name: Like(`%${q}%`) },
        { ...base, fullName: Like(`%${q}%`) },
        { ...base, description: Like(`%${q}%`) },
      );
    } else {
      where.push(base);
    }
    return this.repos.find({
      where,
      order: { lastUpdatedAt: 'DESC', fullName: 'ASC' },
    });
  }

  async findOne(id: number): Promise<Repo> {
    const repo = await this.repos.findOne({ where: { id } });
    if (!repo) throw new NotFoundException(`Repo ${id} not found`);
    return repo;
  }

  /** 按仓库全名查询（不抛错；供其他服务按仓库推导默认值） */
  findByFullName(fullName: string): Promise<Repo | null> {
    return this.repos.findOne({ where: { fullName } });
  }

  /** 更新端/状态/备注（仓库本身信息随同步刷新，不允许手改） */
  async update(id: number, input: UpdateRepoInput): Promise<Repo> {
    const repo = await this.findOne(id);
    if (input.platform !== undefined) {
      repo.platform = this.normalizePlatform(input.platform);
    }
    if (input.status !== undefined) {
      repo.status = this.normalizeStatus(input.status);
    }
    if (input.remark !== undefined) {
      repo.remark = input.remark.trim() || null;
    }
    return this.repos.save(repo);
  }

  /** 全量同步组织仓库清单（按仓库全名 upsert；已忽略/已填端保持不变） */
  async sync(): Promise<RepoSyncResult> {
    if (this.syncing) {
      throw new ConflictException('仓库同步正在进行中，请稍后重试');
    }
    this.syncing = true;
    try {
      const remote = await this.github.listOrgRepos();
      const existing = new Map(
        (await this.repos.find()).map((r) => [r.fullName, r]),
      );
      let created = 0;
      let updated = 0;
      for (const item of remote) {
        const record = existing.get(item.fullName);
        if (record) {
          this.applyRemote(record, item);
          await this.repos.save(record);
          updated++;
        } else {
          const repo = this.repos.create({
            name: item.name,
            fullName: item.fullName,
            platform: RepoPlatform.OTHER,
            status: RepoStatus.ACTIVE,
          });
          this.applyRemote(repo, item);
          await this.repos.save(repo);
          created++;
        }
      }
      this.logger.log(
        `仓库同步完成：新增 ${created}，更新 ${updated}，共 ${remote.length}`,
      );
      return { created, updated, total: remote.length };
    } finally {
      this.syncing = false;
    }
  }

  /** 仓库 + 组织清单（含已忽略）的 Markdown 视图 */
  async listMarkdown(query: ListReposQuery = {}): Promise<string> {
    const rows = await this.list(query);
    const lines = [
      mdFrontmatter({
        update: new Date(),
        title: '仓库',
        description: '代码仓库登记（有效/忽略 + 端 + 最后更新时间）',
      }),
      '# 仓库',
      '',
      `> 共 ${rows.length} 个仓库（忽略的仓库不再出现在仓库联想与代码分支候选；仓库信息随 GitHub 组织清单每小时同步）。`,
      '',
      '| 仓库 | 端 | 状态 | 最后更新时间 | 描述 |',
      '| --- | --- | --- | --- | --- |',
    ];
    for (const row of rows) {
      lines.push(
        `| ${row.fullName} | ${row.platform} | ${row.status} | ${
          row.lastUpdatedAt
            ? row.lastUpdatedAt.toISOString().replace('T', ' ').slice(0, 19)
            : '—'
        } | ${(row.description ?? '').replace(/\|/g, '\\|') || '—'} |`,
      );
    }
    return lines.join('\n');
  }

  /** 仓库是否被忽略（不存在的仓库视为有效，避免误伤手工登记的仓库） */
  async isIgnored(fullName: string): Promise<boolean> {
    const record = await this.repos.findOne({
      where: { fullName },
      select: { id: true, status: true },
    });
    return record?.status === RepoStatus.IGNORED;
  }

  /** 被忽略仓库的全名（小写）集合，供联想过滤 */
  async ignoredFullNames(): Promise<Set<string>> {
    const rows = await this.repos.find({
      where: { status: RepoStatus.IGNORED },
      select: { fullName: true },
    });
    return new Set(rows.map((r) => r.fullName.toLowerCase()));
  }

  /** 代码分支登记前置校验：忽略的仓库不允许新登记/改登记 */
  async assertActive(fullName: string): Promise<void> {
    if (await this.isIgnored(fullName)) {
      throw new BadRequestException(
        `仓库 ${fullName} 已被忽略，请先到「代码 - 仓库」列表恢复为有效`,
      );
    }
  }

  private applyRemote(record: Repo, item: GithubRepo): void {
    record.name = item.name;
    record.fullName = item.fullName;
    record.description = item.description;
    record.htmlUrl = item.htmlUrl;
    record.defaultBranch = item.defaultBranch;
    record.language = item.language;
    const parsed = item.updatedAt ? new Date(item.updatedAt) : null;
    record.lastUpdatedAt =
      parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
  }

  /** 定时同步：每小时一次（刷新最后更新时间与仓库信息），失败仅告警 */
  @Cron(CronExpression.EVERY_HOUR)
  async scheduledSync(): Promise<void> {
    await this.syncSafely('定时同步');
  }

  private async syncSafely(scene: string): Promise<void> {
    if (this.syncing) return;
    try {
      await this.sync();
    } catch (e) {
      this.logger.warn(`仓库${scene}失败: ${(e as Error).message}`);
    }
  }

  private normalizePlatform(platform: string): RepoPlatform {
    if (!Object.values(RepoPlatform).includes(platform as RepoPlatform)) {
      throw new BadRequestException(
        `非法的端：${platform}（可选：${Object.values(RepoPlatform).join('/')}）`,
      );
    }
    return platform as RepoPlatform;
  }

  private normalizeStatus(status: string): RepoStatus {
    if (!Object.values(RepoStatus).includes(status as RepoStatus)) {
      throw new BadRequestException(
        `非法的状态：${status}（可选：${Object.values(RepoStatus).join('/')}）`,
      );
    }
    return status as RepoStatus;
  }
}
