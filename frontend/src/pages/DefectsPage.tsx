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
import { api, DEFECT_SOURCES, DEFECT_STATUSES, type Defect, type Project } from '../lib/api'
import { DefectStatusBadge, DefectSourceBadge } from '../components/StatusBadge'
import { ProjectFilterSelect } from '../components/ProjectFilterSelect'
import { useProjectIdParam } from '../components/useProjectIdParam'
import { NewDefectDialog } from '../components/NewDefectDialog'

/** 全局缺陷列表：描述/端/状态/人员/来源/项目六列，支持描述模糊搜索 + 状态/来源筛选 */
export function DefectsPage() {
  const [defects, setDefects] = useState<Defect[] | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [keyword, setKeyword] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sourceFilter, setSourceFilter] = useState('all')
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
      (!q || d.title.toLowerCase().includes(q)) &&
      (statusFilter === 'all' || d.status === statusFilter) &&
      (sourceFilter === 'all' || d.source === sourceFilter),
  )
  // 状态筛选项：已知状态 + 数据中出现的异常值
  const statusItems = Object.fromEntries(
    ['all', ...DEFECT_STATUSES, ...(defects ?? []).map((d) => d.status)]
      .filter((v, i, arr) => arr.indexOf(v) === i)
      .map((s) => [s, s === 'all' ? '不限状态' : s]),
  )
  const sourceItems = Object.fromEntries(
    ['all', ...DEFECT_SOURCES].map((s) => [s, s === 'all' ? '不限来源' : s]),
  )

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">缺陷</h1>
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
          placeholder="搜索问题描述…"
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
          value={sourceFilter}
          onValueChange={(v) => setSourceFilter(v as string)}
          items={sourceItems}
        >
          <SelectTrigger className="w-36">
            <SelectValue placeholder="来源" />
          </SelectTrigger>
          <SelectContent>
            {Object.keys(sourceItems).map((s) => (
              <SelectItem key={s} value={s}>
                {sourceItems[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {error && <p className="mb-4 text-sm">加载失败:{error}</p>}
      <Table hoverableRows>
        <TableHeader>
          <TableRow>
            <TableHead>问题描述</TableHead>
            <TableHead className="w-24 text-center">端</TableHead>
            <TableHead className="w-24 text-center">状态</TableHead>
            <TableHead className="w-36">人员</TableHead>
            <TableHead className="w-20 text-center">来源</TableHead>
            <TableHead>项目</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((d) => (
            <TableRow key={d.id}>
              <TableCell className="max-w-xl truncate" title={d.title}>
                <Link
                  to={`/projects/${d.projectId}/defects/${d.id}`}
                  className="text-foreground-intense underline"
                >
                  {d.title}
                </Link>
              </TableCell>
              <TableCell className="text-center">{d.platform ?? '—'}</TableCell>
              <TableCell className="text-center">
                <DefectStatusBadge status={d.status} />
              </TableCell>
              <TableCell className="max-w-36 truncate">
                {[d.developer && `开发 ${d.developer}`, d.tester && `测试 ${d.tester}`]
                  .filter(Boolean)
                  .join(' / ') || '—'}
              </TableCell>
              <TableCell className="text-center">
                <DefectSourceBadge source={d.source} />
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
                  ? '暂无缺陷，点击"新建缺陷"或同步飞书多维表格'
                  : '无匹配的缺陷'}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
