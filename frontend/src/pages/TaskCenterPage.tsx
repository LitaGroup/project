import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Card,
} from '@appica/ui-react/card'
import { buttonVariants } from '@appica/ui-react/button'
import { Input } from '@appica/ui-react/input'
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
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@appica/ui-react/select'
import {
  api,
  TASK_TYPES,
  TASK_SUB_STATUSES,
  type TaskPackage,
  type TaskOverview,
  type TaskSubStatus,
  type TaskType,
  type Worker,
} from '../lib/api'
import { TaskStatusBadge } from '../components/StatusBadge'
import { DigitSwap } from '../components/motion-ui'

/** 主状态分组：概览卡片按主状态汇总，并展示子状态构成 */
const STAGE_GROUPS: {
  label: string
  status: string
  subStatuses: TaskSubStatus[]
}[] = [
  { label: '等待中', status: '等待中', subStatuses: ['待识别', '待反馈', '待验收'] },
  { label: '进行中', status: '进行中', subStatuses: ['识别中', '执行中'] },
  { label: '已结束', status: '已结束', subStatuses: ['完成', '取消'] },
]

/** 任务概览：阶段统计 + 任务树列表 + 新建（任务处理中心首页） */
export function TaskCenterPage() {
  const [overview, setOverview] = useState<TaskOverview | null>(null)
  const [tasks, setTasks] = useState<TaskPackage[] | null>(null)
  const [workers, setWorkers] = useState<Worker[]>([])
  const [keyword, setKeyword] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(() => {
    api
      .taskOverview()
      .then(setOverview)
      .catch((e: Error) => setError(e.message))
    api
      .listTaskPackages({
        q: keyword.trim() || undefined,
        subStatus:
          statusFilter === 'all'
            ? undefined
            : (statusFilter as TaskSubStatus),
        type: typeFilter === 'all' ? undefined : (typeFilter as TaskType),
      })
      .then(setTasks)
      .catch((e: Error) => setError(e.message))
  }, [keyword, statusFilter, typeFilter])

  useEffect(() => {
    const t = setTimeout(reload, 250)
    return () => clearTimeout(t)
  }, [reload])

  useEffect(() => {
    api
      .listWorkers({ role: '工作者' })
      .then(setWorkers)
      .catch(() => undefined)
  }, [])

  const workerName = new Map(workers.map((w) => [w.id, w.name]))

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">任务概览</h1>
          <p className="mt-1 text-sm text-foreground-muted">
            任务由机器人执行、责任人验收；系统调度机器人负责识别任务并分配机器人与工作计划
          </p>
        </div>
        <Link
          to="/tasks/new"
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          新建任务
        </Link>
      </div>

      {/* 主状态统计卡 + 子状态构成 */}
      <div className="task-overview-stats grid grid-cols-1 gap-3 md:grid-cols-3">
        {STAGE_GROUPS.map((group) => {
          const count = overview?.statuses[group.status] ?? 0
          return (
            <Card key={group.label}>
              <div className="task-overview-stat px-6 pb-5">
                <p className="text-xs text-foreground-muted">{group.label}</p>
                <p className="task-overview-stat-value mt-1 text-2xl font-semibold"><DigitSwap value={count} /></p>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-foreground-muted">
                  {group.subStatuses.map((subStatus) => (
                    <span key={subStatus}>
                      {subStatus}{' '}
                      <span className="font-medium text-foreground-intense">
                        {overview?.subStatuses[subStatus] ?? 0}
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            </Card>
          )
        })}
      </div>
      <p className="text-xs text-foreground-muted">
        共 {overview?.roots ?? 0} 个主任务 / {overview?.total ?? 0} 个任务（含子任务）
      </p>

      <Toolbar aria-label="任务筛选">
        <ToolbarInput
          className="w-64"
          render={
            <Input
              placeholder="搜索编号 / 标题…"
              clearable
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onClear={() => setKeyword('')}
              aria-label="搜索编号或标题"
            />
          }
        />
        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as string)}
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
            {TASK_SUB_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={typeFilter}
          onValueChange={(v) => setTypeFilter(v as string)}
          items={{
            all: '全部类型',
            ...Object.fromEntries(TASK_TYPES.map((t) => [t, t])),
          }}
        >
          <SelectTrigger className="w-36">
            <SelectValue placeholder="类型" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部类型</SelectItem>
            {TASK_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Toolbar>

      {error && <p className="text-sm">操作失败:{error}</p>}

      <Table hoverableRows>
        <TableHeader>
          <TableRow>
            <TableHead className="w-28">编号</TableHead>
            <TableHead>标题</TableHead>
            <TableHead className="w-24">类型</TableHead>
            <TableHead className="w-24">状态</TableHead>
            <TableHead className="w-36">机器人</TableHead>
            <TableHead className="w-40">更新时间</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(tasks ?? []).map((task) => (
            <TaskRows key={task.id} task={task} workerName={workerName} />
          ))}
          {tasks !== null && tasks.length === 0 && (
            <TableRow>
              <TableCell colSpan={6}>
                暂无任务，点右上角「新建任务」创建
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}

/** 主任务 + 子任务行（子树单层缩进展示） */
function TaskRows({
  task,
  workerName,
}: {
  task: TaskPackage
  workerName: Map<number, string>
}) {
  return (
    <>
      <TableRow>
        <TableCell className="font-mono text-xs">{task.code}</TableCell>
        <TableCell className="max-w-md truncate" title={task.title}>
          <Link to={`/tasks/${task.id}`} className="underline">
            {task.title}
          </Link>
        </TableCell>
        <TableCell>{task.type}</TableCell>
        <TableCell>
          <TaskStatusBadge status={task.status} subStatus={task.subStatus} />
        </TableCell>
        <TableCell>
          {task.agentId ? (workerName.get(task.agentId) ?? `#${task.agentId}`) : '—'}
        </TableCell>
        <TableCell>{new Date(task.updatedAt).toLocaleString()}</TableCell>
      </TableRow>
      {(task.children ?? []).map((child) => (
        <TableRow key={child.id}>
          <TableCell className="pl-8 font-mono text-xs text-foreground-muted">
            {child.code}
          </TableCell>
          <TableCell className="max-w-md truncate pl-8" title={child.title}>
            <span className="text-foreground-muted">└ </span>
            <Link to={`/tasks/${child.id}`} className="underline">
              {child.title}
            </Link>
          </TableCell>
          <TableCell>{child.type}</TableCell>
          <TableCell>
            <TaskStatusBadge status={child.status} subStatus={child.subStatus} />
          </TableCell>
          <TableCell>
            {child.agentId
              ? (workerName.get(child.agentId) ?? `#${child.agentId}`)
              : '—'}
          </TableCell>
          <TableCell>{new Date(child.updatedAt).toLocaleString()}</TableCell>
        </TableRow>
      ))}
    </>
  )
}
