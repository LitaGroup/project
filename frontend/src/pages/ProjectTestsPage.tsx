import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@appica/ui-react/table'
import { ResponsiveTable as Table } from '../components/ResponsiveTable'
import { Input } from '@appica/ui-react/input'
import { Toolbar, ToolbarInput } from '@appica/ui-react/toolbar'
import { api, type Project, type ProjectTest } from '../lib/api'
import { PageBreadcrumb } from '../components/PageBreadcrumb'
import { CountRow } from '../components/CountRow'
import { TestFormDialog } from '../components/TestFormDialog'
import {
  DeleteTestButton,
  ImportTestsButton,
  RunTestButton,
} from '../components/TestActionButtons'

/** 单页展示上限：接口返回项目全量，前端最多渲染 200 条 */
const MAX_TESTS = 200

/** 项目下的用例页：不分页列出本项目全部用例（最多 200 条），支持新建/自动导入/运行/编辑/删除 */
export function ProjectTestsPage() {
  const { id } = useParams<{ id: string }>()
  const projectId = Number(id)

  const [tests, setTests] = useState<ProjectTest[] | null>(null)
  const [project, setProject] = useState<Project | null>(null)
  const [keyword, setKeyword] = useState('')
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(() => {
    api
      .listTests(projectId)
      .then(setTests)
      .catch((e: Error) => setError(e.message))
  }, [projectId])

  useEffect(() => {
    reload()
    api
      .getProject(projectId)
      .then(setProject)
      .catch(() => setProject(null))
  }, [projectId, reload])

  const q = keyword.trim().toLowerCase()
  const filtered = (tests ?? []).filter(
    (t) =>
      !q ||
      t.code.toLowerCase().includes(q) ||
      (t.description ?? '').toLowerCase().includes(q) ||
      t.scriptPath.toLowerCase().includes(q),
  )
  const displayed = filtered.slice(0, MAX_TESTS)

  // 脚本路径显示时去掉与项目脚本目录重叠的前缀（tooltip 仍展示完整路径）
  const dirPrefix = project?.scriptsPath
    ? `${project.scriptsPath.replace(/\/+$/, '')}/`
    : ''
  const displayScriptPath = (p: string) =>
    dirPrefix && p.startsWith(dirPrefix) ? p.slice(dirPrefix.length) : p

  return (
    <div>
      <PageBreadcrumb
        items={[
          { label: '项目', to: '/projects' },
          { label: project?.name ?? '…', to: `/projects/${projectId}` },
          { label: '用例' },
        ]}
      />
      <div className="responsive-page-header mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">用例</h1>
        <div className="responsive-page-actions flex items-center gap-2">
          <ImportTestsButton
            projectId={projectId}
            scriptsPath={project?.scriptsPath ?? null}
            onImported={reload}
          />
          <TestFormDialog projectId={projectId} onSaved={reload} />
        </div>
      </div>
      <Toolbar aria-label="用例搜索" className="mb-4">
        <ToolbarInput
          className="w-64"
          render={
            <Input
              placeholder="搜索编号、描述或脚本…"
              clearable
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onClear={() => setKeyword('')}
              aria-label="搜索编号、描述或脚本"
            />
          }
        />
      </Toolbar>
      {error && <p className="mb-4 text-sm">加载失败:{error}</p>}
      <Table hoverableRows>
        <TableHeader>
          <TableRow>
            <TableHead className="w-40">编号</TableHead>
            <TableHead>描述</TableHead>
            <TableHead>脚本</TableHead>
            <TableHead className="w-48 text-center">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {displayed.map((t) => (
            <TableRow key={t.id}>
              <TableCell>
                <Link
                  to={`/projects/${projectId}/tests/${t.id}`}
                  className="underline"
                >
                  {t.code}
                </Link>
              </TableCell>
              <TableCell className="max-w-md truncate" title={t.description ?? ''}>
                {t.description ?? '—'}
              </TableCell>
              <TableCell className="max-w-md truncate" title={t.scriptPath}>
                {displayScriptPath(t.scriptPath)}
              </TableCell>
              <TableCell className="text-center">
                <div className="flex justify-center gap-2">
                  <RunTestButton test={t} projectId={projectId} />
                  <TestFormDialog projectId={projectId} test={t} onSaved={reload} />
                  <DeleteTestButton test={t} onDeleted={reload} />
                </div>
              </TableCell>
            </TableRow>
          ))}
          {tests !== null && displayed.length === 0 && (
            <TableRow>
              <TableCell colSpan={4}>
                {tests.length === 0
                  ? '本项目暂无用例，点击"添加测试"或"自动导入"创建'
                  : '无符合搜索条件的用例'}
              </TableCell>
            </TableRow>
          )}
          <CountRow
            colSpan={4}
            total={filtered.length}
            displayed={displayed.length}
          />
        </TableBody>
      </Table>
    </div>
  )
}
