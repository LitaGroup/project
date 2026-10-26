import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useExternalStoreRuntime,
  type AppendMessage,
  type ThreadMessageLike,
} from '@assistant-ui/react'
import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown'
import remarkGfm from 'remark-gfm'
import { Badge } from '@appica/ui-react/badge'
import { Button } from '@appica/ui-react/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@appica/ui-react/select'
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@appica/ui-react/alert-dialog'
import { Loader } from '@appica/ui-react/loader'
import { Robot, Send, X } from '@appica/icons-react'
import {
  api,
  type WorkerDebugMessage,
  type WorkerDebugOption,
  type WorkerDebugSnapshot,
} from '../lib/api'
import { PageBreadcrumb } from '../components/PageBreadcrumb'

const MARKDOWN_PLUGINS = [remarkGfm]
const MARKDOWN_PARTS = { Text: DebugMarkdownText, Empty: () => null }
const PLAIN_PARTS = { Text: PlainText, Empty: () => null }

/** 机器人调试：同一机器人复用一个 opencode 会话，支持真正的多轮上下文。 */
export function WorkerDebugPage() {
  const [workers, setWorkers] = useState<WorkerDebugOption[]>([])
  const [workerId, setWorkerId] = useState('')
  const [snapshot, setSnapshot] = useState<WorkerDebugSnapshot | null>(null)
  const [loadingWorkers, setLoadingWorkers] = useState(true)
  const [loadingSession, setLoadingSession] = useState(false)
  const [actionBusy, setActionBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const loadSeq = useRef(0)

  useEffect(() => {
    let alive = true
    api
      .listWorkerDebugWorkers()
      .then((list) => {
        if (!alive) return
        setWorkers(list)
        if (list.length > 0) setWorkerId((current) => current || String(list[0].id))
      })
      .catch((reason: Error) => {
        if (alive) setError(reason.message)
      })
      .finally(() => {
        if (alive) setLoadingWorkers(false)
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    const seq = ++loadSeq.current
    if (!workerId) return
    // 切换机器人时立即清空旧会话，避免展示串台；后续 setState 均在异步回调中。
    // oxlint-disable-next-line react/set-state-in-effect
    setLoadingSession(true)
    setSnapshot(null)
    setError(null)
    api
      .getWorkerDebugSnapshot(Number(workerId))
      .then((data) => {
        if (seq === loadSeq.current) setSnapshot(data)
      })
      .catch((reason: Error) => {
        if (seq === loadSeq.current) setError(reason.message)
      })
      .finally(() => {
        if (seq === loadSeq.current) setLoadingSession(false)
      })
    return () => {
      loadSeq.current += 1
    }
  }, [workerId])

  // 仅执行中轮询，空闲页面不产生持续请求。
  useEffect(() => {
    if (!workerId || snapshot?.status !== 'running') return
    let alive = true
    const timer = window.setInterval(() => {
      api
        .getWorkerDebugSnapshot(Number(workerId))
        .then((data) => {
          if (alive) setSnapshot(data)
        })
        .catch((reason: Error) => {
          if (alive) setError(reason.message)
        })
    }, 1000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [workerId, snapshot?.status])

  const running = snapshot?.status === 'running'

  const send = useCallback(
    async (content: string) => {
      const text = content.trim()
      if (!workerId || !text || running || actionBusy) return
      setError(null)
      try {
        const next = await api.sendWorkerDebugMessage(Number(workerId), text)
        setSnapshot(next)
      } catch (reason) {
        setError((reason as Error).message)
        throw reason
      }
    },
    [actionBusy, running, workerId],
  )

  const interrupt = async () => {
    if (!workerId || actionBusy) return
    setActionBusy(true)
    setError(null)
    try {
      setSnapshot(await api.interruptWorkerDebug(Number(workerId)))
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setActionBusy(false)
    }
  }

  const reset = async () => {
    if (!workerId || actionBusy) return
    setActionBusy(true)
    setError(null)
    try {
      setSnapshot(await api.resetWorkerDebug(Number(workerId)))
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setActionBusy(false)
    }
  }

  const selectedWorker =
    workers.find((worker) => String(worker.id) === workerId) ?? snapshot?.worker

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <PageBreadcrumb items={[{ label: '机器人调试' }]} />
      <header className="flex shrink-0 flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">机器人调试</h1>
          <p className="mt-1 text-sm text-foreground-muted">
            直接验证角色 PROMPT 与技能；多轮消息共享同一 opencode 会话，不创建任务记录
          </p>
        </div>
        <div className="flex items-center gap-2">
          {running && (
            <Button
              variant="outline"
              size="sm"
              disabled={actionBusy}
              onClick={() => void interrupt()}
            >
              <X className="size-4" />
              中断回复
            </Button>
          )}
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!workerId || actionBusy || loadingSession}
                />
              }
            >
              重置会话
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>重置调试会话</AlertDialogTitle>
                <AlertDialogDescription>
                  将清空当前对话并解绑 opencode 会话；正在执行的回复会被中断。下一条消息会重新注入机器人角色与技能。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogClose>
                  <Button variant="outline" size="sm">
                    取消
                  </Button>
                </AlertDialogClose>
                <AlertDialogClose>
                  <Button size="sm" onClick={() => void reset()}>
                    确认重置
                  </Button>
                </AlertDialogClose>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </header>

      <div className="flex shrink-0 flex-wrap items-center gap-3 rounded-[var(--radius-lg)] border border-border bg-background px-4 py-3">
        <span className="shrink-0 text-sm font-medium">调试机器人</span>
        <Select
          value={workerId}
          onValueChange={(value) => setWorkerId(String(value))}
          disabled={loadingWorkers || running}
          items={Object.fromEntries(
            workers.map((worker) => [
              String(worker.id),
              `${worker.name} · ${worker.modelId}`,
            ]),
          )}
        >
          <SelectTrigger className="w-72 max-w-full">
            <SelectValue placeholder="选择启用且配置完整的 Agent" />
          </SelectTrigger>
          <SelectContent>
            {workers.map((worker) => (
              <SelectItem key={worker.id} value={String(worker.id)}>
                {worker.name} · {worker.modelId}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedWorker && (
          <span className="min-w-0 truncate text-xs text-foreground-muted">
            {selectedWorker.executorName} · {selectedWorker.providerId}/{selectedWorker.modelId}
          </span>
        )}
        {snapshot?.sessionId && (
          <Badge variant="soft" size="sm" className="max-w-full font-mono">
            会话 {snapshot.sessionId}
          </Badge>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="shrink-0 rounded-[var(--radius-md)] bg-error-soft px-3 py-2 text-sm text-error-foreground"
        >
          {error}
        </p>
      )}

      {loadingWorkers ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-sm text-foreground-muted">
          <Loader /> 加载机器人…
        </div>
      ) : workers.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-[var(--radius-lg)] border border-border bg-background text-center">
          <Robot className="size-8 text-foreground-muted" />
          <p className="text-sm text-foreground-muted">
            暂无可调试机器人。需要 Agent 已启用，且执行器在线、供应商和模型配置完整。
          </p>
          <Button size="sm" variant="outline" render={<Link to="/tasks/workers" />}>
            前往配置机器人
          </Button>
        </div>
      ) : loadingSession || !snapshot ? (
        <div className="flex flex-1 items-center justify-center text-sm text-foreground-muted">
          {error ? '会话加载失败，请重新选择机器人重试' : '加载调试会话…'}
        </div>
      ) : (
        <DebugChat
          key={snapshot.worker.id}
          snapshot={snapshot}
          busy={actionBusy}
          onSend={send}
        />
      )}
    </div>
  )
}

function DebugChat({
  snapshot,
  busy,
  onSend,
}: {
  snapshot: WorkerDebugSnapshot
  busy: boolean
  onSend: (content: string) => Promise<void>
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
    isSendDisabled: snapshot.status === 'running' || busy,
  })

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[var(--radius-lg)] border border-border bg-background">
      <header className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Robot className="size-4" />
          <span className="text-sm font-medium">{snapshot.worker.name}</span>
          <Badge variant={snapshot.status === 'running' ? 'secondary' : 'soft'} size="sm">
            {snapshot.status === 'running' ? '正在回复' : '会话空闲'}
          </Badge>
        </div>
        <span className="text-xs text-foreground-muted">多轮上下文</span>
      </header>
      <AssistantRuntimeProvider runtime={runtime}>
        <ThreadPrimitive.Root className="flex min-h-0 flex-1 flex-col">
          <ThreadPrimitive.Viewport className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-5">
            {snapshot.messages.length === 0 && (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-sm text-foreground-muted">
                <span className="rounded-full bg-background-muted p-3">
                  <Robot className="size-6" />
                </span>
                <p>发送第一条消息开始调试</p>
                <p className="text-xs">首条消息自动附带角色 PROMPT 与技能，后续消息沿用当前会话</p>
              </div>
            )}
            <ThreadPrimitive.Messages>
              {({ message }) =>
                message.role === 'user' ? (
                  <UserMessage />
                ) : (
                  <AssistantMessage running={message.status?.type === 'running'} />
                )
              }
            </ThreadPrimitive.Messages>
          </ThreadPrimitive.Viewport>
          <div className="shrink-0 border-t border-border bg-background p-3">
            <ComposerPrimitive.Root className="flex items-end gap-2 rounded-[var(--radius-md)] border border-border bg-background px-2 py-1.5 focus-within:border-border-strong">
              <ComposerPrimitive.Input
                rows={2}
                placeholder={
                  snapshot.status === 'running'
                    ? '机器人正在回复，可点击右上角中断…'
                    : '输入调试消息，Enter 发送，Shift+Enter 换行…'
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

function toThreadMessage(message: WorkerDebugMessage): ThreadMessageLike {
  const status =
    message.role === 'assistant'
      ? message.status === 'running'
        ? ({ type: 'running' } as const)
        : message.status === 'error'
          ? ({ type: 'incomplete', reason: 'error' } as const)
          : ({ type: 'complete', reason: 'stop' } as const)
      : undefined
  return {
    id: message.id,
    role: message.role,
    content: message.content ? [{ type: 'text', text: message.content }] : [],
    createdAt: new Date(message.createdAt),
    status,
  }
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="flex justify-end px-1">
      <div className="max-w-[85%] rounded-[var(--radius-lg)] rounded-tr-sm bg-primary px-4 py-2.5 text-sm leading-relaxed text-primary-foreground shadow-sm">
        <MessagePrimitive.Parts components={PLAIN_PARTS} />
      </div>
    </MessagePrimitive.Root>
  )
}

function AssistantMessage({ running }: { running: boolean }) {
  return (
    <MessagePrimitive.Root className="flex gap-3 px-1">
      <span className="mt-1 shrink-0 rounded-full bg-background-muted p-2">
        <Robot className="size-4" />
      </span>
      <div className="min-w-0 max-w-[88%] rounded-[var(--radius-lg)] rounded-tl-sm border border-border bg-background-subtle px-4 py-3 text-sm leading-relaxed shadow-sm">
        <MessagePrimitive.Parts components={MARKDOWN_PARTS} />
        {running && (
          <span className="ml-1 inline-block h-3.5 w-1 animate-pulse rounded-full bg-foreground-muted align-middle" />
        )}
      </div>
    </MessagePrimitive.Root>
  )
}

function DebugMarkdownText() {
  return (
    <MarkdownTextPrimitive
      className="task-chat-markdown"
      smooth={false}
      defer
      remarkPlugins={MARKDOWN_PLUGINS}
    />
  )
}

function PlainText({ text }: { text?: string }) {
  return <span className="whitespace-pre-wrap break-words">{text}</span>
}
