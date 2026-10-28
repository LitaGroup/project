import { BadRequestException } from '@nestjs/common';
import {
  isFreshOutcome,
  OpencodeClient,
  OpencodeModelRef,
} from './opencode-client';

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
}

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
  const afterMs = promptResult?.time?.created ?? 0;

  const pollMs = input.pollMs ?? 2000;
  const deadline = Date.now() + input.timeoutMs;
  while (Date.now() < deadline) {
    const info = await client.session(session.id);
    if (isFreshOutcome(info, afterMs)) {
      if (info.outcome === 'succeeded') {
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
      throw new BadRequestException(`执行器会话 ${session.id} 执行失败`);
    }
    await sleep(Math.min(pollMs, Math.max(0, deadline - Date.now())));
  }
  await client.interrupt(session.id).catch(() => undefined);
  throw new BadRequestException(
    `执行器会话执行超时（超过 ${Math.round(input.timeoutMs / 60_000)} 分钟）`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
