import { useCallback, useMemo } from 'react'
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useExternalStoreRuntime,
  type AppendMessage,
  type MessageState,
  type ThreadMessageLike,
} from '@assistant-ui/react'
import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown'
import remarkGfm from 'remark-gfm'
import { Badge } from '@appica/ui-react/badge'
import { buttonVariants } from '@appica/ui-react/button'
import {
  AlertCircle,
  Check,
  MessageCircleQuestion,
  Send,
  Wrench,
  X,
} from '@appica/icons-react'
import {
  api,
  type TaskChatMessage,
  type TaskChatQuestion,
  type TaskChatSender,
  type TaskChatTool,
  type TaskPackage,
  type TaskPipelineStage,
} from '../../lib/api'
import { questionStatusLabel } from '../../lib/question'
import { QuestionCard } from '../QuestionCard'
import { SenderLine, WorkerAvatar } from './WorkerAvatar'
import { MermaidDiagram } from '../MermaidDiagram'

const MARKDOWN_PLUGINS = [remarkGfm]
/** language-mermaid 代码块（如 flowchart TD）渲染为流程图 */
const MARKDOWN_COMPONENTS_BY_LANGUAGE = {
  mermaid: { SyntaxHighlighter: MermaidDiagram },
}

const FALLBACK_SENDER: TaskChatSender = {
  id: 'system',
  name: '系统',
  kind: 'system',
  roleLabel: '系统',
}

interface ChatCustom {
  sender?: TaskChatSender
  tools?: TaskChatTool[]
  question?: TaskChatQuestion
}

interface TaskChatPanelProps {
  task: TaskPackage
  pipeline: TaskPipelineStage[]
  messages: TaskChatMessage[]
  connection: 'connecting' | 'live' | 'reconnecting'
  busy: boolean
  onSendFeedback: (content: string) => Promise<void>
  /** 回答（answers）或跳过（null）机器人提问 */
  onReplyQuestion: (questionId: string, answers: string[][] | null) => Promise<void>
  onAction: (fn: (id: number) => Promise<unknown>) => void
}

/**
 * 任务详情页左侧对话面板：assistant-ui 渲染消息，SSE 增量由页面写入 messages。
 * 多个机器人完成同一 PIPELINE 时，各条消息按 sender 展示各自的头像与名称。
 */
export function TaskChatPanel({
  task,
  pipeline,
  messages,
  connection,
  busy,
  onSendFeedback,
  onReplyQuestion,
  onAction,
}: TaskChatPanelProps) {
  const onNew = useCallback(
    async (message: AppendMessage) => {
      const text = message.content
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('\n')
        .trim()
      if (!text) return
      await onSendFeedback(text)
    },
    [onSendFeedback],
  )

  const runtime = useExternalStoreRuntime<TaskChatMessage>({
    messages,
    convertMessage: toThreadMessage,
    onNew,
    isSendDisabled: task.subStatus !== '待反馈' || busy,
  })

  const robotCount = useMemo(
    () =>
      new Set(
        pipeline
          .map((stage) => stage.agent?.workerId)
          .filter((id): id is number => id !== undefined),
      ).size,
    [pipeline],
  )

  return (
    <section className="flex min-h-[60vh] min-w-0 flex-col overflow-hidden rounded-[var(--radius-lg)] border border-border bg-background xl:min-h-0">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <ConnectionDot state={connection} />
          <span className="truncate text-sm font-medium text-foreground-intense">
            任务对话
          </span>
          <Badge variant="soft" size="sm">
            {robotCount > 0 ? `${robotCount} 个机器人` : '等待分配'}
          </Badge>
        </div>
        <span className="shrink-0 text-xs text-foreground-muted">
          {connection === 'live'
            ? 'SSE 实时'
            : connection === 'reconnecting'
              ? '重连中…'
              : '连接中…'}
        </span>
      </header>

      <AssistantRuntimeProvider runtime={runtime}>
        <ThreadPrimitive.Root className="flex min-h-0 flex-1 flex-col">
          <ThreadPrimitive.Viewport className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
            {messages.length === 0 && (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-sm text-foreground-muted">
                <span className="rounded-full bg-background-muted p-3">
                  <Wrench className="size-5" />
                </span>
                <p>任务创建后，调度机器人与机器人的反馈会显示在这里</p>
              </div>
            )}
            <ThreadPrimitive.Messages>
              {({ message }) => {
                const question = customOf(message).question
                if (question) {
                  return (
                    <QuestionBubble
                      message={message}
                      question={question}
                      busy={busy}
                      disabled={task.subStatus !== '执行中'}
                      onReply={onReplyQuestion}
                    />
                  )
                }
                return message.role === 'system' ? (
                  <SystemEvent message={message} />
                ) : message.role === 'user' ? (
                  <UserBubble message={message} />
                ) : (
                  <AssistantBubble message={message} />
                )
              }}
            </ThreadPrimitive.Messages>

            <ThreadPrimitive.ViewportFooter className="sticky bottom-0 mt-auto bg-background pt-2">
              <ChatFooter
                task={task}
                busy={busy}
                onAction={onAction}
              />
            </ThreadPrimitive.ViewportFooter>
          </ThreadPrimitive.Viewport>
        </ThreadPrimitive.Root>
      </AssistantRuntimeProvider>
    </section>
  )
}

