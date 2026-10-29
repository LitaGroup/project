import {
  BadRequestException,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { beijingTime } from '../common/frontmatter';
import { encodeKnowledgePath } from '../knowledge/knowledge.path';
import { KnowledgeService } from '../knowledge/knowledge.service';
import type { KnowledgeNode } from '../knowledge/knowledge.types';
import type { Worker } from '../workers/worker.entity';
import { renderTaskDocument } from './task-document-format';
import {
  normalizeTaskDeliveryReport,
  type TaskDeliveryReport,
  type TaskDeliveryReportInput,
} from './task-delivery-report';
import { Task } from './task.entity';
import { TaskTemplate } from './task-template.entity';

export interface TaskDocumentResult {
  path: string;
  url: string;
  title: string;
}

interface LegacyReviewDocument {
  node: KnowledgeNode;
  date: string;
  code: string;
  version: number;
}

/** 旧版任务总结：/task/handoff/{yyyyMMdd}/{taskCode}/{version}.md */
const LEGACY_REVIEW_PATH = /^\/task\/handoff\/(\d{8})\/([^/]+)\/(\d+)\.md$/;

/**
 * 早期任务文档把 `.md` 写进了知识路径（如 `/task/.../HANDOFF.md`）。
 * 知识接口把结尾 `.md` 当作 Markdown 视图后缀，这类节点无法通过浏览器或 API 访问，需去掉。
 */
const SUFFIXED_TASK_DOCUMENT_PATH =
  /^\/task\/(\d{8})\/([^/]+)\/(HANDOFF|REVIEW)\.md$/;

function dateStamp(value: Date): string {
  return beijingTime(value).slice(0, 10).replace(/-/g, '');
}

/**
 * 任务文档：
 * - HANDOFF：机器人申请验收时生成/覆盖的交付文档
 * - REVIEW：验收通过后生成/覆盖的复盘文档
 * 知识路径不带 `.md` 后缀（`.md` 是知识接口的 Markdown 视图后缀）。
 * 同时负责把旧版 /task/handoff/{date}/{code}/{version}.md 收敛到 REVIEW。
 */
@Injectable()
export class TaskDocumentService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TaskDocumentService.name);

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

  /** 申请验收时生成/覆盖交付文档 */
  async upsertHandoff(input: {
    task: Task;
    result: string | null;
    worker: Worker;
    appliedAt: Date;
    /** 执行机器人主动提交的结构化交付说明 */
    report?: TaskDeliveryReportInput | TaskDeliveryReport | null;
    /** 任务需求方名称（由验收入口解析） */
    requesterName?: string | null;
  }): Promise<TaskDocumentResult> {
    const { task, result, worker, appliedAt } = input;
    const path = this.handoffPath(task, appliedAt);
    const title = `${task.code} ${task.title} · 任务交付文档`;
    const definition = await this.taskDefinitionOf(task);
    const content = renderTaskDocument({
      kind: 'handoff',
      task,
      path,
      generatedAt: appliedAt,
      workerName: worker.name,
      workerId: worker.id,
      workerOwnerName: worker.ownerName ?? null,
      requesterName: input.requesterName ?? null,
      definitionName: definition.name,
      definitionDescription: definition.description,
      result: result ?? task.result,
      report: normalizeTaskDeliveryReport(input.report),
    });
    return this.upsertArticle(path, title, content);
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

  /** 复盘文档写入：固定使用验收日期路径，重新生成覆盖同一篇 */
  async upsertReview(input: {
    task: Task;
    title: string;
    content: string;
  }): Promise<TaskDocumentResult> {
    const path = this.reviewPath(input.task);
    return this.upsertArticle(path, input.title, input.content);
  }

  reviewPath(task: Task): string {
    const date = dateStamp(task.acceptedAt ?? task.deliveredAt ?? new Date());
    return `/task/${date}/${task.code}/REVIEW`;
  }

  handoffPath(task: Task, appliedAt: Date): string {
    return `/task/${dateStamp(appliedAt)}/${task.code}/HANDOFF`;
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

  private async migrateTask(
    candidate: LegacyReviewDocument,
    legacyNodes: KnowledgeNode[],
  ): Promise<void> {
    const task = await this.tasks.findOne({
      where: { code: candidate.code },
    });
    const targetDate = task?.acceptedAt
      ? dateStamp(task.acceptedAt)
      : task?.deliveredAt
        ? dateStamp(task.deliveredAt)
        : candidate.date;
    const targetPath = `/task/${targetDate}/${candidate.code}/REVIEW`;
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
