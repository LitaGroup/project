import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@appica/ui-react/card'
import { Badge } from '@appica/ui-react/badge'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@appica/ui-react/table'
import { api, type TaskPackage, type TaskTemplate, type Worker } from '../lib/api'
import { TaskStatusBadge } from '../components/StatusBadge'
import { PageBreadcrumb } from '../components/PageBreadcrumb'
import { MarkdownViewer } from '../components/MarkdownViewer'
import { DetailPageLayout } from '../components/detail/DetailPageLayout'
import { RobotAvatar } from '../components/task-detail/WorkerAvatar'
import { SYSTEM_TASK_TEMPLATE_IDS } from '../components/TaskTemplateTable'

/** 任务栏目 - 定义详情：只读展示任务定义与匹配该定义的最近 5 个任务 */
export function TaskDefinitionDetailPage() {
  const { templateId } = useParams<{ templateId: string }>()
  const [template, setTemplate] = useState<TaskTemplate | null>(null)
  const [workers, setWorkers] = useState<Worker[]>([])
  const [recentTasks, setRecentTasks] = useState<TaskPackage[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const id = Number(templateId)
  const invalidId = !Number.isInteger(id) || id < 1

  useEffect(() => {
    if (invalidId) return
    let alive = true
    api
      .getTaskTemplate(id)
      .then((t) => {
        if (!alive) return
        setTemplate(t)
        setError(null)
      })
      .catch((e: Error) => {
        if (alive) setError(e.message)
      })
    api
      .listWorkers({ role: '工作者' })
      .then((list) => {
        if (alive) setWorkers(list)
      })
      .catch(() => undefined)
    api
      .listTaskTemplateTasks(id)
      .then((list) => {
        if (alive) setRecentTasks(list)
      })
      .catch(() => {
        if (alive) setRecentTasks([])
      })
    return () => {
      alive = false
    }
  }, [id, invalidId])

  const workerMap = useMemo(
    () => new Map(workers.map((worker) => [worker.id, worker])),
    [workers],
  )

  if (!invalidId && !error && !template) {
    return <p className="text-sm text-foreground-muted">加载中…</p>
  }
  if (invalidId || error || !template) {
    const message =
      invalidId || !template ? '任务定义不存在' : (error ?? '任务定义不存在')
    return (
      <div className="flex flex-col gap-4">
        <PageBreadcrumb
          items={[
            { label: '任务', to: '/tasks/list' },
            { label: '定义', to: '/tasks/definitions' },
            { label: '详情' },
          ]}
        />
        <p className="text-sm">加载失败：{message}</p>
      </div>
    )
  }

  const system = SYSTEM_TASK_TEMPLATE_IDS.has(template.id)

  return (
    <DetailPageLayout>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
        <div className="shrink-0">
          <PageBreadcrumb
            items={[
              { label: '任务', to: '/tasks/list' },
              { label: '定义', to: '/tasks/definitions' },
              { label: template.name },
            ]}
          />
          <h1 className="mt-2 flex items-center gap-2 text-2xl font-semibold">
            {template.name}
            {system && (
              <Badge variant="soft" size="sm">
                系统
              </Badge>
            )}
          </h1>
          <p className="mt-1 text-sm text-foreground-muted">
            任务定义详情（只读）；定义的新建与维护在管理区「任务定义」进行
          </p>
        </div>

        <Card className="shrink-0">
          <CardHeader className="flex-none">
            <CardTitle>基础信息</CardTitle>
            <CardDescription>任务类型、创建人与默认处理机器人</CardDescription>
          </CardHeader>
          <div className="grid grid-cols-2 gap-x-8 gap-y-3 px-4 pb-4 text-sm sm:grid-cols-3">
            <div>
              <p className="text-xs text-foreground-muted">任务类型</p>
              <p className="mt-0.5">{template.type || '其它'}</p>
            </div>
            <div>
              <p className="text-xs text-foreground-muted">创建人</p>
              <p className="mt-0.5">{template.createdByName ?? '系统'}</p>
            </div>
            <div>
              <p className="text-xs text-foreground-muted">创建时间</p>
              <p className="mt-0.5">
                {new Date(template.createdAt).toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-xs text-foreground-muted">更新时间</p>
              <p className="mt-0.5">
                {new Date(template.updatedAt).toLocaleString()}
              </p>
            </div>
            <div className="col-span-2 sm:col-span-3">
              <p className="text-xs text-foreground-muted">处理机器人</p>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                {(template.agentIds ?? []).length > 0 ? (
                  template.agentIds.map((agentId) => {
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
                        <span className="truncate text-xs">{name}</span>
                      </span>
                    )
                  })
                ) : (
                  <span className="text-foreground-muted">—</span>
                )}
              </div>
            </div>
          </div>
        </Card>

        <Card className="shrink-0">
          <CardHeader className="flex-none">
            <CardTitle>任务定义描述</CardTitle>
            <CardDescription>
              统一说明任务范围、完成任务所需输入和最终交付方式
            </CardDescription>
          </CardHeader>
          <div className="px-4 pb-4">
            {template.description ? (
              <MarkdownViewer text={template.description} />
            ) : (
              <p className="text-sm text-foreground-muted">暂无描述</p>
            )}
          </div>
        </Card>

        <Card className="shrink-0">
          <CardHeader className="flex-none">
            <CardTitle>最近任务</CardTitle>
            <CardDescription>
              匹配该定义的最近 5 个任务（含子任务，按更新时间倒序）
            </CardDescription>
          </CardHeader>
          <div className="px-4 pb-4">
            <Table hoverableRows>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">编号</TableHead>
                  <TableHead>任务名称</TableHead>
                  <TableHead className="w-24">状态</TableHead>
                  <TableHead className="w-36">处理机器人</TableHead>
                  <TableHead className="w-44">处理时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(recentTasks ?? []).map((task) => {
                  const robot = task.agentId
                    ? (workerMap.get(task.agentId)?.name ?? `#${task.agentId}`)
                    : null
                  return (
                    <TableRow key={task.id}>
                      <TableCell className="font-mono text-xs">
                        {task.code}
                      </TableCell>
                      <TableCell className="max-w-xl truncate" title={task.title}>
                        {task.parentId !== null && (
                          <span className="text-foreground-muted">└ </span>
                        )}
                        <Link to={`/tasks/${task.id}`} className="underline">
                          {task.title}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <TaskStatusBadge
                          status={task.status}
                          subStatus={task.subStatus}
                        />
                      </TableCell>
                      <TableCell className="max-w-36 truncate">
                        {robot ?? '未分配'}
                      </TableCell>
                      <TableCell
                        title={new Date(task.updatedAt).toLocaleString()}
                      >
                        {new Date(task.updatedAt).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  )
                })}
                {recentTasks !== null && recentTasks.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5}>该定义暂无匹配任务</TableCell>
                  </TableRow>
                )}
                {recentTasks === null && (
                  <TableRow>
                    <TableCell colSpan={5}>加载中…</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
      </div>
    </DetailPageLayout>
  )
}
