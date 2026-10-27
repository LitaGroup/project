import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
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
import type {
  ReasoningMessagePart,
  TextMessagePart,
} from '@assistant-ui/react'
import { Button } from '@appica/ui-react/button'
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogClose,
} from '@appica/ui-react/alert-dialog'
import {
  CircleCheck,
  Loader,
  MessageCircleQuestion,
  Refresh,
  Send,
  X,
} from '@appica/icons-react'
import {
  api,
  type WorkerDebugMessage,
  type WorkerDebugOption,
  type WorkerDebugQuestion,
  type WorkerDebugSnapshot,
  type WorkerDebugTodo,
} from '../lib/api'
import { QuestionCard } from '../components/QuestionCard'
import { questionStatusLabel } from '../lib/question'
import { RobotAvatar } from '../components/task-detail/WorkerAvatar'
import {
  CHAT_MARKDOWN_PARTS,
  CHAT_PLAIN_PARTS,
} from '../components/agent-chat/ChatParts'

/**
 * 机器人调试：/tasks/workers/:workerId/debug，从机器人列表进入。
 * 同一用户 + 机器人复用一个 opencode 会话，支持真正的多轮上下文；
 * 对话经 SSE 实时流式推送（文本/思考/待办/终态），右侧面板展示 todowrite 待办。
 */
