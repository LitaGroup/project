import { useEffect, useMemo, useRef } from 'react'
import { Badge } from '@appica/ui-react/badge'
import { MessageCircleQuestion } from '@appica/icons-react'
import type {
  TaskChatMessage,
  TaskChatQuestion,
} from '../../lib/api'
import { questionStatusLabel } from '../../lib/question'
import { ChatMarkdown } from '../ChatMarkdown'
import { SenderLine, WorkerAvatar } from './WorkerAvatar'

/** 任务详情「会话」Tab 的连接状态 */
export type TaskConversationConnection =
  | 'connecting'
  | 'live'
  | 'reconnecting'

/** 距离底部小于该值时仍视为停留在底部，实时内容继续跟随 */
const FOLLOW_BOTTOM_THRESHOLD = 24

/**
 * 任务详情「会话」：只读、实时展示多方交互内容。
 * 不渲染输入框、发送队列、操作按钮、工具调用和思考过程；
 * question 以普通时间线文本展示问题与回答结果，不使用交互式问答组件。
 */
export function TaskConversationView({
  taskId,
  messages,
  connection,
}: {
  taskId: number
  messages: TaskChatMessage[]
  connection: TaskConversationConnection
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  /** 用户停留在底部时跟随最新消息；向上翻阅后保留当前位置 */
  const followBottomRef = useRef(true)
  const visibleMessages = useMemo(
    () =>
      messages.filter((message) =>
        message.kind === 'question'
          ? true
          : Boolean(message.content?.trim()),
      ),
    [messages],
  )

  useEffect(() => {
    // 切换任务后重新定位到新任务的最新消息
    followBottomRef.current = true
  }, [taskId])

  useEffect(() => {
    const box = boxRef.current
    if (!box || !followBottomRef.current) return
    box.scrollTop = box.scrollHeight
  }, [visibleMessages])

  const handleScroll = () => {
    const box = boxRef.current
    if (!box) return
    followBottomRef.current =
      box.scrollHeight - box.scrollTop - box.clientHeight <=
      FOLLOW_BOTTOM_THRESHOLD
  }

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-[var(--radius-lg)] border border-border bg-background">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="text-sm font-semibold text-foreground-intense">
            任务会话
          </h2>
          <Badge variant="soft" size="sm">
            {visibleMessages.length} 条
          </Badge>
        </div>
        <span className="flex shrink-0 items-center gap-1.5 text-xs text-foreground-muted">
          <span
            className={`size-1.5 rounded-full ${
              connection === 'live'
                ? 'bg-success-emphasis'
                : connection === 'reconnecting'
                  ? 'bg-warning-emphasis'
                  : 'bg-foreground-subtle'
            }`}
          />
          {connection === 'live'
            ? '实时'
            : connection === 'reconnecting'
              ? '重连中…'
              : '连接中…'}
        </span>
      </header>

      <div
        ref={boxRef}
        onScroll={handleScroll}
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4"
      >
        {visibleMessages.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-center text-sm text-foreground-muted">
            暂无会话内容
          </div>
        ) : (
          visibleMessages.map((message) =>
            message.kind === 'question' && message.question ? (
              <QuestionTimeline
                key={message.id}
                message={message}
                question={message.question}
              />
            ) : (
              <ConversationMessage key={message.id} message={message} />
            ),
          )
        )}
      </div>
    </section>
  )
}

function ConversationMessage({ message }: { message: TaskChatMessage }) {
  const isUser = message.role === 'user'
  const running = message.status === 'running'
  return (
    <article
      className={`flex items-start gap-3 px-1 ${isUser ? 'flex-row-reverse' : ''}`}
    >
      <WorkerAvatar sender={message.sender} size={30} className="mt-0.5" />
      <div
        className={`flex min-w-0 flex-col gap-1.5 ${
          isUser ? 'max-w-[88%] items-end' : 'min-w-0 flex-1 items-start'
        }`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <SenderLine
            sender={message.sender}
            time={message.createdAt}
            align={isUser ? 'right' : 'left'}
          />
          {running && (
            <span className="inline-flex items-center gap-1 text-[11px] text-info-foreground">
              <span className="size-1.5 animate-pulse rounded-full bg-info-emphasis" />
              实时输出中
            </span>
          )}
        </div>
        <div
          className={`min-w-0 max-w-full text-sm leading-relaxed ${
            isUser
              ? 'rounded-[var(--radius-lg)] rounded-tr-sm bg-primary px-4 py-2.5 text-primary-foreground'
              : 'task-chat-markdown text-foreground-emphasis'
          }`}
        >
          {isUser ? (
            <ChatMarkdown text={message.content} onPrimary />
          ) : (
            <>
              <ChatMarkdown text={message.content} />
              {running && (
                <span className="ml-1 inline-block h-3.5 w-1 animate-pulse rounded-full bg-foreground-muted align-middle" />
              )}
            </>
          )}
        </div>
      </div>
    </article>
  )
}

function QuestionTimeline({
  message,
  question,
}: {
  message: TaskChatMessage
  question: TaskChatQuestion
}) {
  return (
    <article className="flex items-start gap-3 px-1">
      <WorkerAvatar sender={message.sender} size={30} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex flex-wrap items-center gap-2">
          <SenderLine sender={message.sender} time={message.createdAt} />
          <span className="inline-flex items-center gap-1 text-[11px] text-info-foreground">
            <MessageCircleQuestion className="size-3.5" />
            提问 · {questionStatusLabel(question)}
          </span>
        </div>
        <div className="rounded-[var(--radius-lg)] rounded-tl-sm border border-border bg-background-subtle px-4 py-3 text-sm leading-relaxed">
          <div className="flex flex-col gap-2">
            {question.questions.map((item, index) => (
              <div key={`${item.header}-${index}`} className="flex flex-col gap-1">
                <p className="font-medium text-foreground-intense">
                  {index + 1}. {item.header}
                </p>
                <p className="whitespace-pre-wrap break-words text-foreground-emphasis">
                  {item.question}
                </p>
                {item.options && item.options.length > 0 && (
                  <ul className="flex flex-wrap gap-1.5 text-xs text-foreground-muted">
                    {item.options.map((option) => (
                      <li
                        key={option.label}
                        className="rounded-full bg-background-muted px-2 py-0.5"
                        title={option.description}
                      >
                        {option.label}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>

          <div className="mt-3 border-t border-border pt-2">
            {question.answers && question.answers.length > 0 ? (
              <div className="flex flex-col gap-1">
                <p className="text-xs font-medium text-success-foreground">
                  回答结果
                </p>
                {question.answers.map((answer, index) => (
                  <p
                    key={index}
                    className="whitespace-pre-wrap break-words text-sm text-foreground-emphasis"
                  >
                    {index + 1}. {answer.join(' / ')}
                  </p>
                ))}
              </div>
            ) : (
              <p className="text-xs text-foreground-muted">
                {question.state === 'rejected'
                  ? '已跳过回答。'
                  : question.state === 'cancelled'
                    ? '提问已失效。'
                    : question.state === 'answered'
                      ? '已回答。'
                      : '尚未回答；请在「信息」Tab 处理待回答问题。'}
              </p>
            )}
          </div>
        </div>
      </div>
    </article>
  )
}
