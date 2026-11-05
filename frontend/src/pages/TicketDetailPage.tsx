import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Badge } from '@appica/ui-react/badge'
import { Button } from '@appica/ui-react/button'
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@appica/ui-react/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@appica/ui-react/table'
import {
  api,
  type TaskChatMessage,
  type TaskChatQuestion,
  type TaskChatSnapshot,
  type TaskChatStreamMessage,
  type TaskDocumentContent,
  type TaskDocumentsView,
  type TaskHandoffDocument,
  type TaskPipelineStage,
  type TicketDetail,
  type TicketWorkflowRun,
  type WorkbenchTask,
} from '../lib/api'
import { MarkdownViewer } from '../components/MarkdownViewer'
import { TicketStatusBadge } from '../components/StatusBadge'
import { DetailAgentPanel } from '../components/detail/DetailAgentPanel'
import { DetailPageLayout } from '../components/detail/DetailPageLayout'
import { TaskWorkbenchPanel } from '../components/task-detail/TaskWorkbenchPanel'
import { TicketCurrentNodePanel } from '../components/ticket-detail/TicketCurrentNodePanel'
import { TaskDocumentsPanel } from '../components/task-detail/TaskDocumentsPanel'
import { TaskEventsPanel } from '../components/task-detail/TaskEventsPanel'
import { TaskMarkdownDocumentView } from '../components/task-detail/TaskMarkdownDocumentView'
import { TaskTreePanel } from '../components/task-detail/TaskTreePanel'
import { TaskDetailView } from './TaskPackageDetailPage'
import { visibleEventSource } from '../lib/event-source'

type TicketContentTab =
  | 'current'
  | 'progress'
  | 'info'
  | 'events'
  | 'tasks'
  | 'documents'
  | 'review'

const TICKET_CONTENT_TABS: Array<[TicketContentTab, string]> = [
  ['current', '当前'],
  ['progress', '进度'],
  ['info', '信息'],
  ['events', '事件'],
  ['tasks', '任务'],
  ['documents', '文档'],
  ['review', '复盘'],
]

const OUTCOME_LABEL: Record<string, string> = {
  succeeded: '执行成功',
  failed: '执行失败',
  approved: '通过',
  rejected: '驳回',
}