export function WorkerDebugPage() {
  const { workerId } = useParams<{ workerId: string }>()
  const id = Number(workerId)
  const valid = Number.isInteger(id) && id > 0
  const [snapshot, setSnapshot] = useState<WorkerDebugSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const loadSeq = useRef(0)

  // 初始快照：仅在尚无数据时生效（SSE 推送通常更快，避免旧 REST 响应覆盖新推送）
  useEffect(() => {
    if (!valid) return
    const seq = ++loadSeq.current
    // 切换机器人时立即清空旧会话，避免展示串台；后续 setState 均在异步回调中。
    // oxlint-disable-next-line react/set-state-in-effect
    setSnapshot(null)
    setError(null)
    api
      .getWorkerDebugSnapshot(id)
      .then((data) => {
        if (seq !== loadSeq.current) return
        setSnapshot((current) => current ?? data)
      })
      .catch((reason: Error) => {
        if (seq === loadSeq.current) setError(reason.message)
      })
    return () => {
      loadSeq.current += 1
    }
  }, [valid, id])

  // 调试会话 SSE：文本/思考/待办/终态实时推送（断线自动重连并重收快照），无定时轮询
  useEffect(() => {
    if (!valid) return
    const source = new EventSource(`/api/workers/${id}/debug/stream`)
    source.onopen = () => setError(null)
    source.onmessage = (event: MessageEvent<string>) => {
      let payload: { type?: string; snapshot?: WorkerDebugSnapshot }
      try {
        payload = JSON.parse(event.data) as typeof payload
      } catch {
        return
      }
      if (payload.type === 'snapshot' && payload.snapshot) {
        setError(null)
        setSnapshot(payload.snapshot)
      }
    }
    source.onerror = () => {
      // EventSource 自动重连；保留首个错误（如配置不完整），否则提示重连中
      setError((current) => current ?? '实时连接断开，正在重连…')
    }
    return () => source.close()
  }, [valid, id])

  const running = snapshot?.status === 'running'

  const send = useCallback(
    async (content: string) => {
      const text = content.trim()
      if (!valid || !text || running) return
      setError(null)
      try {
        const next = await api.sendWorkerDebugMessage(id, text)
        setSnapshot(next)
      } catch (reason) {
        setError((reason as Error).message)
        throw reason
      }
    },
    [running, valid, id],
  )

  /** 回答（answers）或跳过（null）机器人提问；提交后立即落到本地快照 */
  const replyQuestion = useCallback(
    async (questionId: string, answers: string[][] | null) => {
      if (!valid) return
      setSnapshot(
        await api.replyWorkerDebugQuestion(id, questionId, answers),
      )
    },
    [valid, id],
  )

  const [resetting, setResetting] = useState(false)
  const reset = useCallback(async () => {
    if (!valid || running) return
    setResetting(true)
    setError(null)
    try {
      setSnapshot(await api.resetWorkerDebug(id))
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setResetting(false)
    }
  }, [running, valid, id])

  if (!valid) {
    return (
      <p role="alert" className="text-sm text-foreground-muted">
        调试链接无效，请从
        <Link to="/tasks/workers" className="mx-1 underline">
          机器人列表
        </Link>
        进入
      </p>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {error && (
        <p
          role="alert"
          className="shrink-0 rounded-[var(--radius-md)] bg-error-soft px-3 py-2 text-sm text-error-foreground"
        >
          {error}
        </p>
      )}
      {!snapshot ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-sm text-foreground-muted">
          <Loader />
          {error ? '会话加载失败，请从机器人列表重新进入' : '加载调试会话…'}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <header className="flex shrink-0 items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-border bg-background px-4 py-2.5">
            <div className="flex min-w-0 items-center gap-2.5">
              <RobotAvatar
                name={snapshot.worker.name}
                avatarUrl={snapshot.worker.avatarUrl}
                size={28}
              />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground-intense">
                  {snapshot.worker.name}
                </p>
                <p className="truncate text-xs text-foreground-muted">
                  {snapshot.worker.executorName} · {snapshot.worker.providerId}/
                  {snapshot.worker.modelId}
                  {snapshot.sessionId
                    ? ` · 会话 ${snapshot.sessionId.slice(0, 8)}`
                    : ''}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {running && (
                <span className="text-xs text-foreground-muted">回复中…</span>
              )}
              <AlertDialog>
                <AlertDialogTrigger
                  render={
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={running || resetting || !snapshot.sessionId}
                    />
                  }
                >
                  <Refresh className="size-3.5" />
                  重置会话
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>重置调试会话</AlertDialogTitle>
                    <AlertDialogDescription>
                      将解绑当前 opencode
                      会话并清空平台保存的对话记录，下一条消息会创建新会话。opencode
                      侧的历史会话不会被删除。
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogClose>
                      <Button variant="outline" size="sm">
                        取消
                      </Button>
                    </AlertDialogClose>
                    <AlertDialogClose>
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={resetting}
                        onClick={reset}
                      >
                        {resetting ? '重置中…' : '确认重置'}
                      </Button>
                    </AlertDialogClose>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </header>
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-auto xl:grid-cols-[minmax(0,1fr)_320px] xl:overflow-hidden">
            <DebugChat
              key={workerId}
              snapshot={snapshot}
              running={running}
              onSend={send}
              onReplyQuestion={replyQuestion}
            />
            <TodoPanel todos={snapshot.todos ?? []} />
          </div>
        </div>
      )}
    </div>
  )
}

