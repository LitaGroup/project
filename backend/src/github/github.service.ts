import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

/** 仓库搜索/分支联想的单次分页大小与页数上限（org 仓库 ≤ 500，分支 ≤ 500 足够联想用） */
const PAGE_SIZE = 100;
const MAX_PAGES = 5;

/** org 仓库列表的内存缓存时长（毫秒） */
const REPOS_CACHE_MS = 5 * 60_000;

/** GitHub 仓库（搜索联想用，已裁剪字段） */
export interface GithubRepo {
  /** 仓库名（如 lita-android） */
  name: string;
  /** 仓库全名（owner/name，如 LitaGroup/lita-android） */
  fullName: string;
  private: boolean;
  description: string | null;
  /** 默认分支名（通常 main） */
  defaultBranch: string;
  htmlUrl: string;
  language: string | null;
  updatedAt: string;
}

/** 归一化后的提交（监听入库与展示共用） */
export interface GithubCommit {
  sha: string;
  message: string;
  author: string | null;
  /** 是否合并提交（parents > 1） */
  isMerge: boolean;
  url: string | null;
  committedAt: Date;
}

/** GitHub API 客户端：仓库搜索 / 分支联想 / 分支提交列表（个人访问令牌鉴权，只读） */
@Injectable()
export class GithubService {
  private readonly http: AxiosInstance;
  private readonly org: string;
  private readonly token: string | undefined;
  private reposCache: { at: number; repos: GithubRepo[] } | null = null;

  constructor(config: ConfigService) {
    this.token = config.get<string>('GITHUB_TOKEN')?.trim() || undefined;
    this.org = config.get<string>('GITHUB_ORG')?.trim() || 'LitaGroup';
    this.http = axios.create({
      baseURL: 'https://api.github.com',
      timeout: 30_000,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
    });
  }

  /** 组织名（owner） */
  get orgName(): string {
    return this.org;
  }

  /** token 是否已配置（设置页只展示布尔，不回显明文） */
  get tokenConfigured(): boolean {
    return !!this.token;
  }

  /**
   * 搜索组织下的仓库（q 匹配 仓库名/全名/描述，不区分大小写；空 q 返回全部）。
   * 按最近更新倒序；org 清单缓存 5 分钟，过滤在应用层完成。
   */
  async searchRepos(q?: string): Promise<GithubRepo[]> {
    this.assertToken();
    const repos = await this.listOrgRepos();
    const keyword = q?.trim().toLowerCase();
    const matched = keyword
      ? repos.filter(
          (r) =>
            r.name.toLowerCase().includes(keyword) ||
            r.fullName.toLowerCase().includes(keyword) ||
            (r.description ?? '').toLowerCase().includes(keyword),
        )
      : repos;
    return matched.slice(0, 50);
  }

  /** 仓库的分支名列表（按字母序，分页拉全供联想） */
  async listBranches(repo: string): Promise<string[]> {
    this.assertToken();
    const full = this.normalizeRepo(repo);
    type BranchItem = { name: string };
    const pages = await this.paginate<BranchItem>(
      (page) =>
        this.http.get(`/repos/${full}/branches`, {
          params: { per_page: PAGE_SIZE, page },
        }),
      '分支',
    );
    return pages.map((b) => b.name);
  }

  /** 分支的最近提交（按提交时间倒序；sha=分支名，即该分支 head 所在历史） */
  async listCommits(
    repo: string,
    branch: string,
    perPage = 20,
  ): Promise<GithubCommit[]> {
    this.assertToken();
    const full = this.normalizeRepo(repo);
    type CommitItem = {
      sha: string;
      html_url: string;
      parents: unknown[];
      commit: {
        message: string;
        author: { name?: string; date?: string } | null;
      };
    };
    const { data } = await this.githubGet<CommitItem[]>(
      `/repos/${full}/commits`,
      { params: { sha: branch, per_page: Math.min(100, perPage) } },
      '提交',
    );
    return (Array.isArray(data) ? data : []).map((item) => ({
      sha: item.sha,
      message: item.commit.message ?? '',
      author: item.commit.author?.name ?? null,
      isMerge: (item.parents?.length ?? 0) > 1,
      url: item.html_url ?? null,
      committedAt: new Date(item.commit.author?.date ?? Date.now()),
    }));
  }

