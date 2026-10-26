import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { beijingTime, mdFrontmatter } from '../common/frontmatter';
import { GithubService } from './github.service';
import { CodeEvent } from './code-event.entity';
import { ProjectBranch } from './project-branch.entity';
import { Project } from '../projects/project.entity';

/** 事件关联的项目引用（一个 仓库+分支 可能被多个项目登记） */
export interface CodeEventProjectRef {
  id: number;
  name: string;
}

/** 事件视图：实体 + 关联项目 */
export type CodeEventView = CodeEvent & { projects: CodeEventProjectRef[] };

export interface ListCodeEventsQuery {
  projectId?: number;
  repo?: string;
  branch?: string;
  /** 模糊匹配 提交信息/作者 */
  q?: string;
  limit?: number;
}

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

/**
 * 代码事件查询：监听到的 提交/合并 记录（append-only）。
 * 项目过滤 = 匹配该项目登记的全部 (repo, branch) 组合（一个组合可关联多项目）。
 */
@Injectable()
export class CodeEventsService {
  constructor(
    @InjectRepository(CodeEvent)
    private readonly events: Repository<CodeEvent>,
    @InjectRepository(ProjectBranch)
    private readonly branches: Repository<ProjectBranch>,
    @InjectRepository(Project)
    private readonly projects: Repository<Project>,
    private readonly github: GithubService,
  ) {}

  async listEvents(query: ListCodeEventsQuery): Promise<CodeEventView[]> {
    const qb = this.events.createQueryBuilder('e');
    if (query.projectId !== undefined) {
      const records = await this.branches.find({
        where: { projectId: query.projectId },
        select: { repo: true, branch: true },
      });
      if (records.length === 0) return [];
      qb.andWhere(
        new Brackets((w) => {
          records.forEach((r, i) => {
            w.orWhere(`(e.repo = :repo${i} AND e.branch = :branch${i})`, {
              [`repo${i}`]: r.repo,
              [`branch${i}`]: r.branch,
            });
          });
        }),
      );
    }
    if (query.repo) {
      qb.andWhere('e.repo = :repo', {
        repo: this.github.normalizeRepo(query.repo),
      });
    }
    if (query.branch) {
      qb.andWhere('e.branch = :branch', { branch: query.branch.trim() });
    }
    if (query.q?.trim()) {
      qb.andWhere('(e.message ILIKE :q OR e.author ILIKE :q)', {
        q: `%${query.q.trim()}%`,
      });
    }
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, query.limit ?? DEFAULT_LIMIT),
    );
    const items = await qb
      .orderBy('e.committedAt', 'DESC')
      .addOrderBy('e.id', 'DESC')
      .take(limit)
      .getMany();
    return this.attachProjects(items);
  }

  /** 事件的 Markdown 清单（AI 视图，GET /api/code-events.md） */
  async listMarkdown(query: ListCodeEventsQuery): Promise<string> {
    const scope = query.repo
      ? `仓库 ${this.github.normalizeRepo(query.repo)}`
      : query.projectId !== undefined
        ? `项目 #${query.projectId}`
        : '全平台';
    const items = await this.listEvents(query);
    const lines = items.map((e) => {
      const head = `- ${beijingTime(e.committedAt)} \`${e.repo}\` @ \`${e.branch}\` — ${firstLine(e.message)}`;
      const parts: string[] = [];
      if (e.isMerge) parts.push('合并提交');
      if (e.author) parts.push(`作者：${e.author}`);
      const tail = parts.length > 0 ? `（${parts.join('，')}）` : '';
      const link = e.url ? ` — ${e.url}` : '';
      return `${head}${tail}${link}`;
    });
    const body =
      items.length > 0
        ? lines
        : [
            query.projectId !== undefined &&
            (await this.branchHasProject(query.projectId)) === false
              ? `项目 #${query.projectId} 未登记代码分支（先经 POST /api/code-branches 登记 仓库+分支）`
              : '（暂无记录；监听范围为项目登记的 仓库+分支，轮询每分钟一次）',
          ];
    return [
      mdFrontmatter({ title: `代码提交记录（${scope}）` }),
      `# 代码提交记录（${scope}）`,
      '',
      `共 ${items.length} 条（按提交时间倒序；test/main/stable 等登记分支的新提交/合并会被自动记录）：`,
      '',
      ...body,
      '',
    ].join('\n');
  }

  private async branchHasProject(projectId: number): Promise<boolean> {
    const count = await this.branches.count({ where: { projectId } });
    return count > 0;
  }

  /** 为每条事件附上登记了该 (repo, branch) 的项目（全量映射，量级小） */
  private async attachProjects(items: CodeEvent[]): Promise<CodeEventView[]> {
    if (items.length === 0) return [];
    const [records, projectList] = await Promise.all([
      this.branches.find({
        select: { repo: true, branch: true, projectId: true },
      }),
      this.projects.find({ select: { id: true, name: true } }),
    ]);
    const projectName = new Map(projectList.map((p) => [p.id, p.name]));
    const byTarget = new Map<string, CodeEventProjectRef[]>();
    for (const r of records) {
      const key = `${r.repo}@${r.branch}`;
      const refs = byTarget.get(key) ?? [];
      const name = projectName.get(r.projectId);
      if (name && !refs.some((ref) => ref.id === r.projectId)) {
        refs.push({ id: r.projectId, name });
      }
      byTarget.set(key, refs);
    }
    return items.map((e) => ({
      ...e,
      projects: byTarget.get(`${e.repo}@${e.branch}`) ?? [],
    }));
  }
}

/** 提交信息首行（截断 80 字符） */
function firstLine(message: string): string {
  const line = (message.split('\n')[0] ?? '').trim();
  return line.length > 80 ? `${line.slice(0, 80)}…` : line;
}
