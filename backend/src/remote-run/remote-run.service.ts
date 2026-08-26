import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppVersion } from '../app-versions/app-version.entity';
import { AgentGateway, AgentMessage } from '../agent/agent.gateway';
import { Check } from '../checks/check.entity';
import { CheckRun } from '../checks/check-run.entity';
import { Test } from '../tests/test.entity';
import { TestRun } from '../tests/test-run.entity';

/** 脚本输出协议的单条 act/check 记录（Test/Check 同构） */
interface RunItem {
  kind: 'act' | 'check';
  no?: number;
  title?: string;
  status?: 'success' | 'fail' | 'skip';
  expect?: string;
  real?: string;
  message?: string;
  time?: number;
}

export type RunKind = 'test' | 'check';

/** 一次远程运行的元信息（caller 入队时提供，用于下发任务与飞书通知） */
export interface RunMeta {
  projectId: number;
  /** 飞书通知卡片标题（如"测试：login - lita 1.2.3"） */
  runTitle: string;
  /** 脚本编号（code），通知展示用 */
  checkCode: string;
  scriptPath: string;
  /** 运行设备：android/ios（远程必为这两者） */
  device: string;
  /** 目标 APP：lita/lite 等（appVersion 的 appTarget；无 app 版本时为 null），agent 据此定位受管模拟器 */
  appTarget: string | null;
  /** APP 版本（test 的 android/ios 可能带；check/android 无 app 版本时为 null） */
  appVersion: AppVersion | null;
  /** 触发方式（通知用） */
  source: 'schedule' | 'manual';
  /** 触发任务 id（仅 task 调度的 check 运行有） */
  taskId?: number;
}

/** 远程执行期间累积的上下文（对应本地 executeRun 的局部变量） */
export interface RemoteRunContext {
  kind: RunKind;
  runId: number;
  meta: RunMeta;
  startedAt: number;
  items: RunItem[];
  logs: string[];
  output: string[];
  total: number | null;
  done: Record<string, unknown> | null;
  timer: NodeJS.Timeout | undefined;
}

/** agent 上报的终态（脚本结束） */
export interface DonePayload {
  durationMs: number | null;
  exitCode: number;
  error?: string | null;
}

/** caller 注册的回调（操作各自 run 表 + live 快照 + 通知） */
export interface RemoteRunCallbacks {
  /** dispatch 时：caller 将 run 标 running + 更新 live 快照 */
  onActivate: (ctx: RemoteRunContext, agentName: string) => void;
  /** 每行进度：patch 为需落库的增量（current/total），ctx.output 已含累积行 */
  onProgress: (
    ctx: RemoteRunContext,
    patch: { current?: number; total?: number } | null,
  ) => void;
  /** 终态：caller 落完整 patch + 推 SSE 终态 + 飞书通知 */
  onFinalize: (ctx: RemoteRunContext, patch: Record<string, unknown>) => void;
  /** 中断（断线/超时/离线）：caller 落 error patch + 推 SSE + 通知 */
  onAbort: (ctx: RemoteRunContext, patch: Record<string, unknown>) => void;
}

/** APP 测试远程执行默认超时（毫秒） */
const APP_RUN_TIMEOUT_MS_DEFAULT = 600_000;

/** device 为 android/ios 时走 appium-agent 远程执行 */
export function isRemoteDevice(device: string | null | undefined): boolean {
  return device === 'android' || device === 'ios';
}

/**
 * 远程运行调度核心：承载 appium-agent 队列、dispatch、agent 消息消费、
 * 行协议解析、终态组装。TestsService / ChecksService 各自注册回调，
 * 只维护自己的 run 表 + live 快照 + 通知，避免重复实现。
 */
@Injectable()
export class RemoteRunService implements OnModuleInit {
  private readonly logger = new Logger(RemoteRunService.name);
  private readonly appRunTimeoutMs: number;

