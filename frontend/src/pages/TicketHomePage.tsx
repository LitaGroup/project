import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { buttonVariants } from '@appica/ui-react/button'
import { api, type TicketWorkflowDefinitionSummary } from '../lib/api'
import { PageBreadcrumb } from '../components/PageBreadcrumb'

/** 顶部「工单」默认页：进入第一个可用工单配置；没有可用配置时引导管理员配置 */
export function TicketHomePage() {
  const [rows, setRows] = useState<TicketWorkflowDefinitionSummary[] | null>(
    null,
  )
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .listTicketWorkflowDefinitions()
      .then(setRows)
      .catch((e: Error) => setError(e.message))
  }, [])

  const first = rows?.find(
    (row) => row.enabled && row.latestPublishedVersion > 0,
  )
  if (first) return <Navigate replace to={`/tickets/wf/${first.id}`} />

  return (
    <div className="flex flex-col gap-4">
      <PageBreadcrumb items={[{ label: '工单' }]} />
      <h1 className="text-2xl font-semibold">工单</h1>
      {error && (
        <p className="rounded-[var(--radius-md)] bg-error-muted px-3 py-2 text-sm text-error-foreground">
          加载失败：{error}
        </p>
      )}
      <div className="rounded-[var(--radius-lg)] border border-dashed border-border-strong px-6 py-14 text-center">
        <p className="text-sm text-foreground-muted">
          {rows === null
            ? '加载工单配置中…'
            : '还没有启用且已发布的工单配置。请先在管理区创建并发布工单配置。'}
        </p>
        {rows !== null && (
          <Link
            to="/admin/ticket-config"
            className={`${buttonVariants({ size: 'sm' })} mt-4 inline-flex`}
          >
            前往工单配置
          </Link>
        )}
      </div>
    </div>
  )
}
