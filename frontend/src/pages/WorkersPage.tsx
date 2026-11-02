import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@appica/ui-react/table'
import { Badge } from '@appica/ui-react/badge'
import { Button, buttonVariants } from '@appica/ui-react/button'
import { Input } from '@appica/ui-react/input'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@appica/ui-react/select'
import {
  Toolbar,
  ToolbarButton,
  ToolbarGroup,
  ToolbarInput,
} from '@appica/ui-react/toolbar'
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
  api,
  WORKER_LIVE_STATUSES,
  WORKER_ROLES,
  type Executor,
  type Worker,
} from '../lib/api'
import { WorkerLiveBadge } from '../components/StatusBadge'
import { RobotAvatar } from '../components/task-detail/WorkerAvatar'

/**
 * 机器人管理：系统机器人（id < 1000，代码内置）+ 自定义机器人（id >= 1000）。
 * 调度机器人属于系统机器人，与工作者在同一列表维护；网页新建的均为自定义工作者。
 */
export function WorkersPage() {
  const [workers, setWorkers] = useState<Worker[] | null>(null)
  const [executors, setExecutors] = useState<Executor[]>([])
  const [error, setError] = useState<string | null>(null)
  const [keyword, setKeyword] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [executorFilter, setExecutorFilter] = useState('all')
  const [enabledFilter, setEnabledFilter] = useState('all')

  const reload = useCallback(() => {
    api
      .listWorkers()
      .then(setWorkers)
      .catch((e: Error) => setError(e.message))
    api.listExecutors().then(setExecutors).catch(() => undefined)
  }, [])

  useEffect(reload, [reload])

  const executorName = new Map(executors.map((e) => [e.id, e.name]))

  const executorItems = useMemo<Record<string, string>>(
    () => ({
      all: '不限执行器',
      none: '未配置执行器',
      ...Object.fromEntries(executors.map((e) => [String(e.id), e.name])),
    }),
    [executors],
  )

  const filtered = useMemo(() => {
    const query = keyword.trim().toLowerCase()
    return (workers ?? []).filter((worker) => {
      if (query) {
        const haystack = `${worker.id} ${worker.name} ${worker.intro ?? ''}`.toLowerCase()
        if (!haystack.includes(query)) return false
      }
      if (roleFilter !== 'all' && worker.role !== roleFilter) return false
      if (statusFilter !== 'all' && worker.liveStatus !== statusFilter) return false
      if (executorFilter === 'none') {
        if (worker.executorId != null) return false
      } else if (executorFilter !== 'all') {
        if (worker.executorId !== Number(executorFilter)) return false
      }
      if (enabledFilter === 'enabled' && !worker.enabled) return false
      if (enabledFilter === 'disabled' && worker.enabled) return false
      return true
    })
  }, [
    workers,
    keyword,
    roleFilter,
    statusFilter,
    executorFilter,
    enabledFilter,
  ])

  const hasFilter =
    keyword.trim() !== '' ||
    roleFilter !== 'all' ||
    statusFilter !== 'all' ||
    executorFilter !== 'all' ||
    enabledFilter !== 'all'
  const clearFilters = () => {
    setKeyword('')
    setRoleFilter('all')
    setStatusFilter('all')
    setExecutorFilter('all')
    setEnabledFilter('all')
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">机器人</h1>
          <p className="mt-1 text-sm text-foreground-muted">
            统一管理调度机器人与工作者：系统机器人（ID &lt; 1000）由代码内置、不可删除；
            网页新建的自定义机器人从 ID 1000 开始
          </p>
        </div>
        <Link
          to="/admin/workers/new"
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          新建机器人
        </Link>
      </div>
      {error && <p className="text-sm">操作失败:{error}</p>}

      <Toolbar aria-label="机器人筛选">
        <ToolbarInput
          className="w-64"
          render={
            <Input
              placeholder="搜索名称、简介、ID…"
              clearable
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onClear={() => setKeyword('')}
              aria-label="搜索机器人名称、简介或 ID"
            />
          }
        />
        <ToolbarGroup aria-label="筛选">
          <Select
            value={roleFilter}
            onValueChange={(value) => setRoleFilter(value as string)}
            items={{
              all: '不限类型',
              ...Object.fromEntries(WORKER_ROLES.map((role) => [role, role])),
            }}
          >
            <ToolbarButton
              className="w-32"
              render={
                <SelectTrigger aria-label="按机器人类型筛选">
                  <SelectValue placeholder="类型" />
                </SelectTrigger>
              }
            />
            <SelectContent>
              <SelectItem value="all">不限类型</SelectItem>
              {WORKER_ROLES.map((role) => (
                <SelectItem key={role} value={role}>
                  {role}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={statusFilter}
            onValueChange={(value) => setStatusFilter(value as string)}
            items={{
              all: '不限状态',
              ...Object.fromEntries(
                WORKER_LIVE_STATUSES.map((status) => [status, status]),
              ),
            }}
          >
            <ToolbarButton
              className="w-32"
              render={
                <SelectTrigger aria-label="按实时状态筛选">
                  <SelectValue placeholder="状态" />
                </SelectTrigger>
              }
            />
            <SelectContent>
              <SelectItem value="all">不限状态</SelectItem>
              {WORKER_LIVE_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {status}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={executorFilter}
            onValueChange={(value) => setExecutorFilter(value as string)}
            items={executorItems}
          >
            <ToolbarButton
              className="w-40"
              render={
                <SelectTrigger aria-label="按执行器筛选">
                  <SelectValue placeholder="执行器" />
                </SelectTrigger>
              }
            />
            <SelectContent>
              {Object.entries(executorItems).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={enabledFilter}
            onValueChange={(value) => setEnabledFilter(value as string)}
            items={{
              all: '不限启用状态',
              enabled: '启用',
              disabled: '停用',
            }}
          >
            <ToolbarButton
              className="w-32"
              render={
                <SelectTrigger aria-label="按启用状态筛选">
                  <SelectValue placeholder="启用状态" />
                </SelectTrigger>
              }
            />
            <SelectContent>
              <SelectItem value="all">不限启用状态</SelectItem>
              <SelectItem value="enabled">启用</SelectItem>
              <SelectItem value="disabled">停用</SelectItem>
            </SelectContent>
          </Select>
          {hasFilter && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              清空筛选
            </Button>
          )}
        </ToolbarGroup>
      </Toolbar>

      <Table hoverableRows>
        <TableHeader>
          <TableRow>
            <TableHead>名称</TableHead>
            <TableHead className="w-28">类型</TableHead>
            <TableHead className="w-24">状态</TableHead>
            <TableHead className="w-32">执行器</TableHead>
            <TableHead className="w-48">模型</TableHead>
            <TableHead className="w-24">上级</TableHead>
            <TableHead className="w-24">启用</TableHead>
            <TableHead className="w-48 text-center">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((w) => (
            <TableRow key={w.id}>
              <TableCell className="max-w-64">
                <p className="flex items-center gap-2 truncate font-medium" title={w.name}>
                  <RobotAvatar name={w.name} avatarUrl={w.avatarUrl} size={26} />
                  <span className="truncate">{w.name}</span>
                  <span className="text-xs font-normal text-foreground-muted">#{w.id}</span>
                  {w.system && (
                    <Badge variant="soft" size="sm">
                      系统
                    </Badge>
                  )}
                  {w.humanUserId && (
                    <Badge variant="secondary" size="sm">
                      真人
                    </Badge>
                  )}
                  {w.personalAgentUserId && (
                    <Badge variant="secondary" size="sm">
                      个人 AGENT
                    </Badge>
                  )}
                </p>
                {w.intro && (
                  <p
                    className="truncate text-xs text-foreground-muted"
                    title={w.intro}
                  >
                    {w.intro}
                  </p>
                )}
              </TableCell>
              <TableCell>{w.role}</TableCell>
              <TableCell>
                <WorkerLiveBadge status={w.liveStatus} />
              </TableCell>
              <TableCell>
                {w.humanUserId
                  ? (w.humanUserName ?? `用户 #${w.humanUserId}`)
                  : w.executorId
                    ? (executorName.get(w.executorId) ?? `#${w.executorId}`)
                    : '未配置'}
              </TableCell>
              <TableCell className="truncate text-xs" title={`${w.providerId}/${w.modelId}`}>
                {w.humanUserId
                  ? '用户执行'
                  : `${w.providerId ?? '-'}/${w.modelId ?? '-'}`}
              </TableCell>
              <TableCell>{w.ownerName ?? '—'}</TableCell>
              <TableCell>{w.enabled ? '启用' : '停用'}</TableCell>
              <TableCell className="text-center">
                <div className="flex justify-center gap-2">
                  {!w.humanUserId && (
                    <Link
                      to={`/admin/workers/${w.id}/debug`}
                      className={buttonVariants({ variant: 'outline', size: 'sm' })}
                    >
                      调试
                    </Link>
                  )}
                  <Link
                    to={`/admin/workers/${w.id}`}
                    className={buttonVariants({ variant: 'outline', size: 'sm' })}
                  >
                    {w.humanUserId ? '查看' : '编辑'}
                  </Link>
                  {w.system || w.humanUserId || w.personalAgentUserId ? (
                    <span className="self-center text-xs text-foreground-muted">
                      {w.system
                        ? '系统内置'
                        : w.humanUserId
                          ? '用户绑定'
                          : '个人 AGENT'}
                    </span>
                  ) : (
                    <DeleteWorkerButton worker={w} onDeleted={reload} />
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
          {workers !== null && filtered.length === 0 && (
            <TableRow>
              <TableCell colSpan={8}>
                {hasFilter ? '没有符合筛选条件的机器人' : '暂无机器人'}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}

/**
 * 删除机器人确认
 */
function DeleteWorkerButton({
  worker,
  onDeleted,
}: {
  worker: Worker
  onDeleted: () => void
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button variant="outline" size="sm" />}>
        删除
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除机器人</AlertDialogTitle>
          <AlertDialogDescription>
            确定删除「{worker.name}」吗？有未完结任务时无法删除。
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
              onClick={() =>
                api.deleteWorker(worker.id).then(onDeleted).catch(() => undefined)
              }
            >
              确认删除
            </Button>
          </AlertDialogClose>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