  /** 入队待派发/执行中的上下文（key = `${kind}:${runId}`） */
  private readonly contexts = new Map<string, RemoteRunContext>();
  /** 当前在 agent 上执行的 run（单台 agent 串行） */
  private currentActive: {
    kind: RunKind;
    runId: number;
    ctx: RemoteRunContext;
  } | null = null;

  /** 各 kind 注册的回调 */
  private readonly callbacks: Partial<Record<RunKind, RemoteRunCallbacks>> = {};

  constructor(
    private readonly agentGateway: AgentGateway,
    @InjectRepository(TestRun)
    private readonly testRuns: Repository<TestRun>,
    @InjectRepository(CheckRun)
    private readonly checkRuns: Repository<CheckRun>,
    @InjectRepository(Test)
    private readonly tests: Repository<Test>,
    @InjectRepository(Check)
    private readonly checks: Repository<Check>,
    @InjectRepository(AppVersion)
    private readonly appVersions: Repository<AppVersion>,
    config: ConfigService,
  ) {
    this.appRunTimeoutMs =
      config.get<number>('APP_RUN_TIMEOUT_MS') ?? APP_RUN_TIMEOUT_MS_DEFAULT;
  }

  async onModuleInit(): Promise<void> {
    this.agentGateway.onMessage((msg) => this.handleMessage(msg));
    this.agentGateway.onDisconnect(() => this.handleDisconnect());
    // 服务重启：遗留的 running 任务（本地进程已失/agent 已断）标 error，queued 保留待派发
    await Promise.all([
      this.testRuns
        .createQueryBuilder()
        .update()
        .set({
          status: 'error' as const,
          message: '服务重启，任务中断',
          finishedAt: new Date(),
        })
        .where('status = :s', { s: 'running' })
        .execute(),
      this.checkRuns
        .createQueryBuilder()
        .update()
        .set({
          status: 'error' as const,
          message: '服务重启，任务中断',
          finishedAt: new Date(),
        })
        .where('status = :s', { s: 'running' })
        .execute(),
    ]);
  }

  /** 注册回调（caller 在 onModuleInit 调用） */
  register(kind: RunKind, callbacks: RemoteRunCallbacks): void {
    this.callbacks[kind] = callbacks;
  }

  /** 入队：caller 已创建 queued run + live 句柄 + 推送"开始执行"通知 */
  enqueue(kind: RunKind, runId: number, meta: RunMeta): void {
    const ctx: RemoteRunContext = {
      kind,
      runId,
      meta,
      startedAt: 0,
      items: [],
      logs: [],
      output: [],
      total: null,
      done: null,
      timer: undefined,
    };
    this.contexts.set(this.key(kind, runId), ctx);
    void this.dispatch();
  }

  private key(kind: RunKind, runId: number): string {
    return `${kind}:${runId}`;
  }

  /** 派发：agent 在线且空闲（无在途任务/APP 包操作）时，取队首 queued run 下发 */
  private async dispatch(): Promise<void> {
    if (this.currentActive || !this.agentGateway.isOnline()) return;
    // APP 包安装/卸载进行中：避让，操作完成后由 controller 调 kickDispatch 重试
    if (this.agentGateway.hasPendingAppOps()) return;
    const next = await this.pickNextQueued();
    if (!next) return;
    const ctx = this.contexts.get(this.key(next.kind, next.runId));
    if (!ctx) {
      // 上下文丢失（服务重启后 queued 无 ctx）：标 error 兜底
      await this.markError(next.kind, next.runId, '队列恢复失败：上下文丢失');
      void this.dispatch();
      return;
    }
    const agentName = this.agentGateway.getAgentName();
    ctx.startedAt = Date.now();
    await this.markRunning(next.kind, next.runId, agentName);
    this.callbacks[next.kind]?.onActivate(ctx, agentName ?? '');
    this.currentActive = { kind: next.kind, runId: next.runId, ctx };
    ctx.timer = setTimeout(() => this.onTimeout(ctx), this.appRunTimeoutMs);
    const m = ctx.meta;
    const sent = this.agentGateway.send({
      type: 'task',
      runId: next.runId,
      scriptPath: m.scriptPath,
      device: m.device,
      appTarget: m.appTarget,
      appVersion: m.appVersion?.version,
      timeout: this.appRunTimeoutMs,
    });
    if (!sent) {
      this.abort(ctx, '执行机离线');
    }
  }

