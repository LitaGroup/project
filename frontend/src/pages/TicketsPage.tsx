import { useCallback, useEffect, useMemo, useState } from 'react'
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
  TICKET_CATEGORY_DEFINITIONS,
  type Ticket,
  type TicketCategory,
  type TicketStatus,
} from '../lib/api'
import { PageBreadcrumb } from '../components/PageBreadcrumb'
import { TicketStatusBadge } from '../components/StatusBadge'

const TICKET_STATUSES: TicketStatus[] = [
  '待分配',
  '待接受',
  '待反馈',
  '待继续',
  '待验收',
  '处理中',
  '已完成',
  '已失败',
  '已取消',
]

const STATUS_ITEMS = {
  all: '全部状态',
  ...Object.fromEntries(TICKET_STATUSES.map((status) => [status, status])),
}

const CATEGORY_PATH: Record<string, string> = {
  方案工单: '/tickets/solution',
  技术工单: '/tickets/tech',
  数据工单: '/tickets/data',
  运维工单: '/tickets/ops',
  需求工单: '/tickets/requirement',
  BUG反馈: '/tickets/bug',
}

/** 工单列表：首期由方案工单使用，其余工单类型在导航中禁用 */
export function TicketsPage({ category }: { category: TicketCategory }) {
  const meta =
    TICKET_CATEGORY_DEFINITIONS.find((item) => item.category === category) ??
    TICKET_CATEGORY_DEFINITIONS[0]
  const [tickets, setTickets] = useState<Ticket[] | null>(null)
  const [keyword, setKeyword] = useState('')
  const [status, setStatus] = useState('all')
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(() => {
    api
      .listTickets({
        category,
        status: status === 'all' ? undefined : status,
        q: keyword.trim() || undefined,
      })
      .then((rows) => {
        setTickets(rows)
        setError(null)
      })
      .catch((e: Error) => setError(e.message))
  }, [category, keyword, status])

  useEffect(() => {
    const timer = window.setTimeout(reload, 250)
    return () => window.clearTimeout(timer)
  }, [reload])

  const basePath = useMemo(() => CATEGORY_PATH[category] ?? '/tickets/solution', [category])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <PageBreadcrumb items={[{ label: '工单' }, { label: category }]} />
          <h1 className="mt-2 text-2xl font-semibold">{category}</h1>
          <p className="mt-1 text-sm text-foreground-muted">{meta.description}</p>
        </div>
        <Link
          to={`${basePath}/new`}
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          新建{category}
        </Link>
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
            <TableHead className="w-28">编号</TableHead>
            <TableHead>标题</TableHead>
            <TableHead className="w-40">责任方</TableHead>
            <TableHead className="w-44">当前任务定义</TableHead>
            <TableHead className="w-32">关联任务</TableHead>
            <TableHead className="w-28">状态</TableHead>
            <TableHead className="w-32">创建人</TableHead>
            <TableHead className="w-44">创建时间</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(tickets ?? []).map((ticket) => (
            <TableRow key={ticket.id}>
              <TableCell>
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
              <TableCell>
                <span className="flex items-center gap-1.5">
                  <Badge variant="soft" size="sm">
                    {ticket.assigneeType === 'worker' ? '机器人' : '负责人'}
                  </Badge>
                  <span className="truncate">{ticket.assigneeName}</span>
                </span>
              </TableCell>
              <TableCell className="max-w-44 truncate text-xs text-foreground-muted">
                {ticket.task?.templateName ?? '—'}
              </TableCell>
              <TableCell>
                {ticket.task ? (
                  <Link
                    to={`/tasks/${ticket.task.id}`}
                    className="font-mono text-xs hover:underline"
                  >
                    {ticket.task.code}
                  </Link>
                ) : (
                  '—'
                )}
              </TableCell>
              <TableCell>
                <TicketStatusBadge status={ticket.status} />
              </TableCell>
              <TableCell>{ticket.createdByName}</TableCell>
              <TableCell className="text-xs text-foreground-muted">
                {new Date(ticket.createdAt).toLocaleString()}
              </TableCell>
            </TableRow>
          ))}
          {tickets !== null && tickets.length === 0 && (
            <TableRow>
              <TableCell colSpan={8} className="text-foreground-muted">
                暂无工单，点右上角「新建{category}」创建
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
