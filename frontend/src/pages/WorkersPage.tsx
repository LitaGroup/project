import { useCallback, useEffect, useState } from 'react'
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
import { api, type Executor, type Worker } from '../lib/api'
import { WorkerLiveBadge } from '../components/StatusBadge'

/**
 * 机器人管理：系统机器人（id < 1000，代码内置）+ 自定义机器人（id >= 1000）。
 * 调度机器人属于系统机器人，与工作者在同一列表维护；网页新建的均为自定义工作者。
 */
export function WorkersPage() {
  const [workers, setWorkers] = useState<Worker[] | null>(null)
  const [executors, setExecutors] = useState<Executor[]>([])
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(() => {
    api
      .listWorkers()
      .then(setWorkers)
      .catch((e: Error) => setError(e.message))
    api.listExecutors().then(setExecutors).catch(() => undefined)
  }, [])

  useEffect(reload, [reload])

  const executorName = new Map(executors.map((e) => [e.id, e.name]))

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
          to="/tasks/workers/new"
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          新建机器人
        </Link>
      </div>
      {error && <p className="text-sm">操作失败:{error}</p>}

      <Table hoverableRows>
        <TableHeader>
          <TableRow>
            <TableHead>名称</TableHead>
            <TableHead className="w-28">类型</TableHead>
            <TableHead className="w-24">状态</TableHead>
            <TableHead className="w-32">执行器</TableHead>
            <TableHead className="w-48">模型</TableHead>
            <TableHead className="w-24">负责人</TableHead>
            <TableHead className="w-24">启用</TableHead>
            <TableHead className="w-32 text-center">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(workers ?? []).map((w) => (
            <TableRow key={w.id}>
              <TableCell className="max-w-64">
                <p className="flex items-center gap-2 truncate font-medium" title={w.name}>
                  <span className="truncate">{w.name}</span>
                  <span className="text-xs font-normal text-foreground-muted">#{w.id}</span>
                  {w.system && (
                    <Badge variant="soft" size="sm">
                      系统
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
                {w.executorId
                  ? (executorName.get(w.executorId) ?? `#${w.executorId}`)
                  : '未配置'}
              </TableCell>
              <TableCell className="truncate text-xs" title={`${w.providerId}/${w.modelId}`}>
                {w.providerId ?? '-'}/{w.modelId ?? '-'}
              </TableCell>
              <TableCell>{w.ownerName ?? '—'}</TableCell>
              <TableCell>{w.enabled ? '启用' : '停用'}</TableCell>
              <TableCell className="text-center">
                <div className="flex justify-center gap-2">
                  <Link
                    to={`/tasks/workers/${w.id}`}
                    className={buttonVariants({ variant: 'outline', size: 'sm' })}
                  >
                    编辑
                  </Link>
                  {w.system ? (
                    <span className="self-center text-xs text-foreground-muted">
                      系统内置
                    </span>
                  ) : (
                    <DeleteWorkerButton worker={w} onDeleted={reload} />
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
          {workers !== null && workers.length === 0 && (
            <TableRow>
              <TableCell colSpan={8}>暂无机器人</TableCell>
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
