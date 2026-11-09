import type { MessageEvent } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import type { Logger } from '@nestjs/common';
import type { Observable } from 'rxjs';
import type { AuthedRequest } from '../../auth/auth.guard';
import {
  renderRunMarkdown,
  type RunDetailLike,
} from '../../common/run-markdown';
import type { Worker } from '../../workers/worker.entity';
import type { ProgressFn } from '../mcp-progress';
import {
  identityLabelOf,
  type McpWorkPrincipal,
  type WorkToolResult,
} from './work-tools.types';

/** Markdown 结果（沿用 `.md` 端点面向 Agent 的正文格式） */
export function markdownResult(text: string): WorkToolResult {
  return { content: [{ type: 'text', text }] };
}

/** JSON 结果（实体列表/明细等结构化数据） */
export function jsonResult(payload: unknown): WorkToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  };
}

/** 工具失败：isError=true，文本为具体原因 */
export function toolErrorResult(error: unknown): WorkToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return { isError: true, content: [{ type: 'text', text: message }] };
}

/**
 * MCP 调用方 → 任务/工单工具使用的请求身份。
 * 平台任务服务只读取 worker / user 两个字段，这里构造等价的最小身份对象。
 */
export function asAuthedRequest(principal: McpWorkPrincipal): AuthedRequest {
  return {
    worker: principal.worker,
    user: principal.user,
  } as unknown as AuthedRequest;
}

/** 仅机器人可执行的动作：机器人独立令牌（X-Worker-Token） */
export function requireWorkerPrincipal(principal: McpWorkPrincipal): Worker {
  if (!principal.worker) {
    throw new ForbiddenException('该操作仅接受机器人身份（X-Worker-Token）');
  }
  return principal.worker;
}

/**
 * 统一工具执行包装：成功/失败都落调试日志，失败转 toolError 结果，
 * 避免单个工具异常中断整个 MCP 会话。
 */
export async function executeTool(
  logger: Logger,
  toolName: string,
  principal: McpWorkPrincipal,
  fn: () => WorkToolResult | Promise<WorkToolResult>,
): Promise<WorkToolResult> {
  const started = Date.now();
  try {
    const result = await fn();
    logger.debug(
      `MCP ${toolName} ${result.isError ? 'failed' : 'ok'} ${identityLabelOf(principal)} ${Date.now() - started}ms`,
    );
    return result;
  } catch (error) {
    logger.warn(
      `MCP ${toolName} error ${identityLabelOf(principal)}：${(error as Error).message}`,
    );
    return toolErrorResult(error);
  }
}

/**
 * 订阅一次脚本运行的快照流：输出行经 progress 实时推送，
 * 终态（或超时/调用方断开）后返回完整运行 Markdown（复用 `.md` 视图渲染）。
 * 超时只结束等待，不中断平台侧运行（可用 get_run 找回终态）。
 */
export function collectRunMarkdown(options: {
  title: string;
  metaLines: string[];
  stream: Observable<MessageEvent>;
  initial: RunDetailLike;
  notify: ProgressFn | null;
  signal?: AbortSignal;
  timeoutMs: number;
  /** 终态才能确定的补充信息（如导出产物文件） */
  extraLinesOf?: (latest: RunDetailLike) => string[];
}): Promise<string> {
  const {
    title,
    metaLines,
    stream,
    initial,
    notify,
    signal,
    timeoutMs,
    extraLinesOf,
  } = options;
  return new Promise<string>((resolve) => {
    let latest: RunDetailLike = initial;
    let sent = 0;
    let settled = false;
    let timedOut = false;
    let timeoutTimer: NodeJS.Timeout | null = null;
    let subscription: { unsubscribe(): void } | null = null;

    const finish = () => {
      if (settled) return;
      settled = true;
      if (timeoutTimer) clearTimeout(timeoutTimer);
      subscription?.unsubscribe();
      signal?.removeEventListener('abort', onAbort);
      const meta = [
        ...metaLines,
        ...(extraLinesOf ? extraLinesOf(latest) : []),
      ];
      const markdown = renderRunMarkdown(title, meta, latest);
      resolve(
        timedOut
          ? `${markdown}\n> 等待超时：运行在平台继续执行，可稍后用 get_run 查询终态。\n`
          : markdown,
      );
    };

    const onAbort = () => finish();
    signal?.addEventListener('abort', onAbort, { once: true });

    timeoutTimer = setTimeout(() => {
      timedOut = true;
      finish();
    }, timeoutMs);
    timeoutTimer.unref?.();

    subscription = stream.subscribe({
      next: (event) => {
        const snapshot = event.data as RunDetailLike;
        latest = snapshot;
        const output = snapshot.output ?? [];
        for (; sent < output.length; sent++) {
          if (notify) {
            void notify(sent + 1, output[sent]).catch(() => {});
          }
        }
        if (snapshot.status !== 'running' && snapshot.status !== 'queued') {
          finish();
        }
      },
      error: (error: Error) => {
        latest = { ...latest, status: 'error', message: error.message };
        finish();
      },
      complete: () => finish(),
    });
    // 终态快照可能在 subscribe 时同步推送（此时 subscription 尚未赋值）
    if (settled) subscription.unsubscribe();
  });
}
