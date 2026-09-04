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
import { Badge } from '@appica/ui-react/badge'
import { Input } from '@appica/ui-react/input'
import { api, type Project } from '../lib/api'

interface ScriptRow {
  path: string
  kind: '检查' | '用例' | '导出'
  /** 登记了该脚本的项目 id 列表（空表示未登记） */
  projectIds: number[]
}

/**
 * 脚本全局列表：扫描脚本根目录下全部 .check.ts / .test.ts / .export.ts（脚本/类型/项目），
 * 所属项目取登记了该脚本的检查/用例/导出（未登记显示 —），支持脚本路径模糊搜索。
 */
export function ScriptsPage() {
  const [rows, setRows] = useState<ScriptRow[] | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [keyword, setKeyword] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.listProjects().then(setProjects).catch(() => undefined)
    Promise.all([
      api.listCheckScripts(),
      api.listTestScripts(),
      api.listExportScripts(),
      api.listChecks(),
      api.listTests(),
      api.listExports(),
    ])
      .then(([checkScripts, testScripts, exportScripts, checks, tests, exports]) => {
        // scriptPath → 登记它的项目 id 集合
        const owners = new Map<string, Set<number>>()
        const register = (scriptPath: string, projectId?: number) => {
          if (projectId === undefined) return
          const set = owners.get(scriptPath) ?? new Set<number>()
          set.add(projectId)
          owners.set(scriptPath, set)
        }
        checks.forEach((c) => register(c.scriptPath, c.projectId))
        tests.forEach((t) => register(t.scriptPath, t.projectId))
        exports.forEach((e) => register(e.scriptPath, e.projectId))

        const toRow = (path: string, kind: '检查' | '用例' | '导出'): ScriptRow => ({
          path,
          kind,
          projectIds: [...(owners.get(path) ?? [])],
        })
        setRows([
          ...checkScripts.map((p) => toRow(p, '检查')),
          ...testScripts.map((p) => toRow(p, '用例')),
          ...exportScripts.map((p) => toRow(p, '导出')),
        ])
      })
      .catch((e: Error) => setError(e.message))
  }, [])

  const projectName = new Map(projects.map((p) => [p.id, p.name]))

  const q = keyword.trim().toLowerCase()
  const filtered = (rows ?? []).filter(
    (r) => !q || r.path.toLowerCase().includes(q),
  )

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">脚本</h1>
      </div>

      <div className="mb-4 flex gap-2">
        <Input
          className="w-64"
          placeholder="搜索脚本路径…"
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
            <TableHead>脚本</TableHead>
            <TableHead className="w-24">类型</TableHead>
            <TableHead className="w-64">项目</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((r) => (
            <TableRow key={`${r.kind}:${r.path}`}>
              <TableCell className="max-w-xl truncate" title={r.path}>
                {r.path}
              </TableCell>
              <TableCell>
                <Badge variant="secondary">{r.kind}</Badge>
              </TableCell>
              <TableCell className="max-w-64">
                {r.projectIds.length === 0
                  ? '—'
                  : r.projectIds.map((pid, i) => (
                      <span key={pid}>
                        {i > 0 && '、'}
                        <Link
                          to={`/projects/${pid}`}
                          className="text-foreground-intense underline"
                        >
                          {projectName.get(pid) ?? `#${pid}`}
                        </Link>
                      </span>
                    ))}
              </TableCell>
            </TableRow>
          ))}
          {rows !== null && filtered.length === 0 && (
            <TableRow>
              <TableCell colSpan={3}>
                {rows.length === 0
                  ? '脚本目录下暂无 .check.ts / .test.ts / .export.ts 脚本'
                  : '无匹配的脚本'}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
