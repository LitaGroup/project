import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter } from 'events';
import { Executor } from './executor.entity';
import { OpencodeClient } from './opencode-client';

/** 执行器事件（/api/event SSE 单条解析结果，附 executorId 供上层路由） */
export interface OpencodeEvent {
  executorId: number;
  id: string;
  type: string;
  data: unknown;
}

/** 断线重连间隔 */
const RECONNECT_MS = 5_000;
/** 活动释放后延迟断开的宽限（等待收尾事件） */
const IDLE_DISCONNECT_MS = 30_000;

/**
 * opencode 事件中心：按需为执行器维持一条 GET /api/event SSE 订阅。
 * 有活动（任务执行 / 调试回复）时 retain 建立并占用连接，结束后 release；
 * 引用归零后延迟断开（等待/空闲状态允许断开），下次有活动再重连。
 * 任务派发/调试发送只依赖 opencode 会话 id，断开期间不影响后续续聊。
 */
@Injectable()
export class OpencodeEventHub implements OnModuleDestroy {
  private readonly logger = new Logger(OpencodeEventHub.name);
  /** executorId → 最近一次同步的执行器快照（重连时用最新配置） */
  private readonly latest = new Map<number, Executor>();
  /** executorId → 在途连接（abort 控制器） */
  private readonly streams = new Map<number, AbortController>();
  /** executorId → 活跃引用数（任务执行 / 调试回复） */
  private readonly activity = new Map<number, number>();
  /** executorId → 引用归零后的延迟断开定时器 */
  private readonly idleTimers = new Map<number, NodeJS.Timeout>();
  private readonly bus = new EventEmitter();

  /**
   * 把订阅状态同步到当前执行器清单：停用/删除的执行器断开，重新上线的
   * 执行器若仍有活动引用则恢复连接。无活动的在线执行器不建立连接——按需 retain。
   */
  sync(executors: Executor[]): void {
    for (const executor of executors) {
      this.latest.set(executor.id, executor);
      const wanted = executor.enabled && executor.online;
      const connected = this.streams.has(executor.id);
      if (!wanted && connected) {
        // 保留活动引用：执行器恢复在线后由下一次 sync 重连
        this.clearIdleTimer(executor.id);
        this.disconnect(executor.id);
        continue;
      }
      if (wanted && !connected && (this.activity.get(executor.id) ?? 0) > 0) {
        this.connect(executor);
      }
    }
    // 已删除的执行器：断开并清快照
    for (const id of this.latest.keys()) {
      if (!executors.some((e) => e.id === id)) {
        this.activity.delete(id);
        this.clearIdleTimer(id);
        this.disconnect(id);
        this.latest.delete(id);
      }
    }
  }

  /** 某执行器事件流是否已连接 */
  isConnected(executorId: number): boolean {
    return this.streams.has(executorId);
  }

  /** 建立连接（不占用活动引用；供需要常驻的场景显式调用） */
  ensureConnected(executor: Executor): void {
    this.latest.set(executor.id, executor);
    if (executor.enabled && executor.online && !this.streams.has(executor.id)) {
      this.connect(executor);
    }
  }

  /**
   * 占用一次活动引用并确保事件流在线。
   * 任务派发 / 调试发送时调用，结束时必须配对 release。
   */
  retain(executor: Executor): void {
    this.latest.set(executor.id, executor);
    this.clearIdleTimer(executor.id);
    this.activity.set(executor.id, (this.activity.get(executor.id) ?? 0) + 1);
    if (executor.enabled && executor.online) this.ensureConnected(executor);
  }

  /** 释放一次活动引用；归零后延迟断开（无活动/等待状态允许断开） */
  release(executorId: number): void {
    const count = (this.activity.get(executorId) ?? 0) - 1;
    if (count > 0) {
      this.activity.set(executorId, count);
      return;
    }
    this.activity.delete(executorId);
    this.scheduleDisconnect(executorId);
  }

  /** 订阅事件，返回退订函数 */
  onEvent(handler: (event: OpencodeEvent) => void): () => void {
    this.bus.on('event', handler);
    return () => this.bus.off('event', handler);
  }

  /** 建立一条 SSE 订阅（后台常驻，断线自动重连） */
  private connect(executor: Executor): void {
    const abort = new AbortController();
    this.streams.set(executor.id, abort);
    void this.consume(executor, abort);
  }

  /** 读流循环：SSE 解析（data: 行 JSON；`: heartbeat` 注释行忽略），结束/异常后定时重连 */
  private async consume(
    executor: Executor,
    abort: AbortController,
  ): Promise<void> {
    const client = new OpencodeClient(executor);
    try {
      const res = await client.eventStream(abort.signal);
      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`);
      }
      this.logger.log(`执行器 #${executor.id}（${executor.name}）事件流已连接`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx = buffer.indexOf('\n');
        while (idx >= 0) {
          const line = buffer.slice(0, idx).trimEnd();
          buffer = buffer.slice(idx + 1);
          idx = buffer.indexOf('\n');
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          try {
            const evt = JSON.parse(payload) as {
              id?: string;
              type?: string;
              data?: unknown;
            };
            this.bus.emit('event', {
              executorId: executor.id,
              id: evt.id ?? '',
              type: evt.type ?? '',
              data: evt.data ?? null,
            } satisfies OpencodeEvent);
          } catch {
            // 忽略无法解析的行
          }
        }
      }
      throw new Error('stream ended');
    } catch (e) {
      // 已被顶替/主动断开：不重连
      if (this.streams.get(executor.id) !== abort || abort.signal.aborted) {
        return;
      }
      this.streams.delete(executor.id);
      const active = (this.activity.get(executor.id) ?? 0) > 0;
      this.logger.warn(
        `执行器 #${executor.id}（${executor.name}）事件流断开（${(e as Error).message}），${
          active
            ? `${RECONNECT_MS / 1000}s 后重连`
            : '当前无活动，等待下次 retain'
        }`,
      );
      if (!active) return;
      setTimeout(() => {
        const latest = this.latest.get(executor.id);
        if (
          (this.activity.get(executor.id) ?? 0) > 0 &&
          latest &&
          latest.enabled &&
          latest.online &&
          !this.streams.has(executor.id)
        ) {
          this.connect(latest);
        }
      }, RECONNECT_MS);
    }
  }

  private scheduleDisconnect(executorId: number): void {
    if (this.idleTimers.has(executorId)) return;
    const timer = setTimeout(() => {
      this.idleTimers.delete(executorId);
      if ((this.activity.get(executorId) ?? 0) > 0) return;
      if (!this.streams.has(executorId)) return;
      this.disconnect(executorId);
      this.logger.log(`执行器 #${executorId} 无活动，已断开事件流`);
    }, IDLE_DISCONNECT_MS);
    timer.unref();
    this.idleTimers.set(executorId, timer);
  }

  private clearIdleTimer(executorId: number): void {
    const timer = this.idleTimers.get(executorId);
    if (!timer) return;
    clearTimeout(timer);
    this.idleTimers.delete(executorId);
  }

  /** 主动断开某执行器的事件流 */
  private disconnect(executorId: number): void {
    const abort = this.streams.get(executorId);
    if (!abort) return;
    this.streams.delete(executorId);
    abort.abort();
  }

  onModuleDestroy(): void {
    for (const timer of this.idleTimers.values()) clearTimeout(timer);
    this.idleTimers.clear();
    for (const id of [...this.streams.keys()]) this.disconnect(id);
    this.bus.removeAllListeners();
  }
}
