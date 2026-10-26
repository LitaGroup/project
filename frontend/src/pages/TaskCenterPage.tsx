import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Card,
} from '@appica/ui-react/card'
import { Button } from '@appica/ui-react/button'
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
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@appica/ui-react/select'
import {
  api,
  TASK_TYPES,
  TASK_STATUSES,
  type TaskPackage,
  type TaskOverview,
  type TaskStatus,
  type TaskTemplate,
  type TaskType,
  type Worker,
} from '../lib/api'
import { TaskStatusBadge } from '../components/StatusBadge'
import { MarkdownField } from '../components/MarkdownField'
import type { MarkdownEditorHandle } from '../components/MarkdownEditor'

/** 阶段分组：概览卡片按阶段汇总 */
const STAGE_GROUPS: { label: string; statuses: TaskStatus[] }[] = [
  { label: '创建', statuses: ['草稿', '待补材料', '待调度'] },
  { label: '分发', statuses: ['待确认', '已派发'] },
  { label: '执行', statuses: ['执行中', '待验收'] },
  { label: '交付', statuses: ['内部完成', '已交付'] },
  { label: '终态', statuses: ['维护中', '已取消'] },
]

/** 任务概览：阶段统计 + 任务树列表 + 新建（任务处理中心首页） */
export function TaskCenterPage() {
  const [overview, setOverview] = useState<TaskOverview | null>(null)
  const [tasks, setTasks] = useState<TaskPackage[] | null>(null)
  const [workers, setWorkers] = useState<Worker[]>([])
  const [templates, setTemplates] = useState<TaskTemplate[]>([])
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
        status: statusFilter === 'all' ? undefined : (statusFilter as TaskStatus),
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
    api
      .listTaskTemplates()
      .then(setTemplates)
      .catch(() => undefined)
  }, [])

  const workerName = new Map(workers.map((w) => [w.id, w.name]))

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">任务概览</h1>
          <p className="mt-1 text-sm text-foreground-muted">
            任务由机器人执行，责任人验收；调度器负责识别拆解与分配建议
          </p>
        </div>
        <NewTaskDialog
          workers={workers}
          templates={templates}
          onCreated={reload}
        />
      </div>

      {/* 阶段统计卡 */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {STAGE_GROUPS.map((group) => {
          const count = group.statuses.reduce(
            (sum, s) => sum + (overview?.statuses[s] ?? 0),
            0,
          )
          return (
            <Card key={group.label}>
              <div className="px-6 pb-6">
                <p className="text-xs text-foreground-muted">{group.label}</p>
                <p className="mt-1 text-2xl font-semibold">{count}</p>
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
            ...Object.fromEntries(TASK_STATUSES.map((s) => [s, s])),
          }}
        >
          <SelectTrigger className="w-36">
            <SelectValue placeholder="状态" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部状态</SelectItem>
            {TASK_STATUSES.map((s) => (
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
          <TaskStatusBadge status={task.status} />
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
            <TaskStatusBadge status={child.status} />
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

/** 新建任务弹窗：可按任务包填充，再调整标题/类型/描述/输入/输出/机器人 */
export function NewTaskDialog({
  workers,
  templates,
  onCreated,
}: {
  workers: Worker[]
  templates: TaskTemplate[]
  onCreated: () => void
}) {
  const [open, setOpen] = useState(false)
  const [templateId, setTemplateId] = useState('')
  const [title, setTitle] = useState('')
  const [type, setType] = useState<TaskType>('其它')
  const [description, setDescription] = useState('')
  const [input, setInput] = useState('')
  const [outputSpec, setOutputSpec] = useState('')
  const [agentId, setAgentId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [editorEpoch, setEditorEpoch] = useState(0)
  const descriptionRef = useRef<MarkdownEditorHandle>(null)
  const inputRef = useRef<MarkdownEditorHandle>(null)
  const outputSpecRef = useRef<MarkdownEditorHandle>(null)

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) {
      setTemplateId('')
      setTitle('')
      setType('其它')
      setDescription('')
      setInput('')
      setOutputSpec('')
      setAgentId('')
      setError(null)
      setEditorEpoch((n) => n + 1)
    }
  }

  /** 选择任务包：填充描述/输入/输出/处理机器人（标题为空时用任务包名兜底） */
  const applyTemplate = (id: string) => {
    setTemplateId(id)
    const template = templates.find((t) => String(t.id) === id)
    if (!template) return
    setDescription(template.description ?? '')
    setInput(template.input ?? '')
    setOutputSpec(template.outputSpec ?? '')
    setAgentId(template.agentId ? String(template.agentId) : '')
    setTitle((prev) => (prev.trim() ? prev : template.name))
    // 编辑器为非受控组件：换 key 重新挂载以载入任务包内容
    setEditorEpoch((n) => n + 1)
  }

  const submit = () => {
    setError(null)
    // 取编辑器当前内容：onChange 有防抖，避免刚输入就保存丢字
    const descriptionText =
      descriptionRef.current?.getMarkdown() ?? description
    const inputText = inputRef.current?.getMarkdown() ?? input
    const outputSpecText = outputSpecRef.current?.getMarkdown() ?? outputSpec
    api
      .createTaskPackage({
        title,
        type,
        description: descriptionText.trim() || null,
        input: inputText.trim() || null,
        outputSpec: outputSpecText.trim() || null,
        agentId: agentId ? Number(agentId) : null,
      })
      .then(() => {
        setOpen(false)
        onCreated()
      })
      .catch((e: Error) => setError(e.message))
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button size="sm" />}>新建任务</DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>新建任务</DialogTitle>
        </DialogHeader>
        <DialogBody className="overflow-y-auto">
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-sm">
              任务包（可选，选择后自动填充）
              <Select
                value={templateId || 'none'}
                onValueChange={(v) =>
                  applyTemplate(v === 'none' ? '' : (v as string))
                }
                items={{
                  none: '不使用任务包',
                  ...Object.fromEntries(
                    templates.map((t) => [String(t.id), t.name]),
                  ),
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">不使用任务包</SelectItem>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              标题
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="如：产出 8 月活动榜单接口的技术设计"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              任务类型
              <Select
                value={type}
                onValueChange={(v) => setType(v as TaskType)}
                items={Object.fromEntries(TASK_TYPES.map((t) => [t, t]))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TASK_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <MarkdownField
              label="任务描述（这类任务要做什么）"
              value={description}
              onChange={setDescription}
              handleRef={descriptionRef}
              editorKey={`description:${editorEpoch}`}
              heightClassName="h-40"
            />
            <MarkdownField
              label="任务输入（提供什么材料/上下文）"
              value={input}
              onChange={setInput}
              handleRef={inputRef}
              editorKey={`input:${editorEpoch}`}
              heightClassName="h-40"
            />
            <MarkdownField
              label="明确输出（要交付什么）"
              value={outputSpec}
              onChange={setOutputSpec}
              handleRef={outputSpecRef}
              editorKey={`outputSpec:${editorEpoch}`}
              heightClassName="h-40"
            />
            <label className="flex flex-col gap-1 text-sm">
              指定机器人（可留空：由调度器分配）
              <Select
                value={agentId || 'none'}
                onValueChange={(v) =>
                  setAgentId(v === 'none' ? '' : (v as string))
                }
                items={{
                  none: '不指定（调度器分配）',
                  ...Object.fromEntries(workers.map((w) => [String(w.id), w.name])),
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">不指定（调度器分配）</SelectItem>
                  {workers.map((w) => (
                    <SelectItem key={w.id} value={String(w.id)}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            {error && <p className="text-sm">保存失败:{error}</p>}
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose>
            <Button variant="outline" size="sm">
              取消
            </Button>
          </DialogClose>
          <Button size="sm" onClick={submit} disabled={!title.trim()}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