  /**
   * 归一化仓库标识：支持 `name` / `owner/name` / 完整 URL / .git 后缀，
   * owner 须为本组织（大小写不敏感，规范化为组织原名），否则 400。
   */
  normalizeRepo(input: string): string {
    let v = (input ?? '').trim();
    if (!v) throw new BadRequestException('仓库不能为空');
    v = v
      .replace(/^https?:\/\/(www\.)?github\.com\//i, '')
      .replace(/\.git$/i, '');
    const segments = v.split('/').filter(Boolean);
    if (segments.length < 2) {
      // 只有仓库名：默认归属本组织
      return `${this.org}/${segments[0]}`;
    }
    const [owner, name] = segments.slice(-2);
    if (owner.toLowerCase() !== this.org.toLowerCase()) {
      throw new BadRequestException(
        `仅支持组织 ${this.org} 下的仓库，收到：${owner}/${name}`,
      );
    }
    return `${this.org}/${name}`;
  }

  /** org 全量仓库清单（缓存 5 分钟），按最近更新倒序 */
  private async listOrgRepos(): Promise<GithubRepo[]> {
    if (this.reposCache && Date.now() - this.reposCache.at < REPOS_CACHE_MS) {
      return this.reposCache.repos;
    }
    type RepoItem = {
      name: string;
      full_name: string;
      private: boolean;
      description: string | null;
      default_branch: string | null;
      html_url: string;
      language: string | null;
      updated_at: string;
    };
    const pages = await this.paginate<RepoItem>(
      (page) =>
        this.http.get(`/orgs/${this.org}/repos`, {
          params: { per_page: PAGE_SIZE, page, sort: 'updated' },
        }),
      '仓库',
    );
    const repos: GithubRepo[] = pages
      .map((r) => ({
        name: r.name,
        fullName: r.full_name,
        private: !!r.private,
        description: r.description,
        defaultBranch: r.default_branch ?? 'main',
        htmlUrl: r.html_url,
        language: r.language,
        updatedAt: r.updated_at,
      }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    this.reposCache = { at: Date.now(), repos };
    return repos;
  }

  /** 未配置 token 直接拒绝，避免发出无鉴权请求 */
  private assertToken(): void {
    if (!this.token) {
      throw new ServiceUnavailableException(
        '未配置 GITHUB_TOKEN 环境变量，无法访问 GitHub API（需 LitaGroup 组织仓库的只读访问令牌）',
      );
    }
  }

  /** 分页拉取：逐页顺序请求，直到短页或达到页数上限 */
  private async paginate<T>(
    fetchPage: (page: number) => Promise<{ data: T[] }>,
    label: string,
  ): Promise<T[]> {
    const all: T[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const { data } = await this.unwrap(fetchPage(page), label);
      const items = Array.isArray(data) ? data : [];
      all.push(...items);
      if (items.length < PAGE_SIZE) break;
    }
    return all;
  }

  /** GET 并归一化错误（未配置 token / 限流 / 404 等） */
  private async githubGet<T>(
    url: string,
    config: Parameters<AxiosInstance['get']>[1],
    label: string,
  ): Promise<{ data: T }> {
    return this.unwrap(this.http.get<T>(url, config), label);
  }

  private async unwrap<T>(
    promise: Promise<{ data: T }>,
    label: string,
  ): Promise<{ data: T }> {
    if (!this.token) {
      throw new ServiceUnavailableException(
        '未配置 GITHUB_TOKEN 环境变量，无法访问 GitHub API（需 litaGroup 组织仓库的只读访问令牌）',
      );
    }
    try {
      return await promise;
    } catch (e) {
      if (axios.isAxiosError(e)) {
        const status = e.response?.status;
        const apiMessage = (
          (e.response?.data as { message?: string } | undefined)?.message ?? ''
        ).slice(0, 300);
        if (status === 404) {
          throw new BadGatewayException(`${label}不存在或无权访问`);
        }
        throw new BadGatewayException(
          `GitHub API 请求失败（${status ?? '无响应'}）${apiMessage ? `：${apiMessage}` : ''}`,
        );
      }
      throw e;
    }
  }
}
