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

/**
 * opencode 事件中心：为每台「启用且在线」的执行器维持一条 GET /api/event SSE 订阅
 * （断线 5s 重连），解析后经 EventEmitter 转发（'event' 事件）。
 * 任务模块按 opencodeSessionId → 任务 的映射订阅消费。
 */
@Injectable()
export class OpencodeEventHub implements OnModuleDestroy {
  private readonly logger = new Logger(OpencodeEventHub.name);
  /** executorId → 最近一次同步的执行器快照（重连时用最新配置） */
  private readonly latest = new Map<number, Executor>();
  /** executorId → 在途连接（abort 控制器） */
  private readonly streams = new Map<number, AbortController>();
  private readonly bus = new EventEmitter();

  /** 把订阅状态同步到当前执行器清单：启用+在线建立连接，其余断开 */
  sync(executors: Executor[]): void {
    for (const executor of executors) {
      this.latest.set(executor.id, executor);
      const wanted = executor.enabled && executor.online;
      const active = this.streams.has(executor.id);
      if (wanted && !active) this.connect(executor);
      if (!wanted && active) this.disconnect(executor.id);
    }
    // 已删除的执行器：断开并清快照
    for (const id of this.latest.keys()) {
      if (!executors.some((e) => e.id === id)) {
        this.disconnect(id);
        this.latest.delete(id);
      }
    }
  }

  /** 某执行器事件流是否已连接 */
  isConnected(executorId: number): boolean {
    return this.streams.has(executorId);
  }

  /** 确保某执行器已建立事件流订阅（派发前调用，覆盖重启/离线恢复场景） */
  ensureConnected(executor: Executor): void {
    this.latest.set(executor.id, executor);
    if (executor.enabled && executor.online && !this.streams.has(executor.id)) {
      this.connect(executor);
    }
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
      this.logger.warn(
        `执行器 #${executor.id}（${executor.name}）事件流断开（${(e as Error).message}），${RECONNECT_MS / 1000}s 后重连`,
      );
      setTimeout(() => {
        const latest = this.latest.get(executor.id);
        if (
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

  /** 主动断开某执行器的事件流 */
  private disconnect(executorId: number): void {
    const abort = this.streams.get(executorId);
    if (!abort) return;
    this.streams.delete(executorId);
    abort.abort();
  }

  onModuleDestroy(): void {
    for (const id of [...this.streams.keys()]) this.disconnect(id);
    this.bus.removeAllListeners();
  }
}
