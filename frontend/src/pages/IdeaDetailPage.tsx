import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { Button, buttonVariants } from '@appica/ui-react/button'
import { Badge } from '@appica/ui-react/badge'
import { Card, CardHeader, CardTitle } from '@appica/ui-react/card'
import { Input } from '@appica/ui-react/input'
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
} from '@appica/ui-react/dialog'
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
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@appica/ui-react/select'
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverTitle,
  PopoverDescription,
} from '@appica/ui-react/popover'
import {
  api,
  PROJECT_TYPES,
  type Idea,
  type Project,
  type ProjectType,
} from '../lib/api'
import { IdeaStatusBadge } from '../components/StatusBadge'
import { MarkdownViewer } from '../components/MarkdownViewer'
import { PageBreadcrumb } from '../components/PageBreadcrumb'
import { DetailPageLayout } from '../components/detail/DetailPageLayout'
import { DetailAgentPanel } from '../components/detail/DetailAgentPanel'
import { matchesPinyinSearch } from '../lib/pinyin-search'
import { useAuth } from '../context/AuthContext'

/** 成功反馈停留时长 */
const SUCCESS_STAY_MS = 2_000
/** 失败反馈停留时长 */
const FAILURE_STAY_MS = 5_000

type ActionFeedback =
  | { kind: 'success'; message: string }
  | { kind: 'failure'; message: string }
  | null

/**
 * 灵感详情：正文/图片 + 状态与采纳信息 + 右侧「我的 AI」。
 * 构思期任何登录用户可编辑；采纳会进入需求池，状态流转仅管理员。
 */
