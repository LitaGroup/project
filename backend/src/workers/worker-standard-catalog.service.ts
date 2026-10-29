import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WorkerStandard } from './worker.entity';

/** 规范目录条目（供机器人表单选择） */
export interface StandardCatalogItem {
  /** 展示名（frontmatter name 或 README 首个标题，缺失时取目录名） */
  name: string;
  /** 描述（frontmatter description） */
  description: string | null;
  /** 版本（frontmatter version） */
  version: string | null;
  /** 仓库内 README.md 相对路径 */
  path: string;
  /** README 所在目录（选中后同步的源目录） */
  directory: string;
  /** 原始文件下载地址（raw） */
  url: string;
  /** Gitea 页面地址（查看原文） */
  sourceUrl: string;
}

/** 初始化时解析出的受管规范文件集合 */
export interface ManagedStandardFiles {
  /** 规范库默认分支 */
  branch: string;
  /** 原始文件根地址（拼接仓库内相对路径即可下载） */
  rawBase: string;
  /** 去重后的规范目录 */
  directories: string[];
  /** 目录下全部文件（相对仓库根，已排序去重） */
  files: string[];
}

/** Gitea 仓库树条目（仅取用到的字段） */
interface GiteaTreeEntry {
  path?: string;
  type?: string;
}

interface GiteaTreeResponse {
  tree?: GiteaTreeEntry[];
  truncated?: boolean;
}

const DEFAULT_REPO_URL = 'http://gitea.cinta.team/docs/standard';
const CACHE_TTL_MS = 5 * 60_000;

/**
 * 规范库目录服务：读取 Gitea docs/standard 仓库中各目录的 README.md（不含根目录）。
 * 机器人保存时只保存规范引用；选中目录下的全部文档由初始化任务同步到工位 .opencode/rules。
 */
@Injectable()
export class WorkerStandardCatalogService {
  private readonly logger = new Logger(WorkerStandardCatalogService.name);

  /** 规范库仓库地址（浏览器可访问地址，不含结尾 /） */
  readonly repoUrl: string;

  private cache: StandardCatalogItem[] | null = null;
  private cacheLoadedAt = 0;
  private loading: Promise<StandardCatalogItem[]> | null = null;

  constructor(config: ConfigService) {
    this.repoUrl =
      config
        .get<string>('WORKER_STANDARD_REPO_URL')
        ?.trim()
        .replace(/\/+$/, '') || DEFAULT_REPO_URL;
  }

  /** 列出全部规范；q 匹配 名称/描述/路径（大小写不敏感） */
  async search(q?: string): Promise<StandardCatalogItem[]> {
    const items = await this.list();
    const keyword = q?.trim().toLowerCase();
    if (!keyword) return items;
    return items.filter((item) =>
      [item.name, item.description ?? '', item.path]
        .join('\n')
        .toLowerCase()
        .includes(keyword),
    );
  }

  /** 拉取并解析全部目录 README.md（成功结果缓存 5 分钟） */
  async list(force = false): Promise<StandardCatalogItem[]> {
    if (
      !force &&
      this.cache &&
      Date.now() - this.cacheLoadedAt < CACHE_TTL_MS
    ) {
      return this.cache;
    }
    this.loading ??= this.load().catch((e: Error) => {
      // 失败不留陈旧缓存；下一次请求重新拉取
      this.cache = null;
      this.cacheLoadedAt = 0;
      throw e;
    });
    try {
      return await this.loading;
    } finally {
      this.loading = null;
    }
  }

