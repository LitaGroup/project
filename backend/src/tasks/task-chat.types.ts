import type { Task } from './task.entity';

/** 聊天消息发送方：用户 / 机器人 / 调度机器人 / 系统 */
export type TaskChatSenderKind = 'user' | 'worker' | 'scheduler' | 'system';

/** 消息发送方（机器人使用 workers.id 做稳定的前端配色/头像标识） */
export interface TaskChatSender {
  id: string;
  name: string;
  kind: TaskChatSenderKind;
  workerId?: number;
  roleLabel?: string;
  /** 机器人头像：/images/... 路径（空为默认黑底占位） */
  avatarUrl?: string | null;
}

/** 机器人执行过程中的工具调用 */
export interface TaskChatTool {
  id: string;
  name: string;
  status: 'running' | 'success' | 'error';
  detail?: string;
}

/** 提问选项（opencode question） */
export interface TaskChatQuestionOption {
  label: string;
  description?: string;
}

/** 单个问题（opencode question） */
export interface TaskChatQuestionInfo {
  question: string;
  header: string;
  options?: TaskChatQuestionOption[];
  multiple?: boolean;
  /** 是否接受自由输入（false 时只能从选项中选择） */
  custom?: boolean;
}

/** 提问状态：待回答 / 已回答 / 已跳过 / 已失效（任务结束等） */
export type TaskChatQuestionState =
  'pending' | 'answered' | 'rejected' | 'cancelled';

/** 机器人提问（渲染为对话中的问答卡片） */
export interface TaskChatQuestion {
  /** opencode question requestID（答复时回传） */
  id: string;
  sessionId: string;
  questions: TaskChatQuestionInfo[];
  state: TaskChatQuestionState;
  /** 按问题顺序的答案（选项 label + 自定义文本），仅 answered 有值 */
  answers?: string[][];
  askedAt: string;
  /** 关联的工具调用 id（opencode QuestionRequest.tool.callID） */
  toolCallId?: string;
}

/** 任务聊天消息（任务详情页左侧对话流） */
export interface TaskChatMessage {
  id: string;
  taskId: number;
  role: 'user' | 'assistant' | 'system';
  sender: TaskChatSender;
  /** Markdown 正文；工具调用/提问消息可能为空 */
  content: string;
  createdAt: string;
  status: 'running' | 'complete' | 'error';
  /** message=普通对话气泡；event=居中流转事件；question=机器人提问卡片 */
  kind: 'message' | 'event' | 'question';
  tools?: TaskChatTool[];
  question?: TaskChatQuestion;
  meta?: Record<string, unknown>;
}

/** PIPELINE 阶段：主任务或子任务 + 分配的机器人与调度机器人 */
export interface TaskPipelineStage {
  task: Task;
  agent: TaskChatSender | null;
  scheduler: TaskChatSender | null;
}

/** 任务详情页聊天初始快照 */
export interface TaskChatSnapshot {
  /** 当前打开的任务（可能是 PIPELINE 中的子任务） */
  task: Task;
  /** 所属根任务 */
  rootTask: Task;
  pipeline: TaskPipelineStage[];
  messages: TaskChatMessage[];
}

/** 任务聊天 SSE 推送 */
export type TaskChatStreamMessage =
  | { type: 'ready'; at: number }
  | { type: 'message.upsert'; message: TaskChatMessage; at: number }
  | { type: 'stage.upsert'; stage: TaskPipelineStage; at: number }
  | { type: 'stage.delete'; ids: number[]; at: number }
  | { type: 'refresh'; at: number }
  | { type: 'ping'; at: number };
