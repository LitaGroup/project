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
import { Button, buttonVariants } from '@appica/ui-react/button'
import { api, type Worker } from '../lib/api'

/** 调度器管理：AI 调度运行时配置（PO 进程内 PI + DeepSeek），新建/编辑为独立页面 */
export function SchedulersPage() {
  const [schedulers, setSchedulers] = useState<Worker[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(() => {
    api
      .listWorkers({ role: '调度器' })
      .then(setSchedulers)
      .catch((e: Error) => setError(e.message))
  }, [])

  useEffect(reload, [reload])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">调度器</h1>
          <p className="mt-1 text-sm text-foreground-muted">
            调度器 = 平台进程内 PI Agent（DeepSeek）：任务识别 → 材料审查 → 拆解/分配建议，管理员确认后派发
          </p>
        </div>
        <Link
          to="/tasks/schedulers/new"
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          新建调度器
        </Link>
      </div>
      {error && <p className="text-sm">操作失败:{error}</p>}

      <Table hoverableRows>
        <TableHeader>
          <TableRow>
            <TableHead>名称</TableHead>
            <TableHead>简介</TableHead>
            <TableHead className="w-56">模型</TableHead>
            <TableHead className="w-24">负责人</TableHead>
            <TableHead className="w-20">启用</TableHead>
            <TableHead className="w-40 text-center">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(schedulers ?? []).map((s) => (
            <TableRow key={s.id}>
              <TableCell className="font-medium">{s.name}</TableCell>
              <TableCell
                className="max-w-72 truncate text-xs text-foreground-muted"
                title={s.intro ?? ''}
              >
                {s.intro ?? '—'}
              </TableCell>
              <TableCell className="truncate text-xs" title={`${s.providerId}/${s.modelId}`}>
                {s.providerId ?? '-'}/{s.modelId ?? '-'}
              </TableCell>
              <TableCell>{s.ownerName ?? '—'}</TableCell>
              <TableCell>{s.enabled ? '启用' : '停用'}</TableCell>
              <TableCell className="text-center">
                <div className="flex justify-center gap-2">
                  <Link
                    to={`/tasks/schedulers/${s.id}`}
                    className={buttonVariants({ variant: 'outline', size: 'sm' })}
                  >
                    编辑
                  </Link>
                  <DeleteSchedulerButton scheduler={s} onDeleted={reload} />
                </div>
              </TableCell>
            </TableRow>
          ))}
          {schedulers !== null && schedulers.length === 0 && (
            <TableRow>
              <TableCell colSpan={6}>
                暂无调度器（AI 调度需要至少一个启用的调度器；也可在任务详情人工分配派发）
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}

function DeleteSchedulerButton({
  scheduler,
  onDeleted,
}: {
  scheduler: Worker
  onDeleted: () => void
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button variant="outline" size="sm" />}>
        删除
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除调度器</AlertDialogTitle>
          <AlertDialogDescription>
            确定删除「{scheduler.name}」吗？
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
                api
                  .deleteWorker(scheduler.id)
                  .then(onDeleted)
                  .catch(() => undefined)
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
