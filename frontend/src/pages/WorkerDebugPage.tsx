import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
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
  Refresh,
  X,
} from '@appica/icons-react'
import {
  api,
  type WorkerDebugSnapshot,
  type WorkerDebugTodo,
} from '../lib/api'
import { visibleEventSource } from '../lib/event-source'
import { RobotAvatar } from '../components/task-detail/WorkerAvatar'
import { DebugChat } from '../components/agent-chat/DebugChat'

/**
 * 机器人调试：/admin/workers/:workerId/debug，从机器人列表进入。
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
    const source = visibleEventSource(`/api/workers/${id}/debug/stream`)
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
        <Link to="/admin/workers" className="mx-1 underline">
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
              emptyTitle="发送第一条消息开始调试"
              emptyHint="首条消息沿用工作目录中的 AGENTS.md 与技能，后续消息使用当前会话"
              placeholder={
                running
                  ? '机器人正在回复…'
                  : '输入调试消息，Enter 发送，Shift+Enter 换行…'
              }
            />
            <TodoPanel todos={snapshot.todos ?? []} />
          </div>
        </div>
      )}
    </div>
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
