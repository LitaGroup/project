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
import { Toolbar, ToolbarInput } from '@appica/ui-react/toolbar'
import {
  api,
  type Project,
  type ProjectCheck,
  type ProjectSchedule,
} from '../lib/api'
import { RunStats } from '../components/RunStats'
import { ProjectFilterSelect } from '../components/ProjectFilterSelect'
import { useProjectIdParam } from '../components/useProjectIdParam'

/** 定时任务全局列表：全部项目的定时任务（标题/计划/脚本/项目/运行），支持标题、脚本名模糊搜索 */
export function SchedulesPage() {
  const [schedules, setSchedules] = useState<ProjectSchedule[] | null>(null)
  const [checks, setChecks] = useState<ProjectCheck[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [keyword, setKeyword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [projectFilter, setProjectFilter] = useProjectIdParam()

  useEffect(() => {
    api
      .listSchedules()
      .then(setSchedules)
      .catch((e: Error) => setError(e.message))
    // 脚本列：checkId → 检查登记信息；项目列：projectId → 项目名
    api.listChecks().then(setChecks).catch(() => undefined)
    api.listProjects().then(setProjects).catch(() => undefined)
  }, [])

  const checkOf = new Map(checks.map((c) => [c.id, c]))
  const projectName = new Map(projects.map((p) => [p.id, p.name]))

  const q = keyword.trim().toLowerCase()
  const filtered = (schedules ?? []).filter((s) => {
    if (projectFilter !== 'all' && String(s.projectId) !== projectFilter)
      return false
    if (!q) return true
    const check = checkOf.get(s.checkId)
    return (
      s.title.toLowerCase().includes(q) ||
      (check?.code.toLowerCase().includes(q) ?? false) ||
      (check?.scriptPath.toLowerCase().includes(q) ?? false)
    )
  })

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">定时任务</h1>
      </div>

      <Toolbar aria-label="定时任务筛选" className="mb-4">
        <ToolbarInput
          className="w-64"
          render={
            <Input
              placeholder="搜索标题 / 脚本名…"
              clearable
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onClear={() => setKeyword('')}
              aria-label="搜索标题或脚本名"
            />
          }
        />
        <ProjectFilterSelect
          projects={projects}
          value={projectFilter}
          onChange={setProjectFilter}
        />
      </Toolbar>

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
          {filtered.map((s) => {
            const check = checkOf.get(s.checkId)
            return (
              <TableRow key={s.id}>
                <TableCell className="max-w-md truncate" title={s.title}>
                  <Link
                    to={`/projects/${s.projectId}/schedules/${s.id}`}
                    className="text-foreground-intense underline"
                  >
                    {s.title}
                  </Link>
                </TableCell>
                <TableCell title={`执行周期：${s.cron}`}>
                  {s.enabled
                    ? s.nextRunAt
                      ? new Date(s.nextRunAt).toLocaleString()
                      : '—'
                    : '已停用'}
                </TableCell>
                <TableCell className="max-w-md truncate">
                  {check ? (
                    <Link
                      to={`/projects/${s.projectId}/checks/${check.id}`}
                      className="text-foreground-intense underline"
                      title={check.scriptPath}
                    >
                      {check.code}
                    </Link>
                  ) : (
                    `#${s.checkId}`
                  )}
                </TableCell>
                <TableCell className="max-w-64 truncate">
                  <Link
                    to={`/projects/${s.projectId}`}
                    className="text-foreground-intense underline"
                  >
                    {projectName.get(s.projectId) ?? `#${s.projectId}`}
                  </Link>
                </TableCell>
                <TableCell title="成功/失败/总运行次数（失败含异常）">
                  {s.runStats ? <RunStats stats={s.runStats} /> : '—'}
                </TableCell>
              </TableRow>
            )
          })}
          {schedules !== null && filtered.length === 0 && (
            <TableRow>
              <TableCell colSpan={5}>
                {schedules.length === 0
                  ? '暂无定时任务，到项目详情页新建'
                  : '无匹配的定时任务'}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
