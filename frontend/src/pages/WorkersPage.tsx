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

/** 机器人管理：工作者列表 + 新建/编辑（独立页面）/删除 */
export function WorkersPage() {
  const [workers, setWorkers] = useState<Worker[] | null>(null)
  const [executors, setExecutors] = useState<Executor[]>([])
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(() => {
    api
      .listWorkers({ role: '工作者' })
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
            机器人的负责人对机器人的产出结果负责
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
                <p className="truncate font-medium" title={w.name}>
                  {w.name}
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
              <TableCell>
                <WorkerLiveBadge status={w.liveStatus} />
              </TableCell>
              <TableCell>
                {w.executorId
                  ? (executorName.get(w.executorId) ?? `#${w.executorId}`)
                  : '内置 PI'}
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
                  <DeleteWorkerButton worker={w} onDeleted={reload} />
                </div>
              </TableCell>
            </TableRow>
          ))}
          {workers !== null && workers.length === 0 && (
            <TableRow>
              <TableCell colSpan={7}>暂无机器人</TableCell>
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
