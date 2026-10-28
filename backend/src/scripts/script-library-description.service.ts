import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import { Repository } from 'typeorm';
import { Executor } from '../executors/executor.entity';
import { OpencodeClient } from '../executors/opencode-client';
import { runOpencodePrompt } from '../executors/opencode-run';
import { SYSTEM_SCRIPT_DESCRIPTION_WORKER_ID } from '../workers/system-workers';
import { Worker } from '../workers/worker.entity';
import { WorkersService } from '../workers/workers.service';
import {
  ScriptDescriptionStatus,
  ScriptLibraryDescription,
} from './script-library-description.entity';
import { ScriptLibraryService } from './script-library.service';

/** 单次描述生成超时（毫秒） */
const GENERATION_TIMEOUT_MS = 5 * 60_000;
/** 连续失败重试上限（达到后转 error 停止自动重试；文件变更或手动重新生成时清零） */
const MAX_ATTEMPTS = 3;
/** 描述最大长度（超长截断，防模型啰嗦） */
const MAX_DESCRIPTION_LENGTH = 200;

/** 描述队列统计（状态端点展示用） */
export interface ScriptDescriptionStats {
  pending: number;
  running: number;
  done: number;
  error: number;
}

/** 机器人/执行器就绪后的生成上下文 */
interface GenerationEndpoint {
  worker: Worker;
  executor: Executor;
  providerId: string;
  modelId: string;
  workdir: string;
}

/**
 * 脚本描述生成：每分钟比对脚本文件内容哈希（sha1），
 * 描述为空或文件变更（或上次生成后文件又变化）的脚本重新排队，
 * 由系统机器人「脚本描述机器人」（ID=3，须启用并配置执行器/模型/技能）
 * 经其 opencode 会话分析代码与目录上下文（含 README.md）产出一句中文描述。
 */
