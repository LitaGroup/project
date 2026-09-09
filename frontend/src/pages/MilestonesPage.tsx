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
import {
  api,
  MILESTONE_STATUSES,
  type Milestone,
  type Project,
} from '../lib/api'
import { MilestoneStatusBadge } from '../components/StatusBadge'
import { ProjectFilterSelect } from '../components/ProjectFilterSelect'
import { useProjectIdParam } from '../components/useProjectIdParam'

/**
 * 全局节点列表：日期/内容/状态/达成日期/交付人/验收人/项目七列，
 * 支持内容模糊搜索 + 状态筛选（按日期升序，临近的在前）。
 */
export function MilestonesPage() {
  const [milestones, setMilestones] = useState<Milestone[] | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [keyword, setKeyword] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [error, setError] = useState<string | null>(null)
  const [projectFilter, setProjectFilter] = useProjectIdParam()

  useEffect(() => {
    api
      .listMilestones()
      .then(setMilestones)
      .catch((e: Error) => setError(e.message))
    api.listProjects().then(setProjects).catch(() => undefined)
  }, [])

  const projectName = new Map(projects.map((p) => [p.id, p.name]))
  const q = keyword.trim().toLowerCase()
  const filtered = (milestones ?? []).filter(
    (m) =>
      (projectFilter === 'all' || String(m.projectId) === projectFilter) &&
      (!q || m.content.toLowerCase().includes(q)) &&
      (statusFilter === 'all' || m.status === statusFilter),
  )
  const statusItems: Record<string, string> = {
    all: '不限状态',
    ...Object.fromEntries(MILESTONE_STATUSES.map((s) => [s, s])),
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">节点</h1>
      </div>
      <div className="mb-4 flex gap-2">
        <ProjectFilterSelect
          projects={projects}
          value={projectFilter}
          onChange={setProjectFilter}
        />
        <Input
          className="w-64"
          placeholder="搜索内容…"
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
            <TableHead className="w-28">日期</TableHead>
            <TableHead>内容</TableHead>
            <TableHead className="w-24 text-center">状态</TableHead>
            <TableHead className="w-28 text-center">达成日期</TableHead>
            <TableHead className="w-24">交付人</TableHead>
            <TableHead className="w-24">验收人</TableHead>
            <TableHead>项目</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((m) => (
            <TableRow key={m.id}>
              <TableCell>{m.date}</TableCell>
              <TableCell
                className="max-w-md truncate"
                title={m.remark ? `${m.content}\n备注：${m.remark}` : m.content}
              >
                {m.content}
              </TableCell>
              <TableCell className="text-center">
                <MilestoneStatusBadge status={m.status} />
              </TableCell>
              <TableCell className="text-center">
                {m.achieved === 'yes' ? (m.achievedAt ?? '—') : '—'}
              </TableCell>
              <TableCell className="max-w-24 truncate" title={m.deliverer ?? ''}>
                {m.deliverer ?? '—'}
              </TableCell>
              <TableCell className="max-w-24 truncate" title={m.acceptor ?? ''}>
                {m.acceptor ?? '—'}
              </TableCell>
              <TableCell className="max-w-64 truncate">
                <Link
                  to={`/projects/${m.projectId}`}
                  className="text-foreground-intense underline"
                >
                  {projectName.get(m.projectId) ?? `#${m.projectId}`}
                </Link>
              </TableCell>
            </TableRow>
          ))}
          {milestones !== null && filtered.length === 0 && (
            <TableRow>
              <TableCell colSpan={7}>
                {milestones.length === 0
                  ? '暂无节点，到项目详情页"节点"板块添加'
                  : '无匹配的节点'}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
