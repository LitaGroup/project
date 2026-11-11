import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '@appica/ui-react/badge'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@appica/ui-react/table'
import { Card, CardHeader, CardTitle } from '@appica/ui-react/card'
import { ChevronDown, ChevronRight } from '@appica/icons-react'
import { api, PROJECT_STATUSES, type IterationGroup } from '../lib/api'
import { StatusBadge } from '../components/StatusBadge'
import { TypeBadge, PriorityBadge } from '../components/ProjectBadges'

/** 已终结（发布/关闭）占比作为迭代进度 */
const DONE_STATUSES = ['已发布', '已关闭'] as const

function doneCount(group: IterationGroup): number {
  return DONE_STATUSES.reduce(
    (sum, s) => sum + (group.statusCounts[s] ?? 0),
    0,
  )
}

/**
 * 迭代：计划要做的事情，从需求池排期而来。
 * 按迭代周期（w 编号 + 日期区间）分组展示需求清单与状态进度；数据来自 GET /projects/iterations。
 */
export function IterationsPage() {
  const [groups, setGroups] = useState<IterationGroup[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // 展开的迭代组（cycle 键）：加载后默认只展开当前迭代
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    api
      .listProjectIterations()
      .then((r) => {
        if (cancelled) return
        setGroups(r)
        const current = r.find((g) => g.current)
        setExpanded(new Set(current ? [current.cycle] : []))
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const toggle = (cycle: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(cycle)) next.delete(cycle)
      else next.add(cycle)
      return next
    })

  const summary = useMemo(() => {
    if (!groups) return null
    const iterations = groups.filter((g) => g.week !== null)
    const current = iterations.find((g) => g.current)
    return {
      iterations: iterations.length,
      total: groups.reduce((s, g) => s + g.total, 0),
      done: groups.reduce((s, g) => s + doneCount(g), 0),
      current,
    }
  }, [groups])

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-2xl font-semibold">迭代</h1>
        <p className="mt-1 text-sm">
          从需求池排期而来的计划事项，按迭代周期分组，反映当前进度
        </p>
      </div>

      {error && <p className="mb-4 text-sm">加载失败:{error}</p>}

      {summary && (
        <div className="mb-4 flex flex-wrap gap-3">
          <IterationStat label="迭代数" value={summary.iterations} />
          <IterationStat
            label="当前迭代"
            value={summary.current?.cycle ?? '未命中'}
          />
          <IterationStat label="排期需求" value={summary.total} />
          <IterationStat label="已发布 / 已关闭" value={summary.done} />
        </div>
      )}

      {!groups && !error && <p className="text-sm text-foreground-muted">加载中…</p>}

      <div className="flex flex-col gap-3">
        {(groups ?? []).map((g) => {
          const open = expanded.has(g.cycle)
          const done = doneCount(g)
          const percent = g.total === 0 ? 0 : Math.round((done / g.total) * 100)
          const unscheduled = g.cycle === '-'
          return (
            <Card key={g.cycle} className={g.current ? 'ring-1 ring-foreground-intense' : undefined}>
              <CardHeader
                className="cursor-pointer select-none"
                onClick={() => toggle(g.cycle)}
              >
                <CardTitle className="flex items-center gap-3 text-base">
                  {open ? (
                    <ChevronDown size={16} className="shrink-0" />
                  ) : (
                    <ChevronRight size={16} className="shrink-0" />
                  )}
                  {unscheduled ? (
                    <span className="text-foreground-muted">未排期</span>
                  ) : (
                    <span className="font-mono">{g.cycle}</span>
                  )}
                  {g.dateRange && (
                    <span className="text-sm text-foreground-muted">{g.dateRange}</span>
                  )}
                  {g.current && <Badge variant="soft">当前迭代</Badge>}
                  <span className="ml-auto text-sm text-foreground-muted">
                    共 {g.total} 条
                  </span>
                </CardTitle>
                {!unscheduled && (
                  <div className="mt-2 flex items-center gap-3">
                    <div className="h-1.5 min-w-32 flex-1 overflow-hidden rounded-full bg-background">
                      <div
                        className="h-full rounded-full bg-foreground-intense"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                    <span className="w-16 text-right text-sm text-foreground-muted">
                      {percent}% 完成
                    </span>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-foreground-muted">
                      {PROJECT_STATUSES.filter((s) => (g.statusCounts[s] ?? 0) > 0).map(
                        (s) => (
                          <span key={s}>
                            {s} {g.statusCounts[s]}
                          </span>
                        ),
                      )}
                    </span>
                  </div>
                )}
              </CardHeader>
              {open && (
                <div className="px-4 pb-4">
                  <Table hoverableRows>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-20">ID</TableHead>
                        <TableHead>需求</TableHead>
                        <TableHead className="text-center">类型</TableHead>
                        <TableHead className="text-center">优先级</TableHead>
                        <TableHead className="text-center whitespace-nowrap">预期</TableHead>
                        <TableHead className="text-center">状态</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {g.items.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell>{p.id}</TableCell>
                          <TableCell className="max-w-md truncate" title={p.name}>
                            <Link to={`/projects/${p.id}`} className="underline">
                              {p.name}
                            </Link>
                          </TableCell>
                          <TableCell className="text-center">
                            <TypeBadge type={p.type} />
                          </TableCell>
                          <TableCell className="text-center">
                            {p.priority ? (
                              <PriorityBadge priority={p.priority} />
                            ) : (
                              '—'
                            )}
                          </TableCell>
                          <TableCell className="text-center whitespace-nowrap">
                            {p.expectedReleaseAt ?? '未定'}
                          </TableCell>
                          <TableCell className="text-center">
                            <StatusBadge status={p.status} />
                          </TableCell>
                        </TableRow>
                      ))}
                      {g.items.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={6}>该迭代暂无需求</TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              )}
            </Card>
          )
        })}
      </div>
    </div>
  )
}

function IterationStat({ label, value }: { label: string; value: string | number }) {
  return (
    <Card className="min-w-40">
      <CardHeader>
        <CardTitle className="text-sm font-medium text-foreground-muted">{label}</CardTitle>
        <p className="text-xl font-semibold text-foreground-intense">{value}</p>
      </CardHeader>
    </Card>
  )
}
