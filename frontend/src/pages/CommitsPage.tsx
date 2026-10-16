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
import { Badge } from '@appica/ui-react/badge'
import { Button } from '@appica/ui-react/button'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@appica/ui-react/select'
import { api, type CodeEvent, type Project } from '../lib/api'
import { ProjectFilterSelect } from '../components/ProjectFilterSelect'
import { useProjectIdParam } from '../components/useProjectIdParam'

/** 分支快捷筛选取值（不限 + 常见监听分支；其余分支经搜索框过滤） */
const BRANCH_FILTERS = ['test', 'main', 'stable'] as const

/**
 * 全局代码提交列表：监听到的 GitHub 提交/合并记录（append-only）。
 * 提交时间/仓库/分支/提交信息/作者/项目六列，支持 信息·作者·仓库 模糊搜索 +
 * 分支快捷筛选；项目过滤走服务端（匹配该项目登记的 仓库+分支），按提交时间倒序。
 */
export function CommitsPage() {
  const [events, setEvents] = useState<CodeEvent[] | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [keyword, setKeyword] = useState('')
  const [branchFilter, setBranchFilter] = useState('all')
  const [error, setError] = useState<string | null>(null)
  const [projectFilter, setProjectFilter] = useProjectIdParam()

  useEffect(() => {
    api
      .listCodeEvents({
        projectId: projectFilter === 'all' ? undefined : Number(projectFilter),
        limit: 200,
      })
      .then(setEvents)
      .catch((e: Error) => setError(e.message))
  }, [projectFilter])

  useEffect(() => {
    api.listProjects().then(setProjects).catch(() => undefined)
  }, [])

  const q = keyword.trim().toLowerCase()
  const filtered = (events ?? [])
    .filter((e) => branchFilter === 'all' || e.branch === branchFilter)
    .filter(
      (e) =>
        !q ||
        e.message.toLowerCase().includes(q) ||
        (e.author ?? '').toLowerCase().includes(q) ||
        e.repo.toLowerCase().includes(q),
    )
  const branchItems: Record<string, string> = {
    all: '不限分支',
    ...Object.fromEntries(BRANCH_FILTERS.map((b) => [b, b])),
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">代码提交</h1>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            api
              .listCodeEvents({
                projectId:
                  projectFilter === 'all' ? undefined : Number(projectFilter),
                limit: 200,
              })
              .then(setEvents)
              .catch((e: Error) => setError(e.message))
          }}
        >
          刷新
        </Button>
      </div>
      <div className="mb-4 flex gap-2">
        <ProjectFilterSelect
          projects={projects}
          value={projectFilter}
          onChange={setProjectFilter}
        />
        <Input
          className="w-72"
          placeholder="搜索 提交信息 / 作者 / 仓库…"
          clearable
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onClear={() => setKeyword('')}
        />
        <Select
          value={branchFilter}
          onValueChange={(v) => setBranchFilter(v as string)}
          items={branchItems}
        >
          <SelectTrigger className="w-36">
            <SelectValue placeholder="分支" />
          </SelectTrigger>
          <SelectContent>
            {Object.keys(branchItems).map((b) => (
              <SelectItem key={b} value={b}>
                {branchItems[b]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {error && <p className="mb-4 text-sm">加载失败:{error}</p>}
      <Table hoverableRows>
        <TableHeader>
          <TableRow>
            <TableHead className="w-44">提交时间</TableHead>
            <TableHead className="w-56">仓库</TableHead>
            <TableHead className="w-36">分支</TableHead>
            <TableHead>提交信息</TableHead>
            <TableHead className="w-28">作者</TableHead>
            <TableHead className="w-48">项目</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((e) => (
            <TableRow key={e.id}>
              <TableCell>{new Date(e.committedAt).toLocaleString()}</TableCell>
              <TableCell className="max-w-56 truncate" title={e.repo}>
                <a
                  href={`https://github.com/${e.repo}`}
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  {e.repo}
                </a>
              </TableCell>
              <TableCell>
                <span className="flex items-center gap-1">
                  {e.branch}
                  {e.isMerge && (
                    <Badge variant="info" title="合并提交（parents > 1）">
                      合并
                    </Badge>
                  )}
                </span>
              </TableCell>
              <TableCell
                className="max-w-md truncate"
                title={e.url ?? e.message}
              >
                {e.url ? (
                  <a
                    href={e.url}
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    {(e.message.split('\n')[0] ?? '').trim()}
                  </a>
                ) : (
                  (e.message.split('\n')[0] ?? '').trim()
                )}
              </TableCell>
              <TableCell className="max-w-28 truncate" title={e.author ?? ''}>
                {e.author ?? '—'}
              </TableCell>
              <TableCell className="max-w-48 truncate">
                {e.projects.length > 0 ? (
                  <span className="flex gap-2">
                    {e.projects.slice(0, 2).map((p) => (
                      <Link
                        key={p.id}
                        to={`/projects/${p.id}`}
                        className="text-foreground-intense underline"
                        title={e.projects.map((x) => x.name).join('、')}
                      >
                        {p.name}
                      </Link>
                    ))}
                    {e.projects.length > 2 && (
                      <span
                        className="text-foreground-muted"
                        title={e.projects.map((x) => x.name).join('、')}
                      >
                        +{e.projects.length - 2}
                      </span>
                    )}
                  </span>
                ) : (
                  '—'
                )}
              </TableCell>
            </TableRow>
          ))}
          {events !== null && filtered.length === 0 && (
            <TableRow>
              <TableCell colSpan={6}>
                {events.length === 0
                  ? '暂无提交记录，到项目详情页"代码分支"板块登记 仓库+分支 后自动监听'
                  : '无匹配的提交'}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      <p className="mt-4 text-xs text-foreground-muted">
        监听范围：各项目「代码分支」登记的 仓库+分支（去重），每分钟轮询一次；GitHub 连接状态见设置页。
      </p>
    </div>
  )
}
