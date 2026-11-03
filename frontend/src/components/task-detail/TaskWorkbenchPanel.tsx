import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  AssistantRuntimeProvider,
  ThreadPrimitive,
  useExternalStoreRuntime,
  type AppendMessage,
} from '@assistant-ui/react'
import { Button } from '@appica/ui-react/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@appica/ui-react/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@appica/ui-react/select'
import {
  ArrowsExchange,
  Ban,
  CircleCheck,
  CircleX,
  ClipboardCheck,
  Package2Export,
  Package2Import,
  Sparkles,
  Subtask,
  Wrench,
} from '@appica/icons-react'
import {
  api,
  type TaskChatMessage,
  type TaskChatSnapshot,
  type TaskHandoffDocument,
  type TaskTemplate,
  type WorkbenchTask,
  type Worker,
} from '../../lib/api'
import { TaskStatusBadge } from '../StatusBadge'
import {
  TaskChatMessageItem,
  TaskChatQueuedMessages,
} from './TaskChatMessages'
import { toTaskChatThreadMessage } from './task-chat-message'
import {
  ChatActionIcon,
  ChatComposerDock,
  ChatComposerFrame,
  ChatSendButton,
} from '../agent-chat/ChatComposer'

type RightTab = 'requester' | 'responsible' | 'agent'
type DialogKind =
  | 'refuse'
  | 'handoff'
  | 'assign'
  | 'subtask'
  | 'cancel'
  | null

export interface TaskWorkbenchPanelProps {
  /** 当前任务及其在工作台视角下的角色；无任务时仅展示我的 AI */
  task: WorkbenchTask | null
  /** 任务对话快照（必须与 task 匹配） */
  chat: TaskChatSnapshot | null
  /** 交付文档，用于发起交付前确认当前版本 */
  handoffDoc?: TaskHandoffDocument | null
  /** 交付文档正在编辑时禁止发起交付 */
  handoffEditing?: boolean
  /** 我的 AI 面板；仅在切换到该 Tab 时挂载 */
  agent: ReactNode
  /** 任务操作完成后刷新任务、聊天、交付文档与角色 */
  onRefresh: () => Promise<unknown> | unknown
  className?: string
}

/**
 * 任务协作面板：工作台与任务详情共用。
 *
 * 按当前用户在任务中的身份展示「任务-需求方 / 任务-执行方」，
 * 并复用任务中心的发送队列、提问、验收与分配能力；无任务身份时仅保留「我的 AI」。
 */