  /** 校验并规范化机器人保存的规范引用：必须是本规范库目录下的 README.md（根目录除外） */
  normalizeStandard(input: unknown): StandardCatalogItem {
    const raw = (input ?? {}) as Partial<StandardCatalogItem>;
    if (!raw.url || typeof raw.url !== 'string') {
      throw new BadRequestException('规范链接不能为空');
    }
    let url: URL;
    try {
      url = new URL(raw.url);
    } catch {
      throw new BadRequestException(`规范链接非法：${raw.url}`);
    }
    const repo = new URL(this.repoUrl);
    const rawPrefix = `${repo.pathname}/raw/branch/`.replace('//', '/');
    const srcPrefix = `${repo.pathname}/src/branch/`.replace('//', '/');
    if (url.origin !== repo.origin) {
      throw new BadRequestException('规范必须来自规范库仓库');
    }
    const isRaw = url.pathname.startsWith(rawPrefix);
    const isSrc = url.pathname.startsWith(srcPrefix);
    if (!isRaw && !isSrc) {
      throw new BadRequestException('规范必须指向规范库目录中的 README.md');
    }
    // 输入包含 path 时按 path 剥离分支；仅传链接时默认按单段分支名处理
    const suffix = decodeURIComponent(
      url.pathname.slice((isRaw ? rawPrefix : srcPrefix).length),
    );
    const inputPath =
      typeof raw.path === 'string' &&
      raw.path.endsWith('/README.md') &&
      !raw.path.includes('..')
        ? raw.path
        : null;
    if (
      inputPath &&
      !(suffix === inputPath || suffix.endsWith(`/${inputPath}`))
    ) {
      throw new BadRequestException('规范链接与规范路径不一致');
    }
    const relative =
      inputPath ??
      (suffix.includes('/') ? suffix.slice(suffix.indexOf('/') + 1) : suffix);
    if (
      !relative ||
      relative.includes('..') ||
      !relative.endsWith('/README.md')
    ) {
      throw new BadRequestException('规范必须指向规范库目录中的 README.md');
    }
    const branch = suffix
      .slice(0, suffix.length - relative.length)
      .replace(/\/+$/, '');
    if (!branch) {
      throw new BadRequestException('规范必须指定规范库分支');
    }
    const directory = relative.slice(0, -'/README.md'.length);
    const encodedPath = relative.split('/').map(encodeURIComponent).join('/');
    const encodedBranch = branch.split('/').map(encodeURIComponent).join('/');
    return {
      name: String(raw.name ?? '').trim() || directory,
      path: relative,
      directory,
      url: `${repo.origin}${rawPrefix}${encodedBranch}/${encodedPath}`,
      description:
        typeof raw.description === 'string' && raw.description.trim()
          ? raw.description.trim()
          : null,
      version:
        typeof raw.version === 'string' && raw.version.trim()
          ? raw.version.trim()
          : null,
      sourceUrl: `${repo.origin}${srcPrefix}${encodedBranch}/${encodedPath}`,
    };
  }

  /** 批量规范化并按 README 路径去重；undefined 表示本次未提交该字段 */
  normalizeStandards(
    input?: Array<unknown> | null,
  ): StandardCatalogItem[] | null | undefined {
    if (input === undefined) return undefined;
    if (!input?.length) return null;
    const byPath = new Map<string, StandardCatalogItem>();
    for (const item of input) {
      const standard = this.normalizeStandard(item);
      byPath.set(standard.path, standard);
    }
    return [...byPath.values()];
  }

  /**
   * 解析选中规范目录下的受管文件清单：取仓库当前目录树中这些目录下的全部文件。
   * 嵌套目录（如同时选 java 与 java/21）按目标路径去重。
   */
  async resolveManagedFiles(
    standards?: WorkerStandard[] | null,
  ): Promise<ManagedStandardFiles> {
    const directories = this.selectedDirectories(standards);
    if (!directories.length) {
      return { branch: '', rawBase: '', directories: [], files: [] };
    }
    const repo = new URL(this.repoUrl);
    const apiRepo = `${repo.origin}/api/v1/repos${repo.pathname}`;
    const selectedBranch = this.selectedBranch(standards);
    const repoInfo = await this.requestJson<{ default_branch?: string }>(
      apiRepo,
    );
    const branch = selectedBranch || repoInfo.default_branch?.trim() || 'main';
    const tree = await this.requestJson<GiteaTreeResponse>(
      `${apiRepo}/git/trees/${encodeURIComponent(branch)}?recursive=true`,
    );
    const files = (tree.tree ?? [])
      .filter((item) => {
        if (item.type !== 'blob' || !item.path) return false;
        // 系统垃圾文件不作为规范文档同步
        if (item.path.split('/').pop() === '.DS_Store') return false;
        return directories.some(
          (directory) =>
            item.path === directory || item.path!.startsWith(`${directory}/`),
        );
      })
      .map((item) => item.path!)
      .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
    const encodedBranch = branch.split('/').map(encodeURIComponent).join('/');
    return {
      branch,
      rawBase: `${repo.origin}${repo.pathname}/raw/branch/${encodedBranch}`,
      directories,
      files,
    };
  }

  /** 从保存的规范引用中解析去重后的同步目录 */
  private selectedDirectories(standards?: WorkerStandard[] | null): string[] {
    const directories = (standards ?? [])
      .map((item) => {
        const path = String(item?.path ?? '');
        return path.endsWith('/README.md') && !path.includes('..')
          ? path.slice(0, -'/README.md'.length)
          : this.normalizeStandard(item).directory;
      })
      .filter(Boolean);
    return [...new Set(directories)].sort((a, b) =>
      a.localeCompare(b, 'zh-Hans-CN'),
    );
  }