/** 任务 → assistant-ui 消息（sender 放在 metadata.custom，供多机器人头像展示） */
function toThreadMessage(message: TaskChatMessage): ThreadMessageLike {
  const status =
    message.role === 'assistant'
      ? message.status === 'running'
        ? ({ type: 'running' } as const)
        : message.status === 'error'
          ? ({ type: 'incomplete', reason: 'error' } as const)
          : ({ type: 'complete', reason: 'stop' } as const)
      : undefined
  const content =
    message.role === 'system' && !message.content.trim()
      ? ' '
      : message.content
  return {
    id: message.id,
    role: message.role,
    content: content ? [{ type: 'text', text: content }] : [],
    createdAt: new Date(message.createdAt),
    status,
    metadata: {
      custom: {
        sender: message.sender,
        tools: message.tools ?? [],
        question: message.question,
      } satisfies ChatCustom,
    },
  }
}

function customOf(message: MessageState): ChatCustom {
  return (message.metadata.custom ?? {}) as ChatCustom
}

const MARKDOWN_PARTS = {
  Text: ChatMarkdownText,
  Empty: () => null,
}

const PLAIN_PARTS = {
  Text: PlainText,
  Empty: () => null,
}

function ChatMarkdownText() {
  return (
    <MarkdownTextPrimitive
      className="task-chat-markdown"
      smooth={false}
      defer
      remarkPlugins={MARKDOWN_PLUGINS}
      componentsByLanguage={MARKDOWN_COMPONENTS_BY_LANGUAGE}
    />
  )
}

function PlainText({ text }: { text?: string }) {
  return <span className="whitespace-pre-wrap break-words">{text}</span>
}

function UserBubble({ message }: { message: MessageState }) {
  const sender = customOf(message).sender ?? {
    id: 'user',
    name: '用户',
    kind: 'user' as const,
    roleLabel: '用户',
  }
  return (
    <MessagePrimitive.Root className="flex justify-end gap-3 px-1">
      <div className="flex min-w-0 max-w-[85%] flex-col items-end gap-1.5">
        <SenderLine
          sender={sender}
          time={message.createdAt.toISOString()}
          align="right"
        />
        <div className="rounded-[var(--radius-lg)] rounded-tr-sm bg-primary px-4 py-2.5 text-sm leading-relaxed text-primary-foreground shadow-sm">
          <MessagePrimitive.Parts components={PLAIN_PARTS} />
        </div>
      </div>
      <WorkerAvatar sender={sender} size={30} className="mt-5" />
    </MessagePrimitive.Root>
  )
}

