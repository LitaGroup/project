import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  AssistantRuntimeProvider,
  ThreadPrimitive,
  useExternalStoreRuntime,
  type AppendMessage,
} from '@assistant-ui/react'
import { Wrench } from '@appica/icons-react'
import {
  api,
  type TaskChatMessage,
  type TaskChatSnapshot,
  type WorkbenchTask,
} from '../../lib/api'
import { useImeEnterGuard } from '../../lib/ime-enter'
import { useAuth } from '../../context/AuthContext'
import { TaskStatusBadge } from '../StatusBadge'
import { TaskChatMessageItem } from './TaskChatMessages'
import { toTaskChatThreadMessage } from './task-chat-message'
import {
  ChatComposerDock,
  ChatComposerFrame,
  ChatSendButton,
} from '../agent-chat/ChatComposer'

type RightTab = 'requester' | 'responsible' | 'agent'

export interface TaskWorkbenchPanelProps {
  /** 当前任务及其在工作台视角下的角色；无任务时仅展示我的 AI */
  task: WorkbenchTask | null
  /** 任务对话快照（必须与 task 匹配） */
  chat: TaskChatSnapshot | null
  /** 我的 AI 面板；仅在切换到该 Tab 时挂载 */
  agent: ReactNode
  /** 任务对话或提问完成后刷新任务、聊天、交付文档与角色 */
  onRefresh: () => Promise<unknown> | unknown
  /** 面板当前是否可见；收起时统计其他参与方的新消息 */
  visible?: boolean
  /** 未读消息数变化 */
  onUnreadChange?: (count: number) => void
  className?: string
}

/**
 * 任务协作面板：工作台与任务详情共用。
 *
 * 按当前用户在任务中的身份展示「任务-需求方 / 任务-执行方」，
 * 并复用任务中心的对话投递与提问能力；任务操作统一放在详情标题右侧。
 */
export function TaskWorkbenchPanel({
  task,
  chat,
  agent,
  onRefresh,
  visible = true,
  onUnreadChange,
  className,
}: TaskWorkbenchPanelProps) {
  const { user } = useAuth()
  const [rightTab, setRightTab] = useState<RightTab>('requester')
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const imeEnter = useImeEnterGuard()
  const onUnreadChangeRef = useRef(onUnreadChange)
  const visibleRef = useRef(visible)
  const unreadCountRef = useRef(0)
  const unreadTaskRef = useRef<number | null>(null)
  const seenMessageIdsRef = useRef(new Set<string>())

  const roles = task?.workbenchRoles ?? []
  const isAgent = roles.includes('agent')
  const isRequester = roles.includes('requester')

  const rightTabs = useMemo<Array<[RightTab, string]>>(() => {
    const tabs: Array<[RightTab, string]> = []
    if (isRequester) tabs.push(['requester', '任务-需求方'])
    // 任务沟通仅限需求方与当前真人执行机器人；机器人负责人/接管人不参与。
    if (isAgent) tabs.push(['responsible', '任务-执行方'])
    tabs.push(['agent', '我的助理'])
    return tabs
  }, [isRequester, isAgent])

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
  // 协作面板只消费当前任务的消息；父/子任务即使被快照聚合也不能串到同一身份视角
  const activeMessages = useMemo(
    () =>
      activeChat?.messages.filter(
        (message) => message.taskId === activeChat.task.id,
      ) ?? [],
    [activeChat],
  )
  const executing = task?.subStatus === '执行中'
  const awaitingReview = task?.subStatus === '待验收'
  const awaitingAnswer = task?.subStatus === '待反馈'
  const finished = task?.status === '已结束'

  useEffect(() => {
    onUnreadChangeRef.current = onUnreadChange
  }, [onUnreadChange])

  const emitUnread = useCallback((next: number) => {
    if (unreadCountRef.current === next) return
    unreadCountRef.current = next
    onUnreadChangeRef.current?.(next)
  }, [])

  useEffect(() => {
    emitUnread(0)
  }, [task?.id, emitUnread])

  useEffect(() => {
    visibleRef.current = visible
    if (!visible) return
    emitUnread(0)
    for (const message of activeMessages) {
      seenMessageIdsRef.current.add(message.id)
    }
  }, [visible, activeMessages, emitUnread])

  useEffect(() => {
    if (!task) return
    if (unreadTaskRef.current !== task.id) {
      unreadTaskRef.current = task.id
      seenMessageIdsRef.current.clear()
      for (const message of activeMessages) {
        seenMessageIdsRef.current.add(message.id)
      }
      emitUnread(0)
      return
    }
    const ownSenderId = user ? `user:${user.name ?? user.id}` : null
    let added = 0
    for (const message of activeMessages) {
      if (seenMessageIdsRef.current.has(message.id)) continue
      seenMessageIdsRef.current.add(message.id)
      if (visibleRef.current) continue
      if (
        ownSenderId &&
        message.sender.kind === 'user' &&
        message.sender.id === ownSenderId
      ) {
        continue
      }
      added += 1
    }
    if (added > 0) emitUnread(unreadCountRef.current + added)
  }, [task, activeMessages, emitUnread, user])

  useEffect(() => {
    // 切换任务时清空草稿和错误，避免把上一个任务的内容带过来
    // oxlint-disable-next-line react/set-state-in-effect
    setDraft('')
    // oxlint-disable-next-line react/set-state-in-effect
    setError(null)
  }, [task?.id])

  /** 切换身份时清空未发送内容，避免把需求方内容误发成执行方消息。 */
  const selectRightTab = useCallback(
    (tab: RightTab) => {
      if (tab !== currentRightTab) setDraft('')
      setRightTab(tab)
    },
    [currentRightTab],
  )

  /** 执行对话操作并刷新；返回错误文案，成功时返回 null */
  const run = useCallback(
    async (action: () => Promise<unknown>): Promise<string | null> => {
      setBusy(true)
      setError(null)
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
    messages: activeMessages,
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

  return (
    <section
      className={`flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-[var(--radius-lg)] border border-border bg-background ${
        className ?? ''
      }`}
    >
      {/* 右侧预留详情抽屉关闭按钮的位置 */}
      <header className="shrink-0 px-3 py-2.5 pr-14">
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
          <div className="flex shrink-0 items-center gap-2">
            {currentRightTab !== 'agent' && task && (
              <TaskStatusBadge
                status={task.status}
                subStatus={task.subStatus}
                showMain
              />
            )}
          </div>
        </div>
        {error && (
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
                {!task || activeMessages.length === 0 ? (
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
            <ChatComposerFrame
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
                onCompositionStart={imeEnter.onCompositionStart}
                onCompositionEnd={imeEnter.onCompositionEnd}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' || event.shiftKey) return
                  if (imeEnter.isImeEnter(event)) return
                  event.preventDefault()
                  void sendMessage()
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