  /**
   * 解析已保存规范引用的分支：优先以引用 URL 为准，避免默认分支漂移后同步错版本。
   * 引用分支不一致时拒绝同步，防止同名目录在不同分支间产生歧义。
   */
  private selectedBranch(standards?: WorkerStandard[] | null): string | null {
    const repo = new URL(this.repoUrl);
    const marker = `${repo.pathname}/raw/branch/`;
    const branches = (standards ?? [])
      .map((item) => {
        const path = String(item?.path ?? '');
        if (!path.endsWith('/README.md') || path.includes('..')) return null;
        try {
          const url = new URL(String(item?.url ?? ''));
          if (url.origin !== repo.origin || !url.pathname.startsWith(marker)) {
            return null;
          }
          const suffix = decodeURIComponent(url.pathname.slice(marker.length));
          if (!(suffix === path || suffix.endsWith(`/${path}`))) return null;
          return (
            suffix.slice(0, suffix.length - path.length).replace(/\/+$/, '') ||
            null
          );
        } catch {
          return null;
        }
      })
      .filter((branch): branch is string => Boolean(branch));
    const unique = [...new Set(branches)];
    if (unique.length > 1) {
      throw new BadRequestException('选中的规范必须来自规范库同一分支');
    }
    return unique[0] ?? null;
  }

  /** 拉取默认分支 + 递归目录树，并读取全部目录 README.md 元数据 */
  private async load(): Promise<StandardCatalogItem[]> {
    const repo = new URL(this.repoUrl);
    const apiRepo = `${repo.origin}/api/v1/repos${repo.pathname}`;
    const repoInfo = await this.requestJson<{
      default_branch?: string;
    }>(apiRepo);
    const branch = repoInfo.default_branch?.trim() || 'main';
    const tree = await this.requestJson<GiteaTreeResponse>(
      `${apiRepo}/git/trees/${encodeURIComponent(branch)}?recursive=true`,
    );
    const paths = (tree.tree ?? [])
      .filter(
        (item) =>
          item.type === 'blob' &&
          item.path?.endsWith('/README.md') &&
          item.path !== 'README.md',
      )
      .map((item) => item.path!)
      .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
    const items = await Promise.all(
      paths.map((path) => this.loadItem(branch, path)),
    );
    this.cache = items;
    this.cacheLoadedAt = Date.now();
    return items;
  }

  /** 读取单个目录 README.md 并解析展示元数据 */
  private async loadItem(
    branch: string,
    path: string,
  ): Promise<StandardCatalogItem> {
    const directory = path.slice(0, -'/README.md'.length);
    const encodedPath = path.split('/').map(encodeURIComponent).join('/');
    const encodedBranch = branch.split('/').map(encodeURIComponent).join('/');
    const rawUrl = `${this.repoUrl}/raw/branch/${encodedBranch}/${encodedPath}`;
    const sourceUrl = `${this.repoUrl}/src/branch/${encodedBranch}/${encodedPath}`;
    let content = '';
    try {
      const res = await fetch(rawUrl, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      content = await res.text();
    } catch (e) {
      this.logger.warn(`规范元数据读取失败 ${path}: ${(e as Error).message}`);
    }
    const meta = this.parseFrontmatter(content);
    return {
      name:
        meta.name || meta.title || this.parseFirstHeading(content) || directory,
      description: meta.description || null,
      version: meta.version || null,
      path,
      directory,
      url: rawUrl,
      sourceUrl,
    };
  }

  /** 解析 frontmatter 中的 name/title/description/version（不做完整 YAML 解析） */
  private parseFrontmatter(content: string): {
    name?: string;
    title?: string;
    description?: string;
    version?: string;
  } {
    const match = content.match(/^---\s*\n([\s\S]*?)\n---(?:\s*\n|$)/);
    if (!match) return {};
    const result: Record<string, string> = {};
    for (const line of match[1].split(/\r?\n/)) {
      const item = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
      if (!item) continue;
      const [, key, rawValue] = item;
      const value = rawValue
        .trim()
        .replace(/^['"]|['"]$/g, '')
        .trim();
      if (value) result[key] = value;
    }
    return {
      name: result.name,
      title: result.title,
      description: result.description,
      version: result.version,
    };
  }

  /** README 无 frontmatter 名称时，取首个一级标题作展示名 */
  private parseFirstHeading(content: string): string | null {
    const heading = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => /^#\s+\S/.test(line));
    return heading ? heading.replace(/^#\s+/, '').trim() : null;
  }

  /** Gitea API JSON 请求 */
  private async requestJson<T>(url: string): Promise<T> {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      throw new Error(`Gitea API ${url} HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  }
}
