import type { Worker } from '../workers/worker.entity';

/**
 * 主模型限额（限流 / 配额 / 余额 / token 用尽）识别与共享冷却。
 *
 * 限额通常发生在供应商账号 + 模型维度，同一执行器上多个机器人可能共用同一模型，
 * 因此冷却按 executorId + providerId + modelId 维度共享（进程内内存，重启即清空）。
 * 命中后固定冷却 30 分钟，期间新建会话直接用机器人配置的备用模型；
 * 冷却结束自动重新尝试主模型，再次失败则重新进入冷却。
 */

/** 冷却时长：固定 30 分钟 */
export const MODEL_COOLDOWN_MS = 30 * 60_000;

export interface ModelErrorLike {
  type?: string | null;
  message?: string | null;
}

export interface ModelRef {
  providerId: string;
  modelId: string;
  variant: string | null;
}

/** 机器人当前应使用的模型与限额兜底模型 */
export interface WorkerModelSelection {
  /** 当前生效模型（主模型冷却中且配置了备用时为备用模型） */
  model: ModelRef;
  /** 主模型失败时自动切换的目标；已在使用备用或未配置时为 null */
  fallback: ModelRef | null;
  /** 当前是否因主模型冷却而使用备用模型 */
  usingBackup: boolean;
}

/** executorId:providerId:modelId → 冷却截止时间（毫秒） */
const exhaustedUntil = new Map<string, number>();

function availabilityKey(
  executorId: number,
  providerId: string,
  modelId: string,
): string {
  return `${executorId}:${providerId}:${modelId}`;
}

/** 标记模型进入冷却（主模型或备用模型命中限额时均调用） */
export function markModelExhausted(
  executorId: number,
  providerId: string,
  modelId: string,
  reason?: string | null,
): void {
  const until = Date.now() + MODEL_COOLDOWN_MS;
  exhaustedUntil.set(availabilityKey(executorId, providerId, modelId), until);
  // 冷却仅用于路由决策，避免在日志里输出完整错误文本
  void reason;
}

/** 模型是否处于冷却期（到期自动清除） */
export function isModelExhausted(
  executorId: number,
  providerId: string,
  modelId: string,
): boolean {
  const key = availabilityKey(executorId, providerId, modelId);
  const until = exhaustedUntil.get(key);
  if (until === undefined) return false;
  if (until <= Date.now()) {
    exhaustedUntil.delete(key);
    return false;
  }
  return true;
}

/** 冷却剩余时间（毫秒；未冷却为 0） */
export function modelCooldownRemainingMs(
  executorId: number,
  providerId: string,
  modelId: string,
): number {
  const until = exhaustedUntil.get(
    availabilityKey(executorId, providerId, modelId),
  );
  if (until === undefined) return 0;
  return Math.max(0, until - Date.now());
}

/** 清空全部冷却状态（单测重置用） */
export function resetModelAvailability(): void {
  exhaustedUntil.clear();
}

/**
 * 非限额类错误特征：上下文超长、最大 token 数等参数问题不触发模型切换。
 * 先排除，再匹配限额特征，避免 “token limit” 之类的误判。
 */
const NON_QUOTA_PATTERNS: RegExp[] = [
  /context[\s_-]*(length|window)/i,
  /maximum context/i,
  /prompt is too long/i,
  /too many tokens/i,
  /max(imum)? (output )?tokens?/i,
  /上下文(长度|超长|过长)/i,
];

/** 限额 / 限流特征（英文与中文供应商错误文本） */
const QUOTA_PATTERNS: RegExp[] = [
  /\b429\b/,
  /too many requests/i,
  /rate[\s_-]?limit/i,
  /\bquota\b/i,
  /insufficient[\s_-]+(quota|balance|credit|funds|tokens?)/i,
  /insufficient (quota|balance|credits?|funds)/i,
  /\bbilling\b/i,
  /payment required/i,
  /\b402\b/,
  /credit balance/i,
  /out of credits?/i,
  /exceeded (your |the )?(current )?(quota|usage|spending)/i,
  /usage limit/i,
  /(exhausted|耗尽|用尽|用完)/i,
  /限额/,
  /限流/,
  /配额/,
  /额度/,
  /余额不足/,
  /欠费/,
  /用量(已达|已超|超)/,
];

