import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  AssistantRuntimeProvider,
  ThreadPrimitive,
  useExternalStoreRuntime,
  type AppendMessage,
} from '@assistant-ui/react'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@appica/ui-react/accordion'
import { Badge } from '@appica/ui-react/badge'
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
  type KnowledgeNode,
  type TaskChatMessage,
  type TaskChatSnapshot,
  type TaskChatStreamMessage,
  type TaskEvent,
  type TaskTemplate,
  type WorkbenchRole,
  type WorkbenchSummary,
  type WorkbenchTask,
  type Worker,
  type WorkerDebugAttachment,
  type WorkerDebugMode,
  type WorkerDebugModelCatalog,
  type WorkerDebugModelSelection,
  type WorkerDebugSnapshot,
} from '../lib/api'
import { TaskStatusBadge } from '../components/StatusBadge'
import {
  TaskChatMessageItem,
  TaskChatQueuedMessages,
} from '../components/task-detail/TaskChatMessages'
import { toTaskChatThreadMessage } from '../components/task-detail/task-chat-message'
import { DebugChat } from '../components/agent-chat/DebugChat'
import {
  ChatActionIcon,
  ChatComposerDock,
  ChatComposerFrame,
  ChatSendButton,
} from '../components/agent-chat/ChatComposer'
import {
  MarkdownEditor,
  type MarkdownEditorHandle,
} from '../components/MarkdownEditor'
import { formatDuration, taskDurationMs } from '../lib/duration'

type WorkPanel = 'document' | 'context' | 'log'
type RightTab = 'requester' | 'responsible' | 'agent'
type DialogKind =
  | 'refuse'
  | 'handoff'
  | 'assign'
  | 'subtask'
  | 'cancel'
  | null
type TaskGroupKey = 'in-progress' | 'waiting' | 'completed'

/** 工作台角色展示文案 */
const WORKBENCH_ROLE_LABELS: Record<WorkbenchRole, string> = {
  agent: '我执行',
  owner: '我的 AI 执行',
  requester: '我是需求方',
  responsible: '我是执行方',
}

/** 发起交付的 Markdown 模板：只放结构标题，简单任务可直接删掉标题写一段 */
const HANDOFF_TEMPLATE = [
  '## 交付内容',
  '',
  '## 实现问题与解决',
  '',
  '## 走过的弯路',
  '',
  '## 经验总结',
  '',
  '## 遗留建议与后续待办',
  '',
  '## 其它需要保留的信息',
  '',
].join('\n')

