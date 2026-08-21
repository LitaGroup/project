import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@appica/ui-react/table'
import { api, type Project } from '../lib/api'

/** 全局列表行：名称 + 所属项目（空数组表示无归属，如未登记的脚本） */
export interface ResourceRow {
  key: string
  /** 名称（主显示） */
  name: ReactNode
  /** 名称旁的徽标（如脚本类型） */
  badge?: ReactNode
  /** 名称下的次要信息（如描述、cron 表达式） */
  detail?: ReactNode
  /** 所属项目 id 列表 */
  projectIds: number[]
  /** 名称链接（如检查运行详情页） */
  to?: string
}

/** 全局资源列表页骨架：标题 + 名称/所属项目两列，项目名经 /projects 映射 */
export function ResourceListPage({
  title,
  rows,
  error,
  empty,
}: {
  title: string
  rows: ResourceRow[] | null
  error: string | null
  empty: string
}) {
  const [projects, setProjects] = useState<Project[]>([])
  useEffect(() => {
    api.listProjects().then(setProjects).catch(() => undefined)
  }, [])
  const projectName = new Map(projects.map((p) => [p.id, p.name]))

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{title}</h1>
      </div>

      {error && <p className="mb-4 text-sm">加载失败:{error}</p>}

      <Table hoverableRows>
        <TableHeader>
          <TableRow>
            <TableHead>名称</TableHead>
            <TableHead className="w-64">所属项目</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(rows ?? []).map((row) => (
            <TableRow key={row.key}>
              <TableCell className="max-w-xl">
                <div className="flex items-center gap-2">
                  {row.to ? (
                    <Link
                      to={row.to}
                      className="truncate text-foreground-intense underline"
                      title={typeof row.name === 'string' ? row.name : undefined}
                    >
                      {row.name}
                    </Link>
                  ) : (
                    <span
                      className="truncate"
                      title={typeof row.name === 'string' ? row.name : undefined}
                    >
                      {row.name}
                    </span>
                  )}
                  {row.badge}
                </div>
                {row.detail && (
                  <div className="mt-0.5 truncate text-xs">{row.detail}</div>
                )}
              </TableCell>
              <TableCell className="max-w-64">
                {row.projectIds.length === 0
                  ? '—'
                  : row.projectIds.map((pid, i) => (
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
          {rows !== null && rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={2}>{empty}</TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
