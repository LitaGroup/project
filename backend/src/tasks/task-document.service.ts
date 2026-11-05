import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TaskStatus, TaskSubStatus } from '../common/enums';
import { beijingTime, mdFrontmatter } from '../common/frontmatter';
import { stripKnowledgeFrontmatter } from '../knowledge/knowledge.chunk';
import { encodeKnowledgePath } from '../knowledge/knowledge.path';
import { KnowledgeService } from '../knowledge/knowledge.service';
import type { KnowledgeNode } from '../knowledge/knowledge.types';
import { Task } from './task.entity';
import { TaskRealtimeService } from './task-realtime.service';
import { TaskTemplate } from './task-template.entity';

export interface TaskDocumentResult {
  path: string;
  url: string;
  title: string;
}

/** 交付文档：正文由作者完全维护，平台只维护路径、版本与更新时间。 */
export interface TaskHandoffDocument extends TaskDocumentResult {
  /** 文档是否已由执行方/需求方显式创建 */
  exists: boolean;
  version: number;
  submittedVersion: number | null;
  content: string;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface TaskHandoffUpdateInput {
  /** 完整正文；与 append 二选一 */
  content?: string;
  /** 追加到当前正文末尾的 Markdown；适合执行过程中持续补充进展 */
  append?: string;
  baseVersion: number;
  updatedBy: string;
}

/** 任务目录下的文档（不含正文）：文件名为 `API.md` 这类带后缀的阅读名。 */
export interface TaskDocumentEntry {
  /** 阅读名，如 API.md / HANDOFF.md */
  name: string;
  /** 知识路径（不带 .md 后缀），如 /task/20261102/TK-0001/API */
  path: string;
  /** 网页阅读地址（不带 .md） */
  url: string;
  /** Markdown 接口地址（带 .md） */
  markdownUrl: string;
  title: string;
  /** 文档 Frontmatter 中的描述（可空） */
  description: string | null;
  updatedAt: string | null;
  /** 来源任务（「文档」Tab 聚合子任务文档时携带） */
  taskId?: number;
  taskCode?: string;
  taskTitle?: string;
}

export interface TaskAuxDocumentInput {
  /** 文档名，支持 API / API.md / TECH_DESIGN.md */
  name: string;
  /** 完整 Markdown 正文（Frontmatter 由平台生成） */
  content?: string;
  title?: string;
  updatedBy: string;
}

/** 任务文档正文（网页只读预览用） */
export interface TaskDocumentContentEntry extends TaskDocumentEntry {
  /** 去掉平台 Frontmatter 后的 Markdown 正文 */
  content: string;
}

/** 任务文档中引用的站内图片/文件 */
export interface TaskArtifactEntry {
  name: string;
  kind: 'image' | 'file';
  /** 站内公开地址（/images、/files、/export-files） */
  url: string;
  /** 引用该产物的任务文档 */
  sourceDocument: string;
  /** 来源任务（「文档」Tab 聚合子任务文档时携带） */
  taskId?: number;
  taskCode?: string;
  taskTitle?: string;
}

/** 任务详情「文档」Tab 的完整数据（documents 含当前任务与全部子任务文档） */
export interface TaskDocumentsView {
  directory: string;
  /** 当前任务 id，用于前端区分「当前任务」与「子任务」分组 */
  taskId: number;
  documents: TaskDocumentEntry[];
  artifacts: TaskArtifactEntry[];
}

interface LegacyReviewDocument {
  node: KnowledgeNode;
  date: string;
  code: string;
  version: number;
}

/** 旧任务自动生成的占位正文；不再创建，仅用于拦截历史空交付 */
const LEGACY_HANDOFF_PLACEHOLDER = '> 正在处理中……';
const HANDOFF_DOCUMENT = 'HANDOFF';
const REVIEW_DOCUMENT = 'REVIEW';

/** 任务目录下由平台统一维护、不能从通用文档接口写入的文档 */
const PLATFORM_TASK_DOCUMENTS = new Set([HANDOFF_DOCUMENT, REVIEW_DOCUMENT]);

/** 文档名：字母/数字开头，允许点、下划线、短横线（如 API.md、TECH_DESIGN.md） */
const TASK_DOCUMENT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** 旧版任务总结：/task/handoff/{yyyyMMdd}/{taskCode}/{version}.md */
const LEGACY_REVIEW_PATH = /^\/task\/handoff\/(\d{8})\/([^/]+)\/(\d+)\.md$/;

/**
 * 早期任务文档把 `.md` 写进了知识路径（如 `/task/.../HANDOFF.md`）。
 * 知识接口把结尾 `.md` 当作 Markdown 视图后缀，这类节点无法通过浏览器或 API 访问，需去掉。
 */
const SUFFIXED_TASK_DOCUMENT_PATH = /^\/task\/(\d{8})\/([^/]+)\/([^/]+)\.md$/;

/** 统一文档名：去掉可选的 .md 后缀；HANDOFF/REVIEW 大小写归一。 */
function normalizeTaskDocumentName(raw: string): string {
  const input = raw?.trim();
  if (!input) throw new BadRequestException('文档名称不能为空');
  const name = input.toLowerCase().endsWith('.md') ? input.slice(0, -3) : input;
  if (!name || !TASK_DOCUMENT_NAME.test(name) || name.includes('..')) {
    throw new BadRequestException(
      '文档名称只能包含字母、数字、点、下划线和短横线（如 API.md、TECH_DESIGN.md）',
    );
  }
  const upper = name.toUpperCase();
  return PLATFORM_TASK_DOCUMENTS.has(upper) ? upper : name;
}

/** 知识路径里的文档名不带 .md，阅读名统一补上。 */
function documentReadName(name: string): string {
  return name.toLowerCase().endsWith('.md') ? name : `${name}.md`;
}

/** Markdown 图片/链接与 HTML img：用于从任务文档中提取图片、文件产物 */
const MARKDOWN_ARTIFACT_LINK =
  /(!?)\[([^\]]*)\]\(\s*(<[^>]+>|[^)\s]+)(?:\s+["'][^"']*["'])?\s*\)/g;
