import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import { Observable } from 'rxjs';
import { OpencodeEventHub } from '../executors/opencode-event-hub.service';
import type { OpencodeEvent } from '../executors/opencode-event-hub.service';
import {
  OptimizeEndpoint,
  OptimizePromptInput,
  WorkerAiService,
} from './worker-ai.service';

/** 终态快照保留时长（晚订阅/刷新页面的客户端可立即拿到结果） */
const JOB_TTL_MS = 5 * 60_000;
/** SSE 心跳间隔（须小于网关空闲超时，如 ALB 60s） */
const STREAM_PING_MS = 15_000;
/** 进度行上限（防失控任务撑爆内存） */
const MAX_LINES = 200;

export type WorkerOptimizeStatus = 'running' | 'success' | 'failed';

/** 优化快照：POST 响应、GET 查询与 SSE snapshot 事件共用（JSON 安全） */
export interface WorkerOptimizeSnapshot {
  runId: string;
  status: WorkerOptimizeStatus;
  /** 进度行（时间正序，最新在末尾） */
  lines: string[];
  /** 优化后的 Markdown（status=success 时非空） */
  prompt: string | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

/** SSE 载荷：snapshot=全量快照（订阅即推+终态）；line=进度行增量；ping=心跳 */
type OptimizeStreamPayload =
  | { type: 'snapshot'; snapshot: WorkerOptimizeSnapshot }
  | { type: 'line'; line: string }
  | { type: 'ping' };

/** 一次优化任务的内存态（不落库：平台重启即丢失，前端会提示重试） */
interface OptimizeJob {
  runId: string;
  status: WorkerOptimizeStatus;
  lines: string[];
  prompt: string | null;
  error: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  /** 已提示过“模型生成中”，避免逐段输出刷屏 */
  generating: boolean;
  /** SSE 订阅广播 */
  emitter: EventEmitter;
  /** 终态后的 TTL 清理定时器 */
  ttlTimer?: NodeJS.Timeout;
}

/** 执行器工具名 → 进度行展示文案（未收录的原样展示） */
const TOOL_LABELS: Record<string, string> = {
  read: '读取文件',
  write: '写入文件',
  edit: '编辑文件',
  bash: '执行命令',
  glob: '查找文件',
  grep: '搜索内容',
  webfetch: '访问网页',
  task: '委派子任务',
  todowrite: '更新待办',
  todoread: '读取待办',
};

/**
 * 机器人 AGENTS.md 优化的异步任务：POST 启动后立即返回运行快照，
 * 进度与结果经 SSE 实时推送。
 * 同步长请求会被网关（ALB 60s）以 504 掐断而后端继续跑完，故刻意异步化
 * （与 WorkerEnvironmentService 的初始化任务同一模式）。
 */
@Injectable()
export class WorkerOptimizeService implements OnModuleDestroy {
  private readonly logger = new Logger(WorkerOptimizeService.name);
  /** runId → 优化任务（终态保留 JOB_TTL_MS 供晚订阅查询） */
  private readonly jobs = new Map<string, OptimizeJob>();

  constructor(
    private readonly workerAi: WorkerAiService,
    private readonly eventHub: OpencodeEventHub,
  ) {}

  /** 启动优化：同步完成 PROMPT 与执行端点校验（配置类错误立即 400），随后后台执行 */
  async start(input: OptimizePromptInput): Promise<WorkerOptimizeSnapshot> {
    const content = input.prompt?.trim();
    if (!content) {
      throw new BadRequestException('PROMPT 内容不能为空');
    }
    // 执行器离线/无可用模型等配置错误在启动时同步返回，前端可直接提示
    const endpoint = await this.workerAi.resolveEndpoint(input);
    const job: OptimizeJob = {
      runId: randomUUID(),
      status: 'running',
      lines: [],
      prompt: null,
      error: null,
      startedAt: new Date(),
      finishedAt: null,
      generating: false,
      emitter: new EventEmitter(),
    };
    job.emitter.setMaxListeners(50);
    this.jobs.set(job.runId, job);
    // 刻意不 await：HTTP 请求立即返回，优化在后台跑完（5 分钟预算）
    void this.run(job, content, endpoint);
    return this.toSnapshot(job);
  }

  /** 优化快照（runId 不存在/已过期 404） */
  snapshotOf(runId: string): WorkerOptimizeSnapshot {
    const job = this.jobs.get(runId);
    if (!job) {
      throw new NotFoundException('优化任务不存在或已过期，请重新点击优化');
    }
    return this.toSnapshot(job);
  }

