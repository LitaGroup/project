import type {
  OpencodeQuestionInfo,
  OpencodeQuestionRequest,
} from '../executors/opencode-client';
import type { OpencodeTodo } from '../executors/opencode-todos';

/** 可调试机器人（调试页下拉/面板展示用） */
export interface WorkerDebugOption {
  id: number;
  name: string;
  intro: string | null;
  avatarUrl: string | null;
  executorName: string;
  providerId: string;
  modelId: string;
}

/** 提问状态：待回答 / 已回答 / 已跳过 / 已失效（本轮结束等） */
export type WorkerDebugQuestionState =
  'pending' | 'answered' | 'rejected' | 'cancelled';

/** 机器人提问（opencode question，渲染为对话中的问答卡片） */
export interface WorkerDebugQuestion {
  /** opencode question requestID（答复时回传） */
  id: string;
  /** 提问所在会话（可能是 opencode 子会话，答复时优先使用） */
  sessionId: string;
  questions: OpencodeQuestionInfo[];
  state: WorkerDebugQuestionState;
  /** 按问题顺序的答案（选项 label + 自定义文本），仅 answered 有值 */
  answers?: string[][];
  askedAt: string;
  toolCallId?: string;
}

/** 机器人调试过程中的工具调用（与任务对话的工具结构保持一致） */
export interface WorkerDebugTool {
  id: string;
  name: string;
  status: 'running' | 'success' | 'error';
  argsText?: string;
  result?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface WorkerDebugMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** 流式累积的思考内容（session.reasoning.* 事件；可能为空） */
  reasoning?: string;
  status: 'running' | 'complete' | 'error';
  createdAt: string;
  /** message=普通对话气泡；question=机器人提问卡片（缺省按 message 处理） */
  kind?: 'message' | 'question';
  /** kind=question 时的问答卡片数据（独立消息，不打断助手文本流） */
  question?: WorkerDebugQuestion;
  /** 本轮工具调用（session.tool.* 事件实时累积） */
  tools?: WorkerDebugTool[];
}

/** 调试 SSE 单条消息：snapshot=全量快照推送，ping=保活 */
export interface DebugStreamPayload {
  type: 'snapshot' | 'ping';
  snapshot?: WorkerDebugSnapshot;
}

export interface WorkerDebugSnapshot {
  worker: WorkerDebugOption;
  /** opencode 会话在首条消息发送时创建，7 天内复用同一会话续聊 */
  sessionId: string | null;
  status: 'idle' | 'running';
  messages: WorkerDebugMessage[];
  /** 最近一次 todowrite 的待办清单（随快照返回，前端右侧面板展示） */
  todos: OpencodeTodo[];
  error: string | null;
  updatedAt: string;
}

/** 事件解析出的提问（复用 opencode 客户端的请求结构） */
export type DebugQuestionRequest = OpencodeQuestionRequest;
