import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, buttonVariants } from '@appica/ui-react/button'
import { Badge } from '@appica/ui-react/badge'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@appica/ui-react/table'
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogClose,
} from '@appica/ui-react/alert-dialog'
import { Input } from '@appica/ui-react/input'
import {
  Toolbar,
  ToolbarButton,
  ToolbarGroup,
  ToolbarInput,
} from '@appica/ui-react/toolbar'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@appica/ui-react/select'
import {
  api,
  FEEDBACK_STATUSES,
  FEEDBACK_TYPES,
  type Feedback,
  type FeedbackStatus,
  type FeedbackType,
} from '../lib/api'
import { FeedbackStatusBadge } from '../components/StatusBadge'
import { FeedbackFormDialog } from '../components/FeedbackFormDialog'
import { useAuth } from '../context/AuthContext'

/**
 * 反馈（BUG REPORT）：收集全员上报的问题，独立于研发内部缺陷。
 * 任何登录用户可提交；状态流转仅管理员；提交人可在「待处理」时编辑或撤销。
 */
export function FeedbackPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === '管理员'
  const [items, setItems] = useState<Feedback[] | null>(null)
  const [keyword, setKeyword] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [error, setError] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)

  // 搜索输入防抖后再触发查询（300ms）
  useEffect(() => {
    const t = setTimeout(() => setSearch(keyword.trim()), 300)
    return () => clearTimeout(t)
  }, [keyword])

  useEffect(() => {
    let cancelled = false
    api
      .listFeedbacks({
        q: search || undefined,
        status: statusFilter === 'all' ? undefined : (statusFilter as FeedbackStatus),
        type: typeFilter === 'all' ? undefined : (typeFilter as FeedbackType),
      })
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
  }, [search, statusFilter, typeFilter, refresh])

  const reload = useCallback(() => setRefresh((r) => r + 1), [])

  const statusItems = Object.fromEntries(
    ['all', ...FEEDBACK_STATUSES].map((s) => [s, s === 'all' ? '不限状态' : s]),
  )
  const typeItems = Object.fromEntries(
    ['all', ...FEEDBACK_TYPES].map((t) => [t, t === 'all' ? '不限类型' : t]),
  )
  // Markdown 视图带当前筛选参数（'all'/空串不传）
  const mdQuery = [
    search && `q=${encodeURIComponent(search)}`,
    statusFilter !== 'all' && `status=${encodeURIComponent(statusFilter)}`,
    typeFilter !== 'all' && `type=${encodeURIComponent(typeFilter)}`,
  ]
    .filter(Boolean)
    .join('&')

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">反馈</h1>
          <p className="mt-1 text-sm">
            BUG REPORT 与建议收集：任何人均可提交，管理员负责受理与状态流转
          </p>
        </div>
        <div className="flex items-center gap-3">
          <a
            href={`/api/feedbacks.md${mdQuery ? `?${mdQuery}` : ''}`}
            target="_blank"
            rel="noreferrer"
            className="text-sm underline"
            title="Markdown 视图"
          >
            MD
          </a>
          <FeedbackFormDialog onSaved={reload} />
        </div>
      </div>

      <Toolbar aria-label="反馈筛选" className="mb-4">
        <ToolbarInput
          className="w-64"
          render={
            <Input
              placeholder="搜索标题或提交人…"
              clearable
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onClear={() => setKeyword('')}
              aria-label="搜索反馈标题或提交人"
            />
          }
        />
        <ToolbarGroup aria-label="筛选">
          <Select
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v as string)}
            items={statusItems}
          >
            <ToolbarButton
              className="w-36"
              render={
                <SelectTrigger aria-label="按状态筛选">
                  <SelectValue placeholder="状态" />
                </SelectTrigger>
              }
            />
            <SelectContent>
              <SelectItem value="all">不限状态</SelectItem>
              {FEEDBACK_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={typeFilter}
            onValueChange={(v) => setTypeFilter(v as string)}
            items={typeItems}
          >
            <ToolbarButton
              className="w-32"
              render={
                <SelectTrigger aria-label="按类型筛选">
                  <SelectValue placeholder="类型" />
                </SelectTrigger>
              }
            />
            <SelectContent>
              <SelectItem value="all">不限类型</SelectItem>
              {FEEDBACK_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </ToolbarGroup>
      </Toolbar>

      {error && <p className="mb-4 text-sm">加载失败:{error}</p>}

      <Table hoverableRows>
        <TableHeader>
          <TableRow>
            <TableHead className="w-20">ID</TableHead>
            <TableHead>标题</TableHead>
            <TableHead className="text-center">类型</TableHead>
            <TableHead className="text-center">来源</TableHead>
            <TableHead className="text-center">状态</TableHead>
            <TableHead className="text-center">提交人</TableHead>
            <TableHead className="text-center whitespace-nowrap">创建时间</TableHead>
            <TableHead className="w-40 text-center">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(items ?? []).map((f) => (
            <TableRow key={f.id}>
              <TableCell>{f.id}</TableCell>
              <TableCell className="max-w-md truncate" title={f.title}>
                <Link to={`/feedback/${f.id}`} className="underline">
                  {f.title}
                </Link>
              </TableCell>
              <TableCell className="text-center">
                <Badge variant={f.type === 'BUG' ? 'error' : 'secondary'}>
                  {f.type}
                </Badge>
              </TableCell>
              <TableCell className="text-center">
                {f.source === '飞书群' ? (
                  <Badge variant="info" title="反馈群话题自动收录">
                    飞书群
                  </Badge>
                ) : (
                  <span className="text-foreground-muted">平台</span>
                )}
              </TableCell>
              <TableCell className="text-center">
                <FeedbackStatusBadge status={f.status} />
              </TableCell>
              <TableCell className="text-center">
                {f.reporterName ?? '—'}
              </TableCell>
              <TableCell className="text-center whitespace-nowrap">
                {new Date(f.createdAt).toLocaleString()}
              </TableCell>
              <TableCell className="text-center">
                <div className="flex justify-center gap-2">
                  <Link
                    to={`/feedback/${f.id}`}
                    className={buttonVariants({ variant: 'outline', size: 'sm' })}
                  >
                    详情
                  </Link>
                  {(isAdmin || (f.reporterId === user?.id && f.status === '待处理')) && (
                    <DeleteFeedbackButton feedback={f} onDeleted={reload} />
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
          {items && items.length === 0 && (
            <TableRow>
              <TableCell colSpan={8}>
                {search || statusFilter !== 'all' || typeFilter !== 'all'
                  ? '没有符合筛选条件的反馈'
                  : '暂无反馈，点击右上角提交'}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}

function DeleteFeedbackButton({
  feedback,
  onDeleted,
}: {
  feedback: Feedback
  onDeleted: (id: number) => void
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button variant="outline" size="sm" />}>
        删除
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除反馈</AlertDialogTitle>
          <AlertDialogDescription>
            确定删除「{feedback.title}」吗？删除后不可恢复。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose>
            <Button variant="outline" size="sm">取消</Button>
          </AlertDialogClose>
          <AlertDialogClose>
            <Button variant="destructive" size="sm" onClick={() => onDeleted(feedback.id)}>
              确认删除
            </Button>
          </AlertDialogClose>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
