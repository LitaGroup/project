import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { Notification, Request } from '@modelcontextprotocol/sdk/types.js';

/** 进度推送函数（客户端提供 progressToken 时才存在） */
export type ProgressFn = (progress: number, message: string) => Promise<void>;

type Extra = RequestHandlerExtra<Request, Notification>;

/**
 * 客户端提供 progressToken 时构造进度推送函数，否则返回 null（仅等终态）。
 * 推送失败（客户端断开等）由调用方决定是否忽略。
 */
export function createProgressEmitter(extra: Extra): ProgressFn | null {
  const progressToken = extra._meta?.progressToken;
  if (progressToken === undefined || progressToken === null) return null;
  return async (progress: number, message: string) => {
    await extra.sendNotification({
      method: 'notifications/progress',
      params: { progressToken, progress, message },
    });
  };
}
