import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { buttonVariants } from '@appica/ui-react/button'
import { Input } from '@appica/ui-react/input'
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
  type TaskBoardItem,
  type TaskRealtimeMessage,
  type Worker,
} from '../lib/api'
import { visibleEventSource } from '../lib/event-source'
import { TaskStatusBadge } from '../components/StatusBadge'

/** 已结束子状态：进行任务 Tab 不展示 */
const ENDED_SUB_STATUSES: ReadonlySet<string> = new Set([
  '完成',
  '已拒绝',
  '失败',
  '取消',
])

/** 未结束子状态（进行任务 Tab 的状态筛选项） */
const ACTIVE_SUB_STATUSES = TASK_SUB_STATUSES.filter(
  (status) => !ENDED_SUB_STATUSES.has(status),
)

/** 合并单条任务快照并按更新时间倒序，保持与服务端列表顺序一致 */
function upsertTask(
  list: TaskBoardItem[] | null,
  task: TaskBoardItem,
): TaskBoardItem[] {
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

/** 任务清单页：进行任务（未结束任务列表）+ 所有任务（全量列表） */
export function TasksPage() {
  const [tab, setTab] = useState<'active' | 'all'>('active')
  const [tasks, setTasks] = useState<TaskBoardItem[] | null>(null)
  const [workers, setWorkers] = useState<Worker[]>([])

  // 数据走 SSE：连接后服务端先推全量快照，之后推任务增量；
  // EventSource 断线会自动重连，重连后重新收到快照，无需定时兜底。
  useEffect(() => {
    let closed = false
    const source = visibleEventSource('/api/tasks/stream')

    source.onmessage = (event: MessageEvent<string>) => {
      if (closed) return
      try {
        const message = JSON.parse(event.data) as TaskRealtimeMessage
        if (message.type === 'snapshot') {
          setTasks(message.tasks)
          return
        }
        if (message.type === 'task.upsert') {
          setTasks((current) => upsertTask(current, message.task))
          return
        }
        if (message.type === 'task.delete') {
          const ids = new Set(message.ids)
          setTasks((current) =>
            current ? current.filter((task) => !ids.has(task.id)) : current,
          )
        }
        // task.line / ping 仅用于实时输出与保活，列表不展示实时输出
      } catch {
        // 解析失败忽略下一帧即可，快照兜底
      }
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

  const workerName = useMemo(
    () => new Map(workers.map((w) => [w.id, w.name])),
    [workers],
  )

  /** 进行任务：仅保留未结束（主状态非「已结束」）的任务，结束后经 SSE 实时移除 */
  const activeTasks = useMemo(
    () => (tasks ?? []).filter((task) => task.status !== '已结束'),
    [tasks],
  )

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex shrink-0 items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">任务</h1>
          <p className="mt-1 text-sm text-foreground-muted">
            任务由机器人执行、由人验收；LOOP 每秒推进，列表变更实时推送
          </p>
        </div>
        <Link
          to="/tasks/new"
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          新建任务
        </Link>
      </div>

      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as 'active' | 'all')}
        variant="line"
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <TabsList className="shrink-0">
          <TabsTrigger value="active">进行任务</TabsTrigger>
          <TabsTrigger value="all">所有任务</TabsTrigger>
        </TabsList>

        <TabsContent
          value="active"
          keepMounted
          className="min-h-0 flex-1 overflow-auto pt-4"
        >
          <TaskListView tasks={activeTasks} workerName={workerName} activeOnly />
        </TabsContent>

        <TabsContent
          value="all"
          keepMounted
          className="min-h-0 flex-1 overflow-auto pt-4"
        >
          <TaskListView tasks={tasks} workerName={workerName} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

/**
 * 任务列表（进行任务与所有任务共用同一布局）：
 * 名称/状态/处理时间筛选 + 全量表格。
 * activeOnly 时状态筛选只提供未结束子状态，空态文案区分「暂无未结束任务」。
 */
function TaskListView({
  tasks,
  workerName,
  activeOnly = false,
}: {
  tasks: TaskBoardItem[] | null
  workerName: Map<number, string>
  activeOnly?: boolean
}) {
  const [keyword, setKeyword] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [timeFilter, setTimeFilter] = useState<TimeRangeKey>('all')

  const statusOptions = activeOnly ? ACTIVE_SUB_STATUSES : TASK_SUB_STATUSES

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

  const statusItems = useMemo<Record<string, string>>(
    () => ({
      all: activeOnly ? '全部未结束状态' : '全部状态',
      ...Object.fromEntries(statusOptions.map((s) => [s, s])),
    }),
    [activeOnly, statusOptions],
  )

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
          items={statusItems}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder="状态" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              {activeOnly ? '全部未结束状态' : '全部状态'}
            </SelectItem>
            {statusOptions.map((status) => (
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
            <TableHead className="w-36">需求方</TableHead>
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
              <TableCell
                className="max-w-36 truncate"
                title={task.requesterName ?? undefined}
              >
                {task.requesterName ?? '—'}
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
              <TableCell colSpan={6}>
                {tasks.length === 0
                  ? activeOnly
                    ? '暂无未结束的任务'
                    : '暂无任务'
                  : '无匹配的任务'}
              </TableCell>
            </TableRow>
          )}
          {tasks === null && (
            <TableRow>
              <TableCell colSpan={6}>加载中…</TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
