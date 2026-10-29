import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Badge } from '@appica/ui-react/badge'
import { api, type TicketDetail } from '../lib/api'
import { TicketStatusBadge } from '../components/StatusBadge'
import { TaskDetailView } from './TaskPackageDetailPage'

const CATEGORY_PATH: Record<string, string> = {
  方案工单: '/tickets/solution',
  技术工单: '/tickets/tech',
  数据工单: '/tickets/data',
  运维工单: '/tickets/ops',
  需求工单: '/tickets/requirement',
  BUG反馈: '/tickets/bug',
}

/** 工单详情：顶部工单元信息，主体复用任务详情的对话、流水线、交付物与验收动作 */
export function TicketDetailPage() {
  const { ticketId } = useParams<{ ticketId: string }>()
  const id = Number(ticketId)
  const [ticket, setTicket] = useState<TicketDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    api
      .getTicket(id)
      .then((row) => {
        setTicket(row)
        setError(null)
      })
      .catch((e: Error) => setError(e.message))
  }, [id])

  useEffect(() => {
    load()
    // 工单状态由任务实时推导；任务对话页已有 SSE，这里低频对齐顶部徽标
    const timer = window.setInterval(load, 15_000)
    return () => window.clearInterval(timer)
  }, [load])

  if (!ticket && error) {
    return (
      <p className="rounded-[var(--radius-md)] bg-error-soft px-3 py-2 text-sm text-error-foreground">
        加载失败：{error}
      </p>
    )
  }
  if (!ticket) {
    return <p className="text-sm text-foreground-muted">加载中…</p>
  }
  if (!ticket.task) {
    return (
      <p className="rounded-[var(--radius-md)] bg-error-soft px-3 py-2 text-sm text-error-foreground">
        工单关联的任务已不存在，请检查任务中心
      </p>
    )
  }

  return (
    <TaskDetailView
      taskId={ticket.taskId}
      breadcrumb={[
        { label: ticket.category, to: CATEGORY_PATH[ticket.category] ?? '/tickets/solution' },
        { label: ticket.code },
      ]}
      title={`${ticket.code} ${ticket.title}`}
      extraBadges={
        <>
          <Badge variant="soft" size="sm">
            {ticket.category}
          </Badge>
          <TicketStatusBadge status={ticket.status} />
          <Badge variant="secondary" size="sm">
            责任方 · {ticket.assigneeName}
          </Badge>
        </>
      }
    />
  )
}
