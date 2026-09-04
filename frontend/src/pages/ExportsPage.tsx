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
import { api, type Project, type ProjectExport } from '../lib/api'
import { ProjectFilterSelect } from '../components/ProjectFilterSelect'
import { useProjectIdParam } from '../components/useProjectIdParam'

/** 导出全局列表：全部项目的导出（编号/描述/脚本/项目），支持编号、描述、脚本名模糊搜索 */
export function ExportsPage() {
  const [exports, setExports] = useState<ProjectExport[] | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [keyword, setKeyword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [projectFilter, setProjectFilter] = useProjectIdParam()

  useEffect(() => {
    api
      .listExports()
      .then(setExports)
      .catch((e: Error) => setError(e.message))
    api.listProjects().then(setProjects).catch(() => undefined)
  }, [])

  const projectName = new Map(projects.map((p) => [p.id, p.name]))

  const q = keyword.trim().toLowerCase()
  const filtered = (exports ?? []).filter((e) => {
    if (projectFilter !== 'all' && String(e.projectId) !== projectFilter) return false
    if (!q) return true
    return (
      e.code.toLowerCase().includes(q) ||
      (e.description?.toLowerCase().includes(q) ?? false) ||
      e.scriptPath.toLowerCase().includes(q)
    )
  })

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">导出</h1>
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
          {filtered.map((e) => (
            <TableRow key={e.id}>
              <TableCell className="max-w-40 truncate" title={e.code}>
                {e.projectId === undefined ? (
                  e.code
                ) : (
                  <Link
                    to={`/projects/${e.projectId}/exports/${e.id}`}
                    className="text-foreground-intense underline"
                  >
                    {e.code}
                  </Link>
                )}
              </TableCell>
              <TableCell className="max-w-md truncate" title={e.description ?? ''}>
                {e.description ?? '—'}
              </TableCell>
              <TableCell className="max-w-md truncate" title={e.scriptPath}>
                {e.scriptPath}
              </TableCell>
              <TableCell className="max-w-64 truncate">
                {e.projectId === undefined ? (
                  '—'
                ) : (
                  <Link
                    to={`/projects/${e.projectId}`}
                    className="text-foreground-intense underline"
                  >
                    {projectName.get(e.projectId) ?? `#${e.projectId}`}
                  </Link>
                )}
              </TableCell>
            </TableRow>
          ))}
          {exports !== null && filtered.length === 0 && (
            <TableRow>
              <TableCell colSpan={4}>
                {exports.length === 0
                  ? '暂无导出，到项目详情页登记或自动导入'
                  : '无匹配的导出'}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
