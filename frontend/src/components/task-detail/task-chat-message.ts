import {
  type MessageState,
  type ReasoningMessagePart,
  type TextMessagePart,
  type ThreadMessageLike,
  type ToolCallMessagePart,
} from '@assistant-ui/react'
import type {
  TaskChatMessage,
  TaskChatPerspective,
  TaskChatQuestion,
  TaskChatSender,
} from '../../lib/api'
import { toChatToolPart } from '../agent-chat/ChatParts'

export interface TaskQuestionAutoAnswer {
  status?: 'running' | 'answered' | 'failed'
  parentAgentName?: string
  error?: string
}

/** 消息 metadata.custom：发送方、提问卡片与父机器人自动答复状态 */
export interface TaskChatCustom {
  taskId?: number
  sender?: TaskChatSender
  perspective?: TaskChatPerspective
  question?: TaskChatQuestion
  autoAnswer?: TaskQuestionAutoAnswer
}

/** 任务 → assistant-ui 消息（sender 放在 metadata.custom，供多机器人头像展示） */
export function toTaskChatThreadMessage(
  message: TaskChatMessage,
): ThreadMessageLike {
  const status =
    message.role === 'assistant'
      ? message.status === 'running'
        ? ({ type: 'running' } as const)
        : message.status === 'error'
          ? ({ type: 'incomplete', reason: 'error' } as const)
          : ({ type: 'complete', reason: 'stop' } as const)
      : undefined
  const content = message.content
  const parts: Array<
    ReasoningMessagePart | TextMessagePart | ToolCallMessagePart
  > = []
  if (message.reasoning?.trim()) {
    parts.push({
      type: 'reasoning',
      text: message.reasoning,
      ...(message.status === 'running'
        ? { status: { type: 'running' as const } }
        : {}),
    })
  }
  for (const tool of message.tools ?? []) {
    // question 工具由独立问答卡片展示，不在工具链里重复出现
    if (tool.name === 'question') continue
    parts.push(toChatToolPart(tool))
  }
  if (content) parts.push({ type: 'text', text: content })
  return {
    id: message.id,
    role: message.role,
    content: parts,
    createdAt: new Date(message.createdAt),
    status,
    metadata: {
      custom: {
        taskId: message.taskId,
        sender: message.sender,
        perspective: message.perspective,
        question: message.question,
        autoAnswer: readAutoAnswer(message.meta),
      } satisfies TaskChatCustom,
    },
  }
}

export function taskChatCustomOf(message: MessageState): TaskChatCustom {
  return (message.metadata.custom ?? {}) as TaskChatCustom
}

/** 从消息 meta.autoAnswer 读取父机器人自动答复状态 */
function readAutoAnswer(
  meta: Record<string, unknown> | undefined,
): TaskQuestionAutoAnswer | undefined {
  const value = meta?.autoAnswer
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const status =
    raw.status === 'running' ||
    raw.status === 'answered' ||
    raw.status === 'failed'
      ? raw.status
      : undefined
  return {
    status,
    parentAgentName:
      typeof raw.parentAgentName === 'string'
        ? raw.parentAgentName
        : undefined,
    error: typeof raw.error === 'string' ? raw.error : undefined,
  }
}
