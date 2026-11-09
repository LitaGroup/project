import { MessagePrimitive, type MessageState } from '@assistant-ui/react'
import { MessageCircleQuestion } from '@appica/icons-react'
import type {
  TaskChatPerspective,
  TaskChatQuestion,
  TaskChatSender,
} from '../../lib/api'
import { questionStatusLabel } from '../../lib/question'
import { QuestionCard } from '../QuestionCard'
import { SenderLine, WorkerAvatar } from './WorkerAvatar'
import {
  ChatAssistantParts,
  CHAT_MARKDOWN_PARTS,
  CHAT_MARKDOWN_PARTS_ON_PRIMARY,
} from '../agent-chat/ChatParts'
import { taskChatCustomOf, type TaskChatCustom } from './task-chat-message'

const FALLBACK_SENDER: TaskChatSender = {
  id: 'system',
  name: '系统',
  kind: 'system',
  roleLabel: '系统',
}

const FALLBACK_REQUESTER_SENDER: TaskChatSender = {
  id: 'user',
  name: '需求方',
  kind: 'user',
  roleLabel: '需求方',
}

interface TaskChatMessageItemProps {
  message: MessageState
  busy: boolean
  /** 当前查看视角；提供后同身份消息在右侧，另一方在左侧 */
  viewerPerspective?: TaskChatPerspective
  /** 纯文本消息（无思考/工具）统一按气泡展示，用于工作台双身份对话 */
  plainTextBubbles?: boolean
  /** 对方消息平铺展示，不使用气泡背景/边框/阴影 */
  flatOppositeMessages?: boolean
  /** 当前用户是否可回答该消息中的提问（任务详情与操作台的角色判断不同） */
  canReplyQuestion: (custom: TaskChatCustom) => boolean
  onReplyQuestion: (questionId: string, answers: string[][] | null) => Promise<void>
}

/** 单条任务对话：提问卡片 / 用户气泡 / 机器人思考 + 工具链 + Markdown */
export function TaskChatMessageItem({
  message,
  busy,
  viewerPerspective,
  plainTextBubbles = false,
  flatOppositeMessages = false,
  canReplyQuestion,
  onReplyQuestion,
}: TaskChatMessageItemProps) {
  const custom = taskChatCustomOf(message)
  const question = custom.question
  const perspective: TaskChatPerspective =
    custom.perspective ??
    (message.role === 'user' ? 'requester' : 'responsible')
  const alignRight = viewerPerspective
    ? perspective === viewerPerspective
    : message.role === 'user'
  const rawSender =
    custom.sender ??
    (message.role === 'user' ? FALLBACK_REQUESTER_SENDER : FALLBACK_SENDER)
  const sender: TaskChatSender = viewerPerspective
    ? {
        ...rawSender,
        roleLabel: perspective === 'requester' ? '需求方' : '执行方',
      }
    : rawSender
  if (question) {
    return (
      <QuestionBubble
        message={message}
        sender={sender}
        alignRight={alignRight}
        question={question}
        busy={busy}
        disabled={!canReplyQuestion(custom)}
        onReply={onReplyQuestion}
      />
    )
  }
  const hasText = message.content.some(
    (part) => part.type === 'text' && part.text?.trim(),
  )
  const hasRichContent = message.content.some(
    (part) =>
      part.type === 'tool-call' ||
      (part.type === 'reasoning' && part.text?.trim()),
  )
  const asPlainBubble =
    message.role === 'user' ||
    (plainTextBubbles &&
      hasText &&
      !hasRichContent &&
      message.status?.type !== 'running')
  const flat = flatOppositeMessages && !alignRight
  return asPlainBubble ? (
    <UserBubble
      message={message}
      sender={sender}
      alignRight={alignRight}
      flat={flat}
    />
  ) : (
    <AssistantBubble
      message={message}
      sender={sender}
      alignRight={alignRight}
      flat={flat}
    />
  )
}

function UserBubble({
  message,
  sender,
  alignRight,
  flat,
}: {
  message: MessageState
  sender: TaskChatSender
  alignRight: boolean
  flat: boolean
}) {
  return (
    <MessagePrimitive.Root
      className={`flex items-start gap-3 px-1 ${alignRight ? 'justify-end' : ''}`}
    >
      {!alignRight && (
        <WorkerAvatar sender={sender} size={30} className="mt-0.5" />
      )}
      <div
        className={`flex min-w-0 flex-col gap-1.5 ${
          alignRight
            ? 'max-w-[85%] items-end'
            : flat
              ? 'flex-1 items-start'
              : 'max-w-[85%] items-start'
        }`}
      >
        <SenderLine
          sender={sender}
          time={message.createdAt.toISOString()}
          align={alignRight ? 'right' : undefined}
        />
        <div
          className={
            flat
              ? 'min-w-0 max-w-full text-sm leading-relaxed text-foreground-emphasis'
              : `min-w-0 max-w-full rounded-[var(--radius-lg)] px-4 py-2.5 text-sm leading-relaxed shadow-sm ${
                  alignRight
                    ? 'rounded-tr-sm bg-primary text-primary-foreground'
                    : 'rounded-tl-sm border border-border bg-background-subtle text-foreground-emphasis'
                }`
          }
        >
          <MessagePrimitive.Parts
            components={
              alignRight ? CHAT_MARKDOWN_PARTS_ON_PRIMARY : CHAT_MARKDOWN_PARTS
            }
          />
        </div>
      </div>
      {alignRight && (
        <WorkerAvatar sender={sender} size={30} className="mt-0.5" />
      )}
    </MessagePrimitive.Root>
  )
}

