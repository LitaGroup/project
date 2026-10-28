import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useExternalStoreRuntime,
  type AppendMessage,
  type MessageState,
  type ReasoningMessagePart,
  type TextMessagePart,
  type ThreadMessageLike,
} from '@assistant-ui/react'
import { Badge } from '@appica/ui-react/badge'
import { Button, buttonVariants } from '@appica/ui-react/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@appica/ui-react/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@appica/ui-react/select'
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
  type Worker,
} from '../../lib/api'
import { questionStatusLabel } from '../../lib/question'
import { QuestionCard } from '../QuestionCard'
import { SenderLine, WorkerAvatar } from './WorkerAvatar'
import {
  CHAT_MARKDOWN_PARTS,
  CHAT_PLAIN_PARTS,
} from '../agent-chat/ChatParts'

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
  onSendMessage: (content: string) => Promise<void>
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
  onSendMessage,
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
      await onSendMessage(text)
    },
    [onSendMessage],
  )

  const finished = task.status === '已结束'
  const robotRunning = messages.some(
    (message) => message.role === 'assistant' && message.status === 'running',
  )
  const runtime = useExternalStoreRuntime<TaskChatMessage>({
    messages,
    convertMessage: toThreadMessage,
    onNew,
    isSendDisabled: finished || busy || robotRunning,
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
  const currentAgentName = pipeline.find(
    (stage) => stage.task.id === task.id,
  )?.agent?.name

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
                return message.role === 'user' ? (
                  <UserBubble message={message} />
                ) : (
                  <AssistantBubble message={message} />
                )
              }}
            </ThreadPrimitive.Messages>

            <ThreadPrimitive.ViewportFooter className="sticky bottom-0 mt-auto bg-background pt-2">
              <ChatFooter
                task={task}
                agentName={currentAgentName}
                busy={busy}
                robotRunning={robotRunning}
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
  const content = message.content
  const parts: Array<ReasoningMessagePart | TextMessagePart> = []
  if (message.reasoning?.trim()) {
    parts.push({
      type: 'reasoning',
      text: message.reasoning,
      ...(message.status === 'running'
        ? { status: { type: 'running' as const } }
        : {}),
    })
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
        <div className="min-w-0 max-w-full rounded-[var(--radius-lg)] rounded-tr-sm bg-primary px-4 py-2.5 text-sm leading-relaxed text-primary-foreground shadow-sm">
          <MessagePrimitive.Parts components={CHAT_PLAIN_PARTS} />
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
  const hasReasoning = message.content.some(
    (part) => part.type === 'reasoning' && part.text?.trim(),
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

        {hasText || hasReasoning ? (
          <div className="rounded-[var(--radius-lg)] rounded-tl-sm border border-border bg-background-subtle px-4 py-3 text-sm leading-relaxed shadow-sm">
            <MessagePrimitive.Parts components={CHAT_MARKDOWN_PARTS} />
            {running && hasText && <StreamingCaret />}
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

/** 底部输入区：未结束任务均可发送消息，操作按钮统一位于输入框下方 */
function ChatFooter({
  task,
  agentName,
  busy,
  robotRunning,
  onAction,
}: {
  task: TaskPackage
  agentName?: string
  busy: boolean
  robotRunning: boolean
  onAction: (fn: (id: number) => Promise<unknown>) => void
}) {
  const finished = task.status === '已结束'
  const needsSupplement =
    task.subStatus === '待反馈' ||
    task.subStatus === '待识别' ||
    task.subStatus === '识别中'
  const placeholder = finished
    ? '任务已结束，不能继续对话'
    : robotRunning
      ? '机器人正在回复…'
      : task.subStatus === '待反馈'
      ? '补充资料或确认信息，发送后将重新识别任务…'
      : needsSupplement
        ? '补充任务需求，发送后将重新识别…'
        : task.subStatus === '待验收'
          ? '继续与机器人对话，发送后将重新进入执行…'
          : '继续与机器人对话，Enter 发送，Shift+Enter 换行…'
  const hint =
    task.subStatus === '执行中'
      ? '机器人正在执行，实时输出会同步到对话中'
      : task.subStatus === '识别中'
        ? '调度机器人正在识别任务，补充消息会重新排队识别'
        : task.subStatus === '待识别'
          ? '任务已进入队列，等待调度机器人识别'
          : task.subStatus === '待验收'
            ? '机器人已完成执行，可继续对话或完成验收'
            : task.subStatus === '完成'
              ? '任务已完成并验收'
              : task.subStatus === '取消'
                ? '任务已取消'
                : '等待用户补充任务信息'

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
          rows={2}
          disabled={finished || robotRunning}
          placeholder={placeholder}
          className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-1 py-1.5 text-sm outline-none placeholder:text-foreground-subtle disabled:cursor-not-allowed disabled:opacity-60"
        />
        <ComposerPrimitive.Send
          className={buttonVariants({ variant: 'primary', size: 'icon-sm' })}
          aria-label="发送消息"
          disabled={finished || robotRunning}
        >
          <Send className="size-4" />
        </ComposerPrimitive.Send>
      </ComposerPrimitive.Root>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2">
        <span className="min-w-0 flex-1 truncate text-[11px] text-foreground-muted">
          {hint}
        </span>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {task.subStatus === '执行中' && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => onAction((id) => api.interruptTask(id))}
            >
              中断
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={busy || finished}
            onClick={() => onAction((id) => api.cancelTask(id))}
          >
            取消
          </Button>
          {task.status === '已结束' && task.subStatus === '完成' && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy || robotRunning}
              onClick={() => onAction((id) => api.generateTaskHandoff(id))}
            >
              {robotRunning ? '复盘生成中…' : '重新生成复盘'}
            </Button>
          )}
          <AssignTaskDialog
            task={task}
            agentName={agentName}
            busy={busy}
            onAssign={(agentId) =>
              onAction((id) => api.assignTask(id, agentId))
            }
          />
          <Button
            size="sm"
            variant="primary"
            disabled={busy || task.subStatus !== '待验收'}
            onClick={() => onAction((id) => api.acceptTask(id))}
          >
            完成
          </Button>
        </div>
      </div>
    </div>
  )
}

/** 分配机器人弹窗：仅列出启用中的工作者 */
function AssignTaskDialog({
  task,
  agentName,
  busy,
  onAssign,
}: {
  task: TaskPackage
  agentName?: string
  busy: boolean
  onAssign: (agentId: number) => void
}) {
  const [open, setOpen] = useState(false)
  const [workers, setWorkers] = useState<Worker[]>([])
  const [agentId, setAgentId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) return
    setLoading(true)
    setError(null)
    setAgentId('')
  }

  useEffect(() => {
    if (!open) return
    api
      .listWorkers({ role: '工作者' })
      .then((list) =>
        setWorkers(
          list.filter(
            (worker) => worker.enabled && worker.id !== task.agentId,
          ),
        ),
      )
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [open, task.agentId])

  const items = Object.fromEntries(
    workers.map((worker) => [String(worker.id), worker.name]),
  )
  const submit = () => {
    const next = Number(agentId)
    if (!Number.isInteger(next) || next < 1) {
      setError('请选择机器人')
      return
    }
    if (next === task.agentId) {
      setError('请选择其他机器人')
      return
    }
    setOpen(false)
    onAssign(next)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button
            size="sm"
            variant="outline"
            disabled={busy || task.status === '已结束'}
          />
        }
      >
        分配
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>分配任务</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 px-6 pb-2 text-sm">
          <p className="text-foreground-muted">
            当前机器人：{agentName ?? (task.agentId ? `#${task.agentId}` : '未分配')}
          </p>
          <label className="flex flex-col gap-1">
            <span>分配给</span>
            <Select
              value={agentId || null}
              onValueChange={(value) =>
                setAgentId((value as string | null) ?? '')
              }
              items={items}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={loading ? '加载机器人…' : '选择机器人'}
                />
              </SelectTrigger>
              <SelectContent>
                {workers.map((worker) => (
                  <SelectItem key={worker.id} value={String(worker.id)}>
                    {worker.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          {workers.length === 0 && !loading && (
            <p className="text-xs text-foreground-muted">暂无启用中的工作者</p>
          )}
          <p className="text-xs text-foreground-muted">
            执行中的任务会先中断旧机器人再重新派发；待验收任务会重新执行。
          </p>
          {error && <p className="text-xs text-error-foreground">{error}</p>}
        </div>
        <DialogFooter>
          <Button size="sm" variant="outline" onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={busy || loading || !agentId}
            onClick={submit}
          >
            确认分配
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