function DebugChat({
  snapshot,
  running,
  onSend,
  onReplyQuestion,
}: {
  snapshot: WorkerDebugSnapshot
  running: boolean
  onSend: (content: string) => Promise<void>
  onReplyQuestion: (questionId: string, answers: string[][] | null) => Promise<void>
}) {
  const onNew = useCallback(
    async (message: AppendMessage) => {
      const text = message.content
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('\n')
        .trim()
      if (text) await onSend(text)
    },
    [onSend],
  )
  const runtime = useExternalStoreRuntime<WorkerDebugMessage>({
    messages: snapshot.messages,
    convertMessage: toThreadMessage,
    onNew,
    isSendDisabled: running,
  })

  return (
    <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[var(--radius-lg)] border border-border bg-background">
      <AssistantRuntimeProvider runtime={runtime}>
        <ThreadPrimitive.Root className="flex min-h-0 flex-1 flex-col">
          <ThreadPrimitive.Viewport className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-5">
            {snapshot.messages.length === 0 && (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-sm text-foreground-muted">
                <RobotAvatar
                  name={snapshot.worker.name}
                  avatarUrl={snapshot.worker.avatarUrl}
                  size={48}
                />
                <p>发送第一条消息开始调试</p>
                <p className="text-xs">
                  首条消息沿用工作目录中的 AGENTS.md 与技能，后续消息使用当前会话
                </p>
              </div>
            )}
            <ThreadPrimitive.Messages>
              {({ message }) => {
                const question = customOf(message).question
                if (question) {
                  return (
                    <DebugQuestionBubble
                      question={question}
                      running={running}
                      worker={snapshot.worker}
                      onReply={onReplyQuestion}
                    />
                  )
                }
                return message.role === 'user' ? (
                  <UserMessage />
                ) : (
                  <AssistantMessage
                    running={message.status?.type === 'running'}
                    worker={snapshot.worker}
                  />
                )
              }}
            </ThreadPrimitive.Messages>
          </ThreadPrimitive.Viewport>
          <div className="shrink-0 border-t border-border bg-background p-3">
            <ComposerPrimitive.Root className="flex items-end gap-2 rounded-[var(--radius-md)] border border-border bg-background px-2 py-1.5 focus-within:border-border-strong">
              <ComposerPrimitive.Input
                rows={2}
                placeholder={
                  running ? '机器人正在回复…' : '输入调试消息，Enter 发送，Shift+Enter 换行…'
                }
                className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-foreground-muted"
              />
              <ComposerPrimitive.Send asChild>
                <Button size="icon-sm" aria-label="发送消息">
                  <Send className="size-4" />
                </Button>
              </ComposerPrimitive.Send>
            </ComposerPrimitive.Root>
          </div>
        </ThreadPrimitive.Root>
      </AssistantRuntimeProvider>
    </section>
  )
}

/** 右侧待办面板：最近一次 todowrite 的清单（只读，SSE 实时刷新） */
function TodoPanel({ todos }: { todos: WorkerDebugTodo[] }) {
  const completed = todos.filter((todo) => todo.status === 'completed').length
  return (
    <aside className="flex min-h-0 flex-col overflow-hidden rounded-[var(--radius-lg)] border border-border bg-background">
      <header className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
        <span className="text-sm font-medium">待办</span>
        <span className="text-xs text-foreground-muted">
          {completed}/{todos.length}
        </span>
      </header>
      {todos.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-4 text-center text-sm text-foreground-muted">
          暂无待办
        </div>
      ) : (
        <ul className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-3">
          {todos.map((todo, index) => (
            <TodoItem key={index} todo={todo} />
          ))}
        </ul>
      )}
    </aside>
  )
}

function TodoItem({ todo }: { todo: WorkerDebugTodo }) {
  return (
    <li className="flex items-start gap-2.5 px-1 py-1 text-sm leading-relaxed">
      <TodoStatusIcon status={todo.status} />
      <span className={todoTextStyle(todo.status)}>{todo.content}</span>
    </li>
  )
}

function TodoStatusIcon({ status }: { status: WorkerDebugTodo['status'] }) {
  if (status === 'completed') {
    return <CircleCheck className="mt-0.5 size-4 shrink-0 text-foreground-muted" />
  }
  if (status === 'cancelled') {
    return <X className="mt-0.5 size-4 shrink-0 text-foreground-muted" />
  }
  if (status === 'in_progress') {
    return (
      <span className="mt-1.5 inline-flex size-4 shrink-0 items-center justify-center">
        <span className="size-2 animate-pulse rounded-full bg-primary" />
      </span>
    )
  }
  return (
    <span className="mt-1.5 inline-flex size-4 shrink-0 items-center justify-center">
      <span className="size-2 rounded-full border border-border-strong" />
    </span>
  )
}

