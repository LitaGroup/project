import type { OpencodeTodo } from '../executors/opencode-todos';
import type { WorkerDebugMessage, WorkerDebugSnapshot } from '../workers/worker-debug.types';
import type {
  McpBotQuestionGroup,
  McpToolSummary,
} from './mcp.types';

/**
 * bot_call / bot_answer 执行等待的纯函数集：
 * 从调试会话快照流中提取文本增量、工具变化与终态结果，便于单测。
 */

/** 等待轮次过程中的已推送进度状态（跨快照累积） */
export interface McpRunState {
  /** 当前轮 assistant 文本已推送长度 */
  textLen: number;
  /** 工具签名（id:status 拼接），用于识别变化 */
  toolSignature: string;
}

export function initialRunState(): McpRunState {
  return { textLen: 0, toolSignature: '' };
}

/** 一帧快照解析出的进度增量 */
export interface McpProgressStep {
  /** 新增文本 */
  text?: string;
  /** 工具变化描述（每条一个事件） */
  toolEvents?: string[];
}

/** 最后一条非提问的 assistant 消息（running 优先，其次已完成的收尾消息） */
export function lastAssistantOf(
  messages: WorkerDebugMessage[],
): WorkerDebugMessage | null {
  const assistants = messages.filter(
    (message) => message.role === 'assistant' && !message.question,
  );
  return assistants.length ? assistants[assistants.length - 1] : null;
}

/** 待回答的提问卡片 */
export function pendingQuestionsOf(
  messages: WorkerDebugMessage[],
): McpBotQuestionGroup[] {
  return messages
    .filter(
      (message) =>
        message.kind === 'question' && message.question?.state === 'pending',
    )
    .map((message) => ({
      id: message.question!.id,
      questions: (message.question!.questions ?? []).map((question) => ({
        question: question.question,
        header: question.header,
        ...(question.options?.length
          ? {
              options: question.options.map((option) => ({
                label: option.label,
                ...(option.description ? { description: option.description } : {}),
              })),
            }
          : {}),
        ...(question.multiple ? { multiple: true } : {}),
        custom: question.custom !== false,
      })),
    }));
}

export function toolSummariesOf(
  message: WorkerDebugMessage | null,
): McpToolSummary[] {
  return (message?.tools ?? []).map((tool) => ({
    id: tool.id,
    name: tool.name,
    status: tool.status,
    ...(tool.argsText?.trim()
      ? { detail: tool.argsText.trim().slice(0, 120) }
      : {}),
  }));
}

function toolSignatureOf(tools: McpToolSummary[]): string {
  return tools.map((tool) => `${tool.id ?? tool.name}:${tool.status}`).join('|');
}

/**
 * 对比上一帧解析进度增量：
 * - 文本按已推送长度切增量（新轮次/重置导致变短时按全新文本处理）
 * - 工具签名变化时输出变化的条目描述
 */
export function diffRunProgress(
  state: McpRunState,
  snapshot: WorkerDebugSnapshot,
): McpProgressStep | null {
  const assistant = lastAssistantOf(snapshot.messages);
  const content = assistant?.content ?? '';
  if (content.length < state.textLen) {
    // 会话重置或新轮次：从零开始
    state.textLen = 0;
  }
  const text = content.slice(state.textLen);
  const tools = toolSummariesOf(assistant);
  const signature = toolSignatureOf(tools);
  const toolEvents: string[] = [];
  if (signature !== state.toolSignature) {
    const previous = new Set(
      state.toolSignature.split('|').filter(Boolean),
    );
    for (const tool of tools) {
      const key = `${tool.id ?? tool.name}:${tool.status}`;
      if (previous.has(key)) continue;
      const detail = tool.detail ? `：${tool.detail}` : '';
      toolEvents.push(`[${tool.status}] ${tool.name}${detail}`);
    }
  }
  state.textLen = content.length;
  state.toolSignature = signature;
  if (!text && toolEvents.length === 0) return null;
  return {
    ...(text ? { text } : {}),
    ...(toolEvents.length ? { toolEvents } : {}),
  };
}

/** 当前轮的文本内容（不管是否结束） */
export function currentRunText(snapshot: WorkerDebugSnapshot): string {
  return lastAssistantOf(snapshot.messages)?.content ?? '';
}

/** 工具摘要与待办（快照级） */
export function runArtifactsOf(snapshot: WorkerDebugSnapshot): {
  tools: McpToolSummary[];
  todos: OpencodeTodo[];
} {
  return {
    tools: toolSummariesOf(lastAssistantOf(snapshot.messages)),
    todos: snapshot.todos ?? [],
  };
}

/**
 * 终态判定：返回 null 表示仍在执行中。
 * - 存在待回答提问 → question（会话保持 running，等 bot_answer 续跑）
 * - snapshot.status === 'idle' → complete / error
 */
export function settleRunResult(
  snapshot: WorkerDebugSnapshot,
): {
  status: 'complete' | 'question' | 'error';
  content: string;
  error?: string;
} | null {
  const questions = pendingQuestionsOf(snapshot.messages);
  if (questions.length > 0) {
    return {
      status: 'question',
      content: currentRunText(snapshot),
    };
  }
  if (snapshot.status !== 'idle') return null;
  const assistant = lastAssistantOf(snapshot.messages);
  const content = assistant?.content ?? '';
  if (!assistant || assistant.status === 'error' || snapshot.error) {
    return {
      status: 'error',
      content,
      error: snapshot.error || content || '机器人本轮没有产生结果',
    };
  }
  if (assistant.status !== 'complete') return null;
  return { status: 'complete', content };
}

/**
 * 超时中断后的结果：finishInterrupted 会把 running 消息置 error 并追加固定提示，
 * 这里剥掉提示只保留已完成的部分文本。
 */
const INTERRUPT_NOTICES = [
  '本轮回复已中断。你可以继续发送消息，仍使用当前会话。',
  '本轮回复已中断（平台重启或会话已断开），可继续发送新消息。',
];

export function interruptedResultFrom(snapshot: WorkerDebugSnapshot): {
  content: string;
  tools: McpToolSummary[];
  todos: OpencodeTodo[];
} {
  const assistant = lastAssistantOf(snapshot.messages);
  let content = assistant?.content ?? '';
  for (const notice of INTERRUPT_NOTICES) {
    content = content.replace(notice, '').trimEnd();
  }
  return { content, ...runArtifactsOf(snapshot) };
}