export function TaskWorkbenchPanel({
  task,
  chat,
  handoffDoc = null,
  handoffEditing = false,
  agent,
  onRefresh,
  className,
}: TaskWorkbenchPanelProps) {
  const [rightTab, setRightTab] = useState<RightTab>('requester')
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<DialogKind>(null)
  const [dialogText, setDialogText] = useState('')
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [workers, setWorkers] = useState<Worker[]>([])
  const [templates, setTemplates] = useState<TaskTemplate[]>([])
  const [assignWorkerId, setAssignWorkerId] = useState('')
  const [subtaskTemplateId, setSubtaskTemplateId] = useState('')
  const [subtaskTitle, setSubtaskTitle] = useState('')
  const [subtaskInput, setSubtaskInput] = useState('')
  const [subtaskOutputSpec, setSubtaskOutputSpec] = useState('')

  const roles = task?.workbenchRoles ?? []
  const isAgent = roles.includes('agent')
  const isResponsible = roles.includes('responsible')
  const isRequester = roles.includes('requester')
  const isResponsibleSide = isAgent || isResponsible

  const rightTabs = useMemo<Array<[RightTab, string]>>(() => {
    const tabs: Array<[RightTab, string]> = []
    if (isRequester) tabs.push(['requester', '任务-需求方'])
    if (isResponsibleSide) tabs.push(['responsible', '任务-执行方'])
    tabs.push(['agent', '我的AI'])
    return tabs
  }, [isRequester, isResponsibleSide])

  const currentRightTab: RightTab = rightTabs.some(
    ([key]) => key === rightTab,
  )
    ? rightTab
    : rightTabs[0][0]
  const activeTaskRole =
    currentRightTab === 'requester'
      ? 'requester'
      : currentRightTab === 'responsible'
        ? 'responsible'
        : null

  const activeChat =
    chat && task && chat.task.id === task.id ? chat : null
  const executing = task?.subStatus === '执行中'
  const awaitingAcceptance = task?.subStatus === '待接受'
  const awaitingReview = task?.subStatus === '待验收'
  const awaitingAnswer = task?.subStatus === '待反馈'
  const finished = task?.status === '已结束'
  const completed = finished && task?.subStatus === '完成'
  const delivered = activeChat?.hasAcceptanceApplication ?? false
  const handoffReady = Boolean(
    handoffDoc?.exists &&
      handoffDoc.content.trim() &&
      handoffDoc.content.trim() !== '> 正在处理中……',
  )
  const deliveryActive =
    Boolean(task) && isAgent && (executing || awaitingReview)
  const assignAvailable = Boolean(task) && !finished
  const requesterSubtaskAvailable = Boolean(task) && isRequester && !finished
  const responsibleSubtaskAvailable =
    Boolean(task) && isAgent && executing && !delivered

  useEffect(() => {
    // 切换任务时清空草稿和未完成弹窗，避免把上一个任务的内容带过来
    // oxlint-disable-next-line react/set-state-in-effect
    setDraft('')
    // oxlint-disable-next-line react/set-state-in-effect
    setDialog(null)
    // oxlint-disable-next-line react/set-state-in-effect
    setDialogError(null)
    // oxlint-disable-next-line react/set-state-in-effect
    setError(null)
  }, [task?.id])

  useEffect(() => {
    if (dialog !== 'assign') return
    let closed = false
    api
      .listWorkers({ role: '工作者' })
      .then((rows) => {
        if (!closed) setWorkers(rows.filter((row) => row.enabled))
      })
      .catch(() => undefined)
    return () => {
      closed = true
    }
  }, [dialog])

  useEffect(() => {
    if (dialog !== 'subtask') return
    let closed = false
    api
      .listTaskTemplates()
      .then((rows) => {
        if (!closed) setTemplates(rows)
      })
      .catch(() => undefined)
    return () => {
      closed = true
    }
  }, [dialog])

  /** 切换身份时清空未发送内容，避免把需求方内容误发成执行方消息。 */
  const selectRightTab = useCallback(
    (tab: RightTab) => {
      if (tab !== currentRightTab) setDraft('')
      setRightTab(tab)
    },
    [currentRightTab],
  )

  /** 执行任务操作并刷新；返回错误文案，成功时返回 null */
  const run = useCallback(
    async (action: () => Promise<unknown>): Promise<string | null> => {
      setBusy(true)
      setError(null)
      setDialogError(null)
      try {
        await action()
        await onRefresh()
        return null
      } catch (e) {
        const message = (e as Error).message
        setError(message)
        return message
      } finally {
        setBusy(false)
      }
    },
    [onRefresh],
  )

  const submitMessage = useCallback(
    async (raw: string): Promise<boolean> => {
      const text = raw.trim()
      if (!text || !task || busy || !activeTaskRole) return false
      if (activeTaskRole === 'requester') {
        if (task.subStatus === '待验收') {
          // 需求方身份下，待验收时发送消息等同于验收不通过
          return (
            (await run(() => api.workbenchRejectHandoff(task.id, text))) === null
          )
        }
        return (
          (await run(() => api.sendTaskMessage(task.id, text, 'requester'))) ===
          null
        )
      }
      return (
        (await run(() =>
          isAgent && executing
            ? api.workbenchSendMessage(task.id, text)
            : api.sendTaskMessage(task.id, text, 'responsible'),
        )) === null
      )
    },
    [task, busy, activeTaskRole, isAgent, executing, run],
  )

  const sendMessage = useCallback(async () => {
    const text = draft.trim()
    if (!text || !task || busy) return
    const sent = await submitMessage(text)
    // 发送失败保留输入内容，便于直接重试
    if (sent) setDraft((current) => (current.trim() === text ? '' : current))
  }, [draft, task, busy, submitMessage])

  const runtime = useExternalStoreRuntime<TaskChatMessage>({
    messages: activeChat?.messages ?? [],
    convertMessage: toTaskChatThreadMessage,
    onNew: async (message: AppendMessage) => {
      const text = message.content
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('\n')
        .trim()
      if (text) await submitMessage(text)
    },
    isSendDisabled: !task || busy,
  })

  const replyQuestion = useCallback(
    async (questionId: string, answers: string[][] | null) => {
      if (!task) return
      await run(() =>
        api.workbenchReplyQuestion(task.id, questionId, {
          answers: answers ?? undefined,
          reject: answers === null,
        }),
      )
    },
    [task, run],
  )

  const openDialog = useCallback((kind: Exclude<DialogKind, null>) => {
    setDialogError(null)
    setDialog(kind)
  }, [])

  const submitDialog = useCallback(async () => {
    if (busy || !task) return
    let failure: string | null = null
    if (dialog === 'refuse') {
      failure = await run(() => api.workbenchRefuse(task.id, dialogText.trim()))
    } else if (dialog === 'handoff') {
      failure = await run(() => api.workbenchApplyHandoff(task.id))
    } else if (dialog === 'assign') {
      if (!assignWorkerId) return
      failure = await run(() => api.assignTask(task.id, Number(assignWorkerId)))
    } else if (dialog === 'cancel') {
      failure = await run(() => api.workbenchCancelTask(task.id))
    } else if (dialog === 'subtask') {
      if (!subtaskTemplateId || !subtaskTitle.trim()) return
      failure = await run(() =>
        api.workbenchCreateSubtask(task.id, {
          perspective: activeTaskRole ?? 'requester',
          templateId: Number(subtaskTemplateId),
          title: subtaskTitle.trim(),
          input: subtaskInput.trim() || null,
          outputSpec: subtaskOutputSpec.trim() || null,
        }),
      )
    }
    // 弹窗内的失败直接展示在弹窗里，避免被遮罩挡住
    if (failure) {
      setDialogError(failure)
      return
    }
    setDialog(null)
    setDialogText('')
    setDialogError(null)
    setAssignWorkerId('')
    setSubtaskTemplateId('')
    setSubtaskTitle('')
    setSubtaskInput('')
    setSubtaskOutputSpec('')
  }, [
    task,
    busy,
    dialog,
    dialogText,
    assignWorkerId,
    subtaskTemplateId,
    subtaskTitle,
    subtaskInput,
    subtaskOutputSpec,
    activeTaskRole,
    run,
  ])

  return (
    <>
      <section
        className={`flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[var(--radius-lg)] border border-border bg-background ${
          className ?? ''
        }`}
      >
        {/* 右侧预留详情抽屉关闭按钮的位置 */}
        <header className="shrink-0 border-b border-border px-3 py-2.5 pr-12">
          <div className="flex items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1">
              {rightTabs.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => selectRightTab(key)}
                  className={`rounded-[var(--radius-md)] px-2.5 py-1 text-sm ${
                    currentRightTab === key
                      ? 'bg-background-muted font-medium text-foreground-intense'
                      : 'text-foreground-muted hover:text-foreground-intense'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {currentRightTab !== 'agent' && task && (
              <TaskStatusBadge
                status={task.status}
                subStatus={task.subStatus}
                showMain
              />
            )}
          </div>
          {currentRightTab !== 'agent' && error && (
            <p role="alert" className="mt-2 text-[11px] text-error-foreground">
              {error}
            </p>
          )}
        </header>

        {currentRightTab !== 'agent' ? (
          <>
            <AssistantRuntimeProvider runtime={runtime}>
              <ThreadPrimitive.Root className="flex min-h-0 flex-1 flex-col">
                <ThreadPrimitive.Viewport className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 py-4">
                  {!task || !activeChat?.messages.length ? (
                    <EmptyChat hasTask={Boolean(task)} />
                  ) : null}
                  <ThreadPrimitive.Messages>
                    {({ message }) => (
                      <TaskChatMessageItem
                        message={message}
                        busy={busy}
                        viewerPerspective={activeTaskRole ?? undefined}
                        plainTextBubbles
                        flatOppositeMessages
                        canReplyQuestion={(custom) =>
                          currentRightTab === 'requester' &&
                          isRequester &&
                          awaitingAnswer &&
                          (custom.taskId === undefined ||
                            custom.taskId === task?.id)
                        }
                        onReplyQuestion={replyQuestion}
                      />
                    )}
                  </ThreadPrimitive.Messages>
                </ThreadPrimitive.Viewport>
              </ThreadPrimitive.Root>
            </AssistantRuntimeProvider>

            <ChatComposerDock>
              <TaskChatQueuedMessages
                messages={activeChat?.queuedMessages ?? []}
                className="mb-2"
              />
              <ChatComposerFrame
                left={
                  task ? (
                    <>
                      {currentRightTab === 'requester' && isRequester && (
                        <>
                          <ChatActionIcon
                            label={
                              awaitingReview
                                ? '验收通过'
                                : '验收通过（仅待验收可操作）'
                            }
                            icon={ClipboardCheck}
                            tone="success"
                            disabled={busy || !awaitingReview}
                            onClick={() =>
                              void run(() => api.workbenchAcceptHandoff(task.id))
                            }
                          />
                          <ChatActionIcon
                            label="新子任务"
                            icon={Subtask}
                            disabled={busy || !requesterSubtaskAvailable}
                            onClick={() => openDialog('subtask')}
                          />
                          <ChatActionIcon
                            label="分配任务"
                            icon={ArrowsExchange}
                            disabled={busy || !assignAvailable}
                            onClick={() => openDialog('assign')}
                          />
                          <ChatActionIcon
                            label="取消任务"
                            icon={CircleX}
                            tone="danger"
                            disabled={busy || !assignAvailable}
                            onClick={() => openDialog('cancel')}
                          />
                          {completed && (
                            <ChatActionIcon
                              label="重新生成复盘"
                              icon={Sparkles}
                              disabled={busy}
                              onClick={() =>
                                void run(() =>
                                  api.generateTaskHandoff(task.id),
                                )
                              }
                            />
                          )}
                        </>
                      )}
                      {currentRightTab === 'responsible' && isAgent && (
                        <>
                          {awaitingAcceptance && (
                            <ChatActionIcon
                              label="接受任务"
                              icon={CircleCheck}
                              tone="success"
                              disabled={busy}
                              onClick={() =>
                                void run(() => api.workbenchAccept(task.id))
                              }
                            />
                          )}
                          <ChatActionIcon
                            label={
                              awaitingReview
                                ? '撤销交付'
                                : deliveryActive
                                  ? handoffReady
                                    ? '发起交付'
                                    : '发起交付（请先创建交付文档）'
                                  : '发起交付（仅执行中可操作）'
                            }
                            icon={
                              awaitingReview ? Package2Import : Package2Export
                            }
                            disabled={
                              busy ||
                              !deliveryActive ||
                              handoffEditing ||
                              (!awaitingReview && !handoffReady)
                            }
                            onClick={() => {
                              if (awaitingReview) {
                                void run(() =>
                                  api.workbenchRevokeHandoff(task.id),
                                )
                              } else {
                                openDialog('handoff')
                              }
                            }}
                          />
                          <ChatActionIcon
                            label="新子任务"
                            icon={Subtask}
                            disabled={busy || !responsibleSubtaskAvailable}
                            onClick={() => openDialog('subtask')}
                          />
                          <ChatActionIcon
                            label="分配任务"
                            icon={ArrowsExchange}
                            disabled={busy || !assignAvailable}
                            onClick={() => openDialog('assign')}
                          />
                          <ChatActionIcon
                            label={
                              awaitingAcceptance
                                ? '拒绝任务'
                                : '拒绝任务（仅待接受可操作）'
                            }
                            icon={Ban}
                            tone="danger"
                            disabled={busy || !awaitingAcceptance}
                            onClick={() => openDialog('refuse')}
                          />
                        </>
                      )}
                    </>
                  ) : null
                }
                right={
                  <ChatSendButton
                    onClick={() => void sendMessage()}
                    disabled={
                      !task ||
                      busy ||
                      finished ||
                      !draft.trim() ||
                      (currentRightTab === 'responsible' && awaitingReview)
                    }
                  />
                }
              >
                <textarea
                  value={draft}
                  rows={3}
                  disabled={
                    !task ||
                    busy ||
                    finished ||
                    (currentRightTab === 'responsible' && awaitingReview)
                  }
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault()
                      void sendMessage()
                    }
                  }}
                  placeholder={
                    !task
                      ? '选择任务后开始交互'
                      : finished
                        ? '任务已结束，不能继续对话'
                        : currentRightTab === 'requester'
                          ? awaitingReview
                            ? '输入验收不通过意见，发送后退回机器人…'
                            : '以需求方身份补充需求…'
                          : awaitingReview
                            ? '待需求方验收，如需继续修改请先撤销交付'
                            : isAgent && executing
                              ? '以执行方身份回复…'
                              : '以执行方身份提供反馈…'
                  }
                  className="block h-[72px] w-full resize-none bg-transparent px-3 py-2 text-sm outline-none placeholder:text-foreground-subtle disabled:cursor-not-allowed disabled:opacity-60"
                />
              </ChatComposerFrame>
            </ChatComposerDock>
          </>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">{agent}</div>
        )}
      </section>

      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDialog(null)
            setDialogError(null)
          }
        }}
      >
        <DialogContent
          className={dialog === 'handoff' ? 'sm:max-w-2xl' : undefined}
        >
          <DialogHeader>
            <DialogTitle>
              {dialog === 'refuse'
                ? '拒绝任务'
                : dialog === 'handoff'
                  ? '发起交付'
                  : dialog === 'assign'
                    ? '分配任务'
                    : dialog === 'cancel'
                      ? '取消任务'
                      : '创建子任务'}
            </DialogTitle>
          </DialogHeader>

          {dialog === 'refuse' && (
            <DialogBody>
              <textarea
                value={dialogText}
                rows={5}
                onChange={(event) => setDialogText(event.target.value)}
                placeholder="请说明原因或反馈意见"
                className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-border-strong"
              />
            </DialogBody>
          )}

          {dialog === 'handoff' && (
            <DialogBody>
              <div className="space-y-2 text-xs leading-relaxed text-foreground-muted">
                <p>
                  交付内容以任务交付文档为准，本次申请会锁定当前版本并提交给需求方验收。
                </p>
                <p>
                  当前文档：
                  {handoffDoc?.exists
                    ? ` ${handoffDoc.path} · v${handoffDoc.version}`
                    : handoffDoc
                      ? ` ${handoffDoc.path} · 尚未创建`
                      : ' 尚未加载'}
                </p>
                {!handoffReady && (
                  <p role="alert" className="text-error-foreground">
                    交付文档尚未创建或还没有有效内容，请先在左侧「交付文档」创建并补充后再申请验收。
                  </p>
                )}
                <p>
                  申请后如需继续修改，请先撤销交付或等待需求方返工。
                </p>
              </div>
            </DialogBody>
          )}

          {dialog === 'assign' && (
            <DialogBody>
              <label className="block space-y-1">
                <span className="text-xs text-foreground-muted">处理机器人</span>
                <Select
                  value={assignWorkerId}
                  onValueChange={(value) =>
                    setAssignWorkerId(String(value ?? ''))
                  }
                  items={Object.fromEntries(
                    workers
                      .filter((worker) => worker.id !== task?.agentId)
                      .map((worker) => [String(worker.id), worker.name]),
                  )}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="选择机器人" />
                  </SelectTrigger>
                  <SelectContent>
                    {workers
                      .filter((worker) => worker.id !== task?.agentId)
                      .map((worker) => (
                        <SelectItem key={worker.id} value={String(worker.id)}>
                          {worker.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </label>
            </DialogBody>
          )}

          {dialog === 'subtask' && (
            <DialogBody>
              <div className="space-y-3">
                <label className="block space-y-1">
                  <span className="text-xs text-foreground-muted">任务定义</span>
                  <Select
                    value={subtaskTemplateId}
                    onValueChange={(value) =>
                      setSubtaskTemplateId(String(value ?? ''))
                    }
                    items={Object.fromEntries(
                      templates.map((template) => [
                        String(template.id),
                        template.name,
                      ]),
                    )}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="选择任务定义" />
                    </SelectTrigger>
                    <SelectContent>
                      {templates.map((template) => (
                        <SelectItem
                          key={template.id}
                          value={String(template.id)}
                        >
                          {template.name} · {template.type}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                <label className="block space-y-1">
                  <span className="text-xs text-foreground-muted">标题</span>
                  <input
                    value={subtaskTitle}
                    onChange={(event) => setSubtaskTitle(event.target.value)}
                    placeholder="子任务标题"
                    className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-border-strong"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs text-foreground-muted">输入</span>
                  <textarea
                    value={subtaskInput}
                    rows={3}
                    onChange={(event) => setSubtaskInput(event.target.value)}
                    className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-border-strong"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs text-foreground-muted">交付要求</span>
                  <textarea
                    value={subtaskOutputSpec}
                    rows={3}
                    onChange={(event) =>
                      setSubtaskOutputSpec(event.target.value)
                    }
                    className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-border-strong"
                  />
                </label>
              </div>
            </DialogBody>
          )}

          {dialog === 'cancel' && (
            <DialogBody>
              <p className="text-sm leading-relaxed text-foreground-muted">
                取消后任务将进入「已结束-取消」，执行中的机器人会被中断，且不可恢复。确认取消
                {task ? ` ${task.code}「${task.title}」` : '当前任务'}？
              </p>
            </DialogBody>
          )}

          {dialogError && (
            <p role="alert" className="px-4 text-xs text-error-foreground">
              {dialogError}
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDialog(null)}>
              取消
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={
                busy ||
                (dialog === 'refuse' && !dialogText.trim()) ||
                (dialog === 'assign' && !assignWorkerId) ||
                (dialog === 'subtask' &&
                  (!subtaskTemplateId || !subtaskTitle.trim())) ||
                (dialog === 'handoff' && !handoffReady)
              }
              onClick={() => void submitDialog()}
            >
              {dialog === 'cancel' ? '确认取消' : '提交'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function EmptyChat({ hasTask }: { hasTask: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-foreground-muted">
      <span className="rounded-full bg-background-muted p-3">
        <Wrench className="size-5" />
      </span>
      <p>
        {hasTask
          ? '暂无任务对话，任务进展会在这里实时展示'
          : '选择任务后，这里显示多方协作对话'}
      </p>
    </div>
  )
}
