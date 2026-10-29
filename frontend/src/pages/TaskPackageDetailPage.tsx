import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Badge } from '@appica/ui-react/badge'
import { Button } from '@appica/ui-react/button'
import { Skeleton } from '@appica/ui-react/skeleton'
import {
  api,
  type TaskChatMessage,
  type TaskChatSnapshot,
  type TaskChatStreamMessage,
  type TaskPackage,
  type TaskPipelineStage,
  type TaskQueuedUserMessage,
} from '../lib/api'
import { TaskStatusBadge } from '../components/StatusBadge'
import { PageBreadcrumb } from '../components/PageBreadcrumb'
import { TaskChatPanel } from '../components/task-detail/TaskChatPanel'
import { TaskSidePanel } from '../components/task-detail/TaskSidePanel'
import { formatDuration, taskDurationMs } from '../lib/duration'

type ConnectionState = 'connecting' | 'live' | 'reconnecting'

/**
 * 任务详情：左侧 assistant-ui 对话（SSE 实时），右侧任务详情 / PIPELINE / 交付物。
 * PIPELINE 由主任务 + 子任务组成，每个阶段可能是不同的机器人。
 */
export function TaskPackageDetailPage() {
  const { id } = useParams<{ id: string }>()
  const taskId = Number(id)
  const [task, setTask] = useState<TaskPackage | null>(null)
  const [pipeline, setPipeline] = useState<TaskPipelineStage[]>([])
  const [messages, setMessages] = useState<TaskChatMessage[]>([])
  const [queuedMessages, setQueuedMessages] = useState<TaskQueuedUserMessage[]>(
    [],
  )
  const [requesterName, setRequesterName] = useState<string | null>(null)
  const [agentOwnerName, setAgentOwnerName] = useState<string | null>(null)
  const [interventionCount, setInterventionCount] = useState(0)
  const [events, setEvents] = useState<TaskChatSnapshot['events']>([])
  const [now, setNow] = useState(() => Date.now())
  const [connection, setConnection] = useState<ConnectionState>('connecting')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadSeq = useRef(0)
  /** 首次快照请求是否已返回（用于与 SSE ready 对齐，避免重复加载） */
  const initialSettledRef = useRef(false)
  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    setLoading(true)
    try {
      const data: TaskChatSnapshot = await api.getTaskChat(taskId)
      if (seq !== loadSeq.current) return
      setTask(data.task)
      setPipeline(data.pipeline)
      setMessages(data.messages)
      setQueuedMessages(data.queuedMessages ?? [])
      setRequesterName(data.requesterName)
      setAgentOwnerName(data.agentOwnerName)
      setInterventionCount(data.interventionCount)
      setEvents(data.events)
      setError(null)
    } catch (e) {
      if (seq === loadSeq.current) setError((e as Error).message)
    } finally {
      if (seq === loadSeq.current) {
        setLoading(false)
        initialSettledRef.current = true
      }
    }
  }, [taskId])

  const loadRef = useRef(load)
  useEffect(() => {
    loadRef.current = load
  }, [load])

  useEffect(() => {
    // 首次拉取任务对话；setState 均在 fetch 完成后的异步回调里触发，非同步级联
    initialSettledRef.current = false
    // oxlint-disable-next-line react/set-state-in-effect
    void load()
  }, [load])

  // 持续时间展示：未结束任务定时刷新
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000)
    return () => window.clearInterval(timer)
  }, [])

  // 任务聊天 SSE：机器人文本增量 / 工具调用 / PIPELINE 阶段变化 / 快照刷新信号
  useEffect(() => {
    let closed = false
    let refreshTimer: number | undefined
    const source = new EventSource(`/api/tasks/${taskId}/chat/stream`)

    source.onopen = () => {
      if (!closed) setConnection('live')
    }
    source.onmessage = (event: MessageEvent<string>) => {
      if (closed) return
      let data: TaskChatStreamMessage
      try {
        data = JSON.parse(event.data) as TaskChatStreamMessage
      } catch {
        return
      }
      switch (data.type) {
        case 'ready':
          setConnection('live')
          // 首次快照请求已先于 SSE 就绪完成 → 补一次对齐，覆盖订阅建立前的间隙；
          // 请求仍在途则跳过（避免进入页面重复加载），活跃任务的事件会经 refresh 持续补偿
          if (initialSettledRef.current) void loadRef.current()
          break
        case 'message.upsert':
          setMessages((current) => upsertMessage(current, data.message))
          break
        case 'queue.upsert':
          if (data.message.taskId === taskId) {
            setQueuedMessages((current) =>
              upsertQueuedMessage(current, data.message),
            )
          }
          break
        case 'queue.delete':
          setQueuedMessages((current) =>
            current.filter((message) => !data.ids.includes(message.id)),
          )
          break
        case 'stage.upsert':
          setPipeline((current) => upsertStage(current, data.stage))
          setTask((current) =>
            current?.id === data.stage.task.id ? data.stage.task : current,
          )
          break
        case 'stage.delete':
          setPipeline((current) =>
            current.filter((stage) => !data.ids.includes(stage.task.id)),
          )
          break
        case 'refresh':
          if (refreshTimer) window.clearTimeout(refreshTimer)
          refreshTimer = window.setTimeout(() => {
            refreshTimer = undefined
            void loadRef.current()
          }, 120)
          break
        default:
          // ping 仅保活
          break
      }
    }
    source.onerror = () => {
      if (!closed) setConnection('reconnecting')
    }

    return () => {
      closed = true
      source.close()
      if (refreshTimer) window.clearTimeout(refreshTimer)
    }
  }, [taskId])

  const sendMessage = useCallback(
    async (content: string) => {
      const text = content.trim()
      if (!text) return
      setBusy(true)
      setError(null)
      try {
        await api.sendTaskMessage(taskId, text)
        await loadRef.current()
      } catch (e) {
        setError((e as Error).message)
        throw e
      } finally {
        setBusy(false)
      }
    },
    [taskId],
  )

  const act = useCallback(
    (fn: (id: number) => Promise<unknown>) => {
      setBusy(true)
      setError(null)
      fn(taskId)
        .then(() => loadRef.current())
        .catch((e: Error) => setError(e.message))
        .finally(() => setBusy(false))
    },
    [taskId],
  )

  /** 回答/跳过提问：待反馈走 project 答复，历史会话兼容 opencode reply/reject */
  const replyQuestion = useCallback(
    async (questionId: string, answers: string[][] | null) => {
      setBusy(true)
      setError(null)
      try {
        await api.replyTaskQuestion(
          taskId,
          questionId,
          answers ? { answers } : { reject: true },
        )
        setMessages((current) =>
          current.map((message) => {
            const question = message.question
            if (!question || question.id !== questionId) return message
            return {
              ...message,
              status: 'complete',
              question: {
                ...question,
                state: answers ? ('answered' as const) : ('rejected' as const),
                answers: answers ?? undefined,
              },
            }
          }),
        )
      } catch (e) {
        setError((e as Error).message)
        throw e
      } finally {
        setBusy(false)
      }
    },
    [taskId],
  )

  const currentTask = task?.id === taskId ? task : null

  // 初始加载失败（没有任何数据）：页面内错误 + 重试
  if (!currentTask && !loading && error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-sm text-error-foreground">加载失败：{error}</p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setLoading(true)
            void load()
          }}
        >
          重试
        </Button>
      </div>
    )
  }
  // 首屏骨架：立即渲染页面结构（面包屑/标题/左右面板占位），快照返回后就地填充
  if (!currentTask) {
    return <TaskDetailSkeleton />
  }

  const durationMs = taskDurationMs(currentTask, now)

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <PageBreadcrumb
        items={[
          { label: '任务', to: '/tasks/list' },
          { label: currentTask.title },
        ]}
      />

      <header className="shrink-0">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-xl font-semibold text-foreground-intense">
              {currentTask.code} {currentTask.title}
            </h1>
            <TaskStatusBadge
              status={currentTask.status}
              subStatus={currentTask.subStatus}
              showMain
            />
            <Badge variant="soft" size="sm">
              类型 · {currentTask.type}
            </Badge>
            <Badge variant="secondary" size="sm">
              定义 · {currentTask.templateName ?? '未设置'}
            </Badge>
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-foreground-muted">
            <span>
              创建于 {new Date(currentTask.createdAt).toLocaleString()}
            </span>
            <span>·</span>
            <span>
              {currentTask.status === '已结束' ? '持续时间' : '已运行'}{' '}
              {formatDuration(durationMs)}
            </span>
            <span>·</span>
            <span>人工介入 {interventionCount} 次</span>
          </p>
        </div>
      </header>

      {error && (
        <p
          role="alert"
          className="shrink-0 rounded-[var(--radius-md)] bg-error-soft px-3 py-2 text-sm text-error-foreground"
        >
          {error}
        </p>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-auto xl:grid-cols-[minmax(0,1fr)_420px] xl:overflow-hidden">
        <TaskChatPanel
          key={taskId}
          task={currentTask}
          pipeline={pipeline}
          messages={messages}
          queuedMessages={queuedMessages}
          connection={connection}
          busy={busy}
          onSendMessage={sendMessage}
          onReplyQuestion={replyQuestion}
          onAction={act}
        />
        <TaskSidePanel
          key={taskId}
          task={currentTask}
          agentName={
            pipeline.find((stage) => stage.task.id === currentTask.id)?.agent
              ?.name
          }
          requesterName={requesterName}
          agentOwnerName={agentOwnerName}
          interventionCount={interventionCount}
          durationMs={durationMs}
          events={events}
        />
      </div>
    </div>
  )
}

