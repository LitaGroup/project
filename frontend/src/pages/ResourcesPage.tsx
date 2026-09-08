import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@appica/ui-react/table'
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
  RESOURCE_STATUSES,
  RESOURCE_TYPES,
  type Project,
  type ProjectResource,
} from '../lib/api'
import { ResourceStatusBadge } from '../components/StatusBadge'
import { ProjectFilterSelect } from '../components/ProjectFilterSelect'
import { useProjectIdParam } from '../components/useProjectIdParam'

/**
 * 全局资源列表：标题/类型/状态/链接/项目五列，支持标题模糊搜索 + 类型/状态筛选。
 * 状态默认不含软删除（选"废弃"查看回收站）。
 */
export function ResourcesPage() {
  const [resources, setResources] = useState<ProjectResource[] | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [keyword, setKeyword] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [error, setError] = useState<string | null>(null)
  const [projectFilter, setProjectFilter] = useProjectIdParam()

  useEffect(() => {
    api
      .listResources(undefined, true)
      .then(setResources)
      .catch((e: Error) => setError(e.message))
    api.listProjects().then(setProjects).catch(() => undefined)
  }, [])

  const projectName = new Map(projects.map((p) => [p.id, p.name]))
  const q = keyword.trim().toLowerCase()
  const filtered = (resources ?? []).filter(
    (r) =>
      (projectFilter === 'all' || String(r.projectId) === projectFilter) &&
      (!q || r.title.toLowerCase().includes(q)) &&
      (typeFilter === 'all' || r.type === typeFilter) &&
      (statusFilter === 'all'
        ? r.status !== '废弃'
        : r.status === statusFilter),
  )
  const typeItems: Record<string, string> = {
    all: '不限类型',
    ...Object.fromEntries(RESOURCE_TYPES.map((t) => [t, t])),
  }
  const statusItems: Record<string, string> = {
    all: '不限状态',
    ...Object.fromEntries(RESOURCE_STATUSES.map((s) => [s, s])),
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">资源</h1>
      </div>
      <div className="mb-4 flex gap-2">
        <ProjectFilterSelect
          projects={projects}
          value={projectFilter}
          onChange={setProjectFilter}
        />
        <Input
          className="w-64"
          placeholder="搜索标题…"
          clearable
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onClear={() => setKeyword('')}
        />
        <Select
          value={typeFilter}
          onValueChange={(v) => setTypeFilter(v as string)}
          items={typeItems}
        >
          <SelectTrigger className="w-36">
            <SelectValue placeholder="类型" />
          </SelectTrigger>
          <SelectContent>
            {Object.keys(typeItems).map((t) => (
              <SelectItem key={t} value={t}>
                {typeItems[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as string)}
          items={statusItems}
        >
          <SelectTrigger className="w-36">
            <SelectValue placeholder="状态" />
          </SelectTrigger>
          <SelectContent>
            {Object.keys(statusItems).map((s) => (
              <SelectItem key={s} value={s}>
                {statusItems[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {error && <p className="mb-4 text-sm">加载失败:{error}</p>}
      <Table hoverableRows>
        <TableHeader>
          <TableRow>
            <TableHead>标题</TableHead>
            <TableHead className="w-24 text-center">类型</TableHead>
            <TableHead className="w-24 text-center">状态</TableHead>
            <TableHead>链接 / 前缀</TableHead>
            <TableHead>项目</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="max-w-md truncate" title={r.title}>
                {r.type === '配置' && r.documentId ? (
                  <Link
                    to={`/documents/${r.documentId}`}
                    className="text-foreground-intense underline"
                  >
                    {r.title}
                  </Link>
                ) : (
                  r.title
                )}
              </TableCell>
              <TableCell className="text-center">{r.type}</TableCell>
              <TableCell className="text-center">
                <ResourceStatusBadge status={r.status} />
              </TableCell>
              <TableCell
                className="max-w-96 truncate"
                title={r.type === '多语言' ? (r.prefix ?? undefined) : (r.url ?? undefined)}
              >
                {r.type === '多语言' ? (
                  r.prefix ?? '—'
                ) : r.url ? (
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-foreground-intense underline"
                  >
                    {r.url}
                  </a>
                ) : (
                  '—'
                )}
              </TableCell>
              <TableCell className="max-w-64 truncate">
                <Link
                  to={`/projects/${r.projectId}`}
                  className="text-foreground-intense underline"
                >
                  {projectName.get(r.projectId) ?? `#${r.projectId}`}
                </Link>
              </TableCell>
            </TableRow>
          ))}
          {resources !== null && filtered.length === 0 && (
            <TableRow>
              <TableCell colSpan={5}>
                {resources.length === 0
                  ? '暂无资源，到项目详情页"资源"板块添加'
                  : '无匹配的资源'}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