function todoTextStyle(status: WorkerDebugTodo['status']): string {
  if (status === 'in_progress') {
    return 'min-w-0 break-words font-medium text-foreground-intense'
  }
  if (status === 'completed' || status === 'cancelled') {
    return 'min-w-0 break-words text-foreground-muted line-through'
  }
  return 'min-w-0 break-words text-foreground-intense'
}

/** 思考（reasoning）分片：流式时默认展开，结束后折叠，可点击回看 */
interface ChatCustom {
  question?: WorkerDebugQuestion
}

function customOf(message: MessageState): ChatCustom {
  return (message.metadata.custom ?? {}) as ChatCustom
}

function toThreadMessage(message: WorkerDebugMessage): ThreadMessageLike {
  const status =
    message.role === 'assistant'
      ? message.status === 'running'
        ? ({ type: 'running' } as const)
        : message.status === 'error'
          ? ({ type: 'incomplete', reason: 'error' } as const)
          : ({ type: 'complete', reason: 'stop' } as const)
      : undefined
  const parts: Array<ReasoningMessagePart | TextMessagePart> = []
  if (message.reasoning?.trim()) {
    parts.push({
      type: 'reasoning',
      text: message.reasoning,
      ...(message.status === 'running'
        ? { status: { type: 'running' } as const }
        : {}),
    })
  }
  if (message.content) {
    parts.push({ type: 'text', text: message.content })
  }
  return {
    id: message.id,
    role: message.role,
    content: parts,
    createdAt: new Date(message.createdAt),
    status,
    metadata: {
      custom: {
        question: message.question,
      } satisfies ChatCustom,
    },
  }
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="flex justify-end px-1">
      <div className="min-w-0 max-w-[85%] rounded-[var(--radius-lg)] rounded-tr-sm bg-primary px-4 py-2.5 text-sm leading-relaxed text-primary-foreground shadow-sm">
        <MessagePrimitive.Parts components={CHAT_PLAIN_PARTS} />
      </div>
    </MessagePrimitive.Root>
  )
}

function AssistantMessage({
  running,
  worker,
}: {
  running: boolean
  worker: WorkerDebugOption
}) {
  return (
    <MessagePrimitive.Root className="flex gap-3 px-1">
      <RobotAvatar
        name={worker.name}
        avatarUrl={worker.avatarUrl}
        size={32}
        className="mt-1"
      />
      <div className="min-w-0 max-w-[88%] pt-1 text-sm leading-relaxed">
        <MessagePrimitive.Parts components={CHAT_MARKDOWN_PARTS} />
        {running && (
          <span className="ml-1 inline-block h-3.5 w-1 animate-pulse rounded-full bg-foreground-muted align-middle" />
        )}
      </div>
    </MessagePrimitive.Root>
  )
}

/** 机器人提问卡片：多问题 + 选项 + 自由输入，提交后变成回执（本轮结束后不可再答） */
function DebugQuestionBubble({
  question,
  running,
  worker,
  onReply,
}: {
  question: WorkerDebugQuestion
  running: boolean
  worker: WorkerDebugOption
  onReply: (questionId: string, answers: string[][] | null) => Promise<void>
}) {
  return (
    <MessagePrimitive.Root className="flex gap-3 px-1">
      <RobotAvatar
        name={worker.name}
        avatarUrl={worker.avatarUrl}
        size={32}
        className="mt-0.5"
      />
      <div className="min-w-0 max-w-[88%] pt-1 text-sm leading-relaxed">
        <div className="mb-1.5 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-foreground-muted">
            {worker.name}
          </span>
          <span className="inline-flex items-center gap-1 text-[11px] text-info-foreground">
            <MessageCircleQuestion className="size-3.5" />
            {questionStatusLabel(question, '等待回答（本轮已结束）')}
          </span>
        </div>
        <QuestionCard question={question} disabled={!running} onReply={onReply} />
      </div>
    </MessagePrimitive.Root>
  )
}
