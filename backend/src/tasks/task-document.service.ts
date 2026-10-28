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
import { Task } from './task.entity';

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

function dateStamp(value: Date): string {
  return beijingTime(value).slice(0, 10).replace(/-/g, '');
}

function markdownText(value: string | null | undefined): string {
  return value?.trim() || '（暂无）';
}

/**
 * 任务文档：
 * - HANDOFF.md：机器人申请验收时生成/覆盖的交付文档
 * - REVIEW.md：验收通过后生成/覆盖的复盘文档
 * 同时负责把旧版 /task/handoff/{date}/{code}/{version}.md 收敛到 REVIEW.md。
 */
@Injectable()
export class TaskDocumentService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TaskDocumentService.name);

  constructor(
    @InjectRepository(Task)
    private readonly tasks: Repository<Task>,
    private readonly knowledge: KnowledgeService,
  ) {}

  onApplicationBootstrap(): void {
    const timer = setTimeout(() => {
      void this.migrateLegacyDocuments().catch((error: Error) => {
        this.logger.warn(`旧任务总结文档迁移失败：${error.message}`);
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
  }): Promise<TaskDocumentResult> {
    const { task, result, worker, appliedAt } = input;
    const path = this.handoffPath(task, appliedAt);
    const title = `${task.code} ${task.title} · 任务交付`;
    const content = [
      `# ${title}`,
      '',
      `> 申请验收时间：${beijingTime(appliedAt)} ｜ 执行机器人：${worker.name}（${worker.id}） ｜ 文档路径：\`${path}\``,
      '',
      '## 一、任务信息',
      '',
      '| 字段 | 内容 |',
      '| --- | --- |',
      `| 任务编号 | ${task.code} |`,
      `| 任务标题 | ${task.title.replace(/\|/g, '\\|')} |`,
      `| 任务类型 | ${task.type} |`,
      `| 执行机器人 | ${worker.name.replace(/\|/g, '\\|')}（${worker.id}） |`,
      `| 创建时间 | ${beijingTime(task.createdAt)} |`,
      `| 申请验收时间 | ${beijingTime(appliedAt)} |`,
      '',
      '## 二、任务输入',
      '',
      '### 原始输入',
      '',
      markdownText(task.input?.trim() ? task.input : task.description),
      '',
      '### 整理后的输入',
      '',
      markdownText(task.content?.trim() ? task.content : task.description),
      '',
      '## 三、输出要求',
      '',
      markdownText(task.outputSpec),
      '',
      '## 四、工作计划',
      '',
      markdownText(task.workPlan),
      '',
      '## 五、最终交付物',
      '',
      markdownText(result ?? task.result),
      '',
    ].join('\n');
    return this.upsertArticle(path, title, content);
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
    return `/task/${date}/${task.code}/REVIEW.md`;
  }

  handoffPath(task: Task, appliedAt: Date): string {
    return `/task/${dateStamp(appliedAt)}/${task.code}/HANDOFF.md`;
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
   * 旧版任务总结迁移：每个任务取最新版本收敛为 REVIEW.md。
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
      this.logger.log(`已迁移 ${migrated} 个旧任务总结到 REVIEW.md`);
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
    const targetPath = `/task/${targetDate}/${candidate.code}/REVIEW.md`;
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
        name: 'REVIEW.md',
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