/** 工单详情：新模型展示工作流进度与节点任务；历史工单继续复用任务详情 */
export function TicketDetailPage() {
  const { ticketId } = useParams<{ ticketId: string }>()
  const navigate = useNavigate()
  const id = Number(ticketId)
  const [ticket, setTicket] = useState<TicketDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [acting, setActing] = useState<'accept' | 'reject' | null>(null)
  const [contentTab, setContentTab] = useState<TicketContentTab>('current')

  /** 关联节点任务（最近一次创建的节点任务）的实时数据 */
  const [taskChat, setTaskChat] = useState<TaskChatSnapshot | null>(null)
  const [workbenchTask, setWorkbenchTask] = useState<WorkbenchTask | null>(null)
  const [handoffDoc, setHandoffDoc] = useState<TaskHandoffDocument | null>(null)
  const [documents, setDocuments] = useState<TaskDocumentsView | null>(null)
  const [reviewDoc, setReviewDoc] = useState<TaskDocumentContent | null>(null)
  const [taskLoading, setTaskLoading] = useState(false)
  const [taskError, setTaskError] = useState<string | null>(null)
  const [replying, setReplying] = useState(false)

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
    const timer = window.setInterval(load, 10_000)
    return () => window.clearInterval(timer)
  }, [load])

  const act = (action: 'accept' | 'reject') => {
    setActing(action)
    setActionError(null)
    api
      .acceptTicketWorkflow(id, action)
      .then(() => load())
      .catch((e: Error) => setActionError(e.message))
      .finally(() => setActing(null))
  }

  /** 节点事件/任务/文档/复盘跟随最近一次创建了任务的节点运行 */
  const activeTaskId = useMemo(() => {
    let latest: TicketWorkflowRun | null = null
    for (const run of ticket?.workflow?.runs ?? []) {
      if (!run.taskId) continue
      if (!latest || run.id > latest.id) latest = run
    }
    return latest?.taskId ?? null
  }, [ticket])

  const taskSeq = useRef(0)
  const loadTaskData = useCallback(async () => {
    if (!activeTaskId) return
    const seq = ++taskSeq.current
    setTaskLoading(true)
    try {
      const [chat, handoff, docs, review, workbench] = await Promise.all([
        api.getTaskChat(activeTaskId),
        api.getTaskHandoff(activeTaskId),
        api.listTaskDocuments(activeTaskId),
        api.getTaskReview(activeTaskId),
        api.getWorkbenchTask(activeTaskId).catch(() => null),
      ])
      if (seq !== taskSeq.current) return
      setTaskChat(chat)
      setHandoffDoc(handoff)
      setDocuments(docs)
      setReviewDoc(review)
      setWorkbenchTask(workbench?.id === activeTaskId ? workbench : null)
      setTaskError(null)
    } catch (e) {
      if (seq === taskSeq.current) setTaskError((e as Error).message)
    } finally {
      if (seq === taskSeq.current) setTaskLoading(false)
    }
  }, [activeTaskId])

  useEffect(() => {
    // 切换节点任务后丢弃旧任务的数据，重新拉取事件/任务树/文档/复盘
    // oxlint-disable-next-line react/set-state-in-effect
    setTaskChat(null)
    // oxlint-disable-next-line react/set-state-in-effect
    setWorkbenchTask(null)
    // oxlint-disable-next-line react/set-state-in-effect
    setHandoffDoc(null)
    // oxlint-disable-next-line react/set-state-in-effect
    setDocuments(null)
    // oxlint-disable-next-line react/set-state-in-effect
    setReviewDoc(null)
    // oxlint-disable-next-line react/set-state-in-effect
    setTaskError(null)
    // oxlint-disable-next-line react/set-state-in-effect
    void loadTaskData()
  }, [loadTaskData])

  useEffect(() => {
    // 节点任务实时流：就绪/刷新重拉快照，消息与阶段增量就地合并
    if (!activeTaskId) return
    let closed = false
    const source = visibleEventSource(`/api/tasks/${activeTaskId}/chat/stream`)
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
          void loadTaskData()
          break
        case 'message.upsert':
          if (data.message.taskId !== activeTaskId) break
          setTaskChat((current) =>
            current
              ? {
                  ...current,
                  messages: upsertMessage(current.messages, data.message),
                }
              : current,
          )
          break
        case 'queue.upsert':
          if (data.message.taskId !== activeTaskId) break
          setTaskChat((current) => {
            if (!current) return current
            const index = current.queuedMessages.findIndex(
              (item) => item.id === data.message.id,
            )
            const queued =
              index < 0
                ? [...current.queuedMessages, data.message]
                : current.queuedMessages.map((item, itemIndex) =>
                    itemIndex === index ? data.message : item,
                  )
            return { ...current, queuedMessages: queued }
          })
          break
        case 'queue.delete':
          setTaskChat((current) =>
            current
              ? {
                  ...current,
                  queuedMessages: current.queuedMessages.filter(
                    (item) => !data.ids.includes(item.id),
                  ),
                }
              : current,
          )
          break
        case 'stage.upsert':
          setTaskChat((current) =>
            current
              ? { ...current, pipeline: upsertStage(current.pipeline, data.stage) }
              : current,
          )
          break
        case 'stage.delete':
          setTaskChat((current) =>
            current
              ? {
                  ...current,
                  pipeline: current.pipeline.filter(
                    (stage) => !data.ids.includes(stage.task.id),
                  ),
                }
              : current,
          )
          break
        case 'refresh':
          void loadTaskData()
          break
        default:
          // ping 仅保活
          break
      }
    }
    return () => {
      closed = true
      source.close()
    }
  }, [activeTaskId, loadTaskData])

  /** 当前节点任务与执行机器人（来自 PIPELINE 阶段快照） */
  const currentStage = useMemo(
    () =>
      taskChat?.pipeline.find((stage) => stage.task.id === activeTaskId) ??
      null,
    [taskChat, activeTaskId],
  )
  const currentAgentName = currentStage?.agent?.name ?? null

  /** 快照与当前节点任务对齐时才交给面板，避免串任务 */
  const interactiveChat: TaskChatSnapshot | null =
    taskChat?.task.id === activeTaskId ? taskChat : null
  const interactiveTask: WorkbenchTask | null =
    interactiveChat && workbenchTask?.id === interactiveChat.task.id
      ? {
          ...interactiveChat.task,
          workbenchRoles: workbenchTask.workbenchRoles,
          workbenchAction: workbenchTask.workbenchAction,
        }
      : null

  const messages = useMemo(
    () =>
      (taskChat?.messages ?? []).filter(
        (message) => message.taskId === activeTaskId,
      ),
    [taskChat, activeTaskId],
  )

  /** 待回答的机器人提问（去重） */
  const pendingQuestions = useMemo(() => {
    return Array.from(
      new Map(
        messages
          .map((message) => message.question)
          .filter(
            (question): question is TaskChatQuestion =>
              Boolean(question && question.state === 'pending'),
          )
          .map((question) => [question.id, question]),
      ).values(),
    )
  }, [messages])

  /** 回答/跳过当前节点任务的机器人提问 */
  const replyQuestion = useCallback(
    async (questionId: string, answers: string[][] | null) => {
      if (!activeTaskId) return
      setReplying(true)
      try {
        await api.replyTaskQuestion(
          activeTaskId,
          questionId,
          answers ? { answers } : { reject: true },
        )
        await loadTaskData()
      } finally {
        setReplying(false)
      }
    },
    [activeTaskId, loadTaskData],
  )

  /** 提交补充内容：执行中进入发送队列，等待阶段并入恢复提示 */
  const sendSupplement = useCallback(
    async (content: string) => {
      if (!activeTaskId) return
      await api.sendTaskMessage(activeTaskId, content)
      await loadTaskData()
    },
    [activeTaskId, loadTaskData],
  )

  /** 右侧任务协作操作后刷新工单与节点任务数据 */
  const refreshTicket = useCallback(async () => {
    await Promise.all([load(), loadTaskData()])
  }, [load, loadTaskData])

  if (!ticket && error) {
    return (
      <p className="rounded-[var(--radius-md)] bg-error-muted px-3 py-2 text-sm text-error-foreground">
        加载失败：{error}
      </p>
    )
  }
  if (!ticket) {
    return <p className="text-sm text-foreground-muted">加载中…</p>
  }

  const workflow = ticket.workflow
  const canAccept =
    workflow &&
    ticket.workflowStatus === '待验收' &&
    workflow.currentNodeKey &&
    !workflow.autoAcceptance

  if (workflow) {
    const listPath = `/tickets/wf/${workflow.definitionId}`
    const inputEntries = Object.entries(workflow.inputValues)
    const startFields =
      workflow.nodes.find((node) => node.kind === 'start')?.inputFields ?? []
    const fieldByKey = new Map(startFields.map((field) => [field.key, field]))
    const nodeTaskCode = interactiveChat?.task.code
    /** 仅操作/审批节点创建节点任务；起始/验收节点只保留「我的AI」 */
    const currentNode = workflow.nodes.find(
      (node) => node.key === workflow.currentNodeKey,
    )
    const isTaskNode =
      currentNode?.kind === 'operation' || currentNode?.kind === 'approval'
    return (
      <DetailPageLayout
        aiLabel="任务协作"
        ai={
          <TaskWorkbenchPanel
            task={isTaskNode ? interactiveTask : null}
            chat={isTaskNode ? interactiveChat : null}
            handoffDoc={handoffDoc}
            onRefresh={refreshTicket}
            agent={
              <DetailAgentPanel
                taskId={activeTaskId ?? undefined}
                embedded
                emptyTitle={`${nodeTaskCode ?? ticket.code} 的独立 AI 会话`}
                emptyHint="当前工单的对话与其它页面相互隔离；让 AI 查询、创建或推进任务"
                placeholder={`让 AI 处理 ${nodeTaskCode ?? ticket.code}，或输入其它指令…`}
                onRunFinished={() => {
                  void refreshTicket()
                }}
              />
            }
          />
        }
      >
        <div className="flex h-full min-h-0 flex-col gap-4">
          <div>
            <nav className="flex items-center gap-1 text-sm text-foreground-muted">
              <Link to="/tickets" className="hover:text-foreground">工单</Link>
              <span>/</span>
              <Link to={listPath} className="hover:text-foreground">
                {workflow.definitionName}
              </Link>
              <span>/</span>
              <span className="text-foreground">{ticket.code}</span>
            </nav>
            <h1 className="mt-2 text-2xl font-semibold">
              {ticket.code} {ticket.title}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <TicketStatusBadge status={ticket.status} />
              <Badge variant="outline" size="sm">
                {workflow.definitionName} v{workflow.version}
              </Badge>
              <Badge variant="secondary" size="sm">
                发起机器人 · {ticket.initiatorWorkerName ?? ticket.createdByName}
              </Badge>
              {workflow.autoAcceptance && (
                <Badge variant="soft" size="sm">含自动验收</Badge>
              )}
            </div>
          </div>

          {(actionError || error) && (
            <p className="rounded-[var(--radius-md)] bg-error-muted px-3 py-2 text-sm text-error-foreground">
              {actionError ?? error}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div
              role="tablist"
              aria-label="工单详情正文"
              className="flex w-fit max-w-full shrink-0 gap-1 overflow-x-auto rounded-[var(--radius-md)] bg-background-muted p-1"
            >
              {TICKET_CONTENT_TABS.map(([key, label]) => (
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
            {canAccept && (
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={acting !== null}
                  onClick={() => act('reject')}
                >
                  验收驳回
                </Button>
                <Button size="sm" disabled={acting !== null} onClick={() => act('accept')}>
                  验收通过
                </Button>
              </div>
            )}
          </div>

          {(contentTab === 'current' ||
            contentTab === 'events' ||
            contentTab === 'tasks') &&
            taskError && (
              <p
                role="alert"
                className="shrink-0 rounded-[var(--radius-md)] bg-error-muted px-3 py-2 text-sm text-error-foreground"
              >
                加载失败：{taskError}
              </p>
            )}

          <div className="flex min-h-0 flex-1 flex-col">
            {contentTab === 'current' && (
              <TicketCurrentNodePanel
                workflow={workflow}
                currentTask={currentStage?.task ?? null}
                agentName={currentAgentName}
                messages={messages}
                pendingQuestions={pendingQuestions}
                replying={replying}
                onReplyQuestion={replyQuestion}
                onSend={sendSupplement}
              />
            )}

            {contentTab === 'progress' && (
              <div className="min-h-0 flex-1 overflow-y-auto">
                <Card>
                  <CardHeader>
                    <CardTitle>流程进度</CardTitle>
                    <CardDescription>
                      当前节点：{ticket.currentNodeName || '流程已结束'}
                    </CardDescription>
                  </CardHeader>
                  <div className="px-4 pb-4">
                    <Table hoverableRows>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-16">顺序</TableHead>
                          <TableHead className="w-40">节点</TableHead>
                          <TableHead className="w-36">处理机器人</TableHead>
                          <TableHead className="w-24">状态</TableHead>
                          <TableHead className="w-24">结果</TableHead>
                          <TableHead>任务</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {workflow.runs.map((run, index) => (
                          <TableRow key={run.id}>
                            <TableCell>{index + 1}</TableCell>
                            <TableCell>
                              <span className="font-medium">{run.nodeName}</span>
                              <span className="ml-1 text-xs text-foreground-muted">
                                第 {run.attempt} 次
                              </span>
                            </TableCell>
                            <TableCell>
                              {run.agentName ??
                                ticket.initiatorWorkerName ??
                                '发起机器人'}
                            </TableCell>
                            <TableCell>{run.status}</TableCell>
                            <TableCell>
                              {run.outcome
                                ? OUTCOME_LABEL[run.outcome] ?? run.outcome
                                : '—'}
                            </TableCell>
                            <TableCell>
                              {run.taskId ? (
                                <Link
                                  to={`/tasks/${run.taskId}`}
                                  className="font-mono text-xs hover:underline"
                                >
                                  TK-{String(run.taskId).padStart(4, '0')}
                                  {run.taskStatus ? ` · ${run.taskStatus}` : ''}
                                </Link>
                              ) : (
                                '—'
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                        {workflow.runs.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={6} className="text-foreground-muted">
                              暂无节点运行记录
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </Card>
              </div>
            )}

            {contentTab === 'info' && (
              <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="flex flex-col gap-4">
                  <Card>
                    <CardHeader>
                      <CardTitle>需求正文</CardTitle>
                      <CardDescription>发起工单时填写的工单描述</CardDescription>
                    </CardHeader>
                    <div className="px-4 pb-4 text-sm">
                      {ticket.description?.trim() ? (
                        <MarkdownViewer text={ticket.description} />
                      ) : (
                        <p className="text-foreground-muted">无需求正文</p>
                      )}
                    </div>
                  </Card>
                  <Card>
                    <CardHeader>
                      <CardTitle>工单输入</CardTitle>
                      <CardDescription>起始节点提交的结构化信息</CardDescription>
                    </CardHeader>
                    <div className="flex flex-col gap-2 px-4 pb-4 text-sm">
                      {inputEntries.length === 0 && (
                        <p className="text-foreground-muted">无结构化输入</p>
                      )}
                      {inputEntries.map(([key, value]) => {
                        const field = fieldByKey.get(key)
                        const text =
                          typeof value === 'object' && value !== null
                            ? JSON.stringify(value)
                            : String(value ?? '')
                        return (
                          <div
                            key={key}
                            className="rounded-[var(--radius-md)] bg-background-muted px-3 py-2"
                          >
                            <p className="text-xs text-foreground-muted">
                              {field?.label ?? key}
                            </p>
                            {field?.type === 'textarea' ? (
                              text ? (
                                <MarkdownViewer text={text} className="mt-1" />
                              ) : (
                                <p className="mt-1 text-foreground-muted">—</p>
                              )
                            ) : (
                              <p className="mt-1 break-all whitespace-pre-wrap">
                                {text || '—'}
                              </p>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </Card>
                </div>
              </div>
            )}

            {contentTab === 'events' &&
              (activeTaskId ? (
                <TaskEventsPanel events={interactiveChat?.events ?? []} />
              ) : (
                <EmptyTabPanel text="暂无节点任务事件" />
              ))}

            {contentTab === 'tasks' &&
              (activeTaskId ? (
                <TaskTreePanel
                  pipeline={interactiveChat?.pipeline ?? []}
                  currentTaskId={activeTaskId}
                  onOpenTask={(taskId) => navigate(`/tasks/${taskId}`)}
                />
              ) : (
                <EmptyTabPanel text="暂无节点任务" />
              ))}

            {contentTab === 'documents' &&
              (activeTaskId ? (
                <TaskDocumentsPanel
                  data={documents}
                  loading={taskLoading}
                  error={taskError}
                />
              ) : (
                <EmptyTabPanel text="暂无任务文档" />
              ))}

            {contentTab === 'review' &&
              (activeTaskId ? (
                <TaskMarkdownDocumentView
                  title="复盘文档"
                  subtitle={reviewDoc?.path}
                  meta={
                    reviewDoc?.updatedAt
                      ? `更新于 ${new Date(reviewDoc.updatedAt).toLocaleString()}`
                      : null
                  }
                  content={reviewDoc?.content}
                  loading={taskLoading && !reviewDoc}
                  error={!reviewDoc ? taskError : null}
                  emptyText={
                    ticket.status === '已完成'
                      ? '复盘生成中，完成后自动展示'
                      : '节点任务验收通过后由平台生成复盘文档'
                  }
                  contentKey={reviewDoc?.updatedAt}
                />
              ) : (
                <EmptyTabPanel text="节点任务完成后由平台生成复盘文档" />
              ))}
          </div>
        </div>
      </DetailPageLayout>
    )
  }

  if (!ticket.taskId || !ticket.task) {
    return (
      <p className="rounded-[var(--radius-md)] bg-error-muted px-3 py-2 text-sm text-error-foreground">
        工单关联的任务已不存在，请检查任务中心
      </p>
    )
  }

  const legacyCategoryPath = '/tickets'

  return (
    <TaskDetailView
      taskId={ticket.taskId}
      breadcrumb={[
        { label: ticket.category, to: legacyCategoryPath },
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
            处理机器人 · {ticket.assigneeName}
          </Badge>
        </>
      }
    />
  )
}

/** 无节点任务时的空态占位（与任务文档等面板同款外框样式） */
function EmptyTabPanel({ text }: { text: string }) {
  return (
    <section className="flex h-full min-h-0 flex-col items-center justify-center rounded-[var(--radius-lg)] border border-border bg-background">
      <p className="text-sm text-foreground-muted">{text}</p>
    </section>
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
