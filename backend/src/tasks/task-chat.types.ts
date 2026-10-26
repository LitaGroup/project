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
}

/** 机器人执行过程中的工具调用 */
export interface TaskChatTool {
  id: string;
  name: string;
  status: 'running' | 'success' | 'error';
  detail?: string;
}

/** 任务聊天消息（任务详情页左侧对话流） */
export interface TaskChatMessage {
  id: string;
  taskId: number;
  role: 'user' | 'assistant' | 'system';
  sender: TaskChatSender;
  /** Markdown 正文；工具调用消息可能为空 */
  content: string;
  createdAt: string;
  status: 'running' | 'complete' | 'error';
  /** message=普通对话气泡；event=居中流转事件 */
  kind: 'message' | 'event';
  tools?: TaskChatTool[];
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
