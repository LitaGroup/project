import { BadRequestException } from '@nestjs/common';
import {
  isModelQuotaError,
  markModelExhausted,
  resolveWorkerModel,
  type ModelErrorLike,
} from './model-availability';
import {
  isFreshOutcome,
  OpencodeClient,
  OpencodeModelRef,
} from './opencode-client';
import type { Worker } from '../workers/worker.entity';

export interface RunOpencodePromptFallback {
  /** 主模型限额时切到的备用模型 */
  model: OpencodeModelRef;
  /** 切换后在原会话续跑的指令 */
  continuePrompt?: string;
}

export interface RunOpencodePromptInput {
  /** 会话标题（展示用） */
  title: string;
  model: OpencodeModelRef;
  location?: { directory: string };
  /** 下发给会话的完整提示词 */
  prompt: string;
  /** 整体超时（含等待执行完成） */
  timeoutMs: number;
  /** 轮询会话状态的间隔，默认 2s */
  pollMs?: number;
  /** 会话创建后回调（便于调用方记录并在结束后清理一次性会话） */
  onSessionCreated?: (sessionId: string) => void;
  /**
   * 主模型限额（限流/配额/余额/token 用尽）时的备用模型：
   * 命中后在同一会话切换模型并续跑一次，保留上下文。
   */
  fallback?: RunOpencodePromptFallback;
  /** 命中模型限额时回调（无论是否切换备用），调用方用于标记共享冷却 */
  onQuotaError?: (error: ModelErrorLike | null) => void;
}

/** 主模型限额后切换备用模型的默认续跑指令 */
export const FALLBACK_CONTINUE_PROMPT =
  '主模型已达到使用限额，已切换到备用模型。请继续完成当前任务，不要重复已完成的内容。';

/** 把平台模型引用转为执行器模型引用 */
export function toOpencodeModelRef(model: {
  providerId: string;
  modelId: string;
  variant: string | null;
}): OpencodeModelRef {
  return {
    id: model.modelId,
    providerID: model.providerId,
    ...(model.variant ? { variant: model.variant } : {}),
  };
}

/** 一次性会话的模型计划 */
export interface PromptModelPlan {
  model: OpencodeModelRef;
  fallback?: RunOpencodePromptFallback;
  onQuotaError?: (error: ModelErrorLike | null) => void;
}

/**
 * 解析一次性会话的模型与限额兜底：
 * 主模型冷却中直接用备用；否则主模型 + 备用兜底（命中限额时切换并标记共享冷却）。
 * worker 缺少显式模型配置时沿用调用方按执行器缓存解析出的模型。
 */
export function planPromptModels(
  worker: Worker,
  executorId: number,
  fallbackEndpoint: {
    providerId: string;
    modelId: string;
    variant: string | null;
  },
): PromptModelPlan {
  const selection = resolveWorkerModel(worker);
  const primary = selection?.model ?? fallbackEndpoint;
  const backup = selection?.fallback;
  return {
    model: toOpencodeModelRef(primary),
    // 命中限额即标记共享冷却（主模型或当前生效的备用模型）
    onQuotaError: (error: ModelErrorLike | null) =>
      markModelExhausted(
        executorId,
        primary.providerId,
        primary.modelId,
        error?.message,
      ),
    ...(backup ? { fallback: { model: toOpencodeModelRef(backup) } } : {}),
  };
}

type PromptOutcome = 'succeeded' | 'failed' | 'timeout';

/** 建会话 → 发提示词 → 轮询到终态 → 取最后一条 assistant 文本 */
export async function runOpencodePrompt(
  client: OpencodeClient,
  input: RunOpencodePromptInput,
): Promise<string> {
  if (input.location?.directory) {
    // 工位/工作目录可能尚未创建；先幂等建目录再建会话
    await client.shell(`mkdir -p '${input.location.directory}'`);
  }
  const session = await client.createSession({
    title: input.title,
    model: input.model,
    location: input.location,
  });
  input.onSessionCreated?.(session.id);
  // prompt 为异步接口；outcome 具有粘性，须以本轮用户消息时间作为新鲜度基准
  const promptResult = await client.prompt(session.id, { text: input.prompt });
  let afterMs = promptResult?.time?.created ?? 0;

  const pollMs = input.pollMs ?? 2000;
  const deadline = Date.now() + input.timeoutMs;
  let switched = false;
  while (Date.now() < deadline) {
    const outcome = await waitOutcome(
      client,
      session.id,
      afterMs,
      deadline,
      pollMs,
    );
    if (outcome === 'succeeded') {
      // 会话终态与消息落库可能有短暂延迟，重试几次再取文本
      for (let attempt = 0; attempt < 3; attempt++) {
        const text = await client.lastAssistantText(session.id, afterMs);
        if (text?.trim()) return text;
        if (attempt < 2) await sleep(500);
      }
      throw new BadRequestException(
        `执行器会话 ${session.id} 已结束但没有文本输出`,
      );
    }
    if (outcome === 'timeout') break;
    // 执行失败：读取错误详情，主模型限额时标记冷却并按需切换备用模型续跑一次
    const error = await client
      .lastAssistantError(session.id, afterMs)
      .catch(() => null);
    if (isModelQuotaError(error)) {
      input.onQuotaError?.(error);
      if (!switched && input.fallback) {
        switched = true;
        await client.switchModel(session.id, input.fallback.model);
        const retry = await client.prompt(session.id, {
          text: input.fallback.continuePrompt ?? FALLBACK_CONTINUE_PROMPT,
        });
        afterMs = retry?.time?.created ?? 0;
        continue;
      }
    }
    throw new BadRequestException(`执行器会话 ${session.id} 执行失败`);
  }
  await client.interrupt(session.id).catch(() => undefined);
  throw new BadRequestException(
    `执行器会话执行超时（超过 ${Math.round(input.timeoutMs / 60_000)} 分钟）`,
  );
}

/** 轮询会话到本轮终态（outcome 具有粘性，须晚于本轮用户消息） */
async function waitOutcome(
  client: OpencodeClient,
  sessionId: string,
  afterMs: number,
  deadline: number,
  pollMs: number,
): Promise<PromptOutcome> {
  while (Date.now() < deadline) {
    const info = await client.session(sessionId);
    if (isFreshOutcome(info, afterMs)) {
      return info.outcome === 'succeeded' ? 'succeeded' : 'failed';
    }
    await sleep(Math.min(pollMs, Math.max(0, deadline - Date.now())));
  }
  return 'timeout';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