function AssistantBubble({
  message,
  sender,
  alignRight,
  flat,
}: {
  message: MessageState
  sender: TaskChatSender
  alignRight: boolean
  flat: boolean
}) {
  const hasText = message.content.some(
    (part) => part.type === 'text' && part.text?.trim(),
  )
  const hasReasoning = message.content.some(
    (part) => part.type === 'reasoning' && part.text?.trim(),
  )
  const hasTools = message.content.some((part) => part.type === 'tool-call')
  const running = message.status?.type === 'running'

  return (
    <MessagePrimitive.Root
      className={`flex gap-3 px-1 ${alignRight ? 'justify-end' : ''}`}
    >
      {!alignRight && <WorkerAvatar sender={sender} size={32} className="mt-0.5" />}
      <div
        className={`flex min-w-0 flex-col ${
          alignRight ? 'max-w-[85%] items-end' : 'flex-1 items-start'
        }`}
      >
        <div
          className={`mb-1.5 flex flex-wrap items-center gap-2 ${
            alignRight ? 'justify-end' : ''
          }`}
        >
          <SenderLine
            sender={sender}
            time={message.createdAt.toISOString()}
            align={alignRight ? 'right' : undefined}
          />
          {running && (
            <span className="inline-flex items-center gap-1 text-[11px] text-info-foreground">
              <span className="size-1.5 animate-pulse rounded-full bg-info-emphasis" />
              正在执行
            </span>
          )}
        </div>

        {hasText || hasReasoning || hasTools ? (
          <div
            className={
              flat
                ? 'max-w-full text-sm leading-relaxed text-foreground-emphasis'
                : 'max-w-full rounded-[var(--radius-lg)] rounded-tl-sm border border-border bg-background-subtle px-4 py-3 text-sm leading-relaxed shadow-sm'
            }
          >
            <ChatAssistantParts />
            {running && hasText && <StreamingCaret />}
          </div>
        ) : (
          running && (
            <div
              className={
                flat
                  ? 'inline-flex items-center gap-2 px-1 py-1 text-xs text-foreground-muted'
                  : 'inline-flex items-center gap-2 rounded-[var(--radius-lg)] rounded-tl-sm border border-border bg-background-subtle px-3 py-2 text-xs text-foreground-muted'
              }
            >
              <span className="flex gap-1">
                <span className="size-1.5 animate-pulse rounded-full bg-foreground-subtle" />
                <span className="size-1.5 animate-pulse rounded-full bg-foreground-subtle [animation-delay:150ms]" />
                <span className="size-1.5 animate-pulse rounded-full bg-foreground-subtle [animation-delay:300ms]" />
              </span>
              正在思考 / 调用工具…
            </div>
          )
        )}
      </div>
      {alignRight && <WorkerAvatar sender={sender} size={32} className="mt-0.5" />}
    </MessagePrimitive.Root>
  )
}

interface QuestionBubbleProps {
  message: MessageState
  sender: TaskChatSender
  alignRight: boolean
  question: TaskChatQuestion
  busy: boolean
  /** 仅允许答复时启用，其余状态均禁用 */
  disabled: boolean
  onReply: (questionId: string, answers: string[][] | null) => Promise<void>
}

/** 机器人提问卡片：多问题 + 选项 + 自由输入，提交后变成回执 */
function QuestionBubble({
  message,
  sender,
  alignRight,
  question,
  busy,
  disabled,
  onReply,
}: QuestionBubbleProps) {
  const custom = taskChatCustomOf(message)
  const autoAnswer = custom.autoAnswer
  return (
    <MessagePrimitive.Root
      className={`flex gap-3 px-1 ${alignRight ? 'justify-end' : ''}`}
    >
      {!alignRight && <WorkerAvatar sender={sender} size={32} className="mt-0.5" />}
      <div
        className={`flex min-w-0 flex-col ${
          alignRight ? 'max-w-[85%] items-end' : 'flex-1 items-start'
        }`}
      >
        <div
          className={`mb-1.5 flex flex-wrap items-center gap-2 ${
            alignRight ? 'justify-end' : ''
          }`}
        >
          <SenderLine
            sender={sender}
            time={message.createdAt.toISOString()}
            align={alignRight ? 'right' : undefined}
          />
          <span className="inline-flex items-center gap-1 text-[11px] text-info-foreground">
            <MessageCircleQuestion className="size-3.5" />
            {questionStatusLabel(question)}
          </span>
          {question.state === 'pending' &&
            autoAnswer?.status === 'running' && (
              <span className="text-[11px] text-foreground-muted">
                父任务机器人
                {autoAnswer.parentAgentName
                  ? `「${autoAnswer.parentAgentName}」`
                  : ''}
                回答中…
              </span>
            )}
          {question.state === 'pending' &&
            autoAnswer?.status === 'failed' && (
              <span
                className="text-[11px] text-warning-foreground"
                title={autoAnswer.error}
              >
                父任务机器人答复失败，等待需求方回答
              </span>
            )}
        </div>

        <QuestionCard
          question={question}
          disabled={disabled}
          busy={busy}
          onReply={onReply}
        />
      </div>
      {alignRight && <WorkerAvatar sender={sender} size={32} className="mt-0.5" />}
    </MessagePrimitive.Root>
  )
}

function StreamingCaret() {
  return (
    <span className="ml-1 inline-block h-3.5 w-1 animate-pulse rounded-full bg-foreground-muted align-middle" />
  )
}
