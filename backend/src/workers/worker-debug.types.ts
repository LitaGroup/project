import type {
  OpencodeQuestionInfo,
  OpencodeQuestionRequest,
} from '../executors/opencode-client';
import type { OpencodeTodo } from '../executors/opencode-todos';

/** opencode 主 Agent 模式：build=可修改执行，plan=只分析规划 */
export type WorkerDebugMode = 'build' | 'plan';

/** 可调试机器人（调试页下拉/面板展示用） */
export interface WorkerDebugOption {
  id: number;
  name: string;
  intro: string | null;
  avatarUrl: string | null;
  executorName: string;
  providerId: string;
  modelId: string;
  /** 机器人默认思考等级（空=模型默认） */
  variant: string | null;
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

/** 调试会话中用户选择的模型与思考等级 */
export interface WorkerDebugModelSelection {
  providerId: string;
  modelId: string;
  /** 思考等级变体 id；null 表示使用模型默认值 */
  variant: string | null;
}

/** 模型的可选思考等级 */
export interface WorkerDebugModelVariant {
  id: string;
  name: string;
}

/** 可切换的模型（附带思考等级变体） */
export interface WorkerDebugModel {
  id: string;
  name: string;
  variants: WorkerDebugModelVariant[];
}

/** 按供应商分组的模型清单 */
export interface WorkerDebugModelProvider {
  id: string;
  name: string;
  models: WorkerDebugModel[];
}

/** 我的 AGENT 模型选择器数据 */
export interface WorkerDebugModelCatalog {
  current: WorkerDebugModelSelection;
  providers: WorkerDebugModelProvider[];
}

/** 对话附件（文件上传后按公开 URL 随消息发送） */
export interface WorkerDebugAttachment {
  name: string;
  url: string;
  size?: number;
  mime?: string;
}

/** 机器人调试过程中的工具调用（与任务对话的工具结构保持一致） */
export interface WorkerDebugTool {
  id: string;
  name: string;
  status: 'running' | 'success' | 'error';
  /** 历史错误/补充说明 */
  detail?: string;
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
  /** 用户消息携带的附件（文件上传后的公开地址） */
  files?: WorkerDebugAttachment[];
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
  /** 当前选择/生效的模型与思考等级（我的 AGENT 选择器用） */
  model: WorkerDebugModelSelection;
  /** 当前主 Agent 模式（build / plan） */
  mode: WorkerDebugMode;
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
