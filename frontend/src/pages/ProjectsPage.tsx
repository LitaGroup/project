import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, buttonVariants } from '@appica/ui-react/button'
import { Badge } from '@appica/ui-react/badge'
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
import { Input } from '@appica/ui-react/input'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@appica/ui-react/select'
import {
  api,
  PROJECT_TYPES,
  PROJECT_STATUSES,
  type Project,
  type ProjectType,
  type ProjectStatus,
} from '../lib/api'
import { StatusBadge } from '../components/StatusBadge'
import { TypeBadge, PriorityBadge } from '../components/ProjectBadges'

export function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [error, setError] = useState<string | null>(null)
  const [iterationFilter, setIterationFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [keyword, setKeyword] = useState('')

  const reload = useCallback(() => {
    api
      .listProjects()
      .then(setProjects)
      .catch((e: Error) => setError(e.message))
  }, [])

  useEffect(reload, [reload])

  const handleDelete = (id: number) => {
    api.deleteProject(id).then(reload).catch((e: Error) => setError(e.message))
  }

  const iterations = [
    ...new Set(
      projects.map((p) => p.iterationCycle).filter((v): v is string => !!v),
    ),
  ]
  const priorities = [
    ...new Set(
      projects.map((p) => p.priority).filter((v): v is string => !!v),
    ),
  ]
  const filtered = projects.filter(
    (p) =>
      (iterationFilter === 'all' || p.iterationCycle === iterationFilter) &&
      (statusFilter === 'all' || p.status === statusFilter) &&
      (typeFilter === 'all' || p.type === typeFilter) &&
      (priorityFilter === 'all' || p.priority === priorityFilter) &&
      (!keyword || p.name.toLowerCase().includes(keyword.toLowerCase())),
  )

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">项目</h1>
        <div className="flex items-center gap-2">
          <SyncFeishuButton onSynced={reload} />
          <CreateProjectDialog onCreated={reload} />
        </div>
      </div>

      <div className="mb-4 flex gap-2">
        <Input
          className="w-64"
          placeholder="搜索标题…"
          clearable
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onClear={() => setKeyword('')}
        />
        <Select
          value={iterationFilter}
          onValueChange={(v) => setIterationFilter(v as string)}
          items={{
            all: '不限迭代',
            ...Object.fromEntries(iterations.map((it) => [it, it])),
          }}
        >
          <SelectTrigger className="w-48">
            <SelectValue placeholder="迭代" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">不限迭代</SelectItem>
            {iterations.map((it) => (
              <SelectItem key={it} value={it}>
                {it}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as string)}
          items={{
            all: '不限状态',
            ...Object.fromEntries(PROJECT_STATUSES.map((s) => [s, s])),
          }}
        >
          <SelectTrigger className="w-36">
            <SelectValue placeholder="状态" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">不限状态</SelectItem>
            {PROJECT_STATUSES.map((s: ProjectStatus) => (
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
            all: '不限类型',
            ...Object.fromEntries(PROJECT_TYPES.map((t) => [t, t])),
          }}
        >
          <SelectTrigger className="w-32">
            <SelectValue placeholder="类型" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">不限类型</SelectItem>
            {PROJECT_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={priorityFilter}
          onValueChange={(v) => setPriorityFilter(v as string)}
          items={{
            all: '不限优先级',
            ...Object.fromEntries(priorities.map((pr) => [pr, pr])),
          }}
        >
          <SelectTrigger className="w-32">
            <SelectValue placeholder="优先级" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">不限优先级</SelectItem>
            {priorities.map((pr) => (
              <SelectItem key={pr} value={pr}>
                {pr}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error && <p className="mb-4 text-sm">操作失败:{error}</p>}

      <Table hoverableRows>
        <TableHeader>
          <TableRow>
            <TableHead className="w-20">ID</TableHead>
            <TableHead>标题</TableHead>
            <TableHead className="text-center">类型</TableHead>
            <TableHead className="text-center">优先级</TableHead>
            <TableHead className="text-center whitespace-nowrap">预期</TableHead>
            <TableHead className="text-center">迭代</TableHead>
            <TableHead className="text-center">状态</TableHead>
            <TableHead className="w-48 text-center">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((p) => (
            <TableRow key={p.id}>
              <TableCell>{p.id}</TableCell>
              <TableCell className="max-w-md truncate" title={p.name}>{p.name}</TableCell>
              <TableCell className="text-center">
                <TypeBadge type={p.type} />
              </TableCell>
              <TableCell className="text-center">
                {p.priority ? (
                  <PriorityBadge priority={p.priority} />
                ) : (
                  '—'
                )}
              </TableCell>
              <TableCell className="text-center whitespace-nowrap">{p.expectedReleaseAt ?? '未定'}</TableCell>
              <TableCell className="text-center">
                {p.iterationCycle ? (
                  <Badge variant="secondary">{p.iterationCycle}</Badge>
                ) : (
                  '—'
                )}
              </TableCell>
              <TableCell className="text-center">
                <StatusBadge status={p.status} />
              </TableCell>
              <TableCell className="text-center">
                <div className="flex justify-center gap-2">
                  <Link
                    to={`/projects/${p.id}`}
                    className={buttonVariants({ variant: 'outline', size: 'sm' })}
                  >
                    详情
                  </Link>
                  <DeleteProjectButton project={p} onDeleted={handleDelete} />
                </div>
              </TableCell>
            </TableRow>
          ))}
          {filtered.length === 0 && (
            <TableRow>
              <TableCell colSpan={8}>
                {projects.length === 0
                  ? '暂无项目，点击右上角新建'
                  : '没有符合筛选条件的项目'}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}

function SyncFeishuButton({ onSynced }: { onSynced: () => void }) {
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const sync = () => {
    setLoading(true)
    setMessage(null)
    api
      .syncProjectsFromFeishu()
      .then((r) => {
        setMessage(`已同步 ${r.synced} 条（视图共 ${r.scanned} 条）`)
        onSynced()
      })
      .catch((e: Error) => setMessage(`同步失败：${e.message}`))
      .finally(() => setLoading(false))
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={sync} disabled={loading}>
        {loading ? '同步中…' : '从飞书同步'}
      </Button>
      {message && <span className="text-sm">{message}</span>}
    </>
  )
}

function CreateProjectDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [type, setType] = useState<ProjectType>('活动')
  const [expectedReleaseAt, setExpectedReleaseAt] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = () => {
    setError(null)
    api
      .createProject({
        name,
        type,
        expectedReleaseAt: expectedReleaseAt || undefined,
      })
      .then(() => {
        setOpen(false)
        setName('')
        setExpectedReleaseAt('')
        onCreated()
      })
      .catch((e: Error) => setError(e.message))
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger>
        <Button size="sm">新建项目</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新建项目</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-sm">
              标题
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="项目名称"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              类型
              <Select
                value={type}
                onValueChange={(v) => setType(v as ProjectType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROJECT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              预期发布时间
              <Input
                type="date"
                value={expectedReleaseAt}
                onChange={(e) => setExpectedReleaseAt(e.target.value)}
              />
            </label>
            {error && <p className="text-sm">创建失败:{error}</p>}
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose>
            <Button variant="outline" size="sm">取消</Button>
          </DialogClose>
          <Button size="sm" onClick={submit} disabled={!name.trim()}>
            创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DeleteProjectButton({
  project,
  onDeleted,
}: {
  project: Project
  onDeleted: (id: number) => void
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger>
        <Button variant="outline" size="sm">
          删除
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除项目</AlertDialogTitle>
          <AlertDialogDescription>
            确定删除「{project.name}」吗？其下的文档会一并删除，且不可恢复。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose>
            <Button variant="outline" size="sm">取消</Button>
          </AlertDialogClose>
          <AlertDialogClose>
            <Button variant="destructive" size="sm" onClick={() => onDeleted(project.id)}>
              确认删除
            </Button>
          </AlertDialogClose>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
