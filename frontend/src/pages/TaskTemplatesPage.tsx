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
import { api, type TaskTemplate, type Worker } from '../lib/api'

/** 任务包列表：一类任务的可复用定义（描述/输入/输出 + 默认处理机器人） */
export function TaskTemplatesPage() {
  const [templates, setTemplates] = useState<TaskTemplate[] | null>(null)
  const [workers, setWorkers] = useState<Worker[]>([])
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(() => {
    api
      .listTaskTemplates()
      .then(setTemplates)
      .catch((e: Error) => setError(e.message))
  }, [])

  useEffect(() => {
    reload()
    api
      .listWorkers({ role: '工作者' })
      .then(setWorkers)
      .catch(() => undefined)
  }, [reload])

  const workerName = new Map(workers.map((w) => [w.id, w.name]))

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">任务包</h1>
          <p className="mt-1 text-sm text-foreground-muted">
            沉淀一类任务的可复用定义：描述、输入、输出与默认处理机器人
          </p>
        </div>
        <Link
          to="/tasks/templates/new"
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          新建任务包
        </Link>
      </div>
      {error && <p className="text-sm">操作失败:{error}</p>}

      <Table hoverableRows>
        <TableHeader>
          <TableRow>
            <TableHead className="w-48">名称</TableHead>
            <TableHead className="w-36">处理机器人</TableHead>
            <TableHead>任务描述</TableHead>
            <TableHead className="w-40">更新时间</TableHead>
            <TableHead className="w-32 text-center">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(templates ?? []).map((template) => (
            <TableRow key={template.id}>
              <TableCell className="max-w-48 truncate font-medium">
                {template.name}
              </TableCell>
              <TableCell>
                {template.agentId
                  ? (workerName.get(template.agentId) ??
                    `#${template.agentId}`)
                  : '—'}
              </TableCell>
              <TableCell
                className="max-w-md truncate text-xs text-foreground-muted"
                title={template.description ?? ''}
              >
                {template.description ?? '—'}
              </TableCell>
              <TableCell>
                {new Date(template.updatedAt).toLocaleString()}
              </TableCell>
              <TableCell className="text-center">
                <div className="flex justify-center gap-2">
                  <Link
                    to={`/tasks/templates/${template.id}`}
                    className={buttonVariants({ variant: 'outline', size: 'sm' })}
                  >
                    编辑
                  </Link>
                  <DeleteTemplateButton
                    template={template}
                    onDeleted={reload}
                    onError={setError}
                  />
                </div>
              </TableCell>
            </TableRow>
          ))}
          {templates !== null && templates.length === 0 && (
            <TableRow>
              <TableCell colSpan={5}>
                暂无任务包，点右上角「新建任务包」创建
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}

/** 删除任务包确认 */
function DeleteTemplateButton({
  template,
  onDeleted,
  onError,
}: {
  template: TaskTemplate
  onDeleted: () => void
  onError: (message: string) => void
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button variant="outline" size="sm" />}>
        删除
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除任务包</AlertDialogTitle>
          <AlertDialogDescription>
            确定删除「{template.name}」吗？已创建的任务不受影响。
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
                  .deleteTaskTemplate(template.id)
                  .then(onDeleted)
                  .catch((e: Error) => onError(e.message))
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
