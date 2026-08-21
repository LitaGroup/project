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
import { api, type Project, type ProjectTest } from '../lib/api'

/** 用例全局列表：全部项目的测试用例（编号/描述/脚本/项目），支持编号、描述、脚本名模糊搜索 */
export function TestsPage() {
  const [tests, setTests] = useState<ProjectTest[] | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [keyword, setKeyword] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .listTests()
      .then(setTests)
      .catch((e: Error) => setError(e.message))
    api.listProjects().then(setProjects).catch(() => undefined)
  }, [])

  const projectName = new Map(projects.map((p) => [p.id, p.name]))

  const q = keyword.trim().toLowerCase()
  const filtered = (tests ?? []).filter((t) => {
    if (!q) return true
    return (
      t.code.toLowerCase().includes(q) ||
      (t.description?.toLowerCase().includes(q) ?? false) ||
      t.scriptPath.toLowerCase().includes(q)
    )
  })

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">用例</h1>
      </div>

      <div className="mb-4 flex gap-2">
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
          {filtered.map((t) => (
            <TableRow key={t.id}>
              <TableCell className="max-w-40 truncate" title={t.code}>
                {t.projectId === undefined ? (
                  t.code
                ) : (
                  <Link
                    to={`/projects/${t.projectId}/tests/${t.id}`}
                    className="text-foreground-intense underline"
                  >
                    {t.code}
                  </Link>
                )}
              </TableCell>
              <TableCell className="max-w-md truncate" title={t.description ?? ''}>
                {t.description ?? '—'}
              </TableCell>
              <TableCell className="max-w-md truncate" title={t.scriptPath}>
                {t.scriptPath}
              </TableCell>
              <TableCell className="max-w-64 truncate">
                {t.projectId === undefined ? (
                  '—'
                ) : (
                  <Link
                    to={`/projects/${t.projectId}`}
                    className="text-foreground-intense underline"
                  >
                    {projectName.get(t.projectId) ?? `#${t.projectId}`}
                  </Link>
                )}
              </TableCell>
            </TableRow>
          ))}
          {tests !== null && filtered.length === 0 && (
            <TableRow>
              <TableCell colSpan={4}>
                {tests.length === 0
                  ? '暂无用例，到项目详情页登记或自动导入'
                  : '无匹配的用例'}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
