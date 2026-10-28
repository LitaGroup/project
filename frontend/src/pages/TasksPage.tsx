import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, m } from 'framer-motion'
import { BorderBeam } from '@appica/ui-react/border-beam'
import { buttonVariants } from '@appica/ui-react/button'
import { Input } from '@appica/ui-react/input'
import { Skeleton } from '@appica/ui-react/skeleton'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@appica/ui-react/select'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@appica/ui-react/table'
import { Toolbar, ToolbarInput } from '@appica/ui-react/toolbar'
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@appica/ui-react/tabs'
import {
  api,
  TASK_SUB_STATUSES,
  type TaskPackage,
  type TaskRealtimeMessage,
  type TaskSubStatus,
  type Worker,
} from '../lib/api'
import { TaskStatusBadge } from '../components/StatusBadge'
import { BorderGlow } from '../components/BorderGlow'
import { AgentActivity } from '../components/ai-ui/AgentActivity'
import { ActionSwapText, DigitSwap, TiltCard } from '../components/motion-ui'
import {
  boardCardTransition,
  boardCardVariants,
  boardDetailTransition,
} from '../lib/motion'

/** 看板三列：等待处理 / 执行中 / 等待验收 */
type BoardKey = 'waiting' | 'running' | 'review'
type BoardGroups = Record<BoardKey, TaskPackage[]>
type BoardConnection = 'connecting' | 'live' | 'reconnecting'