@Injectable()
export class ScriptLibraryDescriptionService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ScriptLibraryDescriptionService.name);

  /** 一轮 刷新+生成 未结束时不重入（cron 触发、启动预热与手动触发可能重叠） */
  private processing = false;
  /** 机器人未就绪的告警去重（状态变化后才再次告警） */
  private lastNotReadyReason: string | null = null;

  constructor(
    @InjectRepository(ScriptLibraryDescription)
    private readonly docs: Repository<ScriptLibraryDescription>,
    private readonly libraryService: ScriptLibraryService,
    @InjectRepository(Worker)
    private readonly workers: Repository<Worker>,
    @InjectRepository(Executor)
    private readonly executors: Repository<Executor>,
    private readonly workersService: WorkersService,
  ) {}

  /** 启动预热：延迟数秒等系统机器人初始化（onApplicationBootstrap）完成后再跑第一轮 */
  onApplicationBootstrap(): void {
    setTimeout(() => void this.refreshAndProcess('启动预热'), 10_000);
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async scheduledTick(): Promise<void> {
    await this.refreshAndProcess('定时');
  }

  /** 描述队列统计 */
  async getStats(): Promise<ScriptDescriptionStats> {
    const rows = await this.docs.find({ select: { status: true } });
    const stats: ScriptDescriptionStats = {
      pending: 0,
      running: 0,
      done: 0,
      error: 0,
    };
    for (const row of rows) stats[row.status] += 1;
    return stats;
  }

  /** 手动重新生成：清空内容哈希与失败计数转回待生成（保留旧描述直至新描述产出） */
  async regenerate(scriptPath: string): Promise<void> {
    const normalized = this.libraryService.normalizeScriptPath(scriptPath);
    const row = await this.docs.findOne({
      where: { scriptPath: normalized },
    });
    if (row) {
      await this.docs.update(row.id, {
        status: 'pending',
        attempts: 0,
        error: null,
        contentHash: null,
      });
    } else {
      await this.docs.insert({
        scriptPath: normalized,
        status: 'pending',
      });
    }
    // 立即尝试一轮（机器人未就绪时保持待生成，等定时周期再试）
    void this.refreshAndProcess('手动重新生成');
  }

  /** 一轮：刷新队列 → 逐条生成（single-flight，进行中直接跳过） */
  async refreshAndProcess(source: string): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      await this.refreshQueue();
      await this.processQueue(source);
    } catch (e) {
      this.logger.warn(
        `[${source}] 描述队列处理失败：${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      this.processing = false;
    }
  }

  /**
   * 刷新队列：扫描当前脚本集合，清理已删除脚本的描述；
   * 恢复卡死的 running；失败未超限的重回待生成；文件变更（哈希不一致）的重新排队。
   */
  private async refreshQueue(): Promise<void> {
    const scripts = await this.libraryService.scanScripts();
    const livePaths = new Set(scripts.map((s) => s.path));
    const hashes = new Map(
      await Promise.all(
        scripts.map(
          async (s) => [s.path, await this.fileHash(s.path)] as const,
        ),
      ),
    );

    const rows = await this.docs.find();
    const rowsByPath = new Map(rows.map((r) => [r.scriptPath, r]));

    for (const row of rows) {
      if (!livePaths.has(row.scriptPath)) {
        await this.docs.delete(row.id); // 脚本已删除，描述记录一并清理
      } else if (row.status === 'running') {
        await this.docs.update(row.id, { status: 'pending' }); // 上轮中断恢复
      } else if (row.status === 'error' && row.attempts < MAX_ATTEMPTS) {
        await this.docs.update(row.id, { status: 'pending' }); // 未超限的失败下轮重试（每轮一次）
      }
    }

    for (const script of scripts) {
      const hash = hashes.get(script.path) ?? null;
      const row = rowsByPath.get(script.path);
      if (!row) {
        await this.docs.insert({
          scriptPath: script.path,
          status: 'pending' as ScriptDescriptionStatus,
        });
        continue;
      }
      if (
        row.status === 'done' &&
        row.contentHash &&
        row.contentHash !== hash
      ) {
        // 文件在生成后发生变更：保留旧描述展示，重新排队生成
        await this.docs.update(row.id, {
          status: 'pending',
          attempts: 0,
          error: null,
          contentHash: null,
        });
      }
    }
  }

  /** 逐条生成直到队列清空；机器人未就绪时保持待生成并结束本轮 */
  private async processQueue(source: string): Promise<void> {
    for (;;) {
      const row = await this.docs.findOne({
        where: { status: 'pending' as ScriptDescriptionStatus },
        order: { updatedAt: 'ASC' },
      });
      if (!row) return;
      const endpoint = await this.resolveEndpoint();
      if (!endpoint) return; // 未就绪：保留 pending，等下一周期
      await this.generateOne(row.id, row.scriptPath, endpoint, source);
    }
  }

  /**
   * 解析脚本描述机器人（ID=3）的执行器/模型/工位。
   * 未启用、执行器离线、模型未配置等场景返回 null（队列保持待生成，不报错）。
   */
  private async resolveEndpoint(): Promise<GenerationEndpoint | null> {
    const notReady = (reason: string): null => {
      if (this.lastNotReadyReason !== reason) {
        this.lastNotReadyReason = reason;
        this.logger.warn(`脚本描述机器人未就绪：${reason}（描述生成暂停）`);
      }
      return null;
    };
    const worker = await this.workers.findOne({
      where: { id: SYSTEM_SCRIPT_DESCRIPTION_WORKER_ID },
    });
    if (!worker)
      return notReady(
        `系统机器人 #${SYSTEM_SCRIPT_DESCRIPTION_WORKER_ID} 不存在`,
      );
    if (!worker.enabled) return notReady('机器人未启用');
    const executor = worker.executorId
      ? await this.executors.findOne({ where: { id: worker.executorId } })
      : null;
    if (!executor) return notReady('未配置执行器');
    if (!executor.online) return notReady(`执行器「${executor.name}」离线`);
    let providerId = worker.providerId?.trim() || null;
    let modelId = worker.modelId?.trim() || null;
    if (!providerId || !modelId) {
      const provider = executor.providersCache?.find(
        (item) => item.models.length > 0,
      );
      providerId ??= provider?.id ?? null;
      modelId ??= provider?.models[0]?.id ?? null;
    }
    if (!providerId || !modelId) {
      return notReady(`执行器「${executor.name}」没有可用的供应商/模型缓存`);
    }
    const workdir = this.workersService.workdirOf(worker.id);
    if (!workdir) return notReady('未配置 WORKER_BASE_DIR，无法确定工位目录');
    this.lastNotReadyReason = null;
    return { worker, executor, providerId, modelId, workdir };
  }

  /** 生成单个脚本的描述：调机器人 #3 的 opencode 会话分析代码，成功落描述与内容哈希 */
  private async generateOne(
    rowId: number,
    scriptPath: string,
    endpoint: GenerationEndpoint,
    source: string,
  ): Promise<void> {
    await this.docs.update(rowId, { status: 'running', error: null });
    try {
      const absPath = path.resolve(
        this.libraryService.getScriptsDir(),
        scriptPath,
      );
      const content = await fs.readFile(absPath, 'utf8').catch(() => '');
      const hash = createHash('sha1').update(content).digest('hex');
      const text = await runOpencodePrompt(
        new OpencodeClient(endpoint.executor),
        {
          title: `脚本描述 ${scriptPath}`,
          model: { id: endpoint.modelId, providerID: endpoint.providerId },
          location: { directory: endpoint.workdir },
          prompt: [
            '分析脚本：',
            absPath,
            '',
            '请阅读该脚本文件，并结合其所在目录的上下文（同目录其它脚本、最近一级 README.md，必要时沿目录向上查找 README.md），',
            '按你的角色定义输出一句中文描述正文（不超过 60 字），不要引号、前缀、Markdown 标记或任何解释。',
          ].join('\n'),
          timeoutMs: GENERATION_TIMEOUT_MS,
        },
      );
      const description = this.cleanDescription(text);
      if (!description) throw new Error('模型未返回有效描述');
      await this.docs.update(rowId, {
        description,
        contentHash: hash,
        status: 'done',
        error: null,
        generatedAt: new Date(),
      });
      this.logger.log(`[${source}] ${scriptPath} 描述已生成：${description}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const row = await this.docs.findOne({ where: { id: rowId } });
      const attempts = (row?.attempts ?? 0) + 1;
      // 统一转 error：refreshQueue 会在下一轮（每轮一次）把未超限的失败重回待生成
      await this.docs.update(rowId, {
        status: 'error',
        attempts,
        error: message.slice(0, 500),
      });
      this.logger.warn(
        `[${source}] ${scriptPath} 描述生成失败（第 ${attempts} 次）：${message}`,
      );
    }
  }

  /** 清洗模型输出：去围栏/引号/列表前缀，取首个非空行，超长截断 */
  private cleanDescription(text: string): string | null {
    const trimmed = text.trim();
    const fenced = trimmed.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/);
    const body = (fenced ? fenced[1] : trimmed).trim();
    const line =
      body
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l.length > 0) ?? '';
    const cleaned = line
      .replace(/^[-*•]\s*/, '')
      .replace(/^["'「『]+|["'」』]+$/g, '')
      .trim();
    if (!cleaned) return null;
    return cleaned.slice(0, MAX_DESCRIPTION_LENGTH);
  }

  /** 脚本文件内容 sha1（读取失败返回 null，按未变更处理等待下轮） */
  private async fileHash(relPath: string): Promise<string | null> {
    try {
      const content = await fs.readFile(
        path.resolve(this.libraryService.getScriptsDir(), relPath),
        'utf8',
      );
      return createHash('sha1').update(content).digest('hex');
    } catch {
      return null;
    }
  }
}
