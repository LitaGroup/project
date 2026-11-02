import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
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
import { TaskTemplate } from './task-template.entity';

export interface TaskDocumentResult {
  path: string;
  url: string;
  title: string;
}

/** 交付文档：正文由作者完全维护，平台只维护路径、版本与更新时间。 */
export interface TaskHandoffDocument extends TaskDocumentResult {
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
  updatedAt: string | null;
}

export interface TaskAuxDocumentInput {
  /** 文档名，支持 API / API.md / TECH_DESIGN.md */
  name: string;
  /** 完整 Markdown 正文（Frontmatter 由平台生成） */
  content?: string;
  title?: string;
  updatedBy: string;
}

interface LegacyReviewDocument {
  node: KnowledgeNode;
  date: string;
  code: string;
  version: number;
}

/** 新任务交付文档的初始正文（正文被编辑后即失效） */
const INITIAL_HANDOFF_BODY = '> 正在处理中……';
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

/**
 * 任务文档（统一放在 /task/{yyyyMMdd}/{任务编号}/）：
 * - HANDOFF：任务创建时生成，执行机器人/需求方持续维护，申请验收时锁定版本
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

  /** 任务创建时初始化交付文档；失败只告警，后续读取/派发/验收会惰性补齐。 */
  async initializeHandoff(task: Task): Promise<TaskHandoffDocument | null> {
    try {
      // 新任务没有历史文档，跳过全量 /task 扫描，避免每次创建任务都遍历知识库。
      return await this.ensureHandoff(task, { legacy: false });
    } catch (error) {
      this.logger.warn(
        `任务 ${task.code} 初始化交付文档失败：${(error as Error).message}`,
      );
      return null;
    }
  }

  /**
   * 确保任务有可用的 HANDOFF：
   * 先按任务登记路径查找，再兼容历史日期路径；均不存在时创建初始文档。
   */
  async ensureHandoff(
    task: Task,
    options: { legacy?: boolean } = {},
  ): Promise<TaskHandoffDocument> {
    this.assertKnowledge();
    const plannedPath = this.handoffPath(task);
    let node = await this.knowledge.findNodeByPath(plannedPath);
    if (!node && !task.handoffPath?.trim() && options.legacy !== false) {
      node = await this.findLegacyHandoff(task);
    }
    const path = node?.path ?? plannedPath;
    if (node && node.kind !== 'article') {
      throw new BadRequestException(`任务文档路径 ${path} 已被目录占用`);
    }

    const now = new Date();
    let version = task.handoffVersion > 0 ? task.handoffVersion : 0;
    let body = node
      ? stripKnowledgeFrontmatter(node.content ?? '').trim()
      : INITIAL_HANDOFF_BODY;
    if (!version) {
      version = node ? (frontmatterVersion(node.content ?? '') ?? 1) : 1;
    }

    if (!node) {
      const created = await this.knowledge.createArticleAtPath({
        path,
        title: this.handoffTitle(task),
        content: this.renderHandoffContent({
          task,
          path,
          version,
          body: INITIAL_HANDOFF_BODY,
          updatedAt: now,
          updatedBy: '系统',
        }),
      });
      node = created;
      body = INITIAL_HANDOFF_BODY;
    } else if (!hasYamlFrontmatter(node.content ?? '')) {
      // 历史交付文档补齐平台元信息；正文保持不变。
      node = await this.knowledge.update(node.id, {
        title: this.handoffTitle(task),
        content: this.renderHandoffContent({
          task,
          path,
          version,
          body: body || INITIAL_HANDOFF_BODY,
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

  async readHandoff(task: Task): Promise<TaskHandoffDocument> {
    return this.ensureHandoff(task);
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
      const current = await this.ensureHandoff(task);
      if (!Number.isInteger(input.baseVersion)) {
        throw new BadRequestException('baseVersion 必须是整数');
      }
      if (input.baseVersion !== current.version) {
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
      if (body === current.content.trim()) {
        return { task, document: current, changed: false };
      }
      const now = new Date();
      const version = current.version + 1;
      const previous = {
        handoffVersion: task.handoffVersion,
        handoffUpdatedAt: task.handoffUpdatedAt,
        handoffUpdatedBy: task.handoffUpdatedBy,
        handoffPath: task.handoffPath,
      };
      const claimed = await this.tasks.update(
        {
          id: task.id,
          handoffVersion: current.version,
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
      return {
        task: saved,
        document: {
          ...current,
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

  /** 申请验收：校验正文已维护并锁定当前版本。 */
  async prepareForAcceptance(task: Task): Promise<TaskHandoffDocument> {
    const document = await this.ensureHandoff(task);
    if (!this.hasHandoffBody(document.content)) {
      throw new BadRequestException(
        '交付文档还没有有效内容，请先调用 handoff/update.md 维护交付文档后再申请验收',
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
    return this.upsertArticle(path, input.title, input.content);
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
    this.assertKnowledge();
    const directory = this.taskDirectory(task);
    const nodes = await this.knowledge.listArticlesByPrefix(directory);
    return nodes
      .filter((node) => node.parentPath === directory)
      .map((node) => this.documentEntry(node))
      .sort((a, b) => {
        const rank = (name: string): number =>
          name === `${HANDOFF_DOCUMENT}.md`
            ? 0
            : name === `${REVIEW_DOCUMENT}.md`
              ? 1
              : 2;
        return (
          rank(a.name) - rank(b.name) || a.name.localeCompare(b.name, 'en')
        );
      });
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
    return {
      name: `${name}.md`,
      path,
      url: `/docs/detail/${encodeKnowledgePath(path)}`,
      markdownUrl: `/docs/detail/${encodeKnowledgePath(path)}.md`,
      title,
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

  private documentEntry(node: KnowledgeNode): TaskDocumentEntry {
    return {
      name: documentReadName(node.name),
      path: node.path,
      url: `/docs/detail/${encodeKnowledgePath(node.path)}`,
      markdownUrl: `/docs/detail/${encodeKnowledgePath(node.path)}.md`,
      title: node.title,
      updatedAt: node.updatedAt ? node.updatedAt.toISOString() : null,
    };
  }

  private handoffTitle(task: Task): string {
    return `${task.code} ${task.title} · 任务交付文档`;
  }

  private handoffUrl(path: string): string {
    return `/docs/detail/${encodeKnowledgePath(path)}`;
  }

  private hasHandoffBody(content: string): boolean {
    const text = content.trim();
    return Boolean(text) && text !== INITIAL_HANDOFF_BODY;
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
