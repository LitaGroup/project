import { useCallback, useEffect, useRef, useState } from 'react'
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
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverTitle,
  PopoverDescription,
} from '@appica/ui-react/popover'
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
  IDEA_STATUSES,
  IDEA_TYPES,
  type Idea,
  type IdeaStatus,
  type IdeaType,
} from '../lib/api'
import { IdeaStatusBadge } from '../components/StatusBadge'
import { IdeaFormDialog } from '../components/IdeaFormDialog'
import { useAuth } from '../context/AuthContext'

/**
 * 灵感：收集想法/创意/待办/建议。
 * 任何登录用户可创建与协作完善（构思期）；采纳会进入需求池，状态流转仅管理员。
 */
export function IdeasPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === '管理员'
  const [items, setItems] = useState<Idea[] | null>(null)
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
      .listIdeas({
        q: search || undefined,
        status: statusFilter === 'all' ? undefined : (statusFilter as IdeaStatus),
        type: typeFilter === 'all' ? undefined : (typeFilter as IdeaType),
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
    ['all', ...IDEA_STATUSES].map((s) => [s, s === 'all' ? '不限状态' : s]),
  )
  const typeItems = Object.fromEntries(
    ['all', ...IDEA_TYPES].map((t) => [t, t === 'all' ? '不限类型' : t]),
  )
  // Markdown 视图带当前筛选参数（'all'/空串不传）
  const mdQuery = [
    search && `q=${encodeURIComponent(search)}`,
    statusFilter !== 'all' && `status=${encodeURIComponent(statusFilter)}`,
    typeFilter !== 'all' && `type=${encodeURIComponent(typeFilter)}`,
  ]
    .filter(Boolean)
    .join('&')

  const canDelete = (idea: Idea) =>
    isAdmin || (idea.creatorId === user?.id && idea.status === '构思')

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">灵感</h1>
          <p className="mt-1 text-sm">
            收集想法、创意、待办与建议：构思期任何人可协作完善，采纳即进入需求池
          </p>
        </div>
        <div className="flex items-center gap-3">
          <a
            href={`/api/ideas.md${mdQuery ? `?${mdQuery}` : ''}`}
            target="_blank"
            rel="noreferrer"
            className="text-sm underline"
            title="Markdown 视图"
          >
            MD
          </a>
          <IdeaFormDialog onSaved={reload} />
        </div>
      </div>

      <Toolbar aria-label="灵感筛选" className="mb-4">
        <ToolbarInput
          className="w-64"
          render={
            <Input
              placeholder="搜索标题或创建人…"
              clearable
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onClear={() => setKeyword('')}
              aria-label="搜索灵感标题或创建人"
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
              {IDEA_STATUSES.map((s) => (
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
              {IDEA_TYPES.map((t) => (
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
            <TableHead className="text-center">状态</TableHead>
            <TableHead className="text-center">创建人</TableHead>
            <TableHead className="text-center whitespace-nowrap">创建时间</TableHead>
            <TableHead className="text-center">需求</TableHead>
            <TableHead className="w-40 text-center">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(items ?? []).map((idea) => (
            <TableRow key={idea.id}>
              <TableCell>{idea.id}</TableCell>
              <TableCell className="max-w-md truncate" title={idea.title}>
                <Link to={`/ideas/${idea.id}`} className="underline">
                  {idea.title}
                </Link>
              </TableCell>
              <TableCell className="text-center">
                <Badge variant="secondary">{idea.type}</Badge>
              </TableCell>
              <TableCell className="text-center">
                <IdeaStatusBadge status={idea.status} />
              </TableCell>
              <TableCell className="text-center">
                {idea.creatorName ?? '—'}
              </TableCell>
              <TableCell className="text-center whitespace-nowrap">
                {new Date(idea.createdAt).toLocaleString()}
              </TableCell>
              <TableCell className="text-center">
                {idea.projectId ? (
                  <Link
                    to={`/projects/${idea.projectId}`}
                    className="underline"
                    title="已采纳进入需求池"
                  >
                    #{idea.projectId}
                  </Link>
                ) : (
                  <span className="text-foreground-muted">—</span>
                )}
              </TableCell>
              <TableCell className="text-center">
                <div className="flex justify-center gap-2">
                  <Link
                    to={`/ideas/${idea.id}`}
                    className={buttonVariants({ variant: 'outline', size: 'sm' })}
                  >
                    详情
                  </Link>
                  {canDelete(idea) && (
                    <DeleteIdeaButton idea={idea} onDeleted={reload} />
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
          {items && items.length === 0 && (
            <TableRow>
              <TableCell colSpan={8}>
                {search || statusFilter !== 'all' || typeFilter !== 'all'
                  ? '没有符合筛选条件的灵感'
                  : '暂无灵感，点击右上角记录'}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}

function DeleteIdeaButton({
  idea,
  onDeleted,
}: {
  idea: Idea
  onDeleted: (id: number) => void
}) {
  /** 成功反馈停留时长 */
  const SUCCESS_STAY_MS = 2_000
  /** 失败反馈停留时长 */
  const FAILURE_STAY_MS = 5_000
  const [feedback, setFeedback] = useState<
    | { kind: 'success'; message: string }
    | { kind: 'failure'; message: string }
    | null
  >(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  useEffect(() => clearTimer, [])

  const showFeedback = (
    next: NonNullable<typeof feedback>,
    stayMs: number,
    after?: () => void,
  ) => {
    clearTimer()
    setFeedback(next)
    timerRef.current = setTimeout(() => {
      setFeedback(null)
      after?.()
    }, stayMs)
  }

  const remove = async () => {
    try {
      await api.deleteIdea(idea.id)
      showFeedback({ kind: 'success', message: '已删除' }, SUCCESS_STAY_MS, () =>
        onDeleted(idea.id),
      )
    } catch (e) {
      showFeedback(
        {
          kind: 'failure',
          message: e instanceof Error ? e.message : '删除失败，请稍后重试',
        },
        FAILURE_STAY_MS,
      )
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button variant="outline" size="sm" />}>
        删除
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除灵感</AlertDialogTitle>
          <AlertDialogDescription>
            确定删除「{idea.title}」吗？删除后不可恢复。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose>
            <Button variant="outline" size="sm">取消</Button>
          </AlertDialogClose>
          <Popover
            open={feedback !== null}
            onOpenChange={(open) => {
              if (!open && feedback?.kind === 'failure') {
                clearTimer()
                setFeedback(null)
              }
            }}
          >
            <PopoverTrigger
              render={
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={feedback?.kind === 'success'}
                  onClick={() => void remove()}
                >
                  确认删除
                </Button>
              }
            />
            <PopoverContent side="top" align="center">
              {feedback?.kind === 'success' && (
                <>
                  <PopoverTitle>成功</PopoverTitle>
                  <PopoverDescription>{feedback.message}</PopoverDescription>
                </>
              )}
              {feedback?.kind === 'failure' && (
                <>
                  <PopoverTitle>失败</PopoverTitle>
                  <PopoverDescription>{feedback.message}</PopoverDescription>
                </>
              )}
            </PopoverContent>
          </Popover>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