/** 合并单条任务快照并按更新时间倒序，保持与服务端列表顺序一致 */
function upsertTask(
  list: TaskPackage[] | null,
  task: TaskPackage,
): TaskPackage[] {
  const current = list ?? []
  const exists = current.some((item) => item.id === task.id)
  const next = exists
    ? current.map((item) => (item.id === task.id ? task : item))
    : [...current, task]
  return next.sort(
    (a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime() ||
      b.id - a.id,
  )
}

/** 实时输出增量只更新对应卡片，避免整表重新渲染 */
function appendTaskLine(
  list: TaskPackage[] | null,
  taskId: number,
  line: string,
): TaskPackage[] | null {
  if (!list) return list
  return list.map((task) =>
    task.id === taskId
      ? {
          ...task,
          liveLines: [...(task.liveLines ?? []), line].slice(-60),
        }
      : task,
  )
}

interface BoardColumn {
  key: BoardKey
  title: string
  hint: string
  subStatuses: TaskSubStatus[]
  /** 列头图标底色（角色 token） */
  iconClass: string
  /** 计数胶囊底色（角色 token） */
  countClass: string
  /** 进度条与状态点颜色（角色 token） */
  accentClass: string
  /** 流光颜色（角色 token 变量） */
  beamColor: string
  /** 空状态说明 */
  emptyText: string
  /** 顶部态势短标签 */
  metricLabel: string
}

const BOARD_COLUMNS: BoardColumn[] = [
  {
    key: 'waiting',
    title: '等待中的任务',
    hint: '待分配 / 待接受 / 待反馈 / 待继续',
    subStatuses: ['待分配', '待接受', '待反馈', '待继续'],
    iconClass: 'bg-warning-soft text-warning-foreground',
    countClass: 'bg-warning-soft text-warning-foreground',
    accentClass: 'bg-warning-emphasis',
    beamColor: 'var(--warning-emphasis)',
    emptyText: '新任务会在这里等待分配',
    metricLabel: '等待处理',
  },
  {
    key: 'running',
    title: '进行中的任务',
    hint: '执行中',
    subStatuses: ['执行中'],
    iconClass: 'bg-info-soft text-info-foreground',
    countClass: 'bg-info-soft text-info-foreground',
    accentClass: 'bg-info-emphasis',
    beamColor: 'var(--info-emphasis)',
    emptyText: '机器人开始执行后会出现在这里',
    metricLabel: '正在执行',
  },
  {
    key: 'review',
    title: '验收中的任务',
    hint: '等待人工验收',
    subStatuses: ['待验收'],
    iconClass: 'bg-success-soft text-success-foreground',
    countClass: 'bg-success-soft text-success-foreground',
    accentClass: 'bg-success-emphasis',
    beamColor: 'var(--success-emphasis)',
    emptyText: '执行完成的任务会进入这里',
    metricLabel: '等待验收',
  },
]

const BOARD_SUB_STATUSES = BOARD_COLUMNS.flatMap((c) => c.subStatuses)

/** 所有任务的时间筛选（按处理时间/更新时间） */
type TimeRangeKey = 'all' | 'today' | '3d' | '7d' | '30d'

const TIME_RANGES: Array<{ key: TimeRangeKey; label: string }> = [
  { key: 'all', label: '全部时间' },
  { key: 'today', label: '今天' },
  { key: '3d', label: '近 3 天' },
  { key: '7d', label: '近 7 天' },
  { key: '30d', label: '近 30 天' },
]

/** 时间范围起点（毫秒），all 返回 null */
function timeRangeStart(key: TimeRangeKey): number | null {
  if (key === 'all') return null
  if (key === 'today') {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    return start.getTime()
  }
  const days = key === '3d' ? 3 : key === '7d' ? 7 : 30
  return Date.now() - days * 86_400_000
}

/** 相对时间：刚刚 / n 分钟前 / n 小时前 / n 天前 */
function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(diff)) return '—'
  if (diff < 60_000) return '刚刚'
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`
  return new Date(iso).toLocaleDateString()
}

/** 处理时间短格式：MM-DD HH:mm */
function formatShort(iso: string): string {
  const date = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 任务清单页：进行任务（三列看板）+ 所有任务（可筛选列表） */
export function TasksPage() {
  const [tab, setTab] = useState<'board' | 'all'>('board')
  const [tasks, setTasks] = useState<TaskPackage[] | null>(null)
  const [workers, setWorkers] = useState<Worker[]>([])
  const [logs, setLogs] = useState<Record<number, string[]>>({})
  const [connection, setConnection] = useState<BoardConnection>('connecting')
  const [error, setError] = useState<string | null>(null)

  const logsRef = useRef<Record<number, string[]>>({})
  /** 日志对应的任务更新时间（变化后重新拉取事件兜底） */
  const logsStampRef = useRef<Record<number, string>>({})
  /** 正在拉取日志的任务（避免并发重复请求） */
  const pendingLogsRef = useRef<Set<number>>(new Set())

  // 看板数据走 SSE：连接后服务端先推全量快照，之后推任务/日志增量；
  // EventSource 断线会自动重连，重连后重新收到快照，无需定时兜底。
  useEffect(() => {
    let closed = false
    const source = new EventSource('/api/tasks/stream')

    source.onmessage = (event: MessageEvent<string>) => {
      if (closed) return
      try {
        const message = JSON.parse(event.data) as TaskRealtimeMessage
        if (message.type === 'snapshot') {
          setTasks(message.tasks)
          setConnection('live')
          setError(null)
          return
        }
        if (message.type === 'task.upsert') {
          setTasks((current) => upsertTask(current, message.task))
          setConnection('live')
          setError(null)
          return
        }
        if (message.type === 'task.line') {
          setTasks((current) =>
            appendTaskLine(current, message.taskId, message.line),
          )
          return
        }
        if (message.type === 'task.delete') {
          const ids = new Set(message.ids)
          setTasks((current) =>
            current ? current.filter((task) => !ids.has(task.id)) : current,
          )
        }
        // ping 仅用于保活，无需更新界面
      } catch {
        setError('实时数据解析失败，等待下一次推送')
      }
    }
    source.onerror = () => {
      if (!closed) setConnection('reconnecting')
    }

    return () => {
      closed = true
      source.close()
    }
  }, [])

  useEffect(() => {
    api
      .listWorkers({ role: '工作者' })
      .then(setWorkers)
      .catch(() => undefined)
  }, [])

  /** 拉取任务日志：执行中走列表附带的实时输出，其余取流转事件兜底 */
  const fetchLogs = useCallback(async (ids: number[]) => {
    const targets = ids.filter((id) => !pendingLogsRef.current.has(id))
    if (targets.length === 0) return
    for (const id of targets) pendingLogsRef.current.add(id)
    const batchSize = 4
    const next: Array<[number, string[]]> = []
    const stamps: Record<number, string> = {}
    try {
      for (let i = 0; i < targets.length; i += batchSize) {
        const batch = targets.slice(i, i + batchSize)
        const settled = await Promise.allSettled(
          batch.map((id) => api.getTaskPackage(id)),
        )
        settled.forEach((result, index) => {
          if (result.status !== 'fulfilled') return
          const task = result.value
          const events = (task.events ?? [])
            .slice()
            .reverse()
            .map((e) => e.content)
          next.push([batch[index], events])
          stamps[batch[index]] = task.updatedAt
        })
      }
    } finally {
      for (const id of targets) pendingLogsRef.current.delete(id)
    }
    if (next.length === 0) return
    logsRef.current = { ...logsRef.current, ...Object.fromEntries(next) }
    logsStampRef.current = { ...logsStampRef.current, ...stamps }
    setLogs({ ...logsRef.current })
  }, [])

  // 无实时输出的看板任务：拉一次详情取流转事件作为日志兜底
  useEffect(() => {
    if (!tasks) return
    const missing = tasks
      .filter(
        (t) =>
          BOARD_SUB_STATUSES.includes(t.subStatus) &&
          (t.liveLines?.length ?? 0) === 0 &&
          logsStampRef.current[t.id] !== t.updatedAt,
      )
      .map((t) => t.id)
    if (missing.length > 0) void fetchLogs(missing)
  }, [tasks, fetchLogs])

  const workerName = useMemo(
    () => new Map(workers.map((w) => [w.id, w.name])),
    [workers],
  )

  const boardTasks = useMemo<BoardGroups>(() => {
    const grouped: BoardGroups = {
      waiting: [],
      running: [],
      review: [],
    }
    for (const task of tasks ?? []) {
      const column = BOARD_COLUMNS.find((c) =>
        c.subStatuses.includes(task.subStatus),
      )
      if (column) grouped[column.key].push(task)
    }
    return grouped
  }, [tasks])

  return (
    <div className="tasks-page flex h-full flex-col gap-4">
      <div className="tasks-page-header flex shrink-0 items-center justify-between gap-4">
        <div>
          <h1 className="tasks-page-title text-2xl font-semibold">任务</h1>
          <p className="tasks-page-description mt-1 text-sm text-foreground-muted">
            任务由机器人执行、由人验收；LOOP 每秒推进，看板变更实时推送
          </p>
        </div>
        <Link
          to="/tasks/new"
          className={`tasks-page-create ${buttonVariants({ variant: 'outline', size: 'sm' })}`}
        >
          新建任务
        </Link>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-[var(--radius-md)] bg-error-soft px-3 py-2 text-sm text-error-foreground"
        >
          看板异常：{error}
        </p>
      )}

      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as 'board' | 'all')}
        variant="line"
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <TabsList className="tasks-page-tabs shrink-0">
          <TabsTrigger value="board">进行任务</TabsTrigger>
          <TabsTrigger value="all">所有任务</TabsTrigger>
        </TabsList>

        <TabsContent value="board" keepMounted className="min-h-0 flex-1 pt-4">
          <div className="tasks-board flex h-full min-h-0 flex-col gap-4">
            <TaskBoardOverview
              groups={boardTasks}
              connection={connection}
            />
            <div className="tasks-board-columns grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto pb-1 lg:grid-cols-3 lg:overflow-hidden">
              {BOARD_COLUMNS.map((column) => (
                <TaskBoardColumn
                  key={column.key}
                  column={column}
                  tasks={boardTasks[column.key]}
                  workerName={workerName}
                  logs={logs}
                  loading={tasks === null}
                />
              ))}
            </div>
          </div>
        </TabsContent>

        <TabsContent
          value="all"
          keepMounted
          className="min-h-0 flex-1 overflow-auto pt-4"
        >
          <AllTasksView tasks={tasks} workerName={workerName} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

/** 看板顶部态势：任务总量、阶段分布与实时连接状态 */
function TaskBoardOverview({
  groups,
  connection,
}: {
  groups: BoardGroups
  connection: BoardConnection
}) {
  const total = BOARD_COLUMNS.reduce(
    (sum, column) => sum + groups[column.key].length,
    0,
  )
  const connectionMeta =
    connection === 'live'
      ? {
          label: '实时',
          hint: '数据变更即时同步',
          badgeClass: 'bg-success-soft text-success-foreground',
          dotClass: 'bg-success-emphasis',
        }
      : connection === 'reconnecting'
        ? {
            label: '重连中',
            hint: '连接中断，正在自动重连',
            badgeClass: 'bg-warning-soft text-warning-foreground',
            dotClass: 'bg-warning-emphasis',
          }
        : {
            label: '连接中',
            hint: '正在建立实时连接',
            badgeClass: 'bg-info-soft text-info-foreground',
            dotClass: 'bg-info-emphasis',
          }

  return (
    <section className="task-board-overview shrink-0 overflow-hidden rounded-[var(--radius-lg)] border border-border bg-background">
      <div className="task-board-overview-content flex flex-wrap items-center justify-between gap-x-8 gap-y-3 px-4 pt-3.5 pb-3">
        <div className="flex min-w-52 flex-1 items-center gap-3">
          <span className="task-board-overview-icon flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-info-soft text-info-foreground">
            <ActivityIcon className="size-4.5" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-foreground-intense">
                实时任务态势
              </p>
              <span
                className={`task-board-connection flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${connectionMeta.badgeClass}`}
              >
                <span
                  className={`size-1.5 animate-pulse rounded-full ${connectionMeta.dotClass}`}
                />
                {connectionMeta.label}
              </span>
            </div>
            <p className="mt-0.5 truncate text-[11px] text-foreground-muted">
              {total > 0 ? `${total} 个任务正在流转` : '当前没有进行中的任务'}
              <span className="mx-1.5 text-foreground-subtle">·</span>
              {connectionMeta.hint}
            </p>
          </div>
        </div>

        <div className="task-board-metrics flex items-center gap-5 sm:gap-7">
          {BOARD_COLUMNS.map((column) => (
            <div key={column.key} className="task-board-metric min-w-14" data-state={column.key}>
              <p className="flex items-center gap-1.5 text-[11px] text-foreground-muted">
                <span
                  aria-hidden
                  className={`size-1.5 rounded-full ${column.accentClass}`}
                />
                {column.metricLabel}
              </p>
              <p className="task-board-metric-value mt-0.5 text-lg font-semibold text-foreground-intense">
                <AnimatedCount value={groups[column.key].length} />
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* 阶段分布：用一条连续的态势条呈现任务构成 */}
      <div
        aria-hidden
        className="task-board-distribution flex h-1 overflow-hidden bg-background-muted"
      >
        {total === 0 ? (
          <span className="h-full w-full bg-background-strong" />
        ) : (
          BOARD_COLUMNS.map((column) => {
            const count = groups[column.key].length
            if (count === 0) return null
            return (
              <m.span
                key={column.key}
                className={`h-full ${column.accentClass}`}
                initial={false}
                animate={{ width: `${(count / total) * 100}%` }}
                transition={boardDetailTransition}
              />
            )
          })
        )}
      </div>
    </section>
  )
}

/** 看板列：标题 + 计数 + 纵向卡片列表（列内独立滚动） */
function TaskBoardColumn({
  column,
  tasks,
  workerName,
  logs,
  loading,
}: {
  column: BoardColumn
  tasks: TaskPackage[]
  workerName: Map<number, string>
  logs: Record<number, string[]>
  loading: boolean
}) {
  return (
    <section data-state={column.key} className="task-board-column flex min-h-[18rem] flex-col overflow-hidden rounded-[var(--radius-lg)] border border-border bg-background-subtle lg:h-full lg:min-h-0">
      <div aria-hidden className={`task-board-column-accent h-0.5 shrink-0 ${column.accentClass}`} />
      <header className="task-board-column-header flex shrink-0 items-center justify-between gap-3 border-b border-border px-3.5 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className={`task-board-column-icon flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] ${column.iconClass}`}
          >
            <BoardStatusIcon kind={column.key} className="size-4" />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-medium text-foreground-intense">
              {column.title}
            </h2>
            <p className="truncate text-[11px] text-foreground-muted">
              {column.hint}
            </p>
          </div>
        </div>
        <span
          className={`task-board-column-count flex h-7 min-w-7 shrink-0 items-center justify-center rounded-full px-2 text-xs font-semibold ${column.countClass}`}
        >
          {tasks.length}
        </span>
      </header>

      <div className="task-board-column-list flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        {loading ? (
          <BoardColumnSkeleton />
        ) : (
          <>
            <AnimatePresence initial={false} mode="popLayout">
              {tasks.map((task) => (
                <TaskBoardCard
                  key={task.id}
                  task={task}
                  column={column}
                  robot={
                    task.agentId
                      ? (workerName.get(task.agentId) ?? `#${task.agentId}`)
                      : null
                  }
                  logs={
                    (task.liveLines?.length ?? 0) > 0
                      ? task.liveLines!
                      : (logs[task.id] ?? [])
                  }
                />
              ))}
            </AnimatePresence>
            {tasks.length === 0 && <BoardEmpty column={column} />}
          </>
        )}
      </div>
    </section>
  )
}

