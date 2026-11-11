import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { Button } from '@appica/ui-react/button'
import { Badge } from '@appica/ui-react/badge'
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
import { Card, CardHeader, CardTitle } from '@appica/ui-react/card'
import { Textarea } from '@appica/ui-react/textarea'
import {
  api,
  FEEDBACK_STATUSES,
  type Feedback,
  type FeedbackReply,
  type FeedbackStatus,
} from '../lib/api'
import { FeedbackStatusBadge } from '../components/StatusBadge'
import { FeedbackFormDialog } from '../components/FeedbackFormDialog'
import { MarkdownViewer } from '../components/MarkdownViewer'
import { PageBreadcrumb } from '../components/PageBreadcrumb'
import { useAuth } from '../context/AuthContext'

/**
 * 反馈详情：正文 / 图片 / 处理信息。
 * 管理员可在这里完成状态流转与处理备注；提交人在「待处理」时可编辑与撤销。
 */
export function FeedbackDetailPage() {
  const { feedbackId } = useParams<{ feedbackId: string }>()
  const id = Number(feedbackId)
  const { user } = useAuth()
  const isAdmin = user?.role === '管理员'
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  /** 飞书群话题收录的跟帖（来源为平台时不加载） */
  const [replies, setReplies] = useState<FeedbackReply[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [changing, setChanging] = useState<FeedbackStatus | null>(null)

  const reload = useCallback(() => {
    if (!Number.isInteger(id) || id <= 0) return
    api
      .getFeedback(id)
      .then((f) => {
        setFeedback(f)
        setNote(f.handleNote ?? '')
        setError(null)
        if (f.source === '飞书群') {
          api
            .listFeedbackReplies(f.id)
            .then(setReplies)
            .catch(() => setReplies([]))
        } else {
          setReplies(null)
        }
      })
      .catch((e: Error) => setError(e.message))
  }, [id])

  useEffect(reload, [reload])

  if (!Number.isInteger(id) || id <= 0) return <Navigate to="/feedback" replace />
  if (error && !feedback) {
    return (
      <div>
        <PageBreadcrumb items={[{ label: '反馈', to: '/feedback' }, { label: '详情' }]} />
        <p className="mt-4 text-sm">加载失败:{error}</p>
        <Link to="/feedback" className="mt-2 inline-block text-sm underline">
          返回反馈列表
        </Link>
      </div>
    )
  }
  if (!feedback) return <p className="text-sm text-foreground-muted">加载中…</p>

  const canEdit =
    isAdmin || (feedback.reporterId === user?.id && feedback.status === '待处理')

  const changeStatus = (status: FeedbackStatus) => {
    setChanging(status)
    setError(null)
    api
      .changeFeedbackStatus(feedback.id, { status, handleNote: note })
      .then((f) => setFeedback(f))
      .catch((e: Error) => setError(e.message))
      .finally(() => setChanging(null))
  }

  const time = (value: string | null) =>
    value ? new Date(value).toLocaleString() : '—'

  return (
    <div className="flex flex-col gap-4">
      <PageBreadcrumb
        items={[{ label: '反馈', to: '/feedback' }, { label: feedback.title }]}
      />

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">{feedback.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-foreground-muted">
            <Badge variant={feedback.type === 'BUG' ? 'error' : 'secondary'}>
              {feedback.type}
            </Badge>
            <FeedbackStatusBadge status={feedback.status} />
            {feedback.source === '飞书群' && (
              <Badge variant="info" title="反馈群话题自动收录">
                飞书群收录
              </Badge>
            )}
            <span>提交人:{feedback.reporterName ?? '—'}</span>
            <span>提交于 {time(feedback.createdAt)}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {canEdit && <FeedbackFormDialog feedback={feedback} onSaved={setFeedback} />}
          {(isAdmin || canEdit) && (
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
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() =>
                        api
                          .deleteFeedback(feedback.id)
                          .then(() => window.location.assign('/feedback'))
                          .catch((e: Error) => setError(e.message))
                      }
                    >
                      确认删除
                    </Button>
                  </AlertDialogClose>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      {error && <p className="text-sm">操作失败:{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">问题描述</CardTitle>
        </CardHeader>
        <div className="px-4 pb-4">
          <MarkdownViewer text={feedback.content ?? ''} />
          {feedback.images && feedback.images.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {feedback.images.map((url) => (
                <a key={url} href={url} target="_blank" rel="noreferrer">
                  <img
                    src={url}
                    alt="反馈图片"
                    className="h-24 rounded-[var(--radius-md)] border border-border-strong object-cover"
                  />
                </a>
              ))}
            </div>
          )}
        </div>
      </Card>

      {feedback.source === '飞书群' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              跟帖（群内后续成员消息）
              {replies && replies.length > 0 && (
                <span className="ml-2 text-xs text-foreground-muted">
                  共 {replies.length} 条
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <div className="flex flex-col gap-3 px-4 pb-4">
            {replies === null ? (
              <p className="text-sm text-foreground-muted">加载中…</p>
            ) : replies.length === 0 ? (
              <p className="text-sm text-foreground-muted">暂无跟帖</p>
            ) : (
              replies.map((reply) => (
                <div
                  key={reply.id}
                  className="border-b border-border-strong pb-3 last:border-b-0 last:pb-0"
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs text-foreground-muted">
                    <span className="font-medium text-foreground-intense">
                      {reply.senderName ?? '群成员'}
                    </span>
                    <span>{time(reply.createdAt)}</span>
                  </div>
                  <p className="mt-1 whitespace-pre-line text-sm">
                    {reply.content}
                  </p>
                  {reply.images && reply.images.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {reply.images.map((url) => (
                        <a key={url} href={url} target="_blank" rel="noreferrer">
                          <img
                            src={url}
                            alt="跟帖图片"
                            className="h-24 rounded-[var(--radius-md)] border border-border-strong object-cover"
                          />
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">处理</CardTitle>
        </CardHeader>
        <div className="flex flex-col gap-3 px-4 pb-4">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm md:grid-cols-4">
            <div>
              <dt className="text-foreground-muted">处理人</dt>
              <dd>{feedback.handlerName ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-foreground-muted">最近更新</dt>
              <dd>{time(feedback.updatedAt)}</dd>
            </div>
            <div>
              <dt className="text-foreground-muted">解决时间</dt>
              <dd>{time(feedback.resolvedAt)}</dd>
            </div>
            <div>
              <dt className="text-foreground-muted">当前状态</dt>
              <dd>
                <FeedbackStatusBadge status={feedback.status} />
              </dd>
            </div>
            <div>
              <dt className="text-foreground-muted">处理任务</dt>
              <dd>
                {feedback.taskId ? (
                  <Link to={`/tasks/${feedback.taskId}`} className="underline">
                    TK-{String(feedback.taskId).padStart(4, '0')}
                  </Link>
                ) : (
                  '—'
                )}
              </dd>
            </div>
          </dl>
          {isAdmin ? (
            <>
              <Textarea
                className="h-20"
                placeholder="处理备注（可选，随状态一并保存）"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                aria-label="处理备注"
              />
              <div className="flex items-center gap-2">
                {FEEDBACK_STATUSES.map((s) => (
                  <Button
                    key={s}
                    variant={s === feedback.status ? 'secondary' : 'outline'}
                    size="sm"
                    disabled={
                      s === feedback.status || changing !== null
                    }
                    onClick={() => changeStatus(s)}
                  >
                    {changing === s ? '处理中…' : `置为${s}`}
                  </Button>
                ))}
              </div>
            </>
          ) : (
            feedback.handleNote && (
              <p className="whitespace-pre-line text-sm">{feedback.handleNote}</p>
            )
          )}
        </div>
      </Card>
    </div>
  )
}