/** 去掉 Markdown 标题行与分割线后是否仍有正文（与后端 hasHandoffBody 口径一致） */
function hasHandoffBody(markdown: string): boolean {
  return (
    markdown
      .split('\n')
      .filter((line) => !/^\s{0,3}#{1,6}\s/.test(line))
      .join('\n')
      .replace(/^\s*(?:-{3,}|\*{3,})\s*$/gm, '')
      .trim().length > 0
  )
}

/** 按“当前机器人最近分配时间”倒序；历史数据缺失时回退更新时间 */
function assignedAtDesc(a: WorkbenchTask, b: WorkbenchTask): number {
  const atA = new Date(a.assignedAt ?? a.updatedAt).getTime()
  const atB = new Date(b.assignedAt ?? b.updatedAt).getTime()
  return atB - atA
}

function groupKeyOf(task: WorkbenchTask): TaskGroupKey {
  if (task.status === '进行中') return 'in-progress'
  if (task.status === '等待中') return 'waiting'
  return 'completed'
}

function upsertQueuedMessage(
  current: TaskChatSnapshot['queuedMessages'],
  message: TaskChatSnapshot['queuedMessages'][number],
): TaskChatSnapshot['queuedMessages'] {
  const index = current.findIndex((item) => item.id === message.id)
  if (index < 0) return [...current, message]
  const next = current.slice()
  next[index] = message
  return next
}

function markdownText(value: string | null | undefined): string {
  return value?.trim() || '（暂无）'
}

/** 操作台：左任务栏 + 中聊天交互 + 右任务详情。真人以绑定机器人身份执行任务。 */
export function WorkbenchPage() {
  const { taskId } = useParams<{ taskId?: string }>()
  const navigate = useNavigate()
  const [summary, setSummary] = useState<WorkbenchSummary | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(
    taskId ? Number(taskId) : null,
  )
  const [chat, setChat] = useState<TaskChatSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const [workPanel, setWorkPanel] = useState<WorkPanel>('document')
  const [rightTab, setRightTab] = useState<RightTab>('requester')
  const [agentSnapshot, setAgentSnapshot] = useState<WorkerDebugSnapshot | null>(
    null,
  )
  const [agentCatalog, setAgentCatalog] =
    useState<WorkerDebugModelCatalog | null>(null)
  const [agentModelBusy, setAgentModelBusy] = useState(false)
  const [agentModeBusy, setAgentModeBusy] = useState(false)
  const [agentError, setAgentError] = useState<string | null>(null)
  const [handoffDoc, setHandoffDoc] = useState<KnowledgeNode | null>(null)
  const [docLoading, setDocLoading] = useState(false)
  const [docError, setDocError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<DialogKind>(null)
  const [dialogText, setDialogText] = useState('')
  const handoffEditorRef = useRef<MarkdownEditorHandle>(null)
  const [handoffError, setHandoffError] = useState<string | null>(null)
  const [workers, setWorkers] = useState<Worker[]>([])
  const [templates, setTemplates] = useState<TaskTemplate[]>([])
  const [assignWorkerId, setAssignWorkerId] = useState('')
  const [subtaskTemplateId, setSubtaskTemplateId] = useState('')
  const [subtaskTitle, setSubtaskTitle] = useState('')
  const [subtaskInput, setSubtaskInput] = useState('')
  const [subtaskOutputSpec, setSubtaskOutputSpec] = useState('')

  const chatSeq = useRef(0)

  const loadSummary = useCallback(async () => {
    try {
      const data = await api.getWorkbench()
      setSummary(data)
      setError(null)
      setSelectedId((current) => {
        if (current && data.tasks.some((task) => task.id === current)) {
          return current
        }
        return data.tasks[0]?.id ?? null
      })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadChat = useCallback(async (id: number) => {
    const seq = ++chatSeq.current
    try {
      const data = await api.getTaskChat(id)
      if (seq === chatSeq.current) setChat(data)
    } catch (e) {
      if (seq === chatSeq.current) setError((e as Error).message)
    }
  }, [])

  const task = useMemo<WorkbenchTask | null>(() => {
    if (!summary || !selectedId) return null
    return summary.tasks.find((item) => item.id === selectedId) ?? null
  }, [summary, selectedId])

  const isAgent = Boolean(task?.workbenchRoles.includes('agent'))
  const isOwner = Boolean(task?.workbenchRoles.includes('owner'))
  const isResponsible = Boolean(task?.workbenchRoles.includes('responsible'))
  const isRequester = Boolean(task?.workbenchRoles.includes('requester'))
  const isResponsibleSide = isAgent || isOwner || isResponsible
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

  useEffect(() => {
    void loadSummary()
  }, [loadSummary])

  useEffect(() => {
    // 操作台任务状态由多方推进，5s 轮询足够保持左栏动作提示
    const timer = window.setInterval(() => void loadSummary(), 5_000)
    return () => window.clearInterval(timer)
  }, [loadSummary])

  useEffect(() => {
    api
      .listWorkers({ role: '工作者' })
      .then((rows) => setWorkers(rows.filter((row) => row.enabled)))
      .catch(() => undefined)
    api
      .listTaskTemplates()
      .then(setTemplates)
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!selectedId) {
      setChat(null)
      return
    }
    void loadChat(selectedId)
    let closed = false
    const source = new EventSource(`/api/tasks/${selectedId}/chat/stream`)
    source.onmessage = (event: MessageEvent<string>) => {
      if (closed) return
      let data: TaskChatStreamMessage
      try {
        data = JSON.parse(event.data) as TaskChatStreamMessage
      } catch {
        return
      }
      switch (data.type) {
        case 'message.upsert':
          setChat((current) => {
            if (!current) return current
            const exists = current.messages.some(
              (item) => item.id === data.message.id,
            )
            return {
              ...current,
              messages: exists
                ? current.messages.map((item) =>
                    item.id === data.message.id ? data.message : item,
                  )
                : [...current.messages, data.message].sort(
                    (a, b) =>
                      new Date(a.createdAt).getTime() -
                      new Date(b.createdAt).getTime(),
                  ),
            }
          })
          break
        case 'queue.upsert':
          if (data.message.taskId === selectedId) {
            setChat((current) =>
              current
                ? {
                    ...current,
                    queuedMessages: upsertQueuedMessage(
                      current.queuedMessages,
                      data.message,
                    ),
                  }
                : current,
            )
          }
          break
        case 'queue.delete':
          setChat((current) =>
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
        case 'refresh':
          void loadChat(selectedId)
          break
        default:
          // ready / ping 仅用于连接保活
          break
      }
    }
    source.onerror = () => {
      // EventSource 会自动重连；重连后 refresh 补齐快照
    }
    return () => {
      closed = true
      source.close()
    }
  }, [selectedId, loadChat])

  /**
   * 我的 AGENT：每个任务一个独立会话（taskId 为空时使用通用会话）。
   * 切换任务时重新拉快照并重连 SSE，避免把上一个任务的上下文带过来。
   */
  useEffect(() => {
    const agentWorkerId = summary?.agent.worker?.id ?? null
    if (
      currentRightTab !== 'agent' ||
      !summary?.agent.available ||
      !agentWorkerId
    ) {
      return
    }
    let closed = false
    const taskQuery = selectedId
      ? `?taskId=${encodeURIComponent(selectedId)}`
      : ''
    setAgentError(null)
    setAgentSnapshot(null)
    api
      .getWorkbenchAgentSnapshot(selectedId)
      .then((data) => {
        if (!closed) setAgentSnapshot(data)
      })
      .catch((e: Error) => {
        if (!closed) setAgentError(e.message)
      })
    const source = new EventSource(`/api/workbench/agent/stream${taskQuery}`)
    source.onopen = () => setAgentError(null)
    source.onmessage = (event: MessageEvent<string>) => {
      if (closed) return
      let payload: { type?: string; snapshot?: WorkerDebugSnapshot }
      try {
        payload = JSON.parse(event.data) as typeof payload
      } catch {
        return
      }
      if (payload.type === 'snapshot' && payload.snapshot) {
        setAgentError(null)
        setAgentSnapshot(payload.snapshot)
      }
    }
    source.onerror = () => {
      // EventSource 自动重连；保留服务端返回的首个错误
      setAgentError((current) => current ?? 'AI 实时连接断开，正在重连…')
    }
    return () => {
      closed = true
      source.close()
    }
  }, [
    currentRightTab,
    selectedId,
    summary?.agent.available,
    summary?.agent.worker?.id,
  ])

  /** 我的 AGENT：模型/思考等级清单（每个任务会话独立，切换任务时重新加载） */
  useEffect(() => {
    if (currentRightTab !== 'agent' || !summary?.agent?.available) return
    let closed = false
    api
      .getWorkbenchAgentModels(selectedId)
      .then((data) => {
        if (!closed) setAgentCatalog(data)
      })
      .catch(() => {
        // 模型清单加载失败不阻塞对话，选择器保留当前快照中的模型
      })
    return () => {
      closed = true
    }
  }, [currentRightTab, selectedId, summary?.agent.available])

  /** 我的 AGENT：本轮结束后刷新左栏任务（AGENT 可能通过技能创建/推进了任务） */
  const agentWasRunning = useRef(false)
  useEffect(() => {
    const running = agentSnapshot?.status === 'running'
    if (agentWasRunning.current && !running) void loadSummary()
    agentWasRunning.current = running
  }, [agentSnapshot?.status, loadSummary])

  const sendAgentMessage = useCallback(
    async (raw: string, files?: WorkerDebugAttachment[]) => {
      const text = raw.trim()
      if (!text && !files?.length) return
      setAgentError(null)
      try {
        const next = await api.sendWorkbenchAgentMessage(
          text,
          selectedId,
          files,
        )
        setAgentSnapshot(next)
      } catch (e) {
        setAgentError((e as Error).message)
        throw e
      }
    },
    [selectedId],
  )

  const changeAgentModel = useCallback(
    async (input: WorkerDebugModelSelection) => {
      setAgentModelBusy(true)
      setAgentError(null)
      try {
        const next = await api.setWorkbenchAgentModel(input, selectedId)
        setAgentSnapshot(next)
        setAgentCatalog((current) =>
          current ? { ...current, current: next.model } : current,
        )
      } catch (e) {
        setAgentError((e as Error).message)
      } finally {
        setAgentModelBusy(false)
      }
    },
    [selectedId],
  )

  const changeAgentMode = useCallback(
    async (mode: WorkerDebugMode) => {
      setAgentModeBusy(true)
      setAgentError(null)
      try {
        setAgentSnapshot(await api.setWorkbenchAgentMode(mode, selectedId))
      } catch (e) {
        setAgentError((e as Error).message)
      } finally {
        setAgentModeBusy(false)
      }
    },
    [selectedId],
  )

  const replyAgentQuestion = useCallback(
    async (questionId: string, answers: string[][] | null) => {
      setAgentError(null)
      try {
        setAgentSnapshot(
          await api.replyWorkbenchAgentQuestion(
            questionId,
            answers,
            selectedId,
          ),
        )
      } catch (e) {
        setAgentError((e as Error).message)
        throw e
      }
    },
    [selectedId],
  )

  const retryAgent = useCallback(() => {
    setAgentError(null)
    void loadSummary()
  }, [loadSummary])

  /** 只使用与当前任务匹配的快照，避免切换任务瞬间短暂展示上一个任务的对话 */
  const activeChat = useMemo(
    () => (chat && task && chat.task.id === task.id ? chat : null),
    [chat, task],
  )

  const selectTask = useCallback(
    (id: number) => {
      setSelectedId(id)
      navigate(`/workbench/tasks/${id}`, { replace: true })
    },
    [navigate],
  )

  /** 切换身份/会话时清空任务输入，避免把需求方内容误发成执行方消息。 */
  const selectRightTab = useCallback(
    (tab: RightTab) => {
      if (tab !== currentRightTab) setDraft('')
      setRightTab(tab)
    },
    [currentRightTab],
  )

  const activeTasks = summary?.tasks ?? []

  const taskGroups = useMemo(
    () => [
      {
        key: 'in-progress' as const,
        title: '进行中的',
        tasks: activeTasks
          .filter((task) => groupKeyOf(task) === 'in-progress')
          .sort(assignedAtDesc),
      },
      {
        key: 'waiting' as const,
        title: '等待中的',
        tasks: activeTasks
          .filter((task) => groupKeyOf(task) === 'waiting')
          .sort(assignedAtDesc),
      },
      {
        key: 'completed' as const,
        title: '已完成的',
        tasks: activeTasks
          .filter((task) => groupKeyOf(task) === 'completed')
          .sort(assignedAtDesc),
      },
    ],
    [activeTasks],
  )

  const executing = task?.subStatus === '执行中'
  const awaitingAcceptance = task?.subStatus === '待接受'
  const awaitingReview = task?.subStatus === '待验收'
  const awaitingAnswer = task?.subStatus === '待反馈'
  const completed =
    task?.status === '已结束' && task?.subStatus === '完成'
  const delivered = activeChat?.hasAcceptanceApplication ?? false

  /** 最近一次申请验收的交付文档；eventId 变化时触发实时内容刷新 */
  const latestHandoff = useMemo(() => {
    for (const event of activeChat?.events ?? []) {
      const path = event.meta?.handoffPath
      if (typeof path === 'string' && path.trim()) {
        return { path, eventId: event.id }
      }
    }
    return null
  }, [activeChat?.events])
  const handoffPath = latestHandoff?.path ?? null
  const handoffEventId = latestHandoff?.eventId ?? null

  useEffect(() => {
    if (!selectedId || !handoffPath) {
      setHandoffDoc(null)
      setDocError(null)
      setDocLoading(false)
      return
    }
    let alive = true
    setDocLoading(true)
    setDocError(null)
    api
      .getKnowledgeArticle(handoffPath)
      .then((doc) => {
        if (alive) setHandoffDoc(doc)
      })
      .catch((e: Error) => {
        if (alive) {
          setHandoffDoc(null)
          setDocError(e.message)
        }
      })
      .finally(() => {
        if (alive) setDocLoading(false)
      })
    return () => {
      alive = false
    }
  }, [selectedId, handoffPath, handoffEventId])

  const run = useCallback(
    async (action: () => Promise<unknown>, successText?: string) => {
      setBusy(true)
      setError(null)
      try {
        await action()
        if (successText) setDialogText(successText)
        await Promise.all([
          loadSummary(),
          selectedId ? loadChat(selectedId) : Promise.resolve(),
        ])
      } catch (e) {
        setError((e as Error).message)
        throw e
      } finally {
        setBusy(false)
      }
    },
    [loadSummary, loadChat, selectedId],
  )

  const submitMessage = useCallback(
    async (raw: string) => {
      const text = raw.trim()
      if (!text || !task || busy || !activeTaskRole) return
      if (activeTaskRole === 'requester') {
        if (task.subStatus === '待验收') {
          // 需求方身份下，待验收时发送消息等同于验收不通过
          await run(() => api.workbenchRejectHandoff(task.id, text))
          return
        }
        await run(() => api.sendTaskMessage(task.id, text, 'requester'))
        return
      }
      if (task.subStatus === '待验收') return
      await run(() =>
        isAgent && executing
          ? api.workbenchSendMessage(task.id, text)
          : api.sendTaskMessage(task.id, text, 'responsible'),
      )
    },
    [task, busy, activeTaskRole, isAgent, executing, run],
  )

  const sendMessage = useCallback(async () => {
    const text = draft.trim()
    if (!text || !task || busy) return
    try {
      await submitMessage(text)
      setDraft((current) => (current.trim() === text ? '' : current))
    } catch {
      // 错误已由 run 展示；保留输入内容便于重试
    }
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

  const submitDialog = useCallback(async () => {
    if (busy) return
    if (!task) return
    try {
      if (dialog === 'refuse') {
        await run(() => api.workbenchRefuse(task.id, dialogText.trim()))
      } else if (dialog === 'handoff') {
        const content = handoffEditorRef.current?.getMarkdown() ?? ''
        if (!hasHandoffBody(content)) {
          setHandoffError('请填写交付内容')
          return
        }
        setHandoffError(null)
        await run(() => api.workbenchApplyHandoff(task.id, { content }))
      } else if (dialog === 'assign') {
        if (!assignWorkerId) return
        await run(() => api.assignTask(task.id, Number(assignWorkerId)))
      } else if (dialog === 'cancel') {
        await run(() => api.workbenchCancelTask(task.id))
      } else if (dialog === 'subtask') {
        if (!subtaskTemplateId || !subtaskTitle.trim()) return
        await run(() =>
          api.workbenchCreateSubtask(task.id, {
            perspective: activeTaskRole ?? 'requester',
            templateId: Number(subtaskTemplateId),
            title: subtaskTitle.trim(),
            input: subtaskInput.trim() || null,
            outputSpec: subtaskOutputSpec.trim() || null,
          }),
        )
      }
      setDialog(null)
      setDialogText('')
      setHandoffError(null)
      setAssignWorkerId('')
      setSubtaskTemplateId('')
      setSubtaskTitle('')
      setSubtaskInput('')
      setSubtaskOutputSpec('')
    } catch (e) {
      // 错误已在 run 中展示；交付弹窗内同步展示，避免提示被弹窗遮挡
      if (dialog === 'handoff') setHandoffError((e as Error).message)
    }
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

  const deliveryContent = handoffDoc?.content?.trim()
    ? handoffDoc.content
    : task?.result?.trim()
      ? task.result
      : `# 交付文档\n\n${
          docLoading ? '正在加载交付文档…' : '暂无交付文档内容。'
        }`
  const deliveryEditorKey = [
    selectedId,
    handoffPath ?? 'result',
    handoffDoc?.contentHash ?? handoffDoc?.updatedAt ?? 'empty',
    handoffEventId ?? 'none',
  ].join(':')

  const finished = task?.status === '已结束'
  const deliveryActive = Boolean(task) && isAgent && (executing || awaitingReview)
  const assignAvailable = Boolean(task) && !finished
  const requesterSubtaskAvailable =
    Boolean(task) && isRequester && !finished
  const responsibleSubtaskAvailable =
    Boolean(task) && isAgent && executing && !delivered

  if (loading && !summary) {
    return (
      <div className="flex h-full bg-background">
        <div className="h-full w-[20%] shrink-0" />
        <div className="h-full min-w-0 flex-1 p-3">
          <div className="h-full rounded-[var(--radius-lg)] bg-background-muted p-3">
            <div className="grid h-full grid-cols-[62fr_38fr] gap-3">
              <div className="animate-pulse rounded-[var(--radius-lg)] bg-background" />
              <div className="animate-pulse rounded-[var(--radius-lg)] bg-background" />
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full bg-background">
      {/* 左侧 20%：与其他页面左侧导航同宽对齐，任务纯列表 */}
      <aside className="flex h-full w-[20%] shrink-0 flex-col overflow-hidden bg-background">
        <div className="px-6 pt-3">
          <div className="flex items-center justify-between gap-2">
            <p className="font-mono text-sm leading-5 text-foreground-subtle">
              我的任务
            </p>
            <Badge variant="outline" size="sm">
              {activeTasks.length}
            </Badge>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
          {activeTasks.length === 0 ? (
            <p className="px-3 py-4 text-xs text-foreground-muted">
              暂无任务
            </p>
          ) : (
            <Accordion
              variant="flush"
              icon={false}
              defaultValue={['in-progress']}
              className="w-full"
            >
              {taskGroups.map((group) => (
                <AccordionItem key={group.key} value={group.key}>
                  <AccordionTrigger className="px-3">
                    <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
                      <span className="truncate text-sm">{group.title}</span>
                      <Badge size="sm">{group.tasks.length}</Badge>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="px-0 pb-1">
                    {group.tasks.length === 0 ? (
                      <p className="px-3 py-2 text-xs text-foreground-muted">
                        暂无任务
                      </p>
                    ) : (
                      <ul>
                        {group.tasks.map((item) => {
                          const selected = item.id === selectedId
                          return (
                            <li key={item.id}>
                              <button
                                type="button"
                                onClick={() => selectTask(item.id)}
                                className={`w-full rounded-[var(--radius-md)] px-3 py-2.5 text-left transition-colors ${
                                  selected
                                    ? 'bg-background-muted text-foreground-intense'
                                    : 'text-foreground-emphasis hover:bg-background-muted'
                                }`}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="truncate font-mono text-[11px] text-foreground-subtle">
                                    {item.code}
                                  </span>
                                  <span className="shrink-0 text-[11px] text-foreground-muted">
                                    {formatDuration(taskDurationMs(item, now))}
                                  </span>
                                </div>
                                <p
                                  className="mt-1 line-clamp-2 text-sm font-medium"
                                  title={item.title}
                                >
                                  {item.title}
                                </p>
                                <p
                                  className="mt-1 truncate text-[11px] text-foreground-muted"
                                  title={item.type}
                                >
                                  {item.type}
                                </p>
                              </button>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </div>
      </aside>

      {/* 右侧自适应：浅色圆角内容画布，内部分 工作内容 + AI 交互 */}
      <main className="h-full min-w-0 flex-1 p-3">
        <div className="h-full min-h-0 rounded-[var(--radius-lg)] bg-background-muted p-3">
          <div className="grid h-full min-h-0 grid-cols-[62fr_38fr] gap-3">
            {/* 工作内容 */}
            <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[var(--radius-lg)] bg-background">
        <header className="shrink-0 border-b border-border px-3 py-2.5">
          {task ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h2 className="truncate text-sm font-semibold text-foreground-intense">
                  {task.code} {task.title}
                </h2>
                {task.workbenchAction && (
                  <Badge variant="warning" size="sm">
                    {task.workbenchAction}
                  </Badge>
                )}
                {isOwner && (
                  <Badge variant="soft" size="sm">
                    我的 AI 执行
                  </Badge>
                )}
                {isResponsible && (
                  <Badge variant="soft" size="sm">
                    我是执行方
                  </Badge>
                )}
              </div>
            </div>
          ) : (
            <h2 className="text-sm font-semibold text-foreground-intense">
              选择任务
            </h2>
          )}
          <div className="mt-2 flex items-center gap-1">
            {(
              [
                ['document', '交付文档'],
                ['context', '任务上下文'],
                ['log', '日志'],
              ] as Array<[WorkPanel, string]>
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setWorkPanel(key)}
                className={`rounded-[var(--radius-md)] px-2.5 py-1 text-xs ${
                  workPanel === key
                    ? 'bg-background-muted font-medium text-foreground-intense'
                    : 'text-foreground-muted hover:text-foreground-intense'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {error && (
            <p role="alert" className="mt-2 text-xs text-error-foreground">
              {error}
            </p>
          )}
        </header>

        <div className="min-h-0 flex-1 overflow-hidden">
          {!task ? (
            <EmptyWork />
          ) : workPanel === 'document' ? (
            <div className="flex h-full min-h-0 flex-col">
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-1.5 text-[11px] text-foreground-muted">
                <span className="truncate">
                  {handoffPath ? `交付文档 · ${handoffPath}` : '当前交付内容'}
                </span>
                {docLoading && <span>更新中…</span>}
              </div>
              <div className="md-editor-scroll min-h-0 flex-1 bg-background">
                <MarkdownEditor
                  key={deliveryEditorKey}
                  value={deliveryContent}
                  readOnly
                  compact
                  appica
                />
              </div>
              {docError && (
                <p className="shrink-0 border-t border-border px-3 py-1.5 text-[11px] text-error-foreground">
                  交付文档加载失败：{docError}
                </p>
              )}
            </div>
          ) : workPanel === 'context' ? (
            <div className="h-full space-y-4 overflow-y-auto p-3 text-sm">
              <Info title="类型" value={task.type} />
              <Info title="任务定义" value={task.templateName ?? '未设置'} />
              <Info
                title="角色"
                value={
                  task.workbenchRoles
                    .map((role) => WORKBENCH_ROLE_LABELS[role])
                    .join(' / ') || '—'
                }
              />
              <Info title="状态" value={`${task.status}-${task.subStatus}`} />
              <Section title="任务描述">
                {markdownText(task.description)}
              </Section>
              <Section title="任务输入">{markdownText(task.input)}</Section>
              <Section title="需求内容">{markdownText(task.content)}</Section>
              <Section title="输出要求">{markdownText(task.outputSpec)}</Section>
              <Section title="工作计划">{markdownText(task.workPlan)}</Section>
              {(task.missingItems ?? []).length > 0 && (
                <Section title="待反馈事项">
                  {(task.missingItems ?? [])
                    .map((item) => `${item.item}${item.reason ? `：${item.reason}` : ''}`)
                    .join('\n')}
                </Section>
              )}
            </div>
          ) : (
            <div className="h-full overflow-y-auto p-3">
              <EventLog events={activeChat?.events ?? []} />
            </div>
          )}
        </div>
      </section>

      {/* AI 工作台：任务-需求方 / 任务-执行方 / 我的AI */}
      <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[var(--radius-lg)] bg-background">
        <header className="shrink-0 px-3 py-2.5">
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
          {currentRightTab === 'agent' && agentError && (
            <p
              role="alert"
              className="mt-2 text-[11px] text-error-foreground"
            >
              {agentError}
            </p>
          )}
        </header>

        {currentRightTab !== 'agent' ? (
          <>
            <AssistantRuntimeProvider runtime={runtime}>
              <ThreadPrimitive.Root className="flex min-h-0 flex-1 flex-col">
                <ThreadPrimitive.Viewport className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 py-4">
                  {!task || !activeChat?.messages.length ? <EmptyChat /> : null}
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
                              void run(() =>
                                api.workbenchAcceptHandoff(task.id),
                              )
                            }
                          />
                          <ChatActionIcon
                            label="新子任务"
                            icon={Subtask}
                            disabled={busy || !requesterSubtaskAvailable}
                            onClick={() => setDialog('subtask')}
                          />
                          <ChatActionIcon
                            label="分配任务"
                            icon={ArrowsExchange}
                            disabled={busy || !assignAvailable}
                            onClick={() => setDialog('assign')}
                          />
                          <ChatActionIcon
                            label="取消任务"
                            icon={CircleX}
                            tone="danger"
                            disabled={busy || !assignAvailable}
                            onClick={() => setDialog('cancel')}
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
                                void run(() =>
                                  api.workbenchAccept(task.id),
                                )
                              }
                            />
                          )}
                          <ChatActionIcon
                            label={
                              awaitingReview
                                ? '撤销交付'
                                : deliveryActive
                                  ? '发起交付'
                                  : '发起交付（仅执行中可操作）'
                            }
                            icon={
                              awaitingReview ? Package2Import : Package2Export
                            }
                            disabled={busy || !deliveryActive}
                            onClick={() => {
                              if (awaitingReview) {
                                void run(() =>
                                  api.workbenchRevokeHandoff(task.id),
                                )
                              } else {
                                setHandoffError(null)
                                setDialog('handoff')
                              }
                            }}
                          />
                          <ChatActionIcon
                            label="新子任务"
                            icon={Subtask}
                            disabled={busy || !responsibleSubtaskAvailable}
                            onClick={() => setDialog('subtask')}
                          />
                          <ChatActionIcon
                            label="分配任务"
                            icon={ArrowsExchange}
                            disabled={busy || !assignAvailable}
                            onClick={() => setDialog('assign')}
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
                            onClick={() => setDialog('refuse')}
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
                              : isOwner
                                ? '向执行该任务的 AI 补充要求…'
                                : '以执行方身份提供反馈…'
                  }
                  className="block h-[72px] w-full resize-none bg-transparent px-3 py-2 text-sm outline-none placeholder:text-foreground-subtle disabled:cursor-not-allowed disabled:opacity-60"
                />
              </ChatComposerFrame>
            </ChatComposerDock>
          </>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            {!summary?.agent?.available ? (
              <AgentUnavailable
                reason={
                  summary?.agent?.reason ??
                  '个人 AI 暂不可用，请稍后重试。'
                }
                onRetry={retryAgent}
              />
            ) : agentSnapshot ? (
              <DebugChat
                snapshot={agentSnapshot}
                running={agentSnapshot.status === 'running'}
                onSend={sendAgentMessage}
                onReplyQuestion={replyAgentQuestion}
                framed={false}
                enableAttachments
                onUploadFile={async (file) => {
                  const uploaded = await api.uploadFile(file)
                  return {
                    name: uploaded.filename,
                    url: uploaded.url,
                    size: uploaded.size,
                    mime: uploaded.mime,
                  }
                }}
                modelCatalog={agentCatalog}
                modelSelection={agentSnapshot.model}
                onModelChange={changeAgentModel}
                modelBusy={agentModelBusy}
                mode={agentSnapshot.mode}
                onModeChange={changeAgentMode}
                modeBusy={agentModeBusy}
                emptyTitle={
                  task
                    ? `${task.code} 的独立 AI 会话`
                    : '和你的 AI 开始对话'
                }
                emptyHint={
                  task
                    ? '当前任务的对话与其它任务相互隔离；让 AI 查询、创建或推进任务'
                    : '让 AI 查询、创建或推进任务；它会通过平台技能操作并汇报结果'
                }
                placeholder={
                  agentSnapshot.status === 'running'
                    ? 'AI 正在回复…'
                    : task
                      ? `让 AI 处理 ${task.code}，或输入其它指令…`
                      : '输入指令，Enter 发送，Shift+Enter 换行…'
                }
              />
            ) : agentError ? (
              <AgentUnavailable
                reason={agentError}
                onRetry={retryAgent}
              />
            ) : (
              <div className="flex flex-1 items-center justify-center text-sm text-foreground-muted">
                正在加载 AI 会话…
              </div>
            )}
          </div>
        )}
      </section>
          </div>
        </div>
      </main>

      {/* 操作弹窗：首期统一结构，后续可按任务类型替换中间面板 */}
      <Dialog open={dialog !== null} onOpenChange={(open) => !open && setDialog(null)}>
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
              <div className="space-y-2">
                <p className="text-xs leading-relaxed text-foreground-muted">
                  简单任务写一段交付说明即可；需要沉淀复盘时，在下方小节标题里分别填写。
                </p>
                <div className="md-editor-scroll h-[min(420px,55vh)] rounded-[var(--radius-md)] bg-background-muted">
                  <MarkdownEditor
                    ref={handoffEditorRef}
                    value={HANDOFF_TEMPLATE}
                    compact
                    appica
                  />
                </div>
                {handoffError && (
                  <p role="alert" className="text-xs text-error-foreground">
                    {handoffError}
                  </p>
                )}
              </div>
            </DialogBody>
          )}

          {dialog === 'assign' && (
            <DialogBody>
              <label className="block space-y-1">
                <span className="text-xs text-foreground-muted">处理机器人</span>
                <Select
                  value={assignWorkerId}
                  onValueChange={(value) => setAssignWorkerId(String(value ?? ''))}
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
                  (!subtaskTemplateId || !subtaskTitle.trim()))
              }
              onClick={() => void submitDialog()}
            >
              {dialog === 'cancel' ? '确认取消' : '提交'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function EmptyWork() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-foreground-muted">
      <span className="rounded-full bg-background-muted p-3">
        <Wrench className="size-5" />
      </span>
      <p>选择任务后查看工作内容</p>
    </div>
  )
}

function EmptyChat() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-foreground-muted">
      <span className="rounded-full bg-background-muted p-3">
        <Wrench className="size-5" />
      </span>
      <p>选择任务后，这里显示多机器人协作对话</p>
    </div>
  )
}

function AgentUnavailable({
  reason,
  onRetry,
}: {
  reason: string
  onRetry: () => void
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-sm text-foreground-muted">
      <span className="rounded-full bg-background-muted p-3">
        <Wrench className="size-5" />
      </span>
      <p>我的 AI 暂不可用</p>
      <p className="max-w-md text-xs leading-relaxed text-foreground-subtle">
        {reason}
      </p>
      <Button size="sm" variant="outline" onClick={onRetry}>
        重试
      </Button>
    </div>
  )
}

function Info({ title, value }: { title: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-foreground-subtle">{title}</dt>
      <dd className="mt-0.5 font-medium text-foreground-emphasis">{value}</dd>
    </div>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: string
}) {
  return (
    <div>
      <h4 className="mb-1 text-xs font-medium text-foreground-muted">{title}</h4>
      <div className="whitespace-pre-wrap break-words rounded-[var(--radius-md)] bg-background-muted px-3 py-2 text-xs leading-relaxed text-foreground-emphasis">
        {children}
      </div>
    </div>
  )
}

function EventLog({ events }: { events: TaskEvent[] }) {  if (events.length === 0) {
    return <p className="text-sm text-foreground-muted">暂无任务事件</p>
  }
  return (
    <ol className="space-y-3">
      {events.map((event) => (
        <li key={event.id} className="rounded-[var(--radius-md)] border border-border p-3">
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-foreground-muted">
            <Badge variant="soft" size="sm">
              {event.type}
            </Badge>
            {event.operator && <span>{event.operator}</span>}
            <span>{new Date(event.createdAt).toLocaleString()}</span>
          </div>
          <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground-emphasis">
            {event.content}
          </p>
        </li>
      ))}
    </ol>
  )
}