/** 顶部大号统计在入场与数值变化时翻滚，小计直接显示。 */
function AnimatedCount({ value }: { value: number }) {
  return <DigitSwap value={value} />
}

/** 列加载占位：保持与真实卡片接近的版式，避免加载完成时布局跳动 */
function BoardColumnSkeleton() {
  return (
    <>
      {[0, 1].map((item) => (
        <div
          key={item}
          className="task-board-skeleton rounded-[var(--radius-lg)] border border-border bg-background p-3.5"
        >
          <div className="flex items-center justify-between gap-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-5 w-12" />
          </div>
          <Skeleton className="mt-3 h-4 w-4/5" />
          <Skeleton className="mt-1.5 h-4 w-3/5" />
          <div className="mt-3 flex items-center justify-between border-t border-border pt-2.5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-3 w-12" />
          </div>
          <Skeleton className="mt-3 h-7 w-full" />
        </div>
      ))}
    </>
  )
}

/** 空列：保持纵向居中，给出下一步提示 */
function BoardEmpty({ column }: { column: BoardColumn }) {
  return (
    <div className="task-board-empty flex min-h-40 flex-1 flex-col items-center justify-center rounded-[var(--radius-lg)] border border-dashed border-border-strong bg-background/60 px-5 py-8 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-background-muted text-foreground-subtle">
        <BoardStatusIcon kind={column.key} className="size-5" />
      </span>
      <p className="mt-3 text-xs font-medium text-foreground-intense">
        暂无{column.title}
      </p>
      <p className="mt-1 text-[11px] text-foreground-muted">{column.emptyText}</p>
    </div>
  )
}