  /** 跨表取队首 queued run（按 queuedAt 最早） */
  private async pickNextQueued(): Promise<{
    kind: RunKind;
    runId: number;
    queuedAt: Date;
  } | null> {
    const [t, c] = await Promise.all([
      this.testRuns.findOne({
        where: { status: 'queued' },
        order: { queuedAt: 'ASC' },
      }),
      this.checkRuns.findOne({
        where: { status: 'queued' },
        order: { queuedAt: 'ASC' },
      }),
    ]);
    if (t && c) {
      return (c.queuedAt?.getTime() ?? 0) <= (t.queuedAt?.getTime() ?? 0)
        ? { kind: 'check', runId: c.id, queuedAt: c.queuedAt! }
        : { kind: 'test', runId: t.id, queuedAt: t.queuedAt! };
    }
    if (t) return { kind: 'test', runId: t.id, queuedAt: t.queuedAt! };
    if (c) return { kind: 'check', runId: c.id, queuedAt: c.queuedAt! };
    return null;
  }

  /** 是否有正在 agent 上执行的任务（APP 包操作需避让，见 AgentAppsController） */
  hasActiveRun(): boolean {
    return this.currentActive !== null;
  }

  /** APP 包操作完成后触发一次派发（此前因互斥跳过的 queued 任务得以执行） */
  kickDispatch(): void {
    void this.dispatch();
  }

  private async markRunning(
    kind: RunKind,
    runId: number,
    agentName: string | null,
  ): Promise<void> {
    const repo = kind === 'test' ? this.testRuns : this.checkRuns;
    await repo
      .update(runId, { status: 'running', agentName })
      .catch(() => undefined);
  }

  private async markError(
    kind: RunKind,
    runId: number,
    message: string,
  ): Promise<void> {
    const repo = kind === 'test' ? this.testRuns : this.checkRuns;
    await repo
      .update(runId, { status: 'error', message, finishedAt: new Date() })
      .catch(() => undefined);
  }

  /** agent 消息路由 */
  private handleMessage(msg: AgentMessage): void {
    switch (msg.type) {
      case 'ready':
        void this.dispatch();
        break;
      case 'progress':
        this.handleProgress(msg.runId, msg.line);
        break;
      case 'done':
        this.handleDone(msg.runId, msg);
        break;
      default:
        break;
    }
  }

  private handleProgress(runId: number, line: string): void {
    if (!this.currentActive || this.currentActive.runId !== runId) return;
    const ctx = this.currentActive.ctx;
    const patch = this.applyLine(ctx, line);
    this.callbacks[ctx.kind]?.onProgress(ctx, patch);
  }

  private handleDone(runId: number, payload: DonePayload): void {
    if (!this.currentActive || this.currentActive.runId !== runId) return;
    const ctx = this.currentActive.ctx;
    this.clearActive(ctx);
    const patch = this.buildFinalPatch(ctx, payload);
    this.callbacks[ctx.kind]?.onFinalize(ctx, patch);
    void this.dispatch();
  }

  private handleDisconnect(): void {
    if (!this.currentActive) return;
    const ctx = this.currentActive.ctx;
    this.clearActive(ctx);
    const patch = this.abortPatch(ctx, '执行机断线');
    this.callbacks[ctx.kind]?.onAbort(ctx, patch);
    void this.dispatch();
  }

  private onTimeout(ctx: RemoteRunContext): void {
    this.agentGateway.send({ type: 'cancel', runId: ctx.runId });
    this.clearActive(ctx);
    const patch = this.abortPatch(
      ctx,
      `脚本执行超时（>${this.appRunTimeoutMs / 1000}s）`,
    );
    this.callbacks[ctx.kind]?.onAbort(ctx, patch);
    void this.dispatch();
  }

