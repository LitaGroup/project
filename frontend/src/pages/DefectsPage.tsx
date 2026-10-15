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
import { api, DEFECT_PRIORITIES, DEFECT_STATUSES, type Defect, type Project } from '../lib/api'
import { DefectStatusBadge, DefectPriorityBadge } from '../components/StatusBadge'
import { ProjectFilterSelect } from '../components/ProjectFilterSelect'
import { useProjectIdParam } from '../components/useProjectIdParam'
import { NewDefectDialog } from '../components/NewDefectDialog'

/** 全局缺陷列表：预期/端/状态/项目四列，支持描述模糊搜索（预期+实际）+ 状态筛选 */
export function DefectsPage() {
  const [defects, setDefects] = useState<Defect[] | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [keyword, setKeyword] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [error, setError] = useState<string | null>(null)
  const [projectFilter, setProjectFilter] = useProjectIdParam()

  const reload = () => {
    api.listDefects().then(setDefects).catch((e: Error) => setError(e.message))
  }

  useEffect(() => {
    reload()
    api.listProjects().then(setProjects).catch(() => undefined)
  }, [])

  const projectName = new Map(projects.map((p) => [p.id, p.name]))
  const q = keyword.trim().toLowerCase()
  const filtered = (defects ?? []).filter(
    (d) =>
      (projectFilter === 'all' || String(d.projectId) === projectFilter) &&
      (!q ||
        d.expected.toLowerCase().includes(q) ||
        d.actual.toLowerCase().includes(q)) &&
      (statusFilter === 'all' || d.status === statusFilter) &&
      (priorityFilter === 'all' || d.priority === priorityFilter),
  )
  // 状态筛选项：已知状态 + 数据中出现的异常值
  const statusItems = Object.fromEntries(
    ['all', ...DEFECT_STATUSES, ...(defects ?? []).map((d) => d.status)]
      .filter((v, i, arr) => arr.indexOf(v) === i)
      .map((s) => [s, s === 'all' ? '不限状态' : s]),
  )
  const priorityItems = Object.fromEntries(
    ['all', ...DEFECT_PRIORITIES].map((p) => [p, p === 'all' ? '不限优先级' : p]),
  )
  // Markdown 视图带当前筛选参数（'all'/空串不传）
  const mdQuery = [
    projectFilter !== 'all' && `projectId=${projectFilter}`,
    statusFilter !== 'all' && `status=${encodeURIComponent(statusFilter)}`,
    priorityFilter !== 'all' &&
      `priority=${encodeURIComponent(priorityFilter)}`,
    q && `q=${encodeURIComponent(q)}`,
  ]
    .filter(Boolean)
    .join('&')

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold">缺陷</h1>
          {/* Markdown 视图：后端 .md URL 规范（GET /api/defects.md） */}
          <a
            href={`/api/defects.md${mdQuery ? `?${mdQuery}` : ''}`}
            target="_blank"
            rel="noreferrer"
            className="text-sm underline"
            title="Markdown 视图"
          >
            MD
          </a>
        </div>
        <NewDefectDialog projects={projects} onCreated={reload} />
      </div>
      <div className="mb-4 flex gap-2">
        <ProjectFilterSelect
          projects={projects}
          value={projectFilter}
          onChange={setProjectFilter}
        />
        <Input
          className="w-64"
          placeholder="搜索预期或实际描述…"
          clearable
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onClear={() => setKeyword('')}
        />
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
        <Select
          value={priorityFilter}
          onValueChange={(v) => setPriorityFilter(v as string)}
          items={priorityItems}
        >
          <SelectTrigger className="w-36">
            <SelectValue placeholder="优先级" />
          </SelectTrigger>
          <SelectContent>
            {Object.keys(priorityItems).map((p) => (
              <SelectItem key={p} value={p}>
                {priorityItems[p]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {error && <p className="mb-4 text-sm">加载失败:{error}</p>}
      <Table hoverableRows>
        <TableHeader>
          <TableRow>
            <TableHead>预期功能描述</TableHead>
            <TableHead className="w-24 text-center">端</TableHead>
            <TableHead className="w-24 text-center">优先级</TableHead>
            <TableHead className="w-24 text-center">状态</TableHead>
            <TableHead className="w-16 text-center">图片</TableHead>
            <TableHead>项目</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((d) => (
            <TableRow key={d.id}>
              <TableCell
                className="max-w-xl truncate"
                title={d.expected}
              >
                <Link
                  to={`/projects/${d.projectId}/defects/${d.id}`}
                  className="text-foreground-intense underline"
                >
                  {d.expected}
                </Link>
              </TableCell>
              <TableCell className="text-center">{d.platform ?? '—'}</TableCell>
              <TableCell className="text-center">
                <DefectPriorityBadge priority={d.priority} />
              </TableCell>
              <TableCell className="text-center">
                <DefectStatusBadge status={d.status} />
              </TableCell>
              <TableCell className="text-center">
                {(d.images?.length ?? 0) > 0 ? d.images!.length : '—'}
              </TableCell>
              <TableCell className="max-w-64 truncate">
                <Link
                  to={`/projects/${d.projectId}`}
                  className="text-foreground-intense underline"
                >
                  {projectName.get(d.projectId) ?? `#${d.projectId}`}
                </Link>
              </TableCell>
            </TableRow>
          ))}
          {defects !== null && filtered.length === 0 && (
            <TableRow>
              <TableCell colSpan={6}>
                {defects.length === 0
                  ? '暂无缺陷，点击"新建缺陷"创建'
                  : '无匹配的缺陷'}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