/**
 * 任务块：任务信息 + 最近日志。
 * 进行中的任务边框常驻流光；其余状态仅在 hover 时出现，避免看板持续闪烁。
 */
function TaskBoardCard({
  task,
  column,
  robot,
  logs,
}: {
  task: TaskPackage
  column: BoardColumn
  robot: string | null
  logs: string[]
}) {
  const running = column.key === 'running'

  return (
    <m.div
      layout
      variants={boardCardVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={boardCardTransition}
      whileHover={{ y: -2 }}
      className={`task-board-card group/card relative ${running ? 'task-board-card--running' : ''}`}
    >
      <TaskCardFrame taskId={task.id} running={running} beamColor={column.beamColor}>
        <article
          className={`task-board-card-surface overflow-hidden rounded-[var(--radius-lg)] border bg-background shadow-sm transition-[border-color,box-shadow] ${
            running
              ? 'border-info-emphasis/30'
              : 'border-border group-hover/card:border-border-strong'
          }`}
        >
          <Link to={`/tasks/${task.id}`} className="task-board-card-link block px-3.5 pt-3.5 pb-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-foreground-muted">
                <span className="shrink-0 font-mono text-[10px] font-medium tracking-wide text-foreground-subtle">
                  {task.code}
                </span>
                <span
                  aria-hidden
                  className="size-0.5 shrink-0 rounded-full bg-foreground-subtle"
                />
                <span className="truncate">{task.type}</span>
              </div>
              <span className="shrink-0">
                <TaskStatusBadge
                  status={task.status}
                  subStatus={task.subStatus}
                />
              </span>
            </div>

            <h3 className="task-board-card-title mt-2 line-clamp-2 min-h-10 text-sm font-medium leading-5 text-foreground-intense">
              {task.title}
            </h3>

            <div className="task-board-card-meta mt-2.5 flex items-center justify-between gap-2 border-t border-border pt-2.5 text-[11px] text-foreground-muted">
              <span
                className="flex min-w-0 items-center gap-1.5"
                title={robot ?? '未分配机器人'}
              >
                <RobotIcon className="size-3.5 shrink-0 text-foreground-subtle" />
                <span className="truncate">{robot ?? '未分配机器人'}</span>
              </span>
              <span
                className="flex shrink-0 items-center gap-1"
                title={new Date(task.updatedAt).toLocaleString()}
              >
                <ClockIcon className="size-3 text-foreground-subtle" />
                {formatRelative(task.updatedAt)}
              </span>
            </div>
          </Link>

          <TaskLogPreview
            taskId={task.id}
            lines={logs}
            accentClass={column.accentClass}
            running={running}
          />
        </article>
      </TaskCardFrame>
    </m.div>
  )
}

/** 只切换装饰外壳，任务内容与交互共用同一份子节点。 */
function TaskCardFrame({
  taskId,
  running,
  beamColor,
  children,
}: {
  taskId: number
  running: boolean
  beamColor: string
  children: ReactNode
}) {
  if (running) {
    return (
      <TiltCard>
        <BorderGlow animationSeed={taskId}>{children}</BorderGlow>
      </TiltCard>
    )
  }

  return (
    <TiltCard>
      <BorderBeam
        color={beamColor}
        length={16}
        thickness={1}
        speed={4}
        delay={-((taskId * 0.61803398875) % 1) * 4}
        revealOn="hover"
        className="rounded-[var(--radius-lg)]"
      >
        {children}
      </BorderBeam>
    </TiltCard>
  )
}

/** 最近日志：默认只显示最新一行，按需展开，避免卡片内持续滚动分散注意力 */
function TaskLogPreview({
  taskId,
  lines,
  accentClass,
  running,
}: {
  taskId: number
  lines: string[]
  accentClass: string
  running: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const recent = lines.slice(-8).reverse()
  const latest = recent[0]
  const canExpand = recent.length > 1
  const panelId = `task-log-${taskId}`

  return (
    <div className="task-board-card-log border-t border-border px-3.5 py-2">
      <button
        type="button"
        onClick={() => canExpand && setExpanded((value) => !value)}
        disabled={!canExpand}
        aria-expanded={canExpand ? expanded : undefined}
        aria-controls={canExpand ? panelId : undefined}
        className={`flex w-full items-center gap-2 rounded-[var(--radius-sm)] text-left focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none ${
          canExpand
            ? 'cursor-pointer hover:bg-background-muted'
            : 'cursor-default'
        }`}
      >
        {running ? (
          <AgentActivity animationSeed={taskId} className="task-log-activity shrink-0 text-info" />
        ) : (
          <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${accentClass}`} />
        )}
        <m.span
          key={latest ?? taskId}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...boardDetailTransition, delay: ((taskId * 0.61803398875) % 1) * 0.12 }}
          className="task-board-log-latest min-w-0 flex-1 truncate py-0.5 font-mono text-[11px] text-foreground-muted"
          title={latest ?? '暂无执行日志'}
        >
          {latest ?? '暂无执行日志'}
        </m.span>
        {canExpand && (
          <>
            <ActionSwapText swapKey={expanded ? 'expanded' : 'collapsed'} className="shrink-0 text-[10px] text-foreground-subtle">
              {expanded ? '收起' : `${recent.length} 行`}
            </ActionSwapText>
            <ChevronIcon
              className={`size-3 shrink-0 text-foreground-subtle transition-transform ${
                expanded ? 'rotate-180' : ''
              }`}
            />
          </>
        )}
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <m.div
            id={panelId}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={boardDetailTransition}
            className="overflow-hidden"
          >
            <div className="mt-2 flex flex-col gap-1 rounded-[var(--radius-md)] bg-background-muted px-2.5 py-2">
              {recent.map((line, index) => (
                <p
                  key={`${index}-${line}`}
                  className={`truncate font-mono text-[10px] leading-4 ${
                    index === 0
                      ? 'text-foreground-intense'
                      : 'text-foreground-muted'
                  }`}
                  title={line}
                >
                  <span aria-hidden className="mr-1.5 text-foreground-subtle">
                    ›
                  </span>
                  {line}
                </p>
              ))}
            </div>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function BoardStatusIcon({
  kind,
  className,
}: {
  kind: BoardKey
  className?: string
}) {
  if (kind === 'running') return <AgentActivity className={className} animationSeed={2} />
  if (kind === 'review') {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        className={className}
      >
        <circle cx="12" cy="12" r="8.5" />
        <path d="m8.5 12 2.4 2.4 4.6-5" />
      </svg>
    )
  }
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 1.8" />
    </svg>
  )
}

function ActivityIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      <path d="M3 12h3.5l2.2-5.5 4.6 11 2.2-5.5H21" />
    </svg>
  )
}

function RobotIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      <rect x="4.5" y="8" width="15" height="11" rx="3" />
      <path d="M12 4.5V8M9.5 13h.01M14.5 13h.01M9.5 16h5" />
    </svg>
  )
}

function ClockIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4.5l3 1.7" />
    </svg>
  )
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      <path d="m7 9.5 5 5 5-5" />
    </svg>
  )
}

/** 所有任务：名称/状态/处理时间筛选 + 全量列表 */
function AllTasksView({
  tasks,
  workerName,
}: {
  tasks: TaskPackage[] | null
  workerName: Map<number, string>
}) {
  const [keyword, setKeyword] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [timeFilter, setTimeFilter] = useState<TimeRangeKey>('all')

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase()
    const start = timeRangeStart(timeFilter)
    return (tasks ?? []).filter((task) => {
      if (q) {
        const text = `${task.code} ${task.title}`.toLowerCase()
        if (!text.includes(q)) return false
      }
      if (statusFilter !== 'all' && task.subStatus !== statusFilter) return false
      if (start !== null && new Date(task.updatedAt).getTime() < start) {
        return false
      }
      return true
    })
  }, [tasks, keyword, statusFilter, timeFilter])

  return (
    <div className="flex flex-col gap-4">
      <Toolbar aria-label="任务筛选">
        <ToolbarInput
          className="w-64"
          render={
            <Input
              placeholder="搜索编号 / 名称…"
              clearable
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onClear={() => setKeyword('')}
              aria-label="搜索任务编号或名称"
            />
          }
        />
        <Select
          value={statusFilter}
          onValueChange={(value) => setStatusFilter(value as string)}
          items={{
            all: '全部状态',
            ...Object.fromEntries(TASK_SUB_STATUSES.map((s) => [s, s])),
          }}
        >
          <SelectTrigger className="w-36">
            <SelectValue placeholder="状态" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部状态</SelectItem>
            {TASK_SUB_STATUSES.map((status) => (
              <SelectItem key={status} value={status}>
                {status}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={timeFilter}
          onValueChange={(value) => setTimeFilter(value as TimeRangeKey)}
          items={Object.fromEntries(
            TIME_RANGES.map((range) => [range.key, range.label]),
          )}
        >
          <SelectTrigger className="w-32">
            <SelectValue placeholder="时间" />
          </SelectTrigger>
          <SelectContent>
            {TIME_RANGES.map((range) => (
              <SelectItem key={range.key} value={range.key}>
                {range.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="ml-auto text-xs text-foreground-muted">
          共 {filtered.length} 个任务
        </span>
      </Toolbar>

      <Table hoverableRows>
        <TableHeader>
          <TableRow>
            <TableHead className="w-28">编号</TableHead>
            <TableHead>任务名称</TableHead>
            <TableHead className="w-24">状态</TableHead>
            <TableHead className="w-36">处理机器人</TableHead>
            <TableHead className="w-40">处理时间</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((task) => (
            <TableRow key={task.id}>
              <TableCell className="font-mono text-xs">{task.code}</TableCell>
              <TableCell className="max-w-xl truncate" title={task.title}>
                {task.parentId !== null && (
                  <span className="text-foreground-muted">└ </span>
                )}
                <Link to={`/tasks/${task.id}`} className="underline">
                  {task.title}
                </Link>
              </TableCell>
              <TableCell>
                <TaskStatusBadge
                  status={task.status}
                  subStatus={task.subStatus}
                />
              </TableCell>
              <TableCell className="max-w-36 truncate">
                {task.agentId
                  ? (workerName.get(task.agentId) ?? `#${task.agentId}`)
                  : '未分配'}
              </TableCell>
              <TableCell title={new Date(task.updatedAt).toLocaleString()}>
                {formatShort(task.updatedAt)}
                <span className="ml-1 text-foreground-muted">
                  {formatRelative(task.updatedAt)}
                </span>
              </TableCell>
            </TableRow>
          ))}
          {tasks !== null && filtered.length === 0 && (
            <TableRow>
              <TableCell colSpan={5}>
                {tasks.length === 0 ? '暂无任务' : '无匹配的任务'}
              </TableCell>
            </TableRow>
          )}
          {tasks === null && (
            <TableRow>
              <TableCell colSpan={5}>加载中…</TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
