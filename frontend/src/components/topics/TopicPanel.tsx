import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Avatar, AvatarFallback } from '@appica/ui-react/avatar'
import { Badge } from '@appica/ui-react/badge'
import { Button } from '@appica/ui-react/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@appica/ui-react/dialog'
import { Input } from '@appica/ui-react/input'
import { Textarea } from '@appica/ui-react/textarea'
import {
  api,
  topicStreamUrl,
  TOPIC_FIXED_TAGS,
  type Topic,
  type TopicDetail,
  type TopicListResult,
  type TopicNotification,
  type TopicNotificationList,
  type TopicQuestionPayload,
  type TopicReply,
  type TopicSubjectType,
  type TopicType,
  type Worker,
} from '../../lib/api'
import { MarkdownViewer } from '../MarkdownViewer'
import { RobotAvatar } from '../task-detail/WorkerAvatar'

type TopicFilter = 'all' | 'question' | '澄清' | '建议'

const FILTERS: Array<[TopicFilter, string]> = [
  ['all', '全部'],
  ['question', '待回答'],
  ['澄清', '澄清'],
  ['建议', '建议'],
]

/** 时间展示：今天只显示时分，其它显示日期 */
function timeLabel(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  const now = new Date()
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
    })
  }
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function typeLabel(type: TopicType): string {
  if (type === 'question') return '问答'
  if (type === 'system') return '系统'
  return '内容'
}

function statusLabel(status: Topic['status']): string {
  if (status === 'resolved') return '已解决'
  if (status === 'closed') return '已关闭'
  return '进行中'
}

function authorInitial(name: string): string {
  return name.trim().slice(0, 1) || '?'
}

function TopicAuthorAvatar({
  author,
  size = 28,
}: {
  author: Topic['author']
  size?: number
}) {
  if (author.type === 'worker') {
    return (
      <RobotAvatar
        name={author.name}
        avatarUrl={author.avatarUrl}
        size={size}
      />
    )
  }
  return (
    <Avatar size={size} className="shrink-0">
      <AvatarFallback className="bg-background-muted text-foreground-emphasis">
        {authorInitial(author.name)}
      </AvatarFallback>
    </Avatar>
  )
}

/** 多选 @机器人：按机器人运行时展示，真人机器人由其负责人回复 */
function MentionPicker({
  workers,
  value,
  onChange,
  disabled,
}: {
  workers: Worker[]
  value: number[]
  onChange: (next: number[]) => void
  disabled?: boolean
}) {
  if (workers.length === 0) return null
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-foreground-muted">
        @机器人（可多选）
      </span>
      <div className="flex flex-wrap gap-1.5">
        {workers.map((worker) => {
          const selected = value.includes(worker.id)
          return (
            <Button
              key={worker.id}
              type="button"
              size="sm"
              variant={selected ? 'primary' : 'outline'}
              disabled={disabled}
              onClick={() =>
                onChange(
                  selected
                    ? value.filter((id) => id !== worker.id)
                    : [...value, worker.id],
                )
              }
            >
              @{worker.name}
              <span className="ml-1 text-[10px] opacity-70">
                {worker.runtime === 'human' ? '真人' : 'AI'}
              </span>
            </Button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * 通用话题面板：
 * - 每个主体有一个主话题（默认消息进主话题），可新开话题；
 * - 话题内回复；问答话题显示问题与答复入口；
 * - 支持「澄清 / 建议」固定标签与自定义标签；
 * - @机器人时由后端按主体类型投递任务或触发内联回答。
 */
export function TopicPanel({
  subjectType,
  subjectId,
  compact = false,
}: {
  subjectType: TopicSubjectType
  subjectId: string | number
  /** 嵌入详情页时减少外层留白 */
  compact?: boolean
}) {
  const [list, setList] = useState<TopicListResult | null>(null)
  const [detail, setDetail] = useState<TopicDetail | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [workers, setWorkers] = useState<Worker[]>([])
  const [filter, setFilter] = useState<TopicFilter>('all')
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reply, setReply] = useState('')
  const [replyMentions, setReplyMentions] = useState<number[]>([])
  const [sending, setSending] = useState(false)
  const [newOpen, setNewOpen] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newContent, setNewContent] = useState('')
  const [newType, setNewType] = useState<TopicType>('content')
  const [newTags, setNewTags] = useState<string[]>([])
  const [newMentions, setNewMentions] = useState<number[]>([])
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [answerDraft, setAnswerDraft] = useState('')
  const [notifications, setNotifications] =
    useState<TopicNotificationList | null>(null)
  const selectedRef = useRef<number | null>(null)

  useEffect(() => {
    selectedRef.current = selectedId
  }, [selectedId])

  const loadDetail = useCallback(
    async (topicId: number) => {
      setDetailLoading(true)
      try {
        const next = await api.getTopic(topicId)
        setDetail(next)
        setSelectedId(topicId)
        setAnswerDraft('')
        void api.markTopicRead(topicId).catch(() => undefined)
      } catch (e) {
        setError((e as Error).message)
      } finally {
        setDetailLoading(false)
      }
    },
    [],
  )

  const loadList = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const next = await api.listTopics({ subjectType, subjectId, pageSize: 100 })
      setList(next)
      const fromUrl = Number(
        new URLSearchParams(window.location.search).get('topic'),
      )
      const preferred =
        (selectedRef.current &&
          next.items.some((item) => item.id === selectedRef.current) &&
          selectedRef.current) ||
        (Number.isInteger(fromUrl) &&
          next.items.some((item) => item.id === fromUrl) &&
          fromUrl) ||
        next.defaultTopicId ||
        next.items[0]?.id ||
        null
      if (preferred) await loadDetail(preferred)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [loadDetail, subjectId, subjectType])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    void loadList()
    api
      .listWorkers()
      .then((rows) =>
        setWorkers(
          rows.filter(
            (worker) => worker.enabled && worker.role !== '调度器',
          ),
        ),
      )
      .catch(() => setWorkers([]))
    api
      .getTopicNotifications()
      .then(setNotifications)
      .catch(() => setNotifications(null))
  }, [loadList])

  useEffect(() => {
    const source = new EventSource(topicStreamUrl(subjectType, subjectId))
    source.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as {
          type: string
          topicId?: number
          topic?: Topic
          reply?: TopicReply
        }
        if (data.type === 'reply.upsert' && data.reply) {
          if (data.topicId === selectedRef.current) {
            setDetail((current) => {
              if (!current || current.id !== data.topicId) return current
              const exists = current.replies.some(
                (item) => item.id === data.reply!.id,
              )
              return {
                ...current,
                replies: exists
                  ? current.replies.map((item) =>
                      item.id === data.reply!.id ? data.reply! : item,
                    )
                  : [...current.replies, data.reply!],
                replyCount: exists
                  ? current.replyCount
                  : current.replyCount + 1,
              }
            })
          }
          setList((current) =>
            current
              ? {
                  ...current,
                  items: current.items.map((item) =>
                    item.id === data.topicId
                      ? {
                          ...item,
                          replyCount: item.replyCount + 1,
                          lastReplyAt: data.reply!.createdAt,
                          lastReplyByName: data.reply!.author.name,
                        }
                      : item,
                  ),
                }
              : current,
          )
        }
        if (data.type === 'topic.upsert' && data.topic) {
          setList((current) => {
            if (!current) return current
            const exists = current.items.some(
              (item) => item.id === data.topic!.id,
            )
            return {
              ...current,
              items: exists
                ? current.items.map((item) =>
                    item.id === data.topic!.id ? data.topic! : item,
                  )
                : [data.topic!, ...current.items],
            }
          })
          if (data.topic.id === selectedRef.current) {
            void loadDetail(data.topic.id)
          }
        }
        if (data.type === 'topic.delete' && data.topicId) {
          setList((current) =>
            current
              ? {
                  ...current,
                  items: current.items.filter(
                    (item) => item.id !== data.topicId,
                  ),
                }
              : current,
          )
          if (data.topicId === selectedRef.current) {
            setDetail(null)
            setSelectedId(null)
          }
        }
      } catch {
        // 忽略非法 SSE 行
      }
    }
    return () => source.close()
  }, [loadDetail, subjectId, subjectType])

  const filtered = useMemo(() => {
    const items = list?.items ?? []
    if (filter === 'all') return items
    if (filter === 'question') return items.filter((item) => item.type === 'question')
    return items.filter((item) => item.tags.includes(filter))
  }, [filter, list])

  const questions = useMemo(() => {
    const metadata = (detail?.metadata ?? {}) as TopicQuestionPayload
    return Array.isArray(metadata.questions) ? metadata.questions : []
  }, [detail])

  const submitReply = async () => {
    if (!detail || !reply.trim() || sending) return
    setSending(true)
    setError(null)
    try {
      const result = await api.replyTopic(detail.id, {
        content: reply.trim(),
        mentions: replyMentions,
      })
      setDetail((current) => {
        if (!current || current.replies.some((item) => item.id === result.reply.id)) {
          return current
        }
        return {
          ...current,
          replies: [...current.replies, result.reply],
          replyCount: current.replyCount + 1,
          lastReplyAt: result.reply.createdAt,
          lastReplyByName: result.reply.author.name,
        }
      })
      setReply('')
      setReplyMentions([])
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSending(false)
    }
  }

  const submitAnswer = async (reject = false) => {
    if (!detail || sending) return
    setSending(true)
    setError(null)
    try {
      const lines = answerDraft
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
      const answers = questions.length
        ? questions.map((_, index) => [lines[index] ?? ''])
        : [lines]
      const next = await api.answerTopic(detail.id, {
        answers: reject ? undefined : answers,
        reject,
      })
      setDetail(next)
      setAnswerDraft('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSending(false)
    }
  }

  const createTopic = async () => {
    if (!newContent.trim() || sending) return
    setSending(true)
    setError(null)
    try {
      const created = await api.createTopic({
        subjectType,
        subjectId,
        title: newTitle.trim() || undefined,
        content: newContent.trim(),
        type: newType,
        tags: newTags,
        mentions: newMentions,
      })
      setNewOpen(false)
      setNewTitle('')
      setNewContent('')
      setNewType('content')
      setNewTags([])
      setNewMentions([])
      setList((current) => {
        if (!current || current.items.some((item) => item.id === created.id)) {
          return current
        }
        return {
          ...current,
          items: [created, ...current.items],
          total: current.total + 1,
        }
      })
      await loadDetail(created.id)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSending(false)
    }
  }

  const resolveTopic = async () => {
    if (!detail) return
    try {
      const next = await api.updateTopic(detail.id, { status: 'resolved' })
      setDetail((current) =>
        current ? { ...current, status: next.status } : current,
      )
      setList((current) =>
        current
          ? {
              ...current,
              items: current.items.map((item) =>
                item.id === next.id ? next : item,
              ),
            }
          : current,
      )
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const unread = notifications?.unread ?? list?.unreadTotal ?? 0

  const openNotification = async (item: TopicNotification) => {
    try {
      const topic = await api.getTopic(item.topicId)
      await api.markTopicNotificationsRead([item.id]).catch(() => undefined)
      setNotifications((current) =>
        current
          ? {
              ...current,
              unread: Math.max(0, current.unread - (item.readAt ? 0 : 1)),
              items: current.items.map((row) =>
                row.id === item.id
                  ? { ...row, readAt: row.readAt ?? new Date().toISOString() }
                  : row,
              ),
            }
          : current,
      )
      if (
        topic.subjectType === subjectType &&
        String(topic.subjectId) === String(subjectId)
      ) {
        setNotificationsOpen(false)
        await loadDetail(topic.id)
      } else {
        window.location.href = `${topic.subjectUrl}?topic=${topic.id}`
      }
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <section
      className={`flex min-w-0 flex-col gap-4 ${compact ? '' : 'rounded-lg border border-border bg-background p-4'}`}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">话题</h2>
            {unread > 0 && <Badge variant="secondary">未读 {unread}</Badge>}
          </div>
          <p className="mt-1 text-xs text-foreground-muted">
            默认消息进主话题；需要单独讨论时新开话题。@机器人会按主体类型回复。
          </p>
        </div>
        <div className="flex items-center gap-2">
          {notifications && notifications.total > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setNotificationsOpen(true)}
            >
              通知 {notifications.unread > 0 ? notifications.unread : ''}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setFilter('all')
              setSelectedId(list?.defaultTopicId ?? null)
              if (list?.defaultTopicId) void loadDetail(list.defaultTopicId)
            }}
          >
            回到主话题
          </Button>
          <Button size="sm" onClick={() => setNewOpen(true)}>
            新开话题
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-1.5">
        {FILTERS.map(([key, label]) => (
          <Button
            key={key}
            size="sm"
            variant={filter === key ? 'primary' : 'ghost'}
            onClick={() => setFilter(key)}
          >
            {label}
          </Button>
        ))}
      </div>

      {error && <p className="text-sm text-foreground-muted">加载失败：{error}</p>}

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-w-0 flex-col gap-3">
          {detailLoading && !detail ? (
            <p className="text-sm text-foreground-muted">加载中…</p>
          ) : detail ? (
            <TopicDetailView
              detail={detail}
              workers={workers}
              reply={reply}
              replyMentions={replyMentions}
              sending={sending}
              questions={questions}
              answerDraft={answerDraft}
              onReplyChange={setReply}
              onReplyMentionsChange={setReplyMentions}
              onSendReply={submitReply}
              onAnswerDraftChange={setAnswerDraft}
              onSubmitAnswer={submitAnswer}
              onResolve={resolveTopic}
            />
          ) : (
            <p className="text-sm text-foreground-muted">
              {loading ? '加载中…' : '暂无话题'}
            </p>
          )}
        </div>

        <aside className="flex min-w-0 flex-col gap-2">
          <div className="flex items-center justify-between text-xs text-foreground-muted">
            <span>话题列表</span>
            <span>{filtered.length}</span>
          </div>
          {filtered.length === 0 ? (
            <p className="rounded-lg border border-border p-3 text-sm text-foreground-muted">
              当前筛选下暂无话题
            </p>
          ) : (
            filtered.map((topic) => (
              <button
                key={topic.id}
                type="button"
                onClick={() => void loadDetail(topic.id)}
                className={`flex w-full flex-col gap-1.5 rounded-lg border p-3 text-left transition-colors ${
                  topic.id === selectedId
                    ? 'border-primary bg-background-muted'
                    : 'border-border hover:bg-background-muted'
                }`}
              >
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-sm font-medium">
                    {topic.title || '主话题'}
                  </span>
                  {topic.isDefault && (
                    <Badge variant="secondary">主话题</Badge>
                  )}
                  {topic.type === 'question' && (
                    <Badge variant="secondary">问答</Badge>
                  )}
                  {topic.unreadCount > 0 && (
                    <Badge>{topic.unreadCount}</Badge>
                  )}
                </div>
                <p className="line-clamp-2 text-xs text-foreground-muted">
                  {topic.content || topic.lastReplyByName || '暂无消息'}
                </p>
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-foreground-subtle">
                  <span>{topic.author.name}</span>
                  <span>{topic.replyCount} 回复</span>
                  <span>{timeLabel(topic.lastReplyAt ?? topic.createdAt)}</span>
                  {topic.tags.map((tag) => (
                    <Badge key={tag} variant="secondary">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </button>
            ))
          )}
        </aside>
      </div>

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>新开话题</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-sm">
                标题（可空）
                <Input
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="不填则取正文首行"
                  maxLength={200}
                />
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm">类型</span>
                <Button
                  size="sm"
                  variant={newType === 'content' ? 'primary' : 'outline'}
                  onClick={() => setNewType('content')}
                >
                  内容
                </Button>
                <Button
                  size="sm"
                  variant={newType === 'question' ? 'primary' : 'outline'}
                  onClick={() => setNewType('question')}
                >
                  问答
                </Button>
              </div>
              <label className="flex flex-col gap-1 text-sm">
                正文
                <Textarea
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  placeholder="写清楚背景、问题或建议…"
                  rows={6}
                />
              </label>
              <div className="flex flex-col gap-1.5">
                <span className="text-xs text-foreground-muted">标签</span>
                <div className="flex flex-wrap gap-1.5">
                  {TOPIC_FIXED_TAGS.map((tag) => {
                    const selected = newTags.includes(tag)
                    return (
                      <Button
                        key={tag}
                        size="sm"
                        variant={selected ? 'primary' : 'outline'}
                        onClick={() =>
                          setNewTags(
                            selected
                              ? newTags.filter((item) => item !== tag)
                              : [...newTags, tag],
                          )
                        }
                      >
                        {tag}
                      </Button>
                    )
                  })}
                  <Input
                    className="h-8 w-40"
                    placeholder="自定义标签后回车"
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter') return
                      event.preventDefault()
                      const tag = event.currentTarget.value.trim()
                      if (!tag) return
                      if (!newTags.includes(tag)) setNewTags([...newTags, tag])
                      event.currentTarget.value = ''
                    }}
                  />
                </div>
                {newTags.filter(
                    (tag) =>
                      !(TOPIC_FIXED_TAGS as readonly string[]).includes(tag),
                  )
                  .length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {newTags
                      .filter(
                        (tag) =>
                          !(TOPIC_FIXED_TAGS as readonly string[]).includes(
                            tag,
                          ),
                      )
                      .map((tag) => (
                        <Badge key={tag} variant="secondary">
                          {tag}
                        </Badge>
                      ))}
                  </div>
                )}
              </div>
              <MentionPicker
                workers={workers}
                value={newMentions}
                onChange={setNewMentions}
                disabled={sending}
              />
            </div>
          </DialogBody>
          <DialogFooter>
            <DialogClose>
              <Button variant="outline" size="sm">
                取消
              </Button>
            </DialogClose>
            <Button
              size="sm"
              disabled={!newContent.trim() || sending}
              onClick={() => void createTopic()}
            >
              {sending ? '发布中…' : '发布话题'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={notificationsOpen} onOpenChange={setNotificationsOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>话题通知</DialogTitle>
          </DialogHeader>
          <DialogBody className="max-h-[60vh] overflow-y-auto">
            {!notifications?.items.length ? (
              <p className="text-sm text-foreground-muted">暂无话题通知。</p>
            ) : (
              <div className="flex flex-col gap-2">
                {notifications.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="flex flex-col gap-1 rounded-lg border border-border p-3 text-left hover:bg-background-muted"
                    onClick={() => {
                      void openNotification(item)
                    }}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{item.title}</span>
                      {!item.readAt && <Badge>未读</Badge>}
                      <span className="text-[11px] text-foreground-subtle">
                        {timeLabel(item.createdAt)}
                      </span>
                    </div>
                    {item.content && (
                      <p className="line-clamp-2 text-xs text-foreground-muted">
                        {item.content}
                      </p>
                    )}
                  </button>
                ))}
              </div>
            )}
          </DialogBody>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              disabled={!notifications?.unread}
              onClick={() => {
                void api
                  .markTopicNotificationsRead()
                  .then(() => {
                    setNotifications((current) =>
                      current
                        ? {
                            ...current,
                            unread: 0,
                            items: current.items.map((item) => ({
                              ...item,
                              readAt: item.readAt ?? new Date().toISOString(),
                            })),
                          }
                        : current,
                    )
                  })
                  .catch((e: Error) => setError(e.message))
              }}
            >
              全部已读
            </Button>
            <DialogClose>
              <Button variant="outline" size="sm">
                关闭
              </Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

function TopicDetailView({
  detail,
  workers,
  reply,
  replyMentions,
  sending,
  questions,
  answerDraft,
  onReplyChange,
  onReplyMentionsChange,
  onSendReply,
  onAnswerDraftChange,
  onSubmitAnswer,
  onResolve,
}: {
  detail: TopicDetail
  workers: Worker[]
  reply: string
  replyMentions: number[]
  sending: boolean
  questions: TopicQuestionPayload['questions']
  answerDraft: string
  onReplyChange: (value: string) => void
  onReplyMentionsChange: (value: number[]) => void
  onSendReply: () => void
  onAnswerDraftChange: (value: string) => void
  onSubmitAnswer: (reject?: boolean) => void
  onResolve: () => void
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="text-base font-semibold">
              {detail.title || '主话题'}
            </h3>
            {detail.isDefault && <Badge variant="secondary">主话题</Badge>}
            <Badge variant="secondary">{typeLabel(detail.type)}</Badge>
            <Badge variant="secondary">{statusLabel(detail.status)}</Badge>
            {detail.tags.map((tag) => (
              <Badge key={tag} variant="secondary">
                {tag}
              </Badge>
            ))}
          </div>
          <p className="mt-1 text-xs text-foreground-muted">
            {detail.author.name} · {timeLabel(detail.createdAt)} ·{' '}
            {detail.replyCount} 条回复
          </p>
        </div>
        {detail.type === 'question' && detail.status === 'open' && (
          <Button variant="outline" size="sm" onClick={onResolve}>
            标记已解决
          </Button>
        )}
      </div>

      {(detail.content || detail.images?.length) && (
        <div className="rounded-lg border border-border bg-background-muted p-3">
          <MarkdownViewer text={detail.content} />
          {detail.images?.length ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {detail.images.map((image) => (
                <img
                  key={image}
                  src={image}
                  alt="话题图片"
                  className="max-h-40 rounded-md border border-border object-contain"
                />
              ))}
            </div>
          ) : null}
        </div>
      )}

      {questions?.length ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <div className="flex items-center gap-2">
            <Badge variant="secondary">问答</Badge>
            <span className="text-sm font-medium">
              {detail.status === 'open' ? '待回答' : '已答复'}
            </span>
          </div>
          {questions.map((question, index) => (
            <div key={`${question.header}-${index}`} className="text-sm">
              <p className="font-medium">
                {index + 1}. {question.header}
              </p>
              <p className="mt-0.5 text-foreground-muted">
                {question.question}
              </p>
              {question.options?.length ? (
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {question.options.map((option) => (
                    <Badge key={option.label} variant="secondary">
                      {option.label}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
          {detail.status === 'open' && (
            <div className="mt-1 flex flex-col gap-2">
              <Textarea
                value={answerDraft}
                onChange={(e) => onAnswerDraftChange(e.target.value)}
                placeholder={
                  questions.length > 1
                    ? '每行一个答案，按问题顺序填写'
                    : '填写答案…'
                }
                rows={3}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={!answerDraft.trim() || sending}
                  onClick={() => onSubmitAnswer()}
                >
                  {sending ? '提交中…' : '提交答复'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={sending}
                  onClick={() => onSubmitAnswer(true)}
                >
                  跳过
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        {detail.replies.length === 0 ? (
          <p className="rounded-lg border border-border p-3 text-sm text-foreground-muted">
            还没有回复，发送第一条消息吧。
          </p>
        ) : (
          detail.replies.map((item) => (
            <div key={item.id} className="flex items-start gap-2">
              <TopicAuthorAvatar author={item.author} />
              <div className="min-w-0 flex-1 rounded-lg border border-border p-2.5">
                <div className="flex flex-wrap items-center gap-2 text-xs text-foreground-muted">
                  <span className="font-medium text-foreground-intense">
                    {item.author.name}
                  </span>
                  <span>{timeLabel(item.createdAt)}</span>
                  {item.metadata?.answer === true && (
                    <Badge variant="secondary">答复</Badge>
                  )}
                  {item.status === 'running' && (
                    <Badge variant="secondary">回复中…</Badge>
                  )}
                  {item.status === 'error' && (
                    <Badge variant="secondary">失败</Badge>
                  )}
                </div>
                <div className="mt-1">
                  <MarkdownViewer text={item.content} />
                </div>
                {item.images?.length ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {item.images.map((image) => (
                      <img
                        key={image}
                        src={image}
                        alt="回复图片"
                        className="max-h-40 rounded-md border border-border object-contain"
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          ))
        )}
      </div>

      {!detail.locked && (
        <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <Textarea
            value={reply}
            onChange={(e) => onReplyChange(e.target.value)}
            placeholder={
              detail.isDefault
                ? '发到主话题，任务/工单消息会驱动执行机器人…'
                : '回复这个话题…'
            }
            rows={3}
          />
          <MentionPicker
            workers={workers}
            value={replyMentions}
            onChange={onReplyMentionsChange}
            disabled={sending}
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              disabled={!reply.trim() || sending}
              onClick={onSendReply}
            >
              {sending ? '发送中…' : '发送'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}