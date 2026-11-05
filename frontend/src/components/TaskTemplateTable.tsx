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
import { api, type TaskTemplate, type Worker } from '../lib/api'
import { RobotAvatar } from './task-detail/WorkerAvatar'

/** 系统任务定义固定 ID（未知任务 + 六类工单调度），平台保留、不可删除或改名 */
export const SYSTEM_TASK_TEMPLATE_IDS = new Set([6, 10, 11, 12, 13, 14, 15])

interface TaskTemplateTableProps {
  templates: TaskTemplate[] | null
  workers: Worker[]
  /** manage=管理模块（编辑/删除）；plain=个人中心（关注/查看）；readonly=任务栏目只读（仅查看详情） */
  mode?: 'manage' | 'plain' | 'readonly'
  currentUserId?: number | null
  /** 删除或关注状态变更后刷新列表 */
  onChanged?: () => void
  onError?: (message: string) => void
  emptyText?: string
}

/** 任务定义表格：管理模块、个人中心与任务栏目只读列表共用 */
export function TaskTemplateTable({
  templates,
  workers,
  mode = 'manage',
  currentUserId,
  onChanged,
  onError,
  emptyText,
}: TaskTemplateTableProps) {
  const workerMap = new Map(workers.map((worker) => [worker.id, worker]))

  return (
    <div className="w-full overflow-x-auto">
      <Table hoverableRows className="table-fixed">
        <TableHeader>
          <TableRow>
            <TableHead className="w-44">名称</TableHead>
            <TableHead className="w-24">任务类型</TableHead>
            <TableHead className="w-44">处理机器人</TableHead>
            <TableHead>任务定义描述</TableHead>
            <TableHead className="w-24">创建人</TableHead>
            <TableHead className="w-36">更新时间</TableHead>
            <TableHead
              className={mode === 'plain' ? 'w-48 text-center' : 'w-40 text-center'}
            >
              操作
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(templates ?? []).map((template) => {
            const system = SYSTEM_TASK_TEMPLATE_IDS.has(template.id)
            const mine =
              currentUserId != null && template.createdById === currentUserId
            return (
              <TableRow key={template.id}>
                <TableCell>
                  <p className="flex min-w-0 items-center gap-1.5 truncate font-medium">
                    {mode === 'readonly' ? (
                      <Link
                        to={`/tasks/definitions/${template.id}`}
                        className="min-w-0 truncate underline-offset-2 hover:underline"
                      >
                        {template.name}
                      </Link>
                    ) : (
                      <span className="min-w-0 truncate">{template.name}</span>
                    )}
                    {system && (
                      <Badge variant="soft" size="sm">
                        系统
                      </Badge>
                    )}
                    {mine && (
                      <Badge variant="secondary" size="sm">
                        我创建的
                      </Badge>
                    )}
                    {template.followedByMe && (
                      <Badge variant="secondary" size="sm">
                        已关注
                      </Badge>
                    )}
                  </p>
                </TableCell>
                <TableCell className="truncate">{template.type || '其它'}</TableCell>
                <TableCell>
                  {(template.agentIds ?? []).length > 0 ? (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      {template.agentIds.map((agentId) => {
                        const worker = workerMap.get(agentId)
                        const name = worker?.name ?? `#${agentId}`
                        return (
                          <span
                            key={agentId}
                            className="flex min-w-0 max-w-full items-center gap-1.5"
                            title={name}
                          >
                            <RobotAvatar
                              name={name}
                              avatarUrl={worker?.avatarUrl}
                              size={22}
                            />
                            <span className="min-w-0 truncate text-xs">{name}</span>
                          </span>
                        )
                      })}
                    </div>
                  ) : (
                    '—'
                  )}
                </TableCell>
                <TableCell
                  className="truncate text-xs text-foreground-muted"
                  title={template.description ?? ''}
                >
                  {template.description ?? '—'}
                </TableCell>
                <TableCell className="truncate text-xs">
                  {template.createdByName ?? '系统'}
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs">
                  {new Date(template.updatedAt).toLocaleString()}
                </TableCell>
                <TableCell className="text-center">
                  <div className="flex justify-center gap-2 whitespace-nowrap">
                    {mode === 'manage' ? (
                      <>
                        <Link
                          to={`/admin/task-templates/${template.id}`}
                          className={buttonVariants({ variant: 'outline', size: 'sm' })}
                        >
                          编辑
                        </Link>
                        {!system && (
                          <DeleteTemplateButton
                            template={template}
                            onDeleted={onChanged ?? (() => undefined)}
                            onError={onError ?? (() => undefined)}
                          />
                        )}
                      </>
                    ) : mode === 'readonly' ? (
                      <Link
                        to={`/tasks/definitions/${template.id}`}
                        className={buttonVariants({ variant: 'outline', size: 'sm' })}
                      >
                        查看
                      </Link>
                    ) : (
                      <>
                        <Button
                          variant={template.followedByMe ? 'ghost' : 'outline'}
                          size="sm"
                          onClick={() => {
                            const action = template.followedByMe
                              ? api.unfollowTaskTemplate(template.id)
                              : api.followTaskTemplate(template.id)
                            action.then(onChanged).catch((e: Error) => onError?.(e.message))
                          }}
                        >
                          {template.followedByMe ? '取消关注' : '关注'}
                        </Button>
                        <Link
                          to={`/admin/task-templates/${template.id}`}
                          className={buttonVariants({ variant: 'outline', size: 'sm' })}
                        >
                          查看
                        </Link>
                      </>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            )
          })}
          {templates !== null && templates.length === 0 && (
            <TableRow>
              <TableCell colSpan={7}>
                {emptyText ?? '暂无任务定义，点右上角「新建任务定义」创建'}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}

/** 删除任务定义确认 */
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
          <AlertDialogTitle>删除任务定义</AlertDialogTitle>
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
