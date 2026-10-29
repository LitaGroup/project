import type { TaskEvent } from './task-event.entity';
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
  /** 历史错误/补充说明 */
  detail?: string;
  /** 工具参数（JSON 文本，assistant-ui tool-call 使用） */
  argsText?: string;
  /** 工具结果或错误（超长由后端截断） */
  result?: string;
  startedAt?: string;
  finishedAt?: string;
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
  /** form 协议下的字段 key（答复 form 时由后端使用） */
  fieldKey?: string;
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
  role: 'user' | 'assistant';
  sender: TaskChatSender;
  /** Markdown 正文；工具调用/提问消息可能为空 */
  content: string;
  /** 思考过程（opencode session.reasoning.* 流式累积） */
  reasoning?: string;
  createdAt: string;
  status: 'running' | 'complete' | 'error';
  /** message=普通对话气泡；question=机器人提问卡片（状态变更等时间线事件不进入对话流，走快照 events） */
  kind: 'message' | 'question';
  tools?: TaskChatTool[];
  question?: TaskChatQuestion;
  meta?: Record<string, unknown>;
}

/** 等待投递给执行器的用户消息（机器人本轮结束后按顺序发送） */
export interface TaskQueuedUserMessage {
  id: string;
  taskId: number;
  sender: TaskChatSender;
  content: string;
  createdAt: string;
  status: 'queued' | 'sending';
  /** 上一次投递失败原因（保留在队列中，等待下次恢复） */
  error?: string;
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
  /** 当前任务等待投递给机器人的用户消息（FIFO） */
  queuedMessages: TaskQueuedUserMessage[];
  /** 当前任务的需求人姓名（任务创建人） */
  requesterName: string | null;
  /** 当前执行机器人的负责人姓名 */
  agentOwnerName: string | null;
  /** 当前任务人工介入次数（事件 meta.intervention） */
  interventionCount: number;
  /** 当前任务事件时间线（倒序，供右侧任务事件面板） */
  events: TaskEvent[];
}

/** 任务聊天 SSE 推送 */
export type TaskChatStreamMessage =
  | { type: 'ready'; at: number }
  | { type: 'message.upsert'; message: TaskChatMessage; at: number }
  | { type: 'queue.upsert'; message: TaskQueuedUserMessage; at: number }
  | { type: 'queue.delete'; ids: string[]; at: number }
  | { type: 'stage.upsert'; stage: TaskPipelineStage; at: number }
  | { type: 'stage.delete'; ids: number[]; at: number }
  | { type: 'refresh'; at: number }
  | { type: 'ping'; at: number };
