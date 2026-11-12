import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '@appica/ui-react/badge'
import { buttonVariants } from '@appica/ui-react/button'
import { Card, CardHeader, CardTitle } from '@appica/ui-react/card'
import {
  api,
  BACKLOG_STATUSES,
  type BacklogStatus,
  type IterationSummary,
} from '../lib/api'
import { IterationStatusBadge } from '../components/StatusBadge'
import { useAuth } from '../context/AuthContext'

/**
 * 迭代：T0 快速通道 + W1 周迭代，由 backlog 组成。
 * T0 常驻、需求确认即开发、开发完成即可上线；W1 按周进行，有唯一标识与起止日期。
 */
export function IterationsPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === '管理员'
  const [items, setItems] = useState<IterationSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .listIterations()
      .then((r) => {
        if (cancelled) return
        setItems(r)
        setError(null)
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const summary = useMemo(() => {
    if (!items) return null
    const w1 = items.filter((item) => item.type === 'W1')
    const current = w1.find((item) => item.current)
    return {
      total: items.length,
      w1: w1.length,
      current: current?.code ?? '未命中',
      backlogTotal: items.reduce((sum, item) => sum + item.total, 0),
      done: items.reduce((sum, item) => sum + item.done, 0),
    }
  }, [items])

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">迭代</h1>
          <p className="mt-1 text-sm">
            T0 快速通道 + W1 周迭代；迭代由 backlog 组成，需求转入时指定负责人
          </p>
        </div>
        <div className="flex items-center gap-3">
          <a
            href="/api/iterations.md"
            target="_blank"
            rel="noreferrer"
            className="text-sm underline"
            title="Markdown 视图"
          >
            MD
          </a>
          {isAdmin && (
            <Link to="/iterations/new" className={buttonVariants()}>
              新建 W1 迭代
            </Link>
          )}
        </div>
      </div>

      {error && <p className="mb-4 text-sm">加载失败:{error}</p>}

      {summary && (
        <div className="mb-4 flex flex-wrap gap-3">
          <IterationStat label="迭代数" value={summary.total} />
          <IterationStat label="W1 迭代" value={summary.w1} />
          <IterationStat label="当前迭代" value={summary.current} />
          <IterationStat
            label="迭代项 / 完成"
            value={`${summary.done}/${summary.backlogTotal}`}
          />
        </div>
      )}

      {!items && !error && (
        <p className="text-sm text-foreground-muted">加载中…</p>
      )}

      <div className="flex flex-col gap-3">
        {(items ?? []).map((iteration) => (
          <Card
            key={iteration.id}
            className={iteration.current ? 'ring-1 ring-foreground-intense' : undefined}
          >
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-3 text-base">
                {iteration.type === 'T0' ? (
                  <Badge variant="primary">T0</Badge>
                ) : (
                  <span className="font-mono">{iteration.code}</span>
                )}
                <Link to={`/iterations/${iteration.id}`} className="underline">
                  {iteration.name}
                </Link>
                {iteration.type === 'W1' && (
                  <span className="text-sm text-foreground-muted">
                    {iteration.startAt ?? '?'} ~ {iteration.endAt ?? '?'}
                  </span>
                )}
                {iteration.current && <Badge variant="soft">当前迭代</Badge>}
                <IterationStatusBadge status={iteration.status} />
                <span className="ml-auto text-sm text-foreground-muted">
                  共 {iteration.total} 条
                </span>
              </CardTitle>
              <div className="mt-2 flex items-center gap-3">
                <div className="h-1.5 min-w-32 flex-1 overflow-hidden rounded-full bg-background">
                  <div
                    className="h-full rounded-full bg-foreground-intense"
                    style={{ width: `${iteration.percent}%` }}
                  />
                </div>
                <span className="w-16 text-right text-sm text-foreground-muted">
                  {iteration.percent}% 完成
                </span>
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-foreground-muted">
                  {BACKLOG_STATUSES.filter(
                    (status: BacklogStatus) =>
                      (iteration.statusCounts[status] ?? 0) > 0,
                  ).map((status) => (
                    <span key={status}>
                      {status} {iteration.statusCounts[status]}
                    </span>
                  ))}
                  {iteration.total === 0 && <span>暂无迭代项</span>}
                </span>
              </div>
            </CardHeader>
          </Card>
        ))}
        {items && items.length === 0 && (
          <p className="text-sm text-foreground-muted">
            暂无迭代；管理员可新建 W1 迭代或向 T0 快速通道转入需求。
          </p>
        )}
      </div>
    </div>
  )
}

function IterationStat({
  label,
  value,
}: {
  label: string
  value: string | number
}) {
  return (
    <Card className="min-w-40">
      <CardHeader>
        <CardTitle className="text-sm font-medium text-foreground-muted">
          {label}
        </CardTitle>
        <p className="text-xl font-semibold text-foreground-intense">{value}</p>
      </CardHeader>
    </Card>
  )
}