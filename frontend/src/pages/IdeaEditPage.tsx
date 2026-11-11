import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@appica/ui-react/card'
import { Button, buttonVariants } from '@appica/ui-react/button'
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverTitle,
  PopoverDescription,
} from '@appica/ui-react/popover'
import { api, type AgentPageContext, type Idea } from '../lib/api'
import { PageBreadcrumb } from '../components/PageBreadcrumb'
import {
  MarkdownEditor,
  type MarkdownEditorHandle,
} from '../components/MarkdownEditor'
import { DetailPageLayout } from '../components/detail/DetailPageLayout'
import { DetailAgentPanel } from '../components/detail/DetailAgentPanel'
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
 * 灵感写入（独立页面）：新建 `/ideas/new`，编辑 `/ideas/:id/edit`。
 * 只保留整页 Markdown 正文（图片走编辑器内置上传），标题保存后由 AI 异步生成；
 * 右侧「我的 AI」在编辑态读取真实灵感，新建态先基于当前草稿协助梳理/扩写。
 */
export function IdeaEditPage() {
  const { ideaId } = useParams<{ ideaId: string }>()
  const isEdit = ideaId !== undefined
  const id = Number(ideaId)
  const navigate = useNavigate()
  const { user } = useAuth()
  const isAdmin = user?.role === '管理员'

  const [idea, setIdea] = useState<Idea | null>(null)
  const [loadError, setLoadError] = useState<{
    id: number
    message: string
  } | null>(null)
  const [content, setContent] = useState('')
  const contentRef = useRef('')
  // 编辑器为非受控组件：加载/刷新正文后通过 key 重新挂载
  const [editorKey, setEditorKey] = useState('idea-new')
  const editorRef = useRef<MarkdownEditorHandle>(null)
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState<ActionFeedback>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [aiOpen, setAiOpen] = useState(false)
  const [aiUnread, setAiUnread] = useState(0)

  // 加载状态按当前路由 ID 推导：切换灵感时旧数据不参与渲染
  const loadedIdea = isEdit && idea?.id === id ? idea : null
  const loading = isEdit && !loadedIdea && loadError?.id !== id
  const loadErrorMessage = loadError?.id === id ? loadError.message : null

  useEffect(() => {
    if (!isEdit || !Number.isInteger(id) || id <= 0) return
    let cancelled = false
    api
      .getIdea(id)
      .then((next) => {
        if (cancelled) return
        const nextContent = next.content ?? ''
        setIdea(next)
        contentRef.current = nextContent
        setContent(nextContent)
        setEditorKey(`idea-${next.id}-${Date.now()}`)
        setLoadError(null)
      })
      .catch((e: Error) => {
        if (!cancelled) setLoadError({ id, message: e.message })
      })
    return () => {
      cancelled = true
    }
  }, [id, isEdit])

  /** AI 完善正文或删除灵感后刷新；正文有变化时重挂编辑器，避免覆盖用户未保存输入 */
  const refreshIdea = useCallback(() => {
    if (!isEdit || !Number.isInteger(id) || id <= 0) return
    api
      .getIdea(id)
      .then((next) => {
        setIdea(next)
        setLoadError(null)
        const nextContent = next.content ?? ''
        if (nextContent !== contentRef.current) {
          contentRef.current = nextContent
          setContent(nextContent)
          setEditorKey(`idea-${next.id}-${Date.now()}`)
        }
      })
      .catch((e: Error) => {
        // AI 可能已通过 MCP 删除当前灵感：直接回到列表
        if (e.message.includes('not found')) {
          navigate('/ideas', { replace: true })
          return
        }
        setLoadError({ id, message: e.message })
      })
  }, [id, isEdit, navigate])

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

  const agentContext = useMemo<AgentPageContext | null>(() => {
    if (isEdit) {
      if (!loadedIdea) return null
      return {
        type: 'idea',
        id: `idea:${loadedIdea.id}`,
        title: loadedIdea.title,
        summary: [
          `状态：${loadedIdea.status}`,
          loadedIdea.projectId ? `关联需求：#${loadedIdea.projectId}` : '',
          '可直接用 update_idea 完善当前正文，delete_idea 删除当前灵感',
        ]
          .filter(Boolean)
          .join('；'),
        readUrl: `/api/ideas/${loadedIdea.id}.md`,
      }
    }
    const draft = content.trim()
    return {
      type: 'idea',
      id: 'new',
      title: '新灵感',
      summary: draft
        ? `用户正在撰写一条尚未保存的新灵感。优先基于草稿协助梳理/扩写；用户明确要求创建/保存时再调用 create_idea，并可用返回的灵感 ID 继续 update_idea。当前草稿正文（可能截断）：\n${draft.slice(0, 1800)}`
        : '用户正在撰写一条尚未保存的新灵感，正文暂时为空；请协助梳理思路；用户明确要求创建时再调用 create_idea。',
    }
  }, [isEdit, loadedIdea, content])

  const changeContent = (markdown: string) => {
    contentRef.current = markdown
    setContent(markdown)
  }

  if (isEdit && (!Number.isInteger(id) || id <= 0)) {
    return <Navigate to="/ideas" replace />
  }

  if (loading) {
    return <p className="text-sm text-foreground-muted">加载中…</p>
  }

  if (isEdit && loadErrorMessage && !loadedIdea) {
    return (
      <div>
        <PageBreadcrumb
          items={[{ label: '灵感', to: '/ideas' }, { label: '编辑灵感' }]}
        />
        <p className="mt-4 text-sm">加载失败:{loadErrorMessage}</p>
        <Link to="/ideas" className="mt-2 inline-block text-sm underline">
          返回灵感列表
        </Link>
      </div>
    )
  }

  const canEdit = !isEdit || isAdmin || loadedIdea?.status === '构思'

  // 已采纳/废弃的灵感仅管理员可写：直接访问编辑地址时提示返回详情
  if (isEdit && loadedIdea && !canEdit) {
    return (
      <div>
        <PageBreadcrumb
          items={[
            { label: '灵感', to: '/ideas' },
            { label: loadedIdea.title, to: `/ideas/${loadedIdea.id}` },
            { label: '编辑' },
          ]}
        />
        <p className="mt-4 text-sm">
          {`该灵感已${loadedIdea.status === '采纳' ? '采纳' : '废弃'}，仅管理员可编辑内容。`}
        </p>
        <Link
          to={`/ideas/${loadedIdea.id}`}
          className="mt-2 inline-block text-sm underline"
        >
          返回灵感详情
        </Link>
      </div>
    )
  }

  const backPath = isEdit ? `/ideas/${id}` : '/ideas'
  const submitLabel = isEdit
    ? pending
      ? '保存中…'
      : '保存'
    : pending
      ? '记录中…'
      : '记录'

  const submit = () => {
    if (pending) return
    const body = editorRef.current?.getMarkdown() ?? content
    if (!body.trim()) {
      showFeedback(
        { kind: 'failure', message: '请先写点内容再保存' },
        FAILURE_STAY_MS,
      )
      return
    }
    setPending(true)
    const request = isEdit
      ? api.updateIdea(id, { content: body })
      : api.createIdea({ content: body })
    request
      .then((saved) => {
        contentRef.current = body
        setContent(body)
        setIdea(saved)
        showFeedback(
          { kind: 'success', message: isEdit ? '已保存' : '已记录' },
          SUCCESS_STAY_MS,
          isEdit
            ? undefined
            : () => navigate(`/ideas/${saved.id}/edit`, { replace: true }),
        )
      })
      .catch((e: Error) => {
        showFeedback(
          {
            kind: 'failure',
            message: e.message || '保存失败，请稍后重试',
          },
          FAILURE_STAY_MS,
        )
      })
      .finally(() => setPending(false))
  }

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
          onRunFinished={refreshIdea}
          context={agentContext}
          emptyTitle={
            isEdit
              ? `「${loadedIdea?.title ?? '灵感'}」的独立 AI 会话`
              : '一起把这条灵感写清楚'
          }
          emptyHint={
            isEdit
              ? '让助理读取当前灵感、补充细节、直接改写正文或删除'
              : '先写几句草稿，再让助理帮你梳理、扩写；也可以让助理直接创建灵感'
          }
          placeholder={
            isEdit
              ? '聊聊这条灵感，或让助理直接完善它…'
              : '让助理帮你梳理、扩写，或创建这条灵感…'
          }
        />
      }
    >
      <div className="flex h-full min-h-0 min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <PageBreadcrumb
              items={
                isEdit
                  ? [
                      { label: '灵感', to: '/ideas' },
                      { label: loadedIdea?.title ?? '详情', to: backPath },
                      { label: '编辑' },
                    ]
                  : [{ label: '灵感', to: '/ideas' }, { label: '记录灵感' }]
              }
            />
            <h1 className="mt-2 text-2xl font-semibold">
              {isEdit ? (loadedIdea?.title ?? '编辑灵感') : '记录灵感'}
            </h1>
            <p className="mt-1 text-sm text-foreground-muted">
              {isEdit
                ? '正文支持 Markdown，图片可直接上传；标题由 AI 自动生成'
                : '写清这个想法即可，标题会在保存后由 AI 自动生成；正文支持 Markdown，图片可直接上传'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to={backPath}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              取消
            </Link>
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
                    size="sm"
                    onClick={submit}
                    disabled={pending || feedback?.kind === 'success'}
                  >
                    {submitLabel}
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
          </div>
        </div>

        {/* 整页 Markdown 写作：图片直接走编辑器内置上传，不再单独收集 */}
        <Card className="min-h-64 min-w-0 flex-1 rounded-none">
          <CardHeader className="flex-none">
            <CardTitle>正文</CardTitle>
            <CardDescription>
              描述这个想法的背景、期望与细节；标题无需填写，保存后由 AI 根据正文生成
            </CardDescription>
          </CardHeader>
          <div className="relative mx-2 mb-2 min-h-0 flex-1">
            <div className="md-editor-scroll absolute inset-0 bg-background-muted">
              <MarkdownEditor
                key={editorKey}
                ref={editorRef}
                value={content}
                compact
                appica
                onChange={changeContent}
              />
            </div>
          </div>
        </Card>
      </div>
    </DetailPageLayout>
  )
}