  private clearActive(ctx: RemoteRunContext): void {
    if (ctx.timer) clearTimeout(ctx.timer);
    this.contexts.delete(this.key(ctx.kind, ctx.runId));
    if (this.currentActive?.runId === ctx.runId) this.currentActive = null;
  }

  /** 中断（用于 dispatch 时 agent 离线等场景） */
  private abort(ctx: RemoteRunContext, message: string): void {
    this.clearActive(ctx);
    const patch = this.abortPatch(ctx, message);
    this.callbacks[ctx.kind]?.onAbort(ctx, patch);
    void this.dispatch();
  }

  /**
   * 行协议解析（公共）：更新 ctx 的 items/output/total/done，
   * 返回需落库的增量 patch（current/total），无则 null。
   */
  applyLine(
    ctx: RemoteRunContext,
    line: string,
  ): { current?: number; total?: number } | null {
    const trimmed = line.trim();
    if (!trimmed) return null;
    ctx.output.push(trimmed);
    const match = trimmed.match(/^\[(\w+)\]\s?(.*)$/s);
    const type = match?.[1] ?? 'log';
    const data = match?.[2] ?? trimmed;
    if (type === 'act' || type === 'check') {
      try {
        const item: RunItem = {
          kind: type,
          ...(JSON.parse(data) as Omit<RunItem, 'kind'>),
        };
        ctx.items.push(item);
        return { current: item.no ?? ctx.items.length };
      } catch {
        ctx.logs.push(trimmed);
        return null;
      }
    }
    if (type === 'start') {
      try {
        const start = JSON.parse(data) as { total?: number };
        if (typeof start.total === 'number') {
          ctx.total = start.total;
          return { total: ctx.total };
        }
      } catch {
        // 忽略
      }
      return null;
    }
    if (type === 'done') {
      try {
        ctx.done = JSON.parse(data) as Record<string, unknown>;
      } catch {
        // 忽略
      }
      return null;
    }
    ctx.logs.push(trimmed);
    return null;
  }

  /** 终态 patch 组装：依据 [done] 行（ctx.done）判定 success/fail，无则按退出码/异常兜底 error */
  buildFinalPatch(
    ctx: RemoteRunContext,
    payload: DonePayload,
  ): Record<string, unknown> {
    const done = ctx.done;
    let status: 'success' | 'fail' | 'error';
    let message: string | null;
    let success: number | null;
    let fail: number | null;
    let skip: number | null;
    let total: number | null;
    if (done) {
      status = done.status === 'success' ? 'success' : 'fail';
      message = (done.message as string) || null;
      success = (done.success as number) ?? null;
      fail = (done.fail as number) ?? null;
      skip = (done.skip as number) ?? null;
      total = (done.total as number) ?? ctx.total ?? null;
    } else if (payload.error) {
      status = 'error';
      message = payload.error;
      success = fail = skip = null;
      total = ctx.total ?? null;
    } else if (payload.exitCode !== 0) {
      status = 'error';
      message = `脚本异常退出（exit ${payload.exitCode}）`;
      success = fail = skip = null;
      total = ctx.total ?? null;
    } else {
      status = 'error';
      message = '脚本结束但未输出 [done]';
      success = fail = skip = null;
      total = ctx.total ?? null;
    }
    const current = (done?.total as number) ?? ctx.items.length;
    return {
      status,
      message,
      items: ctx.items,
      logs: ctx.logs,
      output: ctx.output,
      total,
      current,
      success,
      fail,
      skip,
      durationMs: payload.durationMs ?? Date.now() - ctx.startedAt,
      finishedAt: new Date(),
    };
  }

  /** 中断 patch（断线/超时/离线） */
  abortPatch(ctx: RemoteRunContext, message: string): Record<string, unknown> {
    return {
      status: 'error',
      message,
      items: ctx.items,
      logs: ctx.logs,
      output: ctx.output,
      total: ctx.total,
      current: ctx.items.length,
      success: null,
      fail: null,
      skip: null,
      durationMs: ctx.startedAt ? Date.now() - ctx.startedAt : null,
      finishedAt: new Date(),
    };
  }
}