function AssistantBubble({ message }: { message: MessageState }) {
  const custom = customOf(message)
  const sender = custom.sender ?? FALLBACK_SENDER
  // question 工具由独立问答卡片展示，不在工具链里重复出现
  const tools = (custom.tools ?? []).filter((tool) => tool.name !== 'question')
  const hasText = message.content.some(
    (part) => part.type === 'text' && part.text?.trim(),
  )
  const running = message.status?.type === 'running'

  return (
    <MessagePrimitive.Root className="flex gap-3 px-1">
      <WorkerAvatar sender={sender} size={32} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex flex-wrap items-center gap-2">
          <SenderLine
            sender={sender}
            time={message.createdAt.toISOString()}
          />
          {running && (
            <span className="inline-flex items-center gap-1 text-[11px] text-info-foreground">
              <span className="size-1.5 animate-pulse rounded-full bg-info-emphasis" />
              正在执行
            </span>
          )}
        </div>

        {tools.length > 0 && <ToolList tools={tools} />}

        {hasText ? (
          <div className="rounded-[var(--radius-lg)] rounded-tl-sm border border-border bg-background-subtle px-4 py-3 text-sm leading-relaxed shadow-sm">
            <MessagePrimitive.Parts components={MARKDOWN_PARTS} />
            {running && <StreamingCaret />}
          </div>
        ) : (
          running && (
            <div className="inline-flex items-center gap-2 rounded-[var(--radius-lg)] rounded-tl-sm border border-border bg-background-subtle px-3 py-2 text-xs text-foreground-muted">
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
    </MessagePrimitive.Root>
  )
}

function SystemEvent({ message }: { message: MessageState }) {
  const sender = customOf(message).sender ?? FALLBACK_SENDER
  return (
    <MessagePrimitive.Root className="flex justify-center px-2">
      <div className="flex max-w-[92%] items-start gap-2 rounded-[var(--radius-md)] border border-border bg-background-subtle px-3 py-1.5 text-xs leading-relaxed text-foreground-muted">
        {sender.kind !== 'system' && (
          <span className="shrink-0 font-medium text-foreground-emphasis">
            {sender.name}
          </span>
        )}
        <span className="min-w-0 whitespace-pre-wrap break-words">
          <MessagePrimitive.Parts components={PLAIN_PARTS} />
        </span>
        <time className="shrink-0 pt-0.5 text-[10px] text-foreground-subtle">
          {message.createdAt.toLocaleTimeString()}
        </time>
      </div>
    </MessagePrimitive.Root>
  )
}

interface QuestionBubbleProps {
  message: MessageState
  question: TaskChatQuestion
  busy: boolean
  /** 任务已离开执行中（提问不可再答） */
  disabled: boolean
  onReply: (questionId: string, answers: string[][] | null) => Promise<void>
}

/** 机器人提问卡片：多问题 + 选项 + 自由输入，提交后变成回执 */
function QuestionBubble({
  message,
  question,
  busy,
  disabled,
  onReply,
}: QuestionBubbleProps) {
  const sender = customOf(message).sender ?? FALLBACK_SENDER
  return (
    <MessagePrimitive.Root className="flex gap-3 px-1">
      <WorkerAvatar sender={sender} size={32} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex flex-wrap items-center gap-2">
          <SenderLine sender={sender} time={message.createdAt.toISOString()} />
          <span className="inline-flex items-center gap-1 text-[11px] text-info-foreground">
            <MessageCircleQuestion className="size-3.5" />
            {questionStatusLabel(question)}
          </span>
        </div>

        <QuestionCard
          question={question}
          disabled={disabled}
          busy={busy}
          onReply={onReply}
        />
      </div>
    </MessagePrimitive.Root>
  )
}

function ToolList({ tools }: { tools: TaskChatTool[] }) {
  return (
    <div className="mb-2 flex flex-wrap gap-1.5">
      {tools.map((tool) => (
        <span
          key={tool.id}
          className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] ${
            tool.status === 'error'
              ? 'border-error-emphasis bg-error-soft text-error-foreground'
              : tool.status === 'success'
                ? 'border-border bg-background-subtle text-foreground-muted'
                : 'border-info-emphasis bg-info-soft text-info-foreground'
          }`}
          title={tool.detail}
        >
          <Wrench className="size-3 shrink-0" />
          <span className="max-w-48 truncate font-mono">{tool.name}</span>
          {tool.status === 'running' && (
            <span className="shrink-0 animate-pulse">运行中</span>
          )}
          {tool.status === 'success' && (
            <Check className="size-3 shrink-0" />
          )}
          {tool.status === 'error' && <X className="size-3 shrink-0" />}
        </span>
      ))}
    </div>
  )
}

function StreamingCaret() {
  return (
    <span className="ml-1 inline-block h-3.5 w-1 animate-pulse rounded-full bg-foreground-muted align-middle" />
  )
}

function ConnectionDot({
  state,
}: {
  state: 'connecting' | 'live' | 'reconnecting'
}) {
  const color =
    state === 'live'
      ? 'bg-success-emphasis'
      : state === 'reconnecting'
        ? 'bg-warning-emphasis'
        : 'bg-foreground-subtle'
  return (
    <span className="relative flex size-2 shrink-0">
      {state === 'live' && (
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-success-emphasis opacity-60 motion-reduce:hidden" />
      )}
      <span className={`relative inline-flex size-2 rounded-full ${color}`} />
    </span>
  )
}

/** 底部输入区：仅「待反馈」允许发送；其余状态按任务状态提供动作 */
function ChatFooter({
  task,
  busy,
  onAction,
}: {
  task: TaskPackage
  busy: boolean
  onAction: (fn: (id: number) => Promise<unknown>) => void
}) {
  if (task.subStatus === '待反馈') {
    return (
      <div className="rounded-[var(--radius-lg)] border border-border bg-background p-3 shadow-sm">
        {task.missingItems && task.missingItems.length > 0 && (
          <div className="mb-2 rounded-[var(--radius-md)] bg-warning-soft px-3 py-2 text-xs text-warning-foreground">
            <p className="mb-1 flex items-center gap-1.5 font-medium">
              <AlertCircle className="size-3.5" />
              待反馈事项（{task.missingItems.length}）
            </p>
            <ul className="flex max-h-24 list-disc flex-col gap-0.5 overflow-y-auto pl-4">
              {task.missingItems.map((item, index) => (
                <li key={index}>
                  {item.item}
                  {item.reason ? ` — ${item.reason}` : ''}
                </li>
              ))}
            </ul>
          </div>
        )}
        <ComposerPrimitive.Root className="flex items-end gap-2 rounded-[var(--radius-md)] border border-border bg-background px-2 py-1.5 focus-within:border-border-strong">
          <ComposerPrimitive.Input
            rows={1}
            placeholder="补充资料或确认信息，发送后将重新识别任务…"
            className="max-h-32 min-h-8 flex-1 resize-none bg-transparent px-1 py-1.5 text-sm outline-none placeholder:text-foreground-subtle"
          />
          <ComposerPrimitive.Send
            className={buttonVariants({ variant: 'primary', size: 'icon-sm' })}
            aria-label="发送反馈"
          >
            <Send className="size-4" />
          </ComposerPrimitive.Send>
        </ComposerPrimitive.Root>
        <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-foreground-muted">
          <span>Enter 发送，Shift+Enter 换行；反馈会追加到任务描述</span>
          <button
            type="button"
            className="shrink-0 underline underline-offset-2 disabled:opacity-50"
            disabled={busy}
            onClick={() => onAction((id) => api.submitTask(id))}
          >
            仅重新识别
          </button>
        </div>
        <p className="mt-1 text-[11px] text-foreground-subtle">
          已提醒 {task.remindCount ?? 0}/3 次
          {task.lastRemindedAt
            ? `，最近 ${new Date(task.lastRemindedAt).toLocaleString()}`
            : ''}
          ；3 次未处理将自动标记失败
        </p>
      </div>
    )
  }

  const hint =
    task.subStatus === '执行中'
      ? '机器人正在执行，实时输出会同步到对话中'
      : task.subStatus === '识别中'
        ? '调度机器人正在识别任务…'
        : task.subStatus === '待识别'
          ? '任务已进入队列，等待调度机器人识别…'
          : task.subStatus === '待验收'
            ? '机器人已完成执行，请验收交付物'
            : task.subStatus === '完成'
              ? '任务已完成并验收'
              : '任务已取消'

  return (
    <div className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-border bg-background-muted px-3 py-2 text-xs text-foreground-muted">
      <span className="min-w-0 truncate">{hint}</span>
      <div className="flex shrink-0 items-center gap-2">
        {task.subStatus === '执行中' && (
          <button
            type="button"
            className="underline underline-offset-2 disabled:opacity-50"
            disabled={busy}
            onClick={() => onAction((id) => api.interruptTask(id))}
          >
            中断
          </button>
        )}
        {task.subStatus === '待验收' && (
          <button
            type="button"
            className="font-medium text-success-foreground underline underline-offset-2 disabled:opacity-50"
            disabled={busy}
            onClick={() => onAction((id) => api.acceptTask(id))}
          >
            验收通过
          </button>
        )}
        {task.subStatus !== '完成' && task.subStatus !== '取消' && (
          <button
            type="button"
            className="text-error-foreground underline underline-offset-2 disabled:opacity-50"
            disabled={busy}
            onClick={() => onAction((id) => api.cancelTask(id))}
          >
            取消任务
          </button>
        )}
      </div>
    </div>
  )
}