  /**
   * 优化进度 SSE：订阅即推当前快照，进度行增量推送，终态快照推送后完成流，
   * 心跳保活（小于 ALB 等网关的空闲超时）。
   */
  stream(runId: string): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      const job = this.jobs.get(runId);
      if (!job) {
        // 任务不存在（平台重启/过期）：推失败快照后结束，前端据此提示重试
        subscriber.next({
          data: {
            type: 'snapshot',
            snapshot: this.missingSnapshot(runId),
          } satisfies OptimizeStreamPayload,
        });
        subscriber.complete();
        return;
      }
      let closed = false;
      const finishStream = () => {
        closed = true;
        clearInterval(keepalive);
        subscriber.complete();
      };
      const listener = (payload: OptimizeStreamPayload) => {
        if (closed) return;
        subscriber.next({ data: payload });
        if (
          payload.type === 'snapshot' &&
          (payload.snapshot.status === 'success' ||
            payload.snapshot.status === 'failed')
        ) {
          finishStream();
        }
      };
      // 心跳先建（须小于网关空闲超时），保证任何触发路径都能安全清理
      const keepalive = setInterval(() => {
        if (!closed) {
          subscriber.next({
            data: { type: 'ping' } satisfies OptimizeStreamPayload,
          });
        }
      }, STREAM_PING_MS);
      // 先挂监听再推快照，避免间隙漏事件
      job.emitter.on('payload', listener);
      listener({ type: 'snapshot', snapshot: this.toSnapshot(job) });
      return () => {
        closed = true;
        clearInterval(keepalive);
        job.emitter.off('payload', listener);
      };
    });
  }

  /** 后台执行：订阅执行器事件 → 下发优化任务 → 轮询终态 */
  private async run(
    job: OptimizeJob,
    content: string,
    endpoint: OptimizeEndpoint,
  ): Promise<void> {
    const { executor, providerId, modelId } = endpoint;
    // 会话创建后才拿到 sessionId，用可变对象避免 TS 把闭包内赋值收窄成 never
    const subscription: { unsubscribe?: () => void } = {};
    let retained = false;
    try {
      // 执行期间占用执行器事件流，结束后释放（引用归零延迟断开）
      this.eventHub.retain(executor);
      retained = true;
      this.pushLine(job, '▶ 开始优化机器人 AGENTS.md');
      this.pushLine(
        job,
        `· 执行器：${executor.name}（${providerId}/${modelId}）`,
      );
      const prompt = await this.workerAi.runOptimize(content, endpoint, {
        onSessionCreated: (sessionId) => {
          this.pushLine(job, '· 已创建执行器会话，等待模型输出…');
          subscription.unsubscribe = this.eventHub.onEvent((event) =>
            this.onExecutorEvent(job, sessionId, event),
          );
        },
      });
      if (!prompt.trim()) {
        throw new Error('执行器返回内容为空');
      }
      this.finish(job, 'success', null, prompt);
    } catch (e) {
      this.finish(job, 'failed', (e as Error).message, null);
    } finally {
      subscription.unsubscribe?.();
      if (retained) this.eventHub.release(executor.id);
    }
  }

  /** 执行器事件 → 进度行：仅取本次优化会话的事件 */
  private onExecutorEvent(
    job: OptimizeJob,
    sessionId: string,
    event: OpencodeEvent,
  ): void {
    if (job.status !== 'running') return;
    const data = event.data as { sessionID?: string; name?: string } | null;
    if (!data || data.sessionID !== sessionId) return;
    if (event.type === 'session.execution.started') {
      this.pushLine(job, '▶ 执行器开始执行');
      return;
    }
    if (event.type === 'session.tool.input.started') {
      const name = data.name || '?';
      this.pushLine(job, `🔧 ${TOOL_LABELS[name] ?? name}`);
      return;
    }
    if (event.type === 'session.text.delta' && !job.generating) {
      job.generating = true;
      this.pushLine(job, '· 模型正在生成内容…');
    }
  }

  /** 追加进度行并广播（超上限丢弃最旧行） */
  private pushLine(job: OptimizeJob, line: string): void {
    job.lines.push(line);
    if (job.lines.length > MAX_LINES) {
      job.lines.splice(0, job.lines.length - MAX_LINES);
    }
    job.emitter.emit('payload', {
      type: 'line',
      line,
    } satisfies OptimizeStreamPayload);
  }

  /** 终态落快照、广播、保留 TTL 后清理 */
  private finish(
    job: OptimizeJob,
    status: 'success' | 'failed',
    error: string | null,
    prompt: string | null,
  ): void {
    if (job.status !== 'running') return;
    job.status = status;
    job.error = error;
    job.prompt = prompt;
    job.finishedAt = new Date();
    if (status === 'success') {
      this.pushLine(job, '✅ 优化完成');
      this.logger.log(`优化机器人 AGENTS.md 完成（${job.runId}）`);
    } else {
      this.pushLine(job, `✗ 优化失败：${error ?? '未知错误'}`);
      this.logger.warn(`优化机器人 AGENTS.md 失败（${job.runId}）：${error}`);
    }
    job.emitter.emit('payload', {
      type: 'snapshot',
      snapshot: this.toSnapshot(job),
    } satisfies OptimizeStreamPayload);
    const timer = setTimeout(() => {
      if (this.jobs.get(job.runId) === job) this.jobs.delete(job.runId);
    }, JOB_TTL_MS);
    timer.unref();
    job.ttlTimer = timer;
  }

  private toSnapshot(job: OptimizeJob): WorkerOptimizeSnapshot {
    return {
      runId: job.runId,
      status: job.status,
      lines: [...job.lines],
      prompt: job.prompt,
      error: job.error,
      startedAt: job.startedAt.toISOString(),
      finishedAt: job.finishedAt?.toISOString() ?? null,
    };
  }

  /** 任务不存在/过期时的失败快照（仅用于 SSE 首帧） */
  private missingSnapshot(runId: string): WorkerOptimizeSnapshot {
    return {
      runId,
      status: 'failed',
      lines: [],
      prompt: null,
      error: '优化进程已中断（平台重启或任务过期），请重新点击优化',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    };
  }

  onModuleDestroy(): void {
    for (const job of this.jobs.values()) {
      if (job.ttlTimer) clearTimeout(job.ttlTimer);
    }
    this.jobs.clear();
  }
}
