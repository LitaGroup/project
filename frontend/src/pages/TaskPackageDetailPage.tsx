import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  Card,
  CardHeader,
  CardTitle,
} from '@appica/ui-react/card'
import { Button } from '@appica/ui-react/button'
import { Badge } from '@appica/ui-react/badge'
import {
  Table,
  TableBody,
  TableRow,
  TableCell,
} from '@appica/ui-react/table'
import {
  api,
  type DispatchPlan,
  type TaskPackage,
  type Worker,
} from '../lib/api'
import { TaskStatusBadge } from '../components/StatusBadge'
import { PageBreadcrumb } from '../components/PageBreadcrumb'
import { MarkdownEditor } from '../components/MarkdownEditor'
import { Terminal } from '../components/Terminal'

/** 活跃状态（SSE 持续订阅） */
const ACTIVE_STATUSES = ['已派发', '执行中']

/** 任务详情：实时执行终端 + 流程动作 + 调度方案 + 子任务 + 事件时间线 */
export function TaskPackageDetailPage() {
  const { id } = useParams<{ id: string }>()
  const taskId = Number(id)
  const [task, setTask] = useState<TaskPackage | null>(null)
  const [plan, setPlan] = useState<DispatchPlan | null>(null)
  const [worker, setWorker] = useState<Worker | null>(null)
  const [workers, setWorkers] = useState<Worker[]>([])
  const [lines, setLines] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(
    () =>
      api
        .getTaskPackage(taskId)
        .then((t) => {
          setTask(t)
          setLines(t.liveLines ?? [])
          return Promise.all([
            api.getTaskPlan(taskId).catch(() => null),
            t.agentId ? api.getWorker(t.agentId).catch(() => null) : null,
          ])
        })
        .then(([p, w]) => {
          setPlan(p)
          setWorker(w)
        })
        .catch((e: Error) => setError(e.message)),
    [taskId],
  )

  useEffect(() => {
    void load()
    api
      .listWorkers({ role: '工作者' })
      .then(setWorkers)
      .catch(() => undefined)
  }, [load])

  // 活跃状态订阅 SSE（执行器事件行 + 状态推送）
  const active = task ? ACTIVE_STATUSES.includes(task.status) : false
  const loadRef = useRef(load)
  useEffect(() => {
    loadRef.current = load
  }, [load])
  useEffect(() => {
    if (!active) return
    const es = new EventSource(`/api/tasks/${taskId}/stream`)
    es.onmessage = (e: MessageEvent<string>) => {
      const data = JSON.parse(e.data) as { line?: string; status?: string }
      if (data.line) setLines((prev) => [...prev, data.line!])
      if (data.status && !ACTIVE_STATUSES.includes(data.status)) {
        es.close()
        void loadRef.current()
      }
    }
    es.onerror = () => es.close()
    return () => es.close()
  }, [active, taskId])

  const act = (fn: (id: number) => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    fn(taskId)
      .then(() => load())
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false))
  }

  if (error && !task) return <p>加载失败:{error}</p>
  if (!task) return <p className="text-sm text-foreground-muted">加载中…</p>

  const workerName = new Map(workers.map((w) => [w.id, w.name]))

  return (
    <div className="flex h-full gap-6">
      {/* 左侧：实时执行终端 + 结果 */}
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <PageBreadcrumb
          items={[{ label: '任务', to: '/tasks' }, { label: task.title }]}
        />
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold">
              {task.code} {task.title}
            </h2>
            <p className="mt-1 flex items-center gap-2 text-sm text-foreground-muted">
              <TaskStatusBadge status={task.status} />
              <span>{task.type}</span>
              {worker && <span>· {worker.name}</span>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Actions task={task} busy={busy} act={act} />
          </div>
        </div>

        {task.missingItems && task.missingItems.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>缺失材料（补齐后点「材料已补齐」）</CardTitle>
            </CardHeader>
            <div className="px-6 pb-6">
              <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
                {task.missingItems.map((m, i) => (
                  <li key={i}>
                    <span className="font-medium">{m.item}</span>
                    {m.reason ? ` — ${m.reason}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          </Card>
        )}

        {task.result && (
          <Card>
            <CardHeader>
              <CardTitle>执行产出</CardTitle>
            </CardHeader>
            <div className="px-6 pb-6">
              <pre className="whitespace-pre-wrap break-words font-mono text-xs">
                {task.result}
              </pre>
            </div>
          </Card>
        )}

        <section className="flex min-h-64 flex-1 flex-col">
          <h3 className="mb-2 text-sm font-medium">
            实时执行日志{active ? '（进行中）' : ''}
          </h3>
          <Terminal
            run={{
              status: active ? 'running' : 'success',
              output: lines.length > 0 ? lines : ['（暂无输出）'],
            }}
            scriptPath={`任务 ${task.code}`}
          />
        </section>
      </div>

      {/* 右侧：调度方案 + 信息 + 子任务 + 时间线 */}
      <aside className="flex w-96 shrink-0 flex-col gap-4 overflow-auto pb-6">
        {plan && (
          <Card>
            <CardHeader>
              <CardTitle>调度方案（待确认）</CardTitle>
            </CardHeader>
            <div className="px-6 pb-6">
              <div className="flex flex-col gap-3 text-sm">
                {plan.plan.identification.summary && (
                  <p className="text-foreground-muted">
                    {plan.plan.identification.summary}
                  </p>
                )}
                <div>
                  <p className="mb-1 font-medium">拆解与分配</p>
                  <ul className="flex flex-col gap-1">
                    {(plan.plan.subtasks ?? []).map((s, i) => (
                      <li key={i} className="rounded border border-border-strong px-2 py-1">
                        <p className="font-medium">{s.title}</p>
                        <p className="text-xs text-foreground-muted">
                          {s.type}
                          {s.agentId
                            ? ` · ${s.agentName ?? workerName.get(s.agentId) ?? `#${s.agentId}`}`
                            : ' · 未分配'}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      setBusy(true)
                      api
                        .confirmTaskPlan(plan.id)
                        .then(() => load())
                        .catch((e: Error) => setError(e.message))
                        .finally(() => setBusy(false))
                    }}
                  >
                    确认并派发
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      setBusy(true)
                      api
                        .rejectTaskPlan(plan.id, '需调整')
                        .then(() => load())
                        .catch((e: Error) => setError(e.message))
                        .finally(() => setBusy(false))
                    }}
                  >
                    驳回重调度
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>任务信息</CardTitle>
          </CardHeader>
          <div className="px-6 pb-6">
            <dl className="flex flex-col gap-2 text-sm">
              <InfoRow label="编号" value={task.code} />
              <InfoRow label="类型" value={task.type} />
              <InfoRow label="机器人" value={worker?.name ?? '—'} />
              <InfoRow label="工位" value={worker?.workdir ?? '—'} mono />
              <InfoRow label="会话" value={task.opencodeSessionId ?? '—'} mono />
              <InfoRow
                label="创建时间"
                value={new Date(task.createdAt).toLocaleString()}
              />
              {task.acceptedBy && (
                <InfoRow
                  label="验收"
                  value={`${task.acceptedBy} ${task.acceptedAt ? new Date(task.acceptedAt).toLocaleString() : ''}`}
                />
              )}
            </dl>
          </div>
        </Card>

        {task.description && (
          <Card>
            <CardHeader>
              <CardTitle>任务描述</CardTitle>
            </CardHeader>
            <div className="pb-4">
              <TaskMarkdown key={`description:${task.updatedAt}`} value={task.description} />
            </div>
          </Card>
        )}
        {task.input && (
          <Card>
            <CardHeader>
              <CardTitle>任务输入</CardTitle>
            </CardHeader>
            <div className="pb-4">
              <TaskMarkdown key={`input:${task.updatedAt}`} value={task.input} />
            </div>
          </Card>
        )}
        {task.outputSpec && (
          <Card>
            <CardHeader>
              <CardTitle>输出要求</CardTitle>
            </CardHeader>
            <div className="pb-4">
              <TaskMarkdown key={`output:${task.updatedAt}`} value={task.outputSpec} />
            </div>
          </Card>
        )}

        {task.children && task.children.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>子任务（{task.children.length}）</CardTitle>
            </CardHeader>
            <div className="px-6 pb-6">
              <Table>
                <TableBody>
                  {task.children.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-mono text-xs">
                        <Link to={`/tasks/${c.id}`} className="underline">
                          {c.code}
                        </Link>
                      </TableCell>
                      <TableCell className="max-w-40 truncate" title={c.title}>
                        <Link to={`/tasks/${c.id}`} className="underline">
                          {c.title}
                        </Link>
                      </TableCell>
                      <TableCell className="w-20">
                        <TaskStatusBadge status={c.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>流转时间线</CardTitle>
          </CardHeader>
          <div className="px-6 pb-6">
            <ul className="flex flex-col gap-3">
              {(task.events ?? []).map((e) => (
                <li key={e.id} className="flex flex-col gap-0.5 text-sm">
                  <span>
                    <Badge variant="soft" size="sm">
                      {e.type}
                    </Badge>{' '}
                    {e.content}
                  </span>
                  <span className="text-xs text-foreground-muted">
                    {new Date(e.createdAt).toLocaleString()}
                    {e.operator ? ` · ${e.operator}` : ''}
                  </span>
                </li>
              ))}
              {(task.events ?? []).length === 0 && (
                <li className="text-sm text-foreground-muted">暂无记录</li>
              )}
            </ul>
          </div>
        </Card>
      </aside>
    </div>
  )
}

function InfoRow({
  label,
  value,
  mono,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 text-foreground-muted">{label}</dt>
      <dd
        className={`truncate text-right ${mono ? 'font-mono text-xs' : ''}`}
        title={value}
      >
        {value}
      </dd>
    </div>
  )
}

/** 按状态渲染可执行动作 */
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

  switch (task.status) {
    case '草稿':
      return (
        <>
          {button('提交调度', (id) => api.submitTask(id))}
          {button('取消', (id) => api.cancelTask(id), 'destructive')}
        </>
      )
    case '待补材料':
      return (
        <>
          {button('材料已补齐', (id) => api.resolveTaskMissing(id))}
          {button('取消', (id) => api.cancelTask(id), 'destructive')}
        </>
      )
    case '待调度':
      return (
        <>
          {button('AI 调度', (id) => api.scheduleTask(id), 'primary')}
          {button('直接派发', (id) => api.dispatchTask(id))}
          {button('取消', (id) => api.cancelTask(id), 'destructive')}
        </>
      )
    case '待确认':
      return <span className="text-sm text-foreground-muted">请在右侧确认调度方案</span>
    case '已派发':
    case '执行中':
      return (
        <>
          {button('中断', (id) => api.interruptTask(id))}
          {button('重新派发', (id) => api.dispatchTask(id))}
          {button('取消', (id) => api.cancelTask(id), 'destructive')}
        </>
      )
    case '待验收':
      return (
        <>
          {button('验收通过', (id) => api.acceptTask(id), 'primary')}
          {button('取消', (id) => api.cancelTask(id), 'destructive')}
        </>
      )
    case '内部完成':
      return <>{button('交付', (id) => api.deliverTask(id), 'primary')}</>
    case '已交付':
      return <>{button('归档（维护中）', (id) => api.archiveTask(id), 'primary')}</>
    default:
      return null
  }
}

/** 任务描述/输入/输出：按 Markdown 只读渲染 */
function TaskMarkdown({ value }: { value: string }) {
  return <MarkdownEditor value={value} readOnly appica />
}
