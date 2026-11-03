import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@appica/ui-react/accordion'
import { Badge } from '@appica/ui-react/badge'
import { Wrench } from '@appica/icons-react'
import {
  api,
  type WorkbenchSummary,
  type WorkbenchTask,
} from '../lib/api'
import { formatDuration, taskDurationMs } from '../lib/duration'
import { TaskDetailView } from './TaskPackageDetailPage'

type TaskGroupKey = 'in-progress' | 'waiting' | 'completed'

/** 按“当前机器人最近分配时间”倒序；历史数据缺失时回退更新时间 */
function assignedAtDesc(a: WorkbenchTask, b: WorkbenchTask): number {
  const atA = new Date(a.assignedAt ?? a.updatedAt).getTime()
  const atB = new Date(b.assignedAt ?? b.updatedAt).getTime()
  return atB - atA
}

function groupKeyOf(task: WorkbenchTask): TaskGroupKey {
  if (task.status === '进行中') return 'in-progress'
  if (task.status === '等待中') return 'waiting'
  return 'completed'
}

/** 操作台：左侧任务列表 + 右侧复用任务中心的任务详情主体。 */
export function WorkbenchPage() {
  const { taskId } = useParams<{ taskId?: string }>()
  const navigate = useNavigate()
  const [summary, setSummary] = useState<WorkbenchSummary | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(
    taskId ? Number(taskId) : null,
  )
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const loadSummary = useCallback(async () => {
    try {
      const data = await api.getWorkbench()
      setSummary(data)
      setError(null)
      setSelectedId((current) => {
        if (current && data.tasks.some((task) => task.id === current)) {
          return current
        }
        return data.tasks[0]?.id ?? null
      })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    void loadSummary()
  }, [loadSummary])

  useEffect(() => {
    // 操作台任务状态由多方推进，5s 轮询足够保持左栏动作提示
    const timer = window.setInterval(() => void loadSummary(), 5_000)
    return () => window.clearInterval(timer)
  }, [loadSummary])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000)
    return () => window.clearInterval(timer)
  }, [])

  const selectTask = useCallback(
    (id: number) => {
      setSelectedId(id)
      navigate(`/workbench/tasks/${id}`, { replace: true })
    },
    [navigate],
  )

  const activeTasks = useMemo(() => summary?.tasks ?? [], [summary])

  /** 关联任务在我的任务清单内时留在工作台切换，否则进入任务中心详情。 */
  const openRelatedTask = useCallback(
    (id: number) => {
      if (activeTasks.some((task) => task.id === id)) {
        selectTask(id)
      } else {
        navigate(`/tasks/${id}`)
      }
    },
    [activeTasks, navigate, selectTask],
  )

  const taskGroups = useMemo(
    () => [
      {
        key: 'in-progress' as const,
        title: '进行中的',
        tasks: activeTasks
          .filter((task) => groupKeyOf(task) === 'in-progress')
          .sort(assignedAtDesc),
      },
      {
        key: 'waiting' as const,
        title: '等待中的',
        tasks: activeTasks
          .filter((task) => groupKeyOf(task) === 'waiting')
          .sort(assignedAtDesc),
      },
      {
        key: 'completed' as const,
        title: '已完成的',
        tasks: activeTasks
          .filter((task) => groupKeyOf(task) === 'completed')
          .sort(assignedAtDesc),
      },
    ],
    [activeTasks],
  )

  if (loading && !summary) {
    return (
      <div className="flex h-full bg-background">
        <div className="h-full w-[20%] shrink-0 border-r border-border p-3">
          <div className="h-full animate-pulse rounded-[var(--radius-lg)] bg-background-muted" />
        </div>
        <div className="h-full min-w-0 flex-1 p-3">
          <div className="grid h-full grid-cols-[62fr_38fr] gap-3">
            <div className="animate-pulse rounded-[var(--radius-lg)] bg-background-muted" />
            <div className="animate-pulse rounded-[var(--radius-lg)] bg-background-muted" />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full bg-background">
      {/* 左侧 20%：与其他页面左侧导航同宽对齐，任务纯列表 */}
      <aside className="flex h-full w-[20%] shrink-0 flex-col overflow-hidden bg-background">
        <div className="px-6 pt-3">
          <div className="flex items-center justify-between gap-2">
            <p className="font-mono text-sm leading-5 text-foreground-subtle">
              我的任务
            </p>
            <Badge variant="outline" size="sm">
              {activeTasks.length}
            </Badge>
          </div>
          {error && (
            <p role="alert" className="mt-2 text-xs text-error-foreground">
              {error}
            </p>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
          {activeTasks.length === 0 ? (
            <p className="px-3 py-4 text-xs text-foreground-muted">
              暂无任务
            </p>
          ) : (
            <Accordion
              variant="flush"
              icon={false}
              defaultValue={['in-progress']}
              className="w-full"
            >
              {taskGroups.map((group) => (
                <AccordionItem key={group.key} value={group.key}>
                  <AccordionTrigger className="px-3">
                    <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
                      <span className="truncate text-sm">{group.title}</span>
                      <Badge size="sm">{group.tasks.length}</Badge>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="px-0 pb-1">
                    {group.tasks.length === 0 ? (
                      <p className="px-3 py-2 text-xs text-foreground-muted">
                        暂无任务
                      </p>
                    ) : (
                      <ul>
                        {group.tasks.map((item) => {
                          const selected = item.id === selectedId
                          return (
                            <li key={item.id}>
                              <button
                                type="button"
                                onClick={() => selectTask(item.id)}
                                className={`w-full rounded-[var(--radius-md)] px-3 py-2.5 text-left transition-colors ${
                                  selected
                                    ? 'bg-background-muted text-foreground-intense'
                                    : 'text-foreground-emphasis hover:bg-background-muted'
                                }`}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="truncate font-mono text-[11px] text-foreground-subtle">
                                    {item.code}
                                  </span>
                                  <span className="shrink-0 text-[11px] text-foreground-muted">
                                    {formatDuration(taskDurationMs(item, now))}
                                  </span>
                                </div>
                                <p
                                  className="mt-1 line-clamp-2 text-sm font-medium"
                                  title={item.title}
                                >
                                  {item.title}
                                </p>
                                <p
                                  className="mt-1 truncate text-[11px] text-foreground-muted"
                                  title={item.type}
                                >
                                  {item.type}
                                </p>
                              </button>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </div>
      </aside>

      {/* 右侧：任务详情正文与协作面板与任务中心完全复用 */}
      <main className="h-full min-w-0 flex-1 p-3">
        <div className="h-full min-h-0 rounded-[var(--radius-lg)] bg-background-muted p-3">
          {selectedId ? (
            <TaskDetailView
              key={selectedId}
              taskId={selectedId}
              hideBreadcrumb
              handoffEditable
              onTaskChange={loadSummary}
              onOpenTask={openRelatedTask}
            />
          ) : (
            <EmptyWork />
          )}
        </div>
      </main>
    </div>
  )
}

function EmptyWork() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-foreground-muted">
      <span className="rounded-full bg-background-muted p-3">
        <Wrench className="size-5" />
      </span>
      <p>选择任务后查看工作内容</p>
    </div>
  )
}
