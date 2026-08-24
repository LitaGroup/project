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
import { api, DEFECT_STATUSES, type Defect, type Project } from '../lib/api'
import { DefectStatusBadge } from '../components/StatusBadge'

/** 全局缺陷列表：描述/端/状态/人员/项目五列，支持描述模糊搜索 + 状态筛选 */
export function DefectsPage() {
  const [defects, setDefects] = useState<Defect[] | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [keyword, setKeyword] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.listDefects().then(setDefects).catch((e: Error) => setError(e.message))
    api.listProjects().then(setProjects).catch(() => undefined)
  }, [])

  const projectName = new Map(projects.map((p) => [p.id, p.name]))
  const q = keyword.trim().toLowerCase()
  const filtered = (defects ?? []).filter(
    (d) =>
      (!q || d.title.toLowerCase().includes(q)) &&
      (statusFilter === 'all' || d.status === statusFilter),
  )
  // 状态筛选项：已知状态 + 数据中出现的飞书乱填选项
  const statusItems = Object.fromEntries(
    ['all', ...DEFECT_STATUSES, ...(defects ?? []).map((d) => d.status)]
      .filter((v, i, arr) => arr.indexOf(v) === i)
      .map((s) => [s, s === 'all' ? '不限状态' : s]),
  )

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">缺陷</h1>
      </div>
      <div className="mb-4 flex gap-2">
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
      </div>
      {error && <p className="mb-4 text-sm">加载失败:{error}</p>}
      <Table hoverableRows>
        <TableHeader>
          <TableRow>
            <TableHead>问题描述</TableHead>
            <TableHead className="w-24 text-center">端</TableHead>
            <TableHead className="w-24 text-center">状态</TableHead>
            <TableHead className="w-32">人员</TableHead>
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
              <TableCell className="max-w-32 truncate">
                {d.assignee ?? '—'}
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
              <TableCell colSpan={5}>
                {defects.length === 0
                  ? '暂无缺陷，在项目详情页设置缺陷多维表格地址后执行同步'
                  : '无匹配的缺陷'}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