const HTML_IMAGE = /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
const LOCAL_ARTIFACT_PREFIXES = ['/images/', '/files/', '/export-files/'];
const IMAGE_EXTENSION = /\.(?:png|jpe?g|gif|webp|svg|bmp|avif)(?:[?#].*)?$/i;

/** 把站内绝对地址归一为相对路径；外部地址返回 null */
function normalizeLocalArtifactUrl(raw: string): string | null {
  const url = raw.replace(/^<|>$/g, '').trim();
  if (!url) return null;
  if (LOCAL_ARTIFACT_PREFIXES.some((prefix) => url.startsWith(prefix))) {
    return url;
  }
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) return null;
    if (
      LOCAL_ARTIFACT_PREFIXES.some((prefix) =>
        parsed.pathname.startsWith(prefix),
      )
    ) {
      return `${parsed.pathname}${parsed.search}`;
    }
  } catch {
    // 非绝对 URL：忽略
  }
  return null;
}

function artifactName(label: string, url: string): string {
  const cleanLabel = label.trim();
  if (cleanLabel) return cleanLabel;
  const path = url.split(/[?#]/)[0];
  const raw = path.slice(path.lastIndexOf('/') + 1);
  try {
    return decodeURIComponent(raw) || path || url;
  } catch {
    return raw || url;
  }
}

/** 从任务文档正文中提取站内图片与文件（同一 URL 只保留一条） */
function extractTaskArtifacts(
  documents: Array<{
    name: string;
    content: string;
    taskId?: number;
    taskCode?: string;
    taskTitle?: string;
  }>,
): TaskArtifactEntry[] {
  const found = new Map<string, TaskArtifactEntry>();
  const add = (
    rawUrl: string,
    label: string,
    source: {
      name: string;
      taskId?: number;
      taskCode?: string;
      taskTitle?: string;
    },
    forceImage = false,
  ) => {
    const url = normalizeLocalArtifactUrl(rawUrl);
    if (!url) return;
    const kind: TaskArtifactEntry['kind'] =
      forceImage || url.startsWith('/images/') || IMAGE_EXTENSION.test(url)
        ? 'image'
        : 'file';
    const key = `${kind}:${url}`;
    if (found.has(key)) return;
    const entry: TaskArtifactEntry = {
      name: artifactName(label, url),
      kind,
      url,
      sourceDocument: source.name,
    };
    if (source.taskId !== undefined) entry.taskId = source.taskId;
    if (source.taskCode !== undefined) entry.taskCode = source.taskCode;
    if (source.taskTitle !== undefined) entry.taskTitle = source.taskTitle;
    found.set(key, entry);
  };

  for (const document of documents) {
    const body = stripKnowledgeFrontmatter(document.content);
    for (const match of body.matchAll(MARKDOWN_ARTIFACT_LINK)) {
      add(match[3], match[2] ?? '', document, match[1] === '!');
    }
    for (const match of body.matchAll(HTML_IMAGE)) {
      add(match[1], '', document, true);
    }
  }
  return [...found.values()];
}

function dateStamp(value: Date): string {
  return beijingTime(value).slice(0, 10).replace(/-/g, '');
}

function hasYamlFrontmatter(markdown: string): boolean {
  return /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.test(markdown);
}

function frontmatterVersion(markdown: string): number | null {
  if (!hasYamlFrontmatter(markdown)) return null;
  const match = markdown.match(/^version:\s*"?(\d+)"?\s*$/m);
  if (!match) return null;
  const version = Number(match[1]);
  return Number.isFinite(version) && version > 0 ? version : null;
}

/** 读取文档 Frontmatter 的 description（支持单/双引号，不做完整 YAML 解析） */
function frontmatterDescription(markdown: string): string | null {
  if (!hasYamlFrontmatter(markdown)) return null;
  const match = markdown.match(
    /^description:\s*(?:"([^"]*)"|'([^']*)'|(.+?))\s*$/m,
  );
  if (!match) return null;
  const value = (match[1] ?? match[2] ?? match[3] ?? '').trim();
  return value || null;
}

/**
 * 任务文档（统一放在 /task/{yyyyMMdd}/{任务编号}/）：
 * - HANDOFF：执行方开始处理后显式创建并持续维护，申请验收时锁定版本
 * - REVIEW：验收通过后生成/覆盖的复盘文档，与 HANDOFF 同目录
 * - API / TECH_DESIGN 等：执行过程中由任务接口读写的普通文档
 * 知识路径不带 `.md` 后缀（`.md` 是知识接口的 Markdown 视图后缀）。
 * 同时负责把旧版 /task/handoff/{date}/{code}/{version}.md 收敛到 REVIEW。
 */
@Injectable()
export class TaskDocumentService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TaskDocumentService.name);
  private readonly handoffLocks = new Map<number, Promise<unknown>>();

  constructor(
    @InjectRepository(Task)
    private readonly tasks: Repository<Task>,
    @InjectRepository(TaskTemplate)
    private readonly taskTemplates: Repository<TaskTemplate>,
    private readonly knowledge: KnowledgeService,
    private readonly taskRealtime: TaskRealtimeService,
  ) {}

  onApplicationBootstrap(): void {
    const timer = setTimeout(() => {
      void this.migrateLegacyDocuments()
        .catch((error: Error) => {
          this.logger.warn(`旧任务总结文档迁移失败：${error.message}`);
        })
        .then(() => this.migrateSuffixedDocumentPaths())
        .catch((error: Error) => {
          this.logger.warn(`历史任务文档路径修正失败：${error.message}`);
        });
    }, 3000);
    timer.unref();
  }

  /**
   * 读取 HANDOFF：只查找已有文档，不创建。
   * 兼容历史日期目录与旧占位文档；不存在时返回 exists=false 的路径描述。
   */
  async readHandoff(task: Task): Promise<TaskHandoffDocument> {
    this.assertKnowledge();
    const plannedPath = this.handoffPath(task);
    let node = await this.knowledge.findNodeByPath(plannedPath);
    if (!node) {
      node = await this.findLegacyHandoff(task);
    }
    let body = node ? stripKnowledgeFrontmatter(node.content ?? '').trim() : '';

    // 历史任务可能因早期读取在派生路径生成了占位文档，而真实 HANDOFF 位于
    // 其它日期目录。只要当前仍是占位正文，就尝试回收同任务的真实交付文档。
    if (!node || !this.hasHandoffBody(body)) {
      const recovered = await this.findLegacyHandoff(task);
      if (recovered && recovered.id !== node?.id) {
        node = recovered;
        body = stripKnowledgeFrontmatter(recovered.content ?? '').trim();
      }
    }

    const path = node?.path ?? plannedPath;
    if (node && node.kind !== 'article') {
      throw new BadRequestException(`任务文档路径 ${path} 已被目录占用`);
    }

    if (!node) {
      return {
        exists: false,
        path,
        url: this.handoffUrl(path),
        title: this.handoffTitle(task),
        version: 0,
        submittedVersion: task.handoffSubmittedVersion ?? null,
        content: '',
        updatedAt: null,
        updatedBy: null,
      };
    }

    const now = new Date();
    let version = task.handoffVersion > 0 ? task.handoffVersion : 0;
    if (!version) {
      version = frontmatterVersion(node.content ?? '') ?? 1;
    }

    if (!hasYamlFrontmatter(node.content ?? '')) {
      // 历史交付文档补齐平台元信息；正文保持不变。
      node = await this.knowledge.update(node.id, {
        title: this.handoffTitle(task),
        content: this.renderHandoffContent({
          task,
          path,
          version,
          body,
          updatedAt: node.updatedAt ?? now,
          updatedBy: task.handoffUpdatedBy ?? '系统',
        }),
      });
    }

    const updatedAt = task.handoffUpdatedAt ?? node.updatedAt ?? now;
    const updatedBy = task.handoffUpdatedBy ?? '系统';
    if (
      task.handoffPath !== path ||
      task.handoffVersion !== version ||
      !task.handoffUpdatedAt
    ) {
      await this.tasks.update(
        { id: task.id },
        {
          handoffPath: path,
          handoffVersion: version,
          handoffUpdatedAt: updatedAt,
          handoffUpdatedBy: updatedBy,
        },
      );
      task.handoffPath = path;
      task.handoffVersion = version;
      task.handoffUpdatedAt = updatedAt;
      task.handoffUpdatedBy = updatedBy;
    }

    return {
      exists: true,
      path,
      url: this.handoffUrl(path),
      title: this.handoffTitle(task),
      version,
      submittedVersion: task.handoffSubmittedVersion ?? null,
      content: body,
      updatedAt: updatedAt ? new Date(updatedAt).toISOString() : null,
      updatedBy,
    };
  }

  /** 平台维护版本号；作者提交完整正文，Frontmatter 由平台覆盖。 */
  async updateHandoff(
    taskId: number,
    input: TaskHandoffUpdateInput,
  ): Promise<{
    task: Task;
    document: TaskHandoffDocument;
    /** 正文是否有实际变化；无变化不递增版本、不触发通知 */
    changed: boolean;
  }> {
    return this.withHandoffLock(taskId, async () => {
      const task = await this.mustFind(taskId);
      this.assertHandoffEditable(task);
      const current = await this.readHandoff(task);
      if (!Number.isInteger(input.baseVersion)) {
        throw new BadRequestException('baseVersion 必须是整数');
      }
      if (!current.exists) {
        if (input.baseVersion !== 0) {
          throw new ConflictException(
            '交付文档尚未创建；首次写入必须使用 baseVersion=0',
          );
        }
      } else if (input.baseVersion !== current.version) {
        throw new ConflictException(
          `交付文档已更新（当前 v${current.version}，提交基于 v${input.baseVersion}），请重新读取后再修改`,
        );
      }
      const appended =
        typeof input.append === 'string'
          ? stripKnowledgeFrontmatter(input.append).trim()
          : null;
      const body =
        appended !== null
          ? [current.content.trim(), appended].filter(Boolean).join('\n\n')
          : stripKnowledgeFrontmatter(input.content ?? '').trim();
      if (!current.exists && !body) {
        throw new BadRequestException('交付文档正文不能为空');
      }
      if (body === current.content.trim()) {
        return { task, document: current, changed: false };
      }
      const now = new Date();
      const version = Math.max(current.version, task.handoffVersion ?? 0) + 1;
      const previous = {
        handoffVersion: task.handoffVersion,
        handoffUpdatedAt: task.handoffUpdatedAt,
        handoffUpdatedBy: task.handoffUpdatedBy,
        handoffPath: task.handoffPath,
      };
      const claimed = await this.tasks.update(
        {
          id: task.id,
          // 首次创建允许任务版本仍为 0；已有文档按读取到的版本做乐观锁。
          handoffVersion: current.exists
            ? current.version
            : task.handoffVersion,
        },
        {
          handoffPath: current.path,
          handoffVersion: version,
          handoffUpdatedAt: now,
          handoffUpdatedBy: input.updatedBy,
        },
      );
      if (!claimed.affected) {
        throw new ConflictException(
          '交付文档已被其他人更新，请重新读取后再修改',
        );
      }
      try {
        await this.upsertArticle(
          current.path,
          this.handoffTitle(task),
          this.renderHandoffContent({
            task,
            path: current.path,
            version,
            body,
            updatedAt: now,
            updatedBy: input.updatedBy,
          }),
        );
      } catch (error) {
        await this.tasks
          .update({ id: task.id }, previous)
          .catch((rollbackError: Error) =>
            this.logger.warn(
              `任务 ${task.code} 交付文档版本回滚失败：${rollbackError.message}`,
            ),
          );
        throw error;
      }
      const saved = await this.mustFind(taskId);
      // 任务详情「交付 / 文档」Tab 与工作台依赖该事件实时刷新
      this.taskRealtime.taskChanged(taskId);
      return {
        task: saved,
        document: {
          ...current,
          exists: true,
          version,
          submittedVersion: saved.handoffSubmittedVersion ?? null,
          content: body,
          updatedAt: now.toISOString(),
          updatedBy: input.updatedBy,
        },
        changed: true,
      };
    });
  }

  /** 申请验收：校验正文已显式创建并维护，锁定当前版本。 */
  async prepareForAcceptance(task: Task): Promise<TaskHandoffDocument> {
    const document = await this.readHandoff(task);
    if (!document.exists || !this.hasHandoffBody(document.content)) {
      throw new BadRequestException(
        document.exists
          ? '交付文档还没有有效内容，请先调用 handoff/update.md 维护交付文档后再申请验收'
          : '交付文档尚未创建，请先调用 handoff/update.md（baseVersion=0）写入交付内容后再申请验收',
      );
    }
    const claimed = await this.tasks.update(
      {
        id: task.id,
        handoffVersion: document.version,
      },
      { handoffSubmittedVersion: document.version },
    );
    if (!claimed.affected) {
      throw new ConflictException('交付文档刚刚被更新，请重新读取后再申请验收');
    }
    task.handoffSubmittedVersion = document.version;
    return { ...document, submittedVersion: document.version };
  }

  /** 任务详情 / AI 读取：平台重新生成 Frontmatter，正文保持作者原文。 */
  renderHandoffMarkdown(task: Task, document: TaskHandoffDocument): string {
    if (!document.exists) {
      throw new NotFoundException(
        `任务 ${task.code} 尚未创建交付文档，请先调用 handoff/update.md（baseVersion=0）`,
      );
    }
    return this.renderHandoffContent({
      task,
      path: document.path,
      version: document.version,
      body: document.content,
      updatedAt: document.updatedAt ? new Date(document.updatedAt) : new Date(),
      updatedBy: document.updatedBy ?? '系统',
    });
  }

  /** 复盘文档写入：固定使用任务文档目录，重新生成覆盖同一篇 */
  async upsertReview(input: {
    task: Task;
    title: string;
    content: string;
  }): Promise<TaskDocumentResult> {
    const path = this.reviewPath(input.task);
    const result = await this.upsertArticle(path, input.title, input.content);
    this.taskRealtime.taskChanged(input.task.id);
    return result;
  }

  /**
   * 任务文档目录：`/task/{yyyyMMdd}/{任务编号}`。
   * 已登记 HANDOFF 的历史任务沿用其所在目录，保证 API/REVIEW 与 HANDOFF 同目录。
   */
  taskDirectory(task: Task): string {
    const saved = task.handoffPath?.trim();
    if (saved) {
      const slash = saved.lastIndexOf('/');
      if (slash > 0) return saved.slice(0, slash);
    }
    return `/task/${dateStamp(task.createdAt ?? new Date())}/${task.code}`;
  }

  /** 任务目录下某篇文档的知识路径（不带 .md） */
  taskDocumentPath(task: Task, name: string): string {
    return `${this.taskDirectory(task)}/${normalizeTaskDocumentName(name)}`;
  }

  /** 复盘文档与交付文档放在同一任务目录下 */
  reviewPath(task: Task): string {
    return `${this.taskDirectory(task)}/${REVIEW_DOCUMENT}`;
  }

  handoffPath(task: Task): string {
    const saved = task.handoffPath?.trim();
    if (saved) return saved;
    return `${this.taskDirectory(task)}/${HANDOFF_DOCUMENT}`;
  }

  /** 列出任务目录下的文档（HANDOFF 优先，REVIEW 次之，其余按名称排序）。 */
  async listTaskDocuments(task: Task): Promise<TaskDocumentEntry[]> {
    const { nodes, directory } = await this.directTaskDocumentNodes(task);
    return nodes
      .filter((node) => node.parentPath === directory)
      .map((node) => this.documentEntry(node))
      .sort((a, b) => this.compareTaskDocuments(a, b));
  }

  /**
   * 任务详情「文档」Tab：当前任务 + 全部子任务（递归）的 Markdown 文档与产物。
   * 不含父任务与兄弟任务；Agent 用的 documents.md 仍只列当前任务自身文档。
   */
  async taskDocumentsView(task: Task): Promise<TaskDocumentsView> {
    this.assertKnowledge();
    const tree = await this.collectTaskWithDescendants(task);
    const perTask = await Promise.all(
      tree.map(async (current) => {
        const directory = this.taskDirectory(current);
        const nodes = await this.knowledge.listArticlesByPrefix(directory);
        return {
          task: current,
          directory,
          nodes: nodes.filter((node) => node.parentPath === directory),
        };
      }),
    );
    const documents = perTask.flatMap(({ task: current, nodes }) =>
      nodes
        .map((node) => this.documentEntry(node, current))
        .sort((a, b) => this.compareTaskDocuments(a, b)),
    );
    const artifacts = extractTaskArtifacts(
      perTask.flatMap(({ task: current, nodes }) =>
        nodes.map((node) => ({
          name: documentReadName(node.name),
          content: node.content ?? '',
          taskId: current.id,
          taskCode: current.code,
          taskTitle: current.title,
        })),
      ),
    );
    return {
      directory: this.taskDirectory(task),
      taskId: task.id,
      documents,
      artifacts,
    };
  }

  /** 当前任务与其全部后代任务（深度优先；不含父任务与兄弟任务）。 */
  private async collectTaskWithDescendants(task: Task): Promise<Task[]> {
    const rows = await this.tasks.find({
      where: { rootId: task.rootId },
      order: { sortOrder: 'ASC', id: 'ASC' },
    });
    const byParent = new Map<number, Task[]>();
    for (const row of rows) {
      if (row.parentId == null) continue;
      const list = byParent.get(row.parentId) ?? [];
      list.push(row);
      byParent.set(row.parentId, list);
    }
    const collected: Task[] = [];
    const walk = (current: Task): void => {
      collected.push(current);
      for (const child of byParent.get(current.id) ?? []) walk(child);
    };
    walk(task);
    return collected;
  }

  /** 读取任务目录下某篇文档的正文（去掉平台 Frontmatter）。 */
  async readTaskDocument(
    task: Task,
    name: string,
  ): Promise<TaskDocumentContentEntry> {
    this.assertKnowledge();
    const normalized = normalizeTaskDocumentName(name);
    const path = this.taskDocumentPath(task, normalized);
    const node = await this.knowledge.findNodeByPath(path);
    if (!node || node.kind !== 'article') {
      throw new NotFoundException(
        `任务文档 ${documentReadName(normalized)} 不存在`,
      );
    }
    return {
      ...this.documentEntry(node),
      content: stripKnowledgeFrontmatter(node.content ?? '').trim(),
    };
  }

  /** 复盘文档（尚未生成时返回 null）。 */
  async readReview(task: Task): Promise<TaskDocumentContentEntry | null> {
    this.assertKnowledge();
    const path = this.reviewPath(task);
    const node = await this.knowledge.findNodeByPath(path);
    if (!node || node.kind !== 'article') return null;
    return {
      ...this.documentEntry(node),
      content: stripKnowledgeFrontmatter(node.content ?? '').trim(),
    };
  }

  /**
   * 写入任务目录下的普通文档（API.md / TECH_DESIGN.md 等）。
   * HANDOFF 与 REVIEW 由任务流程维护，不允许从这里覆盖。
   */
  async upsertTaskDocument(
    task: Task,
    input: TaskAuxDocumentInput,
  ): Promise<TaskDocumentEntry> {
    const name = normalizeTaskDocumentName(input.name);
    if (PLATFORM_TASK_DOCUMENTS.has(name)) {
      throw new BadRequestException(
        `${name}.md 由任务流程维护：交付文档请用 handoff/update.md，复盘文档在验收通过后由平台生成`,
      );
    }
    const path = this.taskDocumentPath(task, name);
    const now = new Date();
    const title =
      input.title?.trim() || `${task.code} ${task.title} · ${name}.md`;
    const body = stripKnowledgeFrontmatter(input.content ?? '').trim();
    const content = `${mdFrontmatter({
      update: now,
      document: name,
      task: task.code,
      updated_by: input.updatedBy,
    })}${body}\n`;
    await this.upsertArticle(path, title, content);
    this.taskRealtime.taskChanged(task.id);
    return {
      name: `${name}.md`,
      path,
      url: `/docs/detail/${encodeKnowledgePath(path)}`,
      markdownUrl: `/docs/detail/${encodeKnowledgePath(path)}.md`,
      title,
      description: frontmatterDescription(content),
      updatedAt: now.toISOString(),
    };
  }

  /** 任务文档目录的 Markdown 清单（Agent 读取约定与已有文档）。 */
  taskDocumentsMarkdown(task: Task, documents: TaskDocumentEntry[]): string {
    const directory = this.taskDirectory(task);
    const lines = [
      mdFrontmatter({
        title: `任务 ${task.code} 文档`,
        description: task.title,
        update: new Date(),
      }),
      `# ${task.code} ${task.title} · 任务文档`,
      '',
      `- 文档目录：\`${directory}\``,
      `- 目录约定：任务相关文档默认放在该目录；需求中明确指定文档地址时，以需求指定的地址为准。`,
      `- 常用文档：\`API.md\`（接口）、\`TECH_DESIGN.md\`（技术方案）、\`HANDOFF.md\`（交付，执行中持续维护）、\`REVIEW.md\`（复盘，验收通过后由平台生成）。`,
      `- 知识路径不带 \`.md\` 后缀：例如 \`API.md\` 的路径是 \`${directory}/API\`，阅读地址是 \`/api/docs/detail/${encodeKnowledgePath(directory)}/API.md\`。`,
      '',
      '## 已有文档',
      '',
    ];
    if (documents.length === 0) {
      lines.push('（暂无文档）', '');
    } else {
      lines.push(
        '| 文档 | 知识路径 | 阅读地址 | 更新时间 |',
        '| --- | --- | --- | --- |',
      );
      for (const document of documents) {
        lines.push(
          `| ${document.name} | \`${document.path}\` | \`/api${document.markdownUrl}\` | ${
            document.updatedAt ? beijingTime(document.updatedAt) : '-'
          } |`,
        );
      }
      lines.push('');
    }
    lines.push(
      '## 写入文档',
      '',
      '任务目录下的普通文档（不含 HANDOFF / REVIEW）使用任务接口写入，通用知识接口对 `/task/**` 只读：',
      '',
      '```bash',
      'TOKEN=$(cat .opencode/agent-token)',
      `curl -sS -X POST '{BASE}/api/tasks/${task.id}/documents.md' \\`,
      '  -H "X-Worker-Token: $TOKEN" \\',
      '  -H "Content-Type: application/json" \\',
      '  -d \'{"name":"TECH_DESIGN.md","content":"# 技术方案\\n\\n..."}\'',
      '```',
      '',
      'HANDOFF 使用 `POST /api/tasks/{id}/handoff/update.md` 维护；需求指定了项目文档或其它知识路径时，分别使用 `POST /api/documents/upsert.md` 或 `POST /api/docs/nodes/create.md`。',
      '',
    );
    return lines.join('\n');
  }

  /** 按路径创建或覆盖文章 */
  async upsertArticle(
    path: string,
    title: string,
    content: string,
  ): Promise<TaskDocumentResult> {
    this.assertKnowledge();
    const existing = await this.knowledge.findNodeByPath(path);
    if (existing) {
      if (existing.kind !== 'article') {
        throw new BadRequestException(`任务文档路径 ${path} 已被目录占用`);
      }
      await this.knowledge.update(existing.id, { title, content });
    } else {
      await this.knowledge.createArticleAtPath({ path, title, content });
    }
    return {
      path,
      url: `/docs/detail/${encodeKnowledgePath(path)}`,
      title,
    };
  }

  /** 任务定义名称与说明（定义已删除时回退任务上的名称快照）。 */
  async taskDefinitionOf(task: Task): Promise<{
    name: string | null;
    description: string | null;
  }> {
    if (!task.templateId) {
      return { name: task.templateName ?? null, description: null };
    }
    try {
      const template = await this.taskTemplates.findOne({
        where: { id: task.templateId },
        select: { id: true, name: true, description: true },
      });
      if (template) {
        return { name: template.name, description: template.description };
      }
    } catch (error) {
      this.logger.warn(
        `读取任务定义 ${task.templateId} 失败：${(error as Error).message}`,
      );
    }
    return { name: task.templateName ?? null, description: null };
  }

  /**
   * 旧版任务总结迁移：每个任务取最新版本收敛为 REVIEW。
   * 目标已存在时保留目标，仅清理旧版本文档；失败只告警，可下次重试。
   */
  async migrateLegacyDocuments(): Promise<number> {
    if (!this.knowledge.isEnabled) return 0;
    let nodes: KnowledgeNode[];
    try {
      nodes = await this.knowledge.listArticlesByPrefix('/task/handoff');
    } catch (error) {
      this.logger.warn(`读取旧任务总结文档失败：${(error as Error).message}`);
      return 0;
    }
    const latest = new Map<string, LegacyReviewDocument>();
    for (const node of nodes) {
      const match = LEGACY_REVIEW_PATH.exec(node.path);
      if (!match) continue;
      const candidate: LegacyReviewDocument = {
        node,
        date: match[1],
        code: match[2],
        version: Number(match[3]),
      };
      const current = latest.get(candidate.code);
      if (!current || this.isNewer(candidate, current)) {
        latest.set(candidate.code, candidate);
      }
    }
    if (latest.size === 0) return 0;

    let migrated = 0;
    for (const candidate of latest.values()) {
      try {
        const legacyNodes = nodes.filter((node) => {
          const match = LEGACY_REVIEW_PATH.exec(node.path);
          return match?.[2] === candidate.code;
        });
        await this.migrateTask(candidate, legacyNodes);
        migrated += 1;
      } catch (error) {
        this.logger.warn(
          `旧任务总结 ${candidate.node.path} 迁移失败：${(error as Error).message}`,
        );
      }
    }
    await this.knowledge
      .pruneEmptyDirectories('/task/handoff')
      .catch((error: Error) =>
        this.logger.warn(`清理旧任务总结空目录失败：${error.message}`),
      );
    if (migrated > 0) {
      this.logger.log(`已迁移 ${migrated} 个旧任务总结到 REVIEW`);
    }
    return migrated;
  }

  /**
   * 去掉历史任务文档路径里的 `.md` 后缀：
   * 知识接口把结尾 `.md` 当成 Markdown 视图，节点 `/task/.../HANDOFF.md` 会解析成
   * `/task/.../HANDOFF` 而 404。失败只告警，可下次重试。
   */
  async migrateSuffixedDocumentPaths(): Promise<number> {
    if (!this.knowledge.isEnabled) return 0;
    let nodes: KnowledgeNode[];
    try {
      nodes = await this.knowledge.listArticlesByPrefix('/task');
    } catch (error) {
      this.logger.warn(`读取历史任务文档失败：${(error as Error).message}`);
      return 0;
    }

    let migrated = 0;
    for (const node of nodes) {
      if (!SUFFIXED_TASK_DOCUMENT_PATH.test(node.path)) continue;
      const targetPath = node.path.slice(0, -3);
      try {
        const existing = await this.knowledge.findNodeByPath(targetPath);
        if (existing) {
          this.logger.warn(
            `任务文档 ${node.path} 未能去掉 .md 后缀：${targetPath} 已存在`,
          );
          continue;
        }
        await this.knowledge.update(node.id, {
          name: node.name.slice(0, -3),
          content: (node.content ?? '').replaceAll(node.path, targetPath),
        });
        migrated += 1;
      } catch (error) {
        this.logger.warn(
          `任务文档 ${node.path} 去掉 .md 后缀失败：${(error as Error).message}`,
        );
      }
    }
    if (migrated > 0) {
      this.logger.log(`已修正 ${migrated} 个历史任务文档路径（去掉 .md 后缀）`);
    }
    return migrated;
  }

  private async directTaskDocumentNodes(task: Task): Promise<{
    nodes: KnowledgeNode[];
    directory: string;
  }> {
    this.assertKnowledge();
    const directory = this.taskDirectory(task);
    const nodes = await this.knowledge.listArticlesByPrefix(directory);
    return { nodes, directory };
  }

  private compareTaskDocuments(
    a: TaskDocumentEntry,
    b: TaskDocumentEntry,
  ): number {
    const rank = (name: string): number =>
      name === `${HANDOFF_DOCUMENT}.md`
        ? 0
        : name === `${REVIEW_DOCUMENT}.md`
          ? 1
          : 2;
    return rank(a.name) - rank(b.name) || a.name.localeCompare(b.name, 'en');
  }

  private documentEntry(node: KnowledgeNode, task?: Task): TaskDocumentEntry {
    const entry: TaskDocumentEntry = {
      name: documentReadName(node.name),
      path: node.path,
      url: `/docs/detail/${encodeKnowledgePath(node.path)}`,
      markdownUrl: `/docs/detail/${encodeKnowledgePath(node.path)}.md`,
      title: node.title,
      description: frontmatterDescription(node.content ?? ''),
      updatedAt: node.updatedAt ? node.updatedAt.toISOString() : null,
    };
    if (task) {
      entry.taskId = task.id;
      entry.taskCode = task.code;
      entry.taskTitle = task.title;
    }
    return entry;
  }

  private handoffTitle(task: Task): string {
    return `${task.code} ${task.title} · 任务交付文档`;
  }

  private handoffUrl(path: string): string {
    return `/docs/detail/${encodeKnowledgePath(path)}`;
  }

  private hasHandoffBody(content: string): boolean {
    const text = content.trim();
    return Boolean(text) && text !== LEGACY_HANDOFF_PLACEHOLDER;
  }

  private renderHandoffContent(input: {
    task: Task;
    path: string;
    version: number;
    body: string;
    updatedAt: Date;
    updatedBy: string;
  }): string {
    const frontmatter = mdFrontmatter({
      update: input.updatedAt,
      document: HANDOFF_DOCUMENT,
      task: input.task.code,
      version: String(input.version),
      updated_by: input.updatedBy,
    });
    return `${frontmatter}${input.body.trim()}\n`;
  }

  private assertHandoffEditable(task: Task): void {
    if (task.status === TaskStatus.FINISHED) {
      throw new BadRequestException('任务已结束，交付文档只读');
    }
    if (
      task.status === TaskStatus.WAITING &&
      task.subStatus === TaskSubStatus.PENDING_ACCEPT
    ) {
      throw new BadRequestException(
        '任务待验收期间交付文档已锁定，请先撤销交付或等待验收返工',
      );
    }
  }

  /**
   * 任务登记路径不存在时，兼容早期按申请验收日期创建的 HANDOFF。
   * 同一任务有多个历史日期文档时取最近更新的一篇。
   */
  private async findLegacyHandoff(task: Task): Promise<KnowledgeNode | null> {
    try {
      const nodes = await this.knowledge.listArticlesByPrefix('/task');
      const escaped = task.code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`^/task/\\d{8}/${escaped}/HANDOFF(?:\\.md)?$`);
      return (
        nodes
          .filter((node) => pattern.test(node.path))
          // 只回收真实正文，避免把另一个占位 HANDOFF 当成有效交付
          .filter((node) =>
            this.hasHandoffBody(
              stripKnowledgeFrontmatter(node.content ?? '').trim(),
            ),
          )
          .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0] ??
        null
      );
    } catch (error) {
      this.logger.warn(
        `任务 ${task.code} 查找历史交付文档失败：${(error as Error).message}`,
      );
      return null;
    }
  }

  private async withHandoffLock<T>(
    taskId: number,
    action: () => Promise<T>,
  ): Promise<T> {
    const previous = this.handoffLocks.get(taskId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(action);
    this.handoffLocks.set(taskId, current);
    try {
      return await current;
    } finally {
      if (this.handoffLocks.get(taskId) === current) {
        this.handoffLocks.delete(taskId);
      }
    }
  }

  private async mustFind(taskId: number): Promise<Task> {
    const task = await this.tasks.findOne({ where: { id: taskId } });
    if (!task) throw new BadRequestException(`任务 ${taskId} 不存在`);
    return task;
  }

  private async migrateTask(
    candidate: LegacyReviewDocument,
    legacyNodes: KnowledgeNode[],
  ): Promise<void> {
    const task = await this.tasks.findOne({
      where: { code: candidate.code },
    });
    const targetPath = task
      ? this.reviewPath(task)
      : `/task/${candidate.date}/${candidate.code}/${REVIEW_DOCUMENT}`;
    const title = task
      ? `${task.code} ${task.title} · 任务复盘`
      : `${candidate.code} · 任务复盘`;
    const existing = await this.knowledge.findNodeByPath(targetPath);
    if (existing && existing.kind !== 'article') {
      throw new BadRequestException(`目标任务文档路径 ${targetPath} 不是文章`);
    }

    if (!existing) {
      const content = this.normalizeLegacyReview(
        candidate.node.content ?? '',
        candidate.node.path,
        targetPath,
        title,
      );
      await this.knowledge.update(candidate.node.id, {
        parentPath: targetPath.slice(0, targetPath.lastIndexOf('/')),
        name: 'REVIEW',
        title,
        content,
      });
    }
    for (const node of legacyNodes) {
      if (node.id === candidate.node.id && !existing) continue;
      await this.knowledge.remove(node.id).catch((error: Error) => {
        this.logger.warn(`删除旧任务总结 ${node.path} 失败：${error.message}`);
      });
    }
  }

  private normalizeLegacyReview(
    content: string,
    legacyPath: string,
    targetPath: string,
    title: string,
  ): string {
    return content
      .replace(/^# .* · 任务总结移交$/m, `# ${title}`)
      .replace(/^> 报告版本：v\d+ ｜ /m, '> ')
      .replaceAll(legacyPath, targetPath)
      .replaceAll('任务总结', '任务复盘');
  }

  private isNewer(
    next: LegacyReviewDocument,
    current: LegacyReviewDocument,
  ): boolean {
    if (next.date !== current.date) return next.date > current.date;
    if (next.version !== current.version) return next.version > current.version;
    return next.node.updatedAt > current.node.updatedAt;
  }

  private assertKnowledge(): void {
    if (!this.knowledge.isEnabled) {
      throw new BadRequestException(
        this.knowledge.disabledMessage || '知识库不可用，无法生成任务文档',
      );
    }
  }
}
