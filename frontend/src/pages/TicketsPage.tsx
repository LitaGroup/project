import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '@appica/ui-react/badge'
import { buttonVariants } from '@appica/ui-react/button'
import { Input } from '@appica/ui-react/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@appica/ui-react/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@appica/ui-react/table'
import { Toolbar, ToolbarInput } from '@appica/ui-react/toolbar'
import {
  api,
  type Ticket,
  type TicketStatus,
  type TicketWorkflowDefinitionDetail,
} from '../lib/api'
import { PageBreadcrumb } from '../components/PageBreadcrumb'
import { TicketStatusBadge } from '../components/StatusBadge'

const TICKET_STATUSES: TicketStatus[] = [
  '处理中',
  '待验收',
  '已完成',
  '已失败',
  '已取消',
  '待分配',
  '待接受',
  '待反馈',
  '待继续',
  '待申请验收',
]

const STATUS_ITEMS = {
  all: '全部状态',
  ...Object.fromEntries(TICKET_STATUSES.map((status) => [status, status])),
}

interface TicketsPageProps {
  /** 指定工单配置时仅展示该配置下的工单（保留按配置进入的链接） */
  definitionId?: number
  /** 全部工单 / 当前用户参与的工单 */
  scope?: 'all' | 'mine'
}

/** 工单列表：支持指定配置、全部工单与我的工单 */
export function TicketsPage({ definitionId, scope = 'all' }: TicketsPageProps) {
  const [definition, setDefinition] =
    useState<TicketWorkflowDefinitionDetail | null>(null)
  const [tickets, setTickets] = useState<Ticket[] | null>(null)
  const [keyword, setKeyword] = useState('')
  const [status, setStatus] = useState('all')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!definitionId) return
    let alive = true
    api
      .getTicketWorkflowDefinition(definitionId)
      .then((workflow) => {
        if (alive) setDefinition(workflow)
      })
      .catch((e: Error) => {
        if (alive) setError(e.message)
      })
    return () => {
      alive = false
    }
  }, [definitionId])

  const reload = useCallback(() => {
    const statusFilter = status === 'all' ? undefined : status
    const query = keyword.trim() || undefined
    // 工单配置页面只展示该配置下的工单，配置信息同时用于页面标题与「新建工单」入口
    const request = api.listTickets(
      definitionId
        ? {
            workflowDefinitionId: definitionId,
            status: statusFilter,
            q: query,
          }
        : {
            scope: scope === 'mine' ? 'mine' : undefined,
            status: statusFilter,
            q: query,
          },
    )
    request
      .then((rows) => {
        setTickets(rows)
        setError(null)
      })
      .catch((e: Error) => setError(e.message))
  }, [definitionId, keyword, scope, status])

  useEffect(() => {
    const timer = window.setTimeout(reload, 250)
    return () => window.clearTimeout(timer)
  }, [reload])

  const basePath = definitionId ? `/tickets/wf/${definitionId}` : null
  const available = Boolean(definition?.enabled && definition.latestPublishedVersion)
  const title = definitionId
    ? (definition?.name ?? '工单配置')
    : scope === 'mine'
      ? '我的工单'
      : '工单列表'
  const description = definitionId
    ? (definition?.description || '按已发布工作流受理和推进的工单')
    : scope === 'mine'
      ? '我参与的全部工单'
      : '全部工单'
  const emptyText = definitionId
    ? available
      ? '暂无工单，点右上角「新建工单」创建'
      : '该工单配置还没有发布版本'
    : scope === 'mine'
      ? '你还没有参与过工单，可从右上角「+」新建工单'
      : '暂无工单'

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <PageBreadcrumb items={[{ label: '工单' }, { label: title }]} />
          <h1 className="mt-2 text-2xl font-semibold">{title}</h1>
          <p className="mt-1 text-sm text-foreground-muted">{description}</p>
        </div>
        {definitionId &&
          (available ? (
            <Link
              to={`${basePath}/new`}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              新建工单
            </Link>
          ) : (
            <Badge variant="soft">配置未发布，暂不能新建</Badge>
          ))}
      </div>

      {error && <p className="text-sm text-error-foreground">加载失败：{error}</p>}

      <Toolbar aria-label="工单筛选">
        <ToolbarInput
          className="w-64"
          render={
            <Input
              placeholder="搜索工单编号 / 标题…"
              clearable
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              onClear={() => setKeyword('')}
              aria-label="搜索工单编号或标题"
            />
          }
        />
        <Select
          value={status}
          onValueChange={(value) => setStatus((value as string) || 'all')}
          items={STATUS_ITEMS}
        >
          <SelectTrigger className="w-36">
            <SelectValue placeholder="状态" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部状态</SelectItem>
            {TICKET_STATUSES.map((item) => (
              <SelectItem key={item} value={item}>
                {item}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Toolbar>

      <Table hoverableRows>
        <TableHeader>
          <TableRow>
            <TableHead className="w-28 text-center">编号</TableHead>
            <TableHead>标题</TableHead>
            <TableHead className="w-40 text-center">当前节点</TableHead>
            <TableHead className="w-32 text-center">状态</TableHead>
            <TableHead className="w-32 text-center">发起人</TableHead>
            <TableHead className="w-44 text-center">创建时间</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(tickets ?? []).map((ticket) => (
            <TableRow key={ticket.id}>
              <TableCell className="text-center">
                <Link
                  to={`/tickets/${ticket.id}`}
                  className="font-mono text-xs font-medium hover:underline"
                >
                  {ticket.code}
                </Link>
              </TableCell>
              <TableCell className="max-w-96 truncate font-medium" title={ticket.title}>
                <Link to={`/tickets/${ticket.id}`} className="hover:underline">
                  {ticket.title}
                </Link>
              </TableCell>
              <TableCell className="text-center text-sm">
                {ticket.currentNodeName || '—'}
              </TableCell>
              <TableCell className="text-center">
                <TicketStatusBadge status={ticket.status} />
              </TableCell>
              <TableCell className="text-center">
                {ticket.initiatorWorkerName ?? ticket.createdByName}
              </TableCell>
              <TableCell className="text-center text-xs text-foreground-muted">
                {new Date(ticket.createdAt).toLocaleString()}
              </TableCell>
            </TableRow>
          ))}
          {tickets !== null && tickets.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-foreground-muted">
                {emptyText}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