function upsertMessage(
  current: TaskChatMessage[],
  message: TaskChatMessage,
): TaskChatMessage[] {
  const index = current.findIndex((item) => item.id === message.id)
  if (index < 0) {
    return [...current, message].sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    )
  }
  const next = current.slice()
  next[index] = message
  return next
}

function upsertQueuedMessage(
  current: TaskQueuedUserMessage[],
  message: TaskQueuedUserMessage,
): TaskQueuedUserMessage[] {
  const index = current.findIndex((item) => item.id === message.id)
  if (index < 0) return [...current, message]
  const next = current.slice()
  next[index] = message
  return next
}

function upsertStage(
  current: TaskPipelineStage[],
  stage: TaskPipelineStage,
): TaskPipelineStage[] {
  const index = current.findIndex((item) => item.task.id === stage.task.id)
  if (index < 0) {
    return [...current, stage].sort(
      (a, b) =>
        a.task.sortOrder - b.task.sortOrder || a.task.id - b.task.id,
    )
  }
  const next = current.slice()
  next[index] = stage
  return next
}

/**
 * 首屏骨架：镜像真实页面布局（面包屑 + 标题区 + 左对话右面板占位），
 * 快照返回后就地填充，避免整页空白等待与明显布局跳动。
 */
function TaskDetailSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <PageBreadcrumb
        items={[{ label: '任务', to: '/tasks/list' }, { label: '加载中' }]}
      />
      <header className="shrink-0 space-y-2">
        <div className="flex items-center gap-2">
          <Skeleton className="h-7 w-72 max-w-full" />
          <Skeleton className="h-5 w-24 rounded-full" />
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
        <Skeleton className="h-4 w-[28rem] max-w-full" />
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-auto xl:grid-cols-[minmax(0,1fr)_420px] xl:overflow-hidden">
        <section className="flex min-h-[60vh] min-w-0 flex-col overflow-hidden rounded-[var(--radius-lg)] border border-border bg-background xl:min-h-0">
          <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
            <Skeleton className="size-2 rounded-full" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
          <div className="flex flex-1 flex-col justify-end gap-4 px-4 py-4">
            <ChatBubbleSkeleton />
            <ChatBubbleSkeleton align="right" />
            <ChatBubbleSkeleton />
          </div>
        </section>

        <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
          <section className="space-y-3 rounded-[var(--radius-lg)] border border-border bg-background p-4">
            <Skeleton className="h-5 w-24 rounded-full" />
            <div className="grid grid-cols-2 gap-x-3 gap-y-2">
              {Array.from({ length: 8 }, (_, index) => (
                <Skeleton key={index} className="h-3 w-full" />
              ))}
            </div>
          </section>
          <section className="space-y-3 rounded-[var(--radius-lg)] border border-border bg-background p-4">
            <Skeleton className="h-5 w-24 rounded-full" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
            <Skeleton className="h-3 w-4/6" />
          </section>
        </aside>
      </div>
    </div>
  )
}

function ChatBubbleSkeleton({ align = 'left' }: { align?: 'left' | 'right' }) {
  return (
    <div
      className={`flex items-start gap-2.5 ${align === 'right' ? 'flex-row-reverse' : ''}`}
    >
      <Skeleton className="size-8 shrink-0 rounded-full" />
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-3 w-full max-w-md" />
        <Skeleton className="h-3 w-2/3 max-w-xs" />
      </div>
    </div>
  )
}