export function IdeaDetailPage() {
  const { ideaId } = useParams<{ ideaId: string }>()
  const id = Number(ideaId)
  const navigate = useNavigate()
  const { user } = useAuth()
  const isAdmin = user?.role === '管理员'
  const [idea, setIdea] = useState<Idea | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aiOpen, setAiOpen] = useState(false)
  const [aiUnread, setAiUnread] = useState(0)

  const reload = useCallback(() => {
    if (!Number.isInteger(id) || id <= 0) return
    api
      .getIdea(id)
      .then((next) => {
        setIdea(next)
        setError(null)
      })
      .catch((e: Error) => setError(e.message))
  }, [id])

  useEffect(reload, [reload])

  if (!Number.isInteger(id) || id <= 0) return <Navigate to="/ideas" replace />
  if (error && !idea) {
    return (
      <div>
        <PageBreadcrumb items={[{ label: '灵感', to: '/ideas' }, { label: '详情' }]} />
        <p className="mt-4 text-sm">加载失败:{error}</p>
        <Link to="/ideas" className="mt-2 inline-block text-sm underline">
          返回灵感列表
        </Link>
      </div>
    )
  }
  if (!idea) return <p className="text-sm text-foreground-muted">加载中…</p>

  const canEdit = isAdmin || idea.status === '构思'
  const canDelete =
    isAdmin || (idea.creatorId === user?.id && idea.status === '构思')
  const time = (value: string | null) =>
    value ? new Date(value).toLocaleString() : '—'

  return (
    <DetailPageLayout
      aiCollapsible
      aiOutsideContent
      aiLabel="AI 助理"
      aiOpen={aiOpen}
      onAiOpenChange={setAiOpen}
      aiUnreadCount={aiUnread}
      ai={
        <DetailAgentPanel
          title="AI 助理"
          visible={aiOpen}
          onUnreadChange={setAiUnread}
          onRunFinished={reload}
          context={{
            type: 'idea',
            id: `idea:${idea.id}`,
            title: idea.title,
            summary: [
              `类型：${idea.type}`,
              `状态：${idea.status}`,
              idea.projectId ? `关联需求：#${idea.projectId}` : '',
            ]
              .filter(Boolean)
              .join('；'),
            readUrl: `/api/ideas/${idea.id}.md`,
          }}
          emptyTitle={`「${idea.title}」的独立 AI 会话`}
          emptyHint="让助理梳理这个想法、补充细节或改写正文（构思期可直接更新）"
          placeholder="聊聊这个灵感，或让助理直接完善它…"
        />
      }
    >
      <div className="flex h-full min-h-0 min-w-0 flex-col gap-4 overflow-y-auto">
        <PageBreadcrumb
          items={[{ label: '灵感', to: '/ideas' }, { label: idea.title }]}
        />

        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold">{idea.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-foreground-muted">
              <Badge variant="secondary">{idea.type}</Badge>
              <IdeaStatusBadge status={idea.status} />
              <span>创建人:{idea.creatorName ?? '—'}</span>
              <span>创建于 {time(idea.createdAt)}</span>
              <span>最近更新 {time(idea.updatedAt)}</span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {canEdit && (
              <Link
                to={`/ideas/${idea.id}/edit`}
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                编辑
              </Link>
            )}
            {canDelete && (
              <DeleteIdeaButton
                idea={idea}
                onDeleted={() => navigate('/ideas')}
              />
            )}
          </div>
        </div>

        {error && <p className="text-sm">操作失败:{error}</p>}

        <Card className="rounded-none">
          <CardHeader>
            <CardTitle className="text-base">正文</CardTitle>
          </CardHeader>
          <div className="px-4 pb-4">
            {idea.content?.trim() ? (
              <MarkdownViewer text={idea.content} />
            ) : (
              <p className="text-sm text-foreground-muted">
                暂无正文，可直接编辑或在右侧让 AI 帮忙完善。
              </p>
            )}
            {idea.images && idea.images.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {idea.images.map((url) => (
                  <a key={url} href={url} target="_blank" rel="noreferrer">
                    <img
                      src={url}
                      alt="灵感图片"
                      className="h-24 rounded-[var(--radius-md)] border border-border-strong object-cover"
                    />
                  </a>
                ))}
              </div>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">状态与采纳</CardTitle>
          </CardHeader>
          <div className="flex flex-col gap-3 px-4 pb-4">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm md:grid-cols-3">
              <div>
                <dt className="text-foreground-muted">当前状态</dt>
                <dd>
                  <IdeaStatusBadge status={idea.status} />
                </dd>
              </div>
              <div>
                <dt className="text-foreground-muted">采纳时间</dt>
                <dd>{time(idea.adoptedAt)}</dd>
              </div>
              <div>
                <dt className="text-foreground-muted">关联需求</dt>
                <dd>
                  {idea.projectId ? (
                    <Link
                      to={`/projects/${idea.projectId}`}
                      className="underline"
                    >
                      需求 #{idea.projectId}
                    </Link>
                  ) : (
                    '—'
                  )}
                </dd>
              </div>
            </dl>

            {isAdmin ? (
              <div className="flex flex-wrap items-center gap-2">
                {idea.status !== '采纳' && (
                  <>
                    <AdoptIdeaDialog idea={idea} onAdopted={reload} />
                    <ActionButton
                      label="废弃"
                      onAction={async () => {
                        await api.changeIdeaStatus(idea.id, { status: '废弃' })
                        return '已废弃'
                      }}
                      onSuccess={reload}
                    />
                  </>
                )}
                {idea.status !== '构思' && (
                  <ActionButton
                    label="退回构思"
                    onAction={async () => {
                      await api.changeIdeaStatus(idea.id, { status: '构思' })
                      return '已退回构思'
                    }}
                    onSuccess={reload}
                  />
                )}
              </div>
            ) : (
              <p className="text-sm text-foreground-muted">
                状态流转由管理员操作；构思期你可以直接编辑内容。
              </p>
            )}
          </div>
        </Card>
      </div>
    </DetailPageLayout>
  )
}

