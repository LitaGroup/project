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
  api,
  type Project,
  type ProjectCheck,
  type ProjectTask,
} from '../lib/api'
import { RunStats } from '../components/RunStats'
import { ProjectFilterSelect } from '../components/ProjectFilterSelect'
import { useProjectIdParam } from '../components/useProjectIdParam'

/** 任务全局列表：全部项目的定时任务（标题/计划/脚本/项目/运行），支持标题、脚本名模糊搜索 */
export function TasksPage() {
  const [tasks, setTasks] = useState<ProjectTask[] | null>(null)
  const [checks, setChecks] = useState<ProjectCheck[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [keyword, setKeyword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [projectFilter, setProjectFilter] = useProjectIdParam()

  useEffect(() => {
    api
      .listTasks()
      .then(setTasks)
      .catch((e: Error) => setError(e.message))
    // 脚本列：checkId → 检查登记信息；项目列：projectId → 项目名
    api.listChecks().then(setChecks).catch(() => undefined)
    api.listProjects().then(setProjects).catch(() => undefined)
  }, [])

  const checkOf = new Map(checks.map((c) => [c.id, c]))
  const projectName = new Map(projects.map((p) => [p.id, p.name]))

  const q = keyword.trim().toLowerCase()
  const filtered = (tasks ?? []).filter((t) => {
    if (projectFilter !== 'all' && String(t.projectId) !== projectFilter) return false
    if (!q) return true
    const check = checkOf.get(t.checkId)
    return (
      t.title.toLowerCase().includes(q) ||
      (check?.code.toLowerCase().includes(q) ?? false) ||
      (check?.scriptPath.toLowerCase().includes(q) ?? false)
    )
  })

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">任务</h1>
      </div>

      <div className="mb-4 flex gap-2">
        <ProjectFilterSelect
          projects={projects}
          value={projectFilter}
          onChange={setProjectFilter}
        />
        <Input
          className="w-64"
          placeholder="搜索标题 / 脚本名…"
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
            <TableHead>标题</TableHead>
            <TableHead className="w-44">计划</TableHead>
            <TableHead>脚本</TableHead>
            <TableHead>项目</TableHead>
            <TableHead className="w-24">运行</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((t) => {
            const check = checkOf.get(t.checkId)
            return (
              <TableRow key={t.id}>
                <TableCell className="max-w-md truncate" title={t.title}>
                  <Link
                    to={`/projects/${t.projectId}/tasks/${t.id}`}
                    className="text-foreground-intense underline"
                  >
                    {t.title}
                  </Link>
                </TableCell>
                <TableCell title={`执行周期：${t.cron}`}>
                  {t.enabled
                    ? t.nextRunAt
                      ? new Date(t.nextRunAt).toLocaleString()
                      : '—'
                    : '已停用'}
                </TableCell>
                <TableCell className="max-w-md truncate">
                  {check ? (
                    <Link
                      to={`/projects/${t.projectId}/checks/${check.id}`}
                      className="text-foreground-intense underline"
                      title={check.scriptPath}
                    >
                      {check.code}
                    </Link>
                  ) : (
                    `#${t.checkId}`
                  )}
                </TableCell>
                <TableCell className="max-w-64 truncate">
                  <Link
                    to={`/projects/${t.projectId}`}
                    className="text-foreground-intense underline"
                  >
                    {projectName.get(t.projectId) ?? `#${t.projectId}`}
                  </Link>
                </TableCell>
                <TableCell title="成功/失败/总运行次数（失败含异常）">
                  {t.runStats ? <RunStats stats={t.runStats} /> : '—'}
                </TableCell>
              </TableRow>
            )
          })}
          {tasks !== null && filtered.length === 0 && (
            <TableRow>
              <TableCell colSpan={5}>
                {tasks.length === 0
                  ? '暂无任务，到项目详情页新建定时任务'
                  : '无匹配的任务'}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