/** 判断错误是否为模型限额/限流（可自动切换备用模型） */
export function isModelQuotaError(error?: ModelErrorLike | null): boolean {
  if (!error) return false;
  const text = `${error.type ?? ''} ${error.message ?? ''}`.trim();
  if (!text) return false;
  if (NON_QUOTA_PATTERNS.some((pattern) => pattern.test(text))) return false;
  return QUOTA_PATTERNS.some((pattern) => pattern.test(text));
}

/** 从执行器返回的任意错误结构中提取 type/message（限于限额判定所需字段） */
export function toModelError(value: unknown): ModelErrorLike | null {
  if (!value) return null;
  if (typeof value === 'string') return { message: value };
  if (typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const nested =
    record.data && typeof record.data === 'object'
      ? (record.data as Record<string, unknown>)
      : null;
  const type =
    (typeof record.type === 'string' && record.type) ||
    (typeof record.name === 'string' && record.name) ||
    null;
  const message =
    (typeof record.message === 'string' && record.message) ||
    (nested && typeof nested.message === 'string' && nested.message) ||
    null;
  if (!type && !message) return null;
  return { type, message };
}

/** 机器人主模型（未配置供应商/模型时为 null） */
export function workerMainModel(
  worker: Pick<Worker, 'providerId' | 'modelId' | 'variant'>,
): ModelRef | null {
  const providerId = worker.providerId?.trim();
  const modelId = worker.modelId?.trim();
  if (!providerId || !modelId) return null;
  return { providerId, modelId, variant: worker.variant?.trim() || null };
}

/**
 * 机器人备用模型：未配置、缺供应商或与主模型完全相同时视为未配置。
 */
export function workerBackupModel(
  worker: Pick<
    Worker,
    | 'providerId'
    | 'modelId'
    | 'backupProviderId'
    | 'backupModelId'
    | 'backupVariant'
  >,
): ModelRef | null {
  const providerId = worker.backupProviderId?.trim();
  const modelId = worker.backupModelId?.trim();
  if (!providerId || !modelId) return null;
  if (
    providerId === worker.providerId?.trim() &&
    modelId === worker.modelId?.trim()
  ) {
    return null;
  }
  return { providerId, modelId, variant: worker.backupVariant?.trim() || null };
}

/**
 * 解析机器人当前应使用的模型：
 * - 主模型未冷却：用主模型，备用模型作为限额兜底；
 * - 主模型冷却中且配置了备用：直接用备用模型（不再兜底回主模型）；
 * - 主模型冷却中且没有备用：仍用主模型（保持原有失败行为）。
 */
export function resolveWorkerModel(
  worker: Pick<
    Worker,
    | 'executorId'
    | 'providerId'
    | 'modelId'
    | 'variant'
    | 'backupProviderId'
    | 'backupModelId'
    | 'backupVariant'
  >,
): WorkerModelSelection | null {
  const main = workerMainModel(worker);
  if (!main) return null;
  const backup = workerBackupModel(worker);
  if (!backup) return { model: main, fallback: null, usingBackup: false };
  const executorId = worker.executorId;
  if (!executorId) {
    return { model: main, fallback: backup, usingBackup: false };
  }
  const mainExhausted = isModelExhausted(
    executorId,
    main.providerId,
    main.modelId,
  );
  const backupExhausted = isModelExhausted(
    executorId,
    backup.providerId,
    backup.modelId,
  );
  if (mainExhausted) {
    // 主模型冷却中：优先备用模型；备用也冷却时回到主模型重试（保持原有失败行为）
    return backupExhausted
      ? { model: main, fallback: null, usingBackup: false }
      : { model: backup, fallback: null, usingBackup: true };
  }
  // 主模型可用：备用模型冷却中时不再作为兜底，避免切到同样限额的模型
  return {
    model: main,
    fallback: backupExhausted ? null : backup,
    usingBackup: false,
  };
}