/** 采纳弹窗：在需求池新建需求，或关联已有需求 */
function AdoptIdeaDialog({
  idea,
  onAdopted,
}: {
  idea: Idea
  onAdopted: () => void
}) {
  const [open, setOpen] = useState(false)
  const [projectType, setProjectType] = useState<ProjectType>('其它')
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [keyword, setKeyword] = useState('')
  const [projectId, setProjectId] = useState('')
  const [loadError, setLoadError] = useState<string | null>(null)

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) {
      setKeyword('')
      setProjectId('')
      setProjectType('其它')
      setLoadError(null)
      api
        .listProjects()
        .then(setProjects)
        .catch((e: Error) => setLoadError(e.message))
    }
  }

  const allProjects = projects ?? []
  const filtered = allProjects
    .filter((p) => matchesPinyinSearch(keyword.trim(), [p.name]))
    .slice(0, 50)
  const projectItems = Object.fromEntries(
    allProjects.map((p) => [String(p.id), `${p.name}（#${p.id}）`]),
  )

  const closeAfterSuccess = () => {
    onAdopted()
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button size="sm">采纳…</Button>} />
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>采纳「{idea.title}」</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-5">
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">新建需求</h3>
              <p className="text-xs text-foreground-muted">
                用这个灵感的标题与正文在需求池创建需求。
              </p>
              <div className="flex items-center gap-2">
                <Select
                  value={projectType}
                  onValueChange={(v) => setProjectType(v as ProjectType)}
                >
                  <SelectTrigger className="w-32" aria-label="需求类型">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROJECT_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <ActionButton
                  label="新建并采纳"
                  variant="secondary"
                  onAction={async () => {
                    await api.changeIdeaStatus(idea.id, {
                      status: '采纳',
                      createProject: true,
                      projectType,
                    })
                    return '已采纳并在需求池创建需求'
                  }}
                  onSuccess={closeAfterSuccess}
                />
              </div>
            </section>

            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">关联已有需求</h3>
              <p className="text-xs text-foreground-muted">
                把这个灵感关联到需求池中已经存在的需求。
              </p>
              <Input
                placeholder="搜索需求名称…"
                clearable
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                onClear={() => setKeyword('')}
                aria-label="搜索需求名称"
              />
              <div className="flex items-center gap-2">
                <Select
                  value={projectId}
                  onValueChange={(v) => setProjectId(v as string)}
                  items={projectItems}
                >
                  <SelectTrigger
                    className="min-w-0 flex-1"
                    aria-label="选择要关联的需求"
                  >
                    <SelectValue placeholder="选择需求" />
                  </SelectTrigger>
                  <SelectContent>
                    {filtered.map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>
                        {p.name}（#{p.id}）
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <ActionButton
                  label="关联并采纳"
                  variant="secondary"
                  disabled={!projectId}
                  onAction={async () => {
                    await api.changeIdeaStatus(idea.id, {
                      status: '采纳',
                      projectId: Number(projectId),
                    })
                    return '已采纳并关联需求'
                  }}
                  onSuccess={closeAfterSuccess}
                />
              </div>
              {projects === null && !loadError && (
                <p className="text-xs text-foreground-muted">需求列表加载中…</p>
              )}
              {loadError && (
                <p className="text-xs">需求列表加载失败:{loadError}</p>
              )}
              {projects !== null && filtered.length === 0 && (
                <p className="text-xs text-foreground-muted">
                  没有匹配的需求
                </p>
              )}
            </section>
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}

/** 带 Popover 结果反馈的按钮：成功停留 2 秒后执行下一步，失败停留 5 秒可重试 */
function ActionButton({
  label,
  disabled = false,
  variant = 'outline',
  onAction,
  onSuccess,
}: {
  label: string
  disabled?: boolean
  variant?: 'outline' | 'destructive' | 'secondary'
  /** 执行动作并返回成功消息 */
  onAction: () => Promise<string>
  /** 成功反馈停留结束后执行（刷新/关闭弹窗等） */
  onSuccess?: () => void
}) {
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState<ActionFeedback>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  useEffect(() => clearTimer, [])

  const showFeedback = (
    next: NonNullable<ActionFeedback>,
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

  const run = async () => {
    if (pending) return
    setPending(true)
    try {
      const message = await onAction()
      showFeedback({ kind: 'success', message }, SUCCESS_STAY_MS, onSuccess)
    } catch (e) {
      showFeedback(
        {
          kind: 'failure',
          message: e instanceof Error ? e.message : '操作失败，请稍后重试',
        },
        FAILURE_STAY_MS,
      )
    } finally {
      setPending(false)
    }
  }

  return (
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
            variant={variant}
            size="sm"
            disabled={disabled || pending || feedback?.kind === 'success'}
            onClick={() => void run()}
          >
            {pending ? '处理中…' : label}
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
  )
}

function DeleteIdeaButton({
  idea,
  onDeleted,
}: {
  idea: Idea
  onDeleted: () => void
}) {
  const [feedback, setFeedback] = useState<ActionFeedback>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  useEffect(() => clearTimer, [])

  const showFeedback = (
    next: NonNullable<ActionFeedback>,
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
      showFeedback({ kind: 'success', message: '已删除' }, SUCCESS_STAY_MS, onDeleted)
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
