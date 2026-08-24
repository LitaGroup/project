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
import { api, type Project, type ProjectCheck } from '../lib/api'
import { ProjectFilterSelect } from '../components/ProjectFilterSelect'
import { useProjectIdParam } from '../components/useProjectIdParam'

/** 检查全局列表：全部项目的检查（编号/描述/脚本/项目），支持编号、描述、脚本名模糊搜索 */
export function ChecksPage() {
  const [checks, setChecks] = useState<ProjectCheck[] | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [keyword, setKeyword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [projectFilter, setProjectFilter] = useProjectIdParam()

  useEffect(() => {
    api
      .listChecks()
      .then(setChecks)
      .catch((e: Error) => setError(e.message))
    api.listProjects().then(setProjects).catch(() => undefined)
  }, [])

  const projectName = new Map(projects.map((p) => [p.id, p.name]))

  const q = keyword.trim().toLowerCase()
  const filtered = (checks ?? []).filter((c) => {
    if (projectFilter !== 'all' && String(c.projectId) !== projectFilter) return false
    if (!q) return true
    return (
      c.code.toLowerCase().includes(q) ||
      (c.description?.toLowerCase().includes(q) ?? false) ||
      c.scriptPath.toLowerCase().includes(q)
    )
  })

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">检查</h1>
      </div>

      <div className="mb-4 flex gap-2">
        <ProjectFilterSelect
          projects={projects}
          value={projectFilter}
          onChange={setProjectFilter}
        />
        <Input
          className="w-64"
          placeholder="搜索编号 / 描述 / 脚本名…"
          clearable
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onClear={() => setKeyword('')}
        />
      </div>

      {error && <p className="mb-4 text-sm">加载失败:{error}</p>}

      <Table hoverableRows>
        <TableHeader>
          <TableRow>
            <TableHead className="w-40">编号</TableHead>
            <TableHead>描述</TableHead>
            <TableHead>脚本</TableHead>
            <TableHead>项目</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((c) => (
            <TableRow key={c.id}>
              <TableCell className="max-w-40 truncate" title={c.code}>
                {c.projectId === undefined ? (
                  c.code
                ) : (
                  <Link
                    to={`/projects/${c.projectId}/checks/${c.id}`}
                    className="text-foreground-intense underline"
                  >
                    {c.code}
                  </Link>
                )}
              </TableCell>
              <TableCell className="max-w-md truncate" title={c.description ?? ''}>
                {c.description ?? '—'}
              </TableCell>
              <TableCell className="max-w-md truncate" title={c.scriptPath}>
                {c.scriptPath}
              </TableCell>
              <TableCell className="max-w-64 truncate">
                {c.projectId === undefined ? (
                  '—'
                ) : (
                  <Link
                    to={`/projects/${c.projectId}`}
                    className="text-foreground-intense underline"
                  >
                    {projectName.get(c.projectId) ?? `#${c.projectId}`}
                  </Link>
                )}
              </TableCell>
            </TableRow>
          ))}
          {checks !== null && filtered.length === 0 && (
            <TableRow>
              <TableCell colSpan={4}>
                {checks.length === 0
                  ? '暂无检查，到项目详情页登记或自动导入'
                  : '无匹配的检查'}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
