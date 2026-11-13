import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { Badge } from '@appica/ui-react/badge'
import { Button, buttonVariants } from '@appica/ui-react/button'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@appica/ui-react/table'
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
  DialogClose,
} from '@appica/ui-react/dialog'
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverTitle,
  PopoverDescription,
} from '@appica/ui-react/popover'
import {
  api,
  type IterationDetail,
  type Project,
  type Worker,
} from '../lib/api'
import { PageBreadcrumb } from '../components/PageBreadcrumb'
import { BacklogSelection } from '../components/BacklogSelection'
import { BacklogStatusDialog } from '../components/BacklogStatusDialog'
import { BacklogStatusBadge, IterationStatusBadge } from '../components/StatusBadge'
import { useAuth } from '../context/AuthContext'

const SUCCESS_STAY_MS = 2_000
const FAILURE_STAY_MS = 5_000

type ActionFeedback =
  | { kind: 'success'; message: string }
  | { kind: 'failure'; message: string }
  | null

/** 预期上线时间展示到小时 */
function formatHour(value: string | null): string {
  if (!value) return '—'
  const d = new Date(value)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:00`
}

/**
 * 迭代详情：展示迭代信息与迭代项看板/列表，支持手动推进迭代项状态、
 * 追加需求（转成 backlog）以及结束/重开 W1 迭代。
 */
export function IterationDetailPage() {
  const { iterationId } = useParams<{ iterationId: string }>()
  const id = Number(iterationId)
  const { user } = useAuth()
  const isAdmin = user?.role === '管理员'

  const [detail, setDetail] = useState<IterationDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<ActionFeedback>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [projects, setProjects] = useState<Project[] | null>(null)
  const [workers, setWorkers] = useState<Worker[] | null>(null)
  const [drafts, setDrafts] = useState<Map<number, number | null>>(new Map())
  const [addOpen, setAddOpen] = useState(false)
  const [adding, setAdding] = useState(false)

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }
  useEffect(() => clearTimer, [])

  const showFeedback = (
    next: NonNullable<ActionFeedback>,
    stayMs: number,
    after?: () => void,
  ) => {
    clearTimer()
    setFeedback(next)
    timerRef.current = setTimeout(() => {
      setFeedback(null)
      after?.()
    }, stayMs)
  }

  const load = useCallback(() => {
    if (!Number.isInteger(id) || id <= 0) return
    setError(null)
    api
      .getIteration(id)
      .then(setDetail)
      .catch((e: Error) => setError(e.message))
  }, [id])

  useEffect(load, [load])

  const loadOptions = useCallback(() => {
    if (projects && workers) return
    Promise.all([api.listProjects(), api.listWorkers({ role: '工作者' })])
      .then(([projectRows, workerRows]) => {
        setProjects(projectRows)
        setWorkers(
          workerRows.filter((worker) => worker.enabled && !worker.personalAgentUserId),
        )
      })
      .catch((e: Error) => setError(e.message))
  }, [projects, workers])

  const missingOwnerCount = useMemo(
    () => [...drafts.values()].filter((owner) => owner === null).length,
    [drafts],
  )

  if (!Number.isInteger(id) || id <= 0) {
    return <Navigate to="/iterations" replace />
  }

  if (error && !detail) {
    return (
      <div>
        <PageBreadcrumb items={[{ label: '迭代', to: '/iterations' }, { label: '详情' }]} />
        <p className="mt-4 text-sm">加载失败:{error}</p>
        <Link to="/iterations" className="mt-2 inline-block text-sm underline">
          返回迭代列表
        </Link>
      </div>
    )
  }

  if (!detail) return <p className="text-sm text-foreground-muted">加载中…</p>

  const toggleIterationStatus = () => {
    const next = detail.status === '进行中' ? '已结束' : '进行中'
    api
      .updateIteration(id, { status: next })
      .then(() => {
        showFeedback({ kind: 'success', message: `已${next === '已结束' ? '结束' : '重开'}迭代` }, SUCCESS_STAY_MS)
        load()
      })
      .catch((e: Error) =>
        showFeedback(
          { kind: 'failure', message: e.message || '操作失败' },
          FAILURE_STAY_MS,
        ),
      )
  }

  const submitAdd = () => {
    if (adding) return
    const items = [...drafts.entries()]
      .filter((entry): entry is [number, number] => entry[1] !== null)
      .map(([projectId, ownerWorkerId]) => ({ projectId, ownerWorkerId }))
    if (items.length === 0) {
      showFeedback({ kind: 'failure', message: '请至少选择一个需求' }, FAILURE_STAY_MS)
      return
    }
    if (missingOwnerCount > 0) {
      showFeedback(
        { kind: 'failure', message: '每条已选需求都要指定负责人' },
        FAILURE_STAY_MS,
      )
      return
    }
    setAdding(true)
    api
      .createBacklogs(id, items)
      .then(() => {
        setAddOpen(false)
        setDrafts(new Map())
        showFeedback(
          { kind: 'success', message: `已转入 ${items.length} 条需求` },
          SUCCESS_STAY_MS,
        )
        load()
      })
      .catch((e: Error) =>
        showFeedback(
          { kind: 'failure', message: e.message || '转入失败' },
          FAILURE_STAY_MS,
        ),
      )
      .finally(() => setAdding(false))
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <PageBreadcrumb
            items={[{ label: '迭代', to: '/iterations' }, { label: detail.code }]}
          />
          <h1 className="mt-2 flex items-center gap-3 text-2xl font-semibold">
            {detail.type === 'T0' ? (
              <Badge variant="primary">T0</Badge>
            ) : (
              <span className="font-mono">{detail.code}</span>
            )}
            {detail.name}
            <IterationStatusBadge status={detail.status} />
            {detail.current && <Badge variant="soft">当前迭代</Badge>}
          </h1>
          <p className="mt-1 text-sm text-foreground-muted">
            {detail.type === 'W1'
              ? `${detail.startAt ?? '?'} ~ ${detail.endAt ?? '?'}`
              : '常驻快速通道'}
            {' · '}
            共 {detail.total} 条，已完成 {detail.done} 条（{detail.percent}%）
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={`/api/iterations/${id}.md`}
            target="_blank"
            rel="noreferrer"
            className="text-sm underline"
            title="Markdown 视图"
          >
            MD
          </a>
          {isAdmin && (
            <>
              {detail.type === 'W1' && (
                <Button variant="outline" size="sm" onClick={toggleIterationStatus}>
                  {detail.status === '进行中' ? '结束迭代' : '重开迭代'}
                </Button>
              )}
              <Dialog
                open={addOpen}
                onOpenChange={(open) => {
                  setAddOpen(open)
                  if (open) loadOptions()
                }}
              >
                <DialogTrigger render={<Button size="sm" />}>
                  添加需求
                </DialogTrigger>
                <DialogContent className="max-w-4xl">
                  <DialogHeader>
                    <DialogTitle>向「{detail.name}」添加需求</DialogTitle>
                  </DialogHeader>
                  <DialogBody>
                    {projects && workers ? (
                      <BacklogSelection
                        projects={projects}
                        workers={workers}
                        drafts={drafts}
                        onChange={setDrafts}
                      />
                    ) : (
                      <p className="text-sm text-foreground-muted">加载中…</p>
                    )}
                  </DialogBody>
                  <DialogFooter>
                    <DialogClose>
                      <Button variant="outline" size="sm">取消</Button>
                    </DialogClose>
                    <Button size="sm" onClick={submitAdd} disabled={adding}>
                      {adding ? '转入中…' : '确认转入'}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </>
          )}
        </div>
      </div>

      <Popover
        open={feedback !== null}
        onOpenChange={(open) => {
          if (!open && feedback?.kind === 'failure') {
            clearTimer()
            setFeedback(null)
          }
        }}
      >
        <PopoverTrigger render={<span />} />
        <PopoverContent side="bottom" align="end">
          {feedback?.kind === 'success' && (
            <>
              <PopoverTitle>成功</PopoverTitle>
              <PopoverDescription>{feedback.message}</PopoverDescription>
            </>
          )}
          {feedback?.kind === 'failure' && (
            <>
              <PopoverTitle>失败</PopoverTitle>
              <PopoverDescription>{feedback.message}</PopoverDescription>
            </>
          )}
        </PopoverContent>
      </Popover>

      {error && <p className="mb-4 text-sm">操作失败:{error}</p>}

      <Table hoverableRows>
        <TableHeader>
          <TableRow>
            <TableHead className="w-24">编号</TableHead>
            <TableHead>标题</TableHead>
            <TableHead className="text-center">负责人</TableHead>
            <TableHead className="w-36 text-center">预期上线</TableHead>
            <TableHead className="text-center">状态</TableHead>
            <TableHead className="text-center">交付任务</TableHead>
            <TableHead className="w-24 text-center">推进状态</TableHead>
            <TableHead className="w-16 text-center">详情</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {detail.backlogs.map((backlog) => {
            const terminal = backlog.status === '完成' || backlog.status === '取消'
            return (
              <TableRow key={backlog.id}>
                <TableCell className="font-mono text-sm">{backlog.code}</TableCell>
                <TableCell className="max-w-md truncate" title={backlog.title}>
                  <Link to={`/backlogs/${backlog.id}`} className="underline">
                    {backlog.title}
                  </Link>
                  <span className="ml-2 text-xs text-foreground-muted" title="原始需求">
                    需求 #{backlog.projectId}
                  </span>
                </TableCell>
                <TableCell className="text-center">
                  {backlog.ownerName ?? '—'}
                </TableCell>
                <TableCell className="text-center">
                  {formatHour(backlog.expectedOnlineAt)}
                </TableCell>
                <TableCell className="text-center">
                  <BacklogStatusBadge status={backlog.status} />
                </TableCell>
                <TableCell className="text-center">
                  {backlog.taskId ? (
                    <Link to={`/tasks/${backlog.taskId}`} className="underline">
                      #{backlog.taskId}
                    </Link>
                  ) : (
                    <span className="text-foreground-muted">—</span>
                  )}
                </TableCell>
                <TableCell className="text-center">
                  <BacklogStatusDialog
                    backlogId={backlog.id}
                    currentStatus={backlog.status}
                    terminal={terminal}
                    onDone={() => {
                      showFeedback({ kind: 'success', message: '状态已更新' }, SUCCESS_STAY_MS)
                      load()
                    }}
                  />
                </TableCell>
                <TableCell className="text-center">
                  <Link
                    to={`/backlogs/${backlog.id}`}
                    className={buttonVariants({ variant: 'outline', size: 'sm' })}
                  >
                    查看
                  </Link>
                </TableCell>
              </TableRow>
            )
          })}
          {detail.backlogs.length === 0 && (
            <TableRow>
              <TableCell colSpan={8}>
                暂无迭代项，管理员可点击右上角「添加需求」转入
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}