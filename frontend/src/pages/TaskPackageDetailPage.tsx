import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { Badge } from '@appica/ui-react/badge'
import { Button } from '@appica/ui-react/button'
import { Skeleton } from '@appica/ui-react/skeleton'
import {
  api,
  type TaskChatMessage,
  type TaskChatQuestion,
  type TaskChatSnapshot,
  type TaskChatStreamMessage,
  type TaskDocumentContent,
  type TaskDocumentsView,
  type TaskHandoffDocument,
  type TaskPackage,
  type TaskPipelineStage,
  type WorkbenchTask,
} from '../lib/api'
import { TaskStatusBadge } from '../components/StatusBadge'
import { PageBreadcrumb, type Crumb } from '../components/PageBreadcrumb'
import { DetailPageLayout } from '../components/detail/DetailPageLayout'
import { DetailAgentPanel } from '../components/detail/DetailAgentPanel'
import { TaskConversationView } from '../components/task-detail/TaskConversationView'
import { TaskWorkbenchPanel } from '../components/task-detail/TaskWorkbenchPanel'
import { TaskDocumentsPanel } from '../components/task-detail/TaskDocumentsPanel'
import { TaskEventsPanel } from '../components/task-detail/TaskEventsPanel'
import { TaskInfoPanel } from '../components/task-detail/TaskInfoPanel'
import {
  HandoffDocumentStatus,
  TaskMarkdownDocumentView,
} from '../components/task-detail/TaskMarkdownDocumentView'
import { formatDuration, taskDurationMs } from '../lib/duration'

type ConnectionState = 'connecting' | 'live' | 'reconnecting'
type TaskContentTab =
  | 'handoff'
  | 'info'
  | 'events'
  | 'documents'
  | 'conversation'
  | 'review'

const TASK_CONTENT_TABS: Array<[TaskContentTab, string]> = [
  ['handoff', '交付'],
  ['info', '信息'],
  ['events', '事件'],
  ['documents', '文档'],
  ['conversation', '会话'],
  ['review', '复盘'],
]

/**
 * 任务详情：正文按「交付 / 信息 / 事件 / 文档 / 会话 / 复盘」组织，
 * 右侧复用工作台的任务协作面板（需求方 / 执行方 / 我的 AI）。
 * 正文「会话」只读实时展示多方交互，右侧按当前用户身份参与任务。
 */
export function TaskPackageDetailPage() {
  const { id } = useParams<{ id: string }>()
  return <TaskDetailView taskId={Number(id)} />
}

/** 可复用的任务详情主体：工单详情页在同一任务对话外补充工单面包屑与状态徽标 */
export function TaskDetailView({
  taskId,
  breadcrumb,
  title,
  extraBadges,
}: {
  taskId: number
  breadcrumb?: Crumb[]
  title?: string
  extraBadges?: ReactNode
}) {
  const [task, setTask] = useState<TaskPackage | null>(null)
  const [workbenchTask, setWorkbenchTask] = useState<WorkbenchTask | null>(null)
  const [pipeline, setPipeline] = useState<TaskPipelineStage[]>([])
  const [messages, setMessages] = useState<TaskChatMessage[]>([])
  const [queuedMessages, setQueuedMessages] = useState<
    TaskChatSnapshot['queuedMessages']
  >([])
  const [hasAcceptanceApplication, setHasAcceptanceApplication] =
    useState(false)
  const [requesterName, setRequesterName] = useState<string | null>(null)
  const [agentOwnerName, setAgentOwnerName] = useState<string | null>(null)
  const [interventionCount, setInterventionCount] = useState(0)
  const [events, setEvents] = useState<TaskChatSnapshot['events']>([])
  const [now, setNow] = useState(() => Date.now())
  const [connection, setConnection] = useState<ConnectionState>('connecting')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [contentTab, setContentTab] = useState<TaskContentTab>('handoff')
  const [handoffDoc, setHandoffDoc] = useState<TaskHandoffDocument | null>(null)
  const [reviewDoc, setReviewDoc] = useState<TaskDocumentContent | null>(null)
  const [documents, setDocuments] = useState<TaskDocumentsView | null>(null)
  const [docsLoading, setDocsLoading] = useState(true)
  const [docsError, setDocsError] = useState<string | null>(null)
  /** 文档写入（交付/复盘/普通文档）后由任务 SSE 递增，驱动只读预览刷新 */
  const [docsRevision, setDocsRevision] = useState(0)

  const loadSeq = useRef(0)
  /** 首次快照请求是否已返回（用于与 SSE ready 对齐，避免重复加载） */
  const initialSettledRef = useRef(false)
  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    setLoading(true)
    try {
      const data: TaskChatSnapshot = await api.getTaskChat(taskId)
      if (seq !== loadSeq.current) return
      setTask(data.task)
      setPipeline(data.pipeline)
      setMessages(data.messages)
      setQueuedMessages(data.queuedMessages)
      setHasAcceptanceApplication(data.hasAcceptanceApplication)
      setRequesterName(data.requesterName)
      setAgentOwnerName(data.agentOwnerName)
      setInterventionCount(data.interventionCount)
      setEvents(data.events)
      setError(null)
    } catch (e) {
      if (seq === loadSeq.current) setError((e as Error).message)
    } finally {
      if (seq === loadSeq.current) {
        setLoading(false)
        initialSettledRef.current = true
      }
    }
  }, [taskId])

  const loadRef = useRef(load)
  useEffect(() => {
    loadRef.current = load
  }, [load])

  /** 当前用户在该任务中的工作台角色；加载失败时降级为仅「我的 AI」 */
  const roleSeq = useRef(0)
  const loadWorkbenchTask = useCallback(async () => {
    const seq = ++roleSeq.current
    try {
      const data = await api.getWorkbenchTask(taskId)
      if (seq === roleSeq.current) setWorkbenchTask(data)
    } catch {
      // 瞬态失败保留已加载角色；首次失败降级为仅「我的 AI」
      if (seq === roleSeq.current) {
        setWorkbenchTask((current) =>
          current?.id === taskId ? current : null,
        )
      }
    }
  }, [taskId])

  const loadWorkbenchTaskRef = useRef(loadWorkbenchTask)
  useEffect(() => {
    loadWorkbenchTaskRef.current = loadWorkbenchTask
  }, [loadWorkbenchTask])

  useEffect(() => {
    // 首次拉取任务对话与当前用户角色；setState 均在 fetch 完成后的异步回调里触发
    initialSettledRef.current = false
    // oxlint-disable-next-line react/set-state-in-effect
    void load()
    // oxlint-disable-next-line react/set-state-in-effect
    void loadWorkbenchTask()
  }, [load, loadWorkbenchTask])

  /** 任务文档数据：交付 / 复盘 / 文档清单；SSE 文档刷新时整体重读 */
  const docsSeq = useRef(0)
  const loadTaskDocuments = useCallback(async () => {
    const seq = ++docsSeq.current
    setDocsLoading(true)
    try {
      const [handoff, review, documentList] = await Promise.all([
        api.getTaskHandoff(taskId),
        api.getTaskReview(taskId),
        api.listTaskDocuments(taskId),
      ])
      if (seq !== docsSeq.current) return
      setHandoffDoc(handoff)
      setReviewDoc(review)
      setDocuments(documentList)
      setDocsError(null)
    } catch (e) {
      if (seq === docsSeq.current) setDocsError((e as Error).message)
    } finally {
      if (seq === docsSeq.current) setDocsLoading(false)
    }
  }, [taskId])

  useEffect(() => {
    // 打开详情及每次文档变更事件后重读任务文档
    // oxlint-disable-next-line react/set-state-in-effect
    void loadTaskDocuments()
  }, [loadTaskDocuments, docsRevision])

  /** 右侧任务协作操作后同步刷新任务、角色与文档 */
  const refreshTaskPanel = useCallback(async () => {
    await Promise.all([
      loadRef.current(),
      loadWorkbenchTaskRef.current(),
      loadTaskDocuments(),
    ])
  }, [loadTaskDocuments])

  // 持续时间展示：未结束任务定时刷新
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000)
    return () => window.clearInterval(timer)
  }, [])

  // 任务聊天 SSE：机器人文本增量 / 工具调用 / PIPELINE 阶段变化 / 快照刷新信号
  useEffect(() => {
    let closed = false
    let refreshTimer: number | undefined
    const source = new EventSource(`/api/tasks/${taskId}/chat/stream`)

    source.onopen = () => {
      if (!closed) setConnection('live')
    }
    source.onmessage = (event: MessageEvent<string>) => {
      if (closed) return
      let data: TaskChatStreamMessage
      try {
        data = JSON.parse(event.data) as TaskChatStreamMessage
      } catch {
        return
      }
      switch (data.type) {
        case 'ready':
          setConnection('live')
          // 首次快照请求已先于 SSE 就绪完成 → 补一次对齐，覆盖订阅建立前的间隙；
          // 请求仍在途则跳过（避免进入页面重复加载），活跃任务的事件会经 refresh 持续补偿
          if (initialSettledRef.current) {
            void loadRef.current()
            void loadWorkbenchTaskRef.current()
            setDocsRevision((value) => value + 1)
          }
          break
        case 'message.upsert':
          setMessages((current) => upsertMessage(current, data.message))
          break
        case 'queue.upsert':
          setQueuedMessages((current) => {
            const index = current.findIndex(
              (item) => item.id === data.message.id,
            )
            if (index < 0) return [...current, data.message]
            const next = current.slice()
            next[index] = data.message
            return next
          })
          break
        case 'queue.delete':
          setQueuedMessages((current) =>
            current.filter((item) => !data.ids.includes(item.id)),
          )
          break
        case 'stage.upsert':
          setPipeline((current) => upsertStage(current, data.stage))
          setTask((current) =>
            current?.id === data.stage.task.id ? data.stage.task : current,
          )
          break
        case 'stage.delete':
          setPipeline((current) =>
            current.filter((stage) => !data.ids.includes(stage.task.id)),
          )
          break
        case 'refresh':
          if (refreshTimer) window.clearTimeout(refreshTimer)
          refreshTimer = window.setTimeout(() => {
            refreshTimer = undefined
            void loadRef.current()
            void loadWorkbenchTaskRef.current()
            // 文档、交付、复盘与任务详情共用同一个刷新信号
            setDocsRevision((value) => value + 1)
          }, 120)
          break
        default:
          // ping 仅保活
          break
      }
    }
    source.onerror = () => {
      if (!closed) setConnection('reconnecting')
    }

    return () => {
      closed = true
      source.close()
      if (refreshTimer) window.clearTimeout(refreshTimer)
    }
  }, [taskId])

  /** 回答/跳过提问：待反馈走 project 答复，历史会话兼容 opencode reply/reject */
  const replyQuestion = useCallback(
    async (questionId: string, answers: string[][] | null) => {
      setBusy(true)
      setError(null)
      try {
        await api.replyTaskQuestion(
          taskId,
          questionId,
          answers ? { answers } : { reject: true },
        )
        setMessages((current) =>
          current.map((message) => {
            const question = message.question
            if (!question || question.id !== questionId) return message
            return {
              ...message,
              status: 'complete',
              question: {
                ...question,
                state: answers ? ('answered' as const) : ('rejected' as const),
                answers: answers ?? undefined,
              },
            }
          }),
        )
      } catch (e) {
        setError((e as Error).message)
        throw e
      } finally {
        setBusy(false)
      }
    },
    [taskId],
  )

  const currentTask = task?.id === taskId ? task : null
  /** 角色取工作台单任务接口，任务状态取实时聊天快照，避免操作后状态滞后 */
  const interactiveTask: WorkbenchTask | null =
    currentTask && workbenchTask?.id === currentTask.id
      ? {
          ...currentTask,
          workbenchRoles: workbenchTask.workbenchRoles,
          workbenchAction: workbenchTask.workbenchAction,
        }
      : null
  const interactiveChat: TaskChatSnapshot | null = currentTask
    ? {
        task: currentTask,
        rootTask: currentTask,
        pipeline,
        messages,
        queuedMessages,
        requesterName,
        agentOwnerName,
        interventionCount,
        hasAcceptanceApplication,
        events,
      }
    : null

  // 初始加载失败（没有任何数据）：页面内错误 + 重试
  if (!currentTask && !loading && error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-sm text-error-foreground">加载失败：{error}</p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setLoading(true)
            void load()
          }}
        >
          重试
        </Button>
      </div>
    )
  }
  // 首屏骨架：立即渲染页面结构（面包屑/标题/左右面板占位），快照返回后就地填充
  if (!currentTask) {
    return <TaskDetailSkeleton />
  }

  const durationMs = taskDurationMs(currentTask, now)
  const handoffPlaceholder =
    !handoffDoc?.exists ||
    !handoffDoc.content.trim() ||
    handoffDoc.content.trim() === '> 正在处理中……'
  const agentName = pipeline.find(
    (stage) => stage.task.id === currentTask.id,
  )?.agent?.name
  const pendingQuestions = Array.from(
    new Map(
      messages
        .map((message) => message.question)
        .filter((question): question is TaskChatQuestion =>
          Boolean(question && question.state === 'pending'),
        )
        .map((question) => [question.id, question]),
    ).values(),
  )

  return (
    <DetailPageLayout
      aiLabel="任务协作"
      ai={
        <TaskWorkbenchPanel
          task={interactiveTask}
          chat={interactiveChat}
          handoffDoc={handoffDoc}
          onRefresh={refreshTaskPanel}
          agent={
            <DetailAgentPanel
              taskId={currentTask.id}
              embedded
              emptyTitle={`${currentTask.code} 的独立 AI 会话`}
              emptyHint="当前任务的对话与其它页面相互隔离；让 AI 查询、创建或推进任务"
              placeholder={`让 AI 处理 ${currentTask.code}，或输入其它指令…`}
              onRunFinished={() => {
                void refreshTaskPanel()
              }}
            />
          }
        />
      }
    >
      <div className="flex h-full min-h-0 flex-col gap-4">
        <PageBreadcrumb
          items={
            breadcrumb ?? [
              { label: '任务', to: '/tasks/list' },
              { label: currentTask.title },
            ]
          }
        />

        <header className="shrink-0">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-xl font-semibold text-foreground-intense">
                {title ?? `${currentTask.code} ${currentTask.title}`}
              </h1>
              {extraBadges}
              <TaskStatusBadge
                status={currentTask.status}
                subStatus={currentTask.subStatus}
                showMain
              />
              <Badge variant="soft" size="sm">
                类型 · {currentTask.type}
              </Badge>
              <Badge variant="secondary" size="sm">
                定义 · {currentTask.templateName ?? '未设置'}
              </Badge>
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-foreground-muted">
              <span>
                创建于 {new Date(currentTask.createdAt).toLocaleString()}
              </span>
              <span>·</span>
              <span>
                {currentTask.status === '已结束' ? '持续时间' : '已运行'}{' '}
                {formatDuration(durationMs)}
              </span>
              <span>·</span>
              <span>人工介入 {interventionCount} 次</span>
            </p>
          </div>
        </header>

        {error && (
          <p
            role="alert"
            className="shrink-0 rounded-[var(--radius-md)] bg-error-soft px-3 py-2 text-sm text-error-foreground"
          >
            {error}
          </p>
        )}

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div
            role="tablist"
            aria-label="任务详情正文"
            className="flex w-fit max-w-full shrink-0 gap-1 overflow-x-auto rounded-[var(--radius-md)] bg-background-muted p-1"
          >
            {TASK_CONTENT_TABS.map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={contentTab === key}
                onClick={() => setContentTab(key)}
                className={`shrink-0 rounded-[var(--radius-sm)] px-3 py-1 text-sm transition-colors ${
                  contentTab === key
                    ? 'bg-background font-medium text-foreground-intense shadow-sm'
                    : 'text-foreground-muted hover:text-foreground-intense'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex min-h-0 flex-1 flex-col pt-3">
            {contentTab === 'handoff' && (
              <TaskMarkdownDocumentView
                title="交付文档"
                footer={
                  <HandoffDocumentStatus
                    path={handoffDoc?.path}
                    version={handoffDoc?.version}
                    updatedAt={handoffDoc?.updatedAt}
                    exists={handoffDoc?.exists}
                    loading={docsLoading && !handoffDoc}
                  />
                }
                content={handoffPlaceholder ? undefined : handoffDoc?.content}
                loading={docsLoading && !handoffDoc}
                error={!handoffDoc ? docsError : null}
                emptyText={
                  handoffDoc?.exists
                    ? '执行方尚未更新交付文档，更新后会自动展示'
                    : handoffDoc
                      ? '执行方尚未创建交付文档；接受任务并开始处理后应立即创建'
                      : '暂无交付文档'
                }
                contentKey={handoffDoc?.version}
              />
            )}

            {contentTab === 'info' && (
              <TaskInfoPanel
                key={taskId}
                task={currentTask}
                agentName={agentName}
                requesterName={requesterName}
                agentOwnerName={agentOwnerName}
                interventionCount={interventionCount}
                durationMs={durationMs}
                busy={busy}
                pendingQuestions={pendingQuestions}
                onReplyQuestion={replyQuestion}
              />
            )}

            {contentTab === 'events' && (
              <TaskEventsPanel events={events} />
            )}

            {contentTab === 'documents' && (
              <TaskDocumentsPanel
                data={documents}
                loading={docsLoading}
                error={docsError}
              />
            )}

            {contentTab === 'conversation' && (
              <TaskConversationView
                messages={messages}
                connection={connection}
              />
            )}

            {contentTab === 'review' && (
              <TaskMarkdownDocumentView
                title="复盘文档"
                subtitle={reviewDoc?.path}
                meta={
                  reviewDoc?.updatedAt
                    ? `更新于 ${new Date(reviewDoc.updatedAt).toLocaleString()}`
                    : null
                }
                content={reviewDoc?.content}
                loading={docsLoading && !reviewDoc}
                error={!reviewDoc ? docsError : null}
                emptyText={
                  currentTask.status === '已结束' &&
                  currentTask.subStatus === '完成'
                    ? '复盘生成中，完成后自动展示'
                    : '任务验收通过后由平台生成复盘文档'
                }
                contentKey={reviewDoc?.updatedAt}
              />
            )}
          </div>
        </div>
      </div>
    </DetailPageLayout>
  )
}

function upsertMessage(
  current: TaskChatMessage[],
  message: TaskChatMessage,
): TaskChatMessage[] {
  const index = current.findIndex((item) => item.id === message.id)
  if (index < 0) {
    return [...current, message].sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    )
  }
  const next = current.slice()
  next[index] = message
  return next
}

function upsertStage(
  current: TaskPipelineStage[],
  stage: TaskPipelineStage,
): TaskPipelineStage[] {
  const index = current.findIndex((item) => item.task.id === stage.task.id)
  if (index < 0) {
    return [...current, stage].sort(
      (a, b) =>
        a.task.sortOrder - b.task.sortOrder || a.task.id - b.task.id,
    )
  }
  const next = current.slice()
  next[index] = stage
  return next
}

/**
 * 首屏骨架：镜像真实页面布局（面包屑 + 标题区 + 六个正文 Tab + 右侧 AI），
 * 快照返回后就地填充，避免整页空白等待与明显布局跳动。
 */
function TaskDetailSkeleton() {
  return (
    <DetailPageLayout
      aiLabel="任务协作"
      ai={
        <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-[var(--radius-lg)] border border-border bg-background">
          <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-5 w-12 rounded-full" />
          </div>
          <div className="flex flex-1 flex-col justify-end gap-4 px-4 py-4">
            <ChatBubbleSkeleton />
            <ChatBubbleSkeleton align="right" />
            <ChatBubbleSkeleton />
          </div>
        </section>
      }
    >
      <div className="flex h-full min-h-0 flex-col gap-4">
        <PageBreadcrumb
          items={[{ label: '任务', to: '/tasks/list' }, { label: '加载中' }]}
        />
        <header className="shrink-0 space-y-2">
          <div className="flex items-center gap-2">
            <Skeleton className="h-7 w-72 max-w-full" />
            <Skeleton className="h-5 w-24 rounded-full" />
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
          <Skeleton className="h-4 w-[28rem] max-w-full" />
        </header>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex w-fit gap-1 rounded-[var(--radius-md)] bg-background-muted p-1">
            {TASK_CONTENT_TABS.map(([key]) => (
              <Skeleton
                key={key}
                className="h-8 w-14 rounded-[var(--radius-sm)]"
              />
            ))}
          </div>
          <section className="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--radius-lg)] border border-border bg-background">
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-3">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-5 w-24 rounded-full" />
            </div>
            <div className="flex flex-1 flex-col gap-3 px-4 py-4">
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-11/12" />
              <Skeleton className="h-3 w-4/5" />
              <Skeleton className="mt-3 h-6 w-1/2" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-10/12" />
            </div>
          </section>
        </div>
      </div>
    </DetailPageLayout>
  )
}

function ChatBubbleSkeleton({ align = 'left' }: { align?: 'left' | 'right' }) {
  return (
    <div
      className={`flex items-start gap-2.5 ${align === 'right' ? 'flex-row-reverse' : ''}`}
    >
      <Skeleton className="size-8 shrink-0 rounded-full" />
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-3 w-full max-w-md" />
        <Skeleton className="h-3 w-2/3 max-w-xs" />
      </div>
    </div>
  )
}
