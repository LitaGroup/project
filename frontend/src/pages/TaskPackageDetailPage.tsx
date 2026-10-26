import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Badge } from '@appica/ui-react/badge'
import { Button } from '@appica/ui-react/button'
import {
  api,
  type TaskChatMessage,
  type TaskChatSnapshot,
  type TaskChatStreamMessage,
  type TaskPackage,
  type TaskPipelineStage,
} from '../lib/api'
import { TaskStatusBadge } from '../components/StatusBadge'
import { PageBreadcrumb } from '../components/PageBreadcrumb'
import { TaskChatPanel } from '../components/task-detail/TaskChatPanel'
import { TaskSidePanel } from '../components/task-detail/TaskSidePanel'
import { useAuth } from '../context/AuthContext'

type ConnectionState = 'connecting' | 'live' | 'reconnecting'

/**
 * 任务详情：左侧 assistant-ui 对话（SSE 实时），右侧任务详情 / PIPELINE / 交付物。
 * PIPELINE 由主任务 + 子任务组成，每个阶段可能是不同的机器人。
 */
export function TaskPackageDetailPage() {
  const { id } = useParams<{ id: string }>()
  const taskId = Number(id)
  const { user } = useAuth()
  const [task, setTask] = useState<TaskPackage | null>(null)
  const [pipeline, setPipeline] = useState<TaskPipelineStage[]>([])
  const [messages, setMessages] = useState<TaskChatMessage[]>([])
  const [connection, setConnection] = useState<ConnectionState>('connecting')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadSeq = useRef(0)
  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    try {
      const data: TaskChatSnapshot = await api.getTaskChat(taskId)
      if (seq !== loadSeq.current) return
      setTask(data.task)
      setPipeline(data.pipeline)
      setMessages(data.messages)
      setError(null)
    } catch (e) {
      if (seq === loadSeq.current) setError((e as Error).message)
    } finally {
      if (seq === loadSeq.current) setLoading(false)
    }
  }, [taskId])

  const loadRef = useRef(load)
  useEffect(() => {
    loadRef.current = load
  }, [load])

  useEffect(() => {
    // 首次拉取任务对话；setState 均在 fetch 完成后的异步回调里触发，非同步级联
    // oxlint-disable-next-line react/set-state-in-effect
    void load()
  }, [load])

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
          // 连接建立后重新对齐一次快照，补齐 GET 与 SSE 订阅之间的间隙
          void loadRef.current()
          break
        case 'message.upsert':
          setMessages((current) => upsertMessage(current, data.message))
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

  const sendFeedback = useCallback(
    async (content: string) => {
      const text = content.trim()
      if (!text) return
      const optimistic: TaskChatMessage = {
        id: `local:${Date.now()}`,
        taskId,
        role: 'user',
        sender: {
          id: `user:${user?.name ?? 'me'}`,
          name: user?.name ?? '我',
          kind: 'user',
          roleLabel: '用户',
        },
        content: text,
        createdAt: new Date().toISOString(),
        status: 'complete',
        kind: 'message',
      }
      setMessages((current) => [...current, optimistic])
      setBusy(true)
      setError(null)
      try {
        await api.provideTaskFeedback(taskId, text)
        await loadRef.current()
      } catch (e) {
        setMessages((current) =>
          current.filter((message) => message.id !== optimistic.id),
        )
        setError((e as Error).message)
        throw e
      } finally {
        setBusy(false)
      }
    },
    [taskId, user?.name],
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

  if (loading && !task) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-foreground-muted">
        加载任务对话…
      </div>
    )
  }
  if (!task) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-sm text-error-foreground">
          加载失败：{error ?? '任务不存在'}
        </p>
        <Button size="sm" variant="outline" onClick={() => void load()}>
          重试
        </Button>
      </div>
    )
  }

  const currentTask = task.id === taskId ? task : null
  if (!currentTask) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p
          className={`text-sm ${error ? 'text-error-foreground' : 'text-foreground-muted'}`}
        >
          {error ? `加载失败：${error}` : '加载任务对话…'}
        </p>
        {error && (
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
        )}
      </div>
    )
  }

  const currentStage = pipeline.find((stage) => stage.task.id === currentTask.id)
  const robotNames = pipeline
    .map((stage) => stage.agent?.name)
    .filter((name): name is string => Boolean(name))

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <PageBreadcrumb
        items={[
          { label: '任务', to: '/tasks/list' },
          { label: currentTask.title },
        ]}
      />

      <header className="flex shrink-0 items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-xl font-semibold text-foreground-intense">
              {currentTask.code} {currentTask.title}
            </h1>
            <TaskStatusBadge
              status={currentTask.status}
              subStatus={currentTask.subStatus}
            />
            <Badge variant="soft" size="sm">
              {currentTask.type}
            </Badge>
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-foreground-muted">
            {robotNames.length > 0 ? (
              <span>{[...new Set(robotNames)].join(' · ')}</span>
            ) : (
              <span>等待分配机器人</span>
            )}
            <span>·</span>
            <span>
              PIPELINE {pipeline.length} 个阶段
              {currentStage?.scheduler
                ? ` · 调度机器人 ${currentStage.scheduler.name}`
                : ''}
            </span>
            <span>·</span>
            <span>
              创建于 {new Date(currentTask.createdAt).toLocaleString()}
            </span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Actions task={currentTask} busy={busy} act={act} />
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
          connection={connection}
          busy={busy}
          onSendFeedback={sendFeedback}
          onAction={act}
        />
        <TaskSidePanel key={taskId} task={currentTask} pipeline={pipeline} />
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

/** 按「主状态-子状态」渲染可执行动作 */
function Actions({
  task,
  busy,
  act,
}: {
  task: TaskPackage
  busy: boolean
  act: (fn: (id: number) => Promise<unknown>) => void
}) {
  const button = (
    label: string,
    fn: (id: number) => Promise<unknown>,
    variant: 'primary' | 'outline' | 'destructive' = 'outline',
  ) => (
    <Button
      size="sm"
      variant={variant}
      disabled={busy}
      onClick={() => act(fn)}
    >
      {label}
    </Button>
  )

  switch (task.subStatus) {
    case '待识别':
    case '识别中':
      return <>{button('取消', (id) => api.cancelTask(id), 'destructive')}</>
    case '待反馈':
      return <>{button('取消', (id) => api.cancelTask(id), 'destructive')}</>
    case '待验收':
      return (
        <>
          {button('验收通过', (id) => api.acceptTask(id), 'primary')}
          {button('取消', (id) => api.cancelTask(id), 'destructive')}
        </>
      )
    case '执行中':
      return (
        <>
          {button('中断', (id) => api.interruptTask(id))}
          {button('取消', (id) => api.cancelTask(id), 'destructive')}
        </>
      )
    default:
      return null
  }
}
