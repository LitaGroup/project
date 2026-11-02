import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  ThreadPrimitive,
  useExternalStoreRuntime,
  type AppendMessage,
} from '@assistant-ui/react'
import { Badge } from '@appica/ui-react/badge'
import { Button, buttonVariants } from '@appica/ui-react/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@appica/ui-react/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@appica/ui-react/select'
import {
  AlertCircle,
  Send,
  Wrench,
} from '@appica/icons-react'
import {
  api,
  type TaskChatMessage,
  type TaskPackage,
  type TaskPipelineStage,
  type TaskQueuedUserMessage,
  type Worker,
} from '../../lib/api'
import {
  TaskChatMessageItem,
  TaskChatQueuedMessages,
} from './TaskChatMessages'
import { toTaskChatThreadMessage } from './task-chat-message'

interface TaskChatPanelProps {
  task: TaskPackage
  pipeline: TaskPipelineStage[]
  messages: TaskChatMessage[]
  queuedMessages: TaskQueuedUserMessage[]
  connection: 'connecting' | 'live' | 'reconnecting'
  busy: boolean
  /** 是否曾提交过验收申请（返工后仍允许需求方验收） */
  hasAcceptanceApplication: boolean
  onSendMessage: (content: string) => Promise<void>
  /** 回答（answers）或跳过（null）机器人提问 */
  onReplyQuestion: (questionId: string, answers: string[][] | null) => Promise<void>
  onAction: (fn: (id: number) => Promise<unknown>) => void
}

/**
 * 任务详情页左侧对话面板：assistant-ui 渲染消息，SSE 增量由页面写入 messages。
 * 多个机器人完成同一 PIPELINE 时，各条消息按 sender 展示各自的头像与名称。
 */
export function TaskChatPanel({
  task,
  pipeline,
  messages,
  queuedMessages,
  connection,
  busy,
  hasAcceptanceApplication,
  onSendMessage,
  onReplyQuestion,
  onAction,
}: TaskChatPanelProps) {
  const onNew = useCallback(
    async (message: AppendMessage) => {
      const text = message.content
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('\n')
        .trim()
      if (!text) return
      await onSendMessage(text)
    },
    [onSendMessage],
  )

  const finished = task.status === '已结束'
  const robotRunning = messages.some(
    (message) => message.role === 'assistant' && message.status === 'running',
  )
  // 执行中仍可输入：消息进入平台发送队列，待当前轮结束后自动投递。
  const runtime = useExternalStoreRuntime<TaskChatMessage>({
    messages,
    convertMessage: toTaskChatThreadMessage,
    onNew,
    isSendDisabled: busy || finished,
  })

  const robotCount = useMemo(
    () =>
      new Set(
        pipeline
          .map((stage) => stage.agent?.workerId)
          .filter((id): id is number => id !== undefined),
      ).size,
    [pipeline],
  )
  const currentAgentName = pipeline.find(
    (stage) => stage.task.id === task.id,
  )?.agent?.name

  return (
    <section className="flex min-h-[60vh] min-w-0 flex-col overflow-hidden rounded-[var(--radius-lg)] border border-border bg-background xl:min-h-0">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <ConnectionDot state={connection} />
          <span className="truncate text-sm font-medium text-foreground-intense">
            任务对话
          </span>
          <Badge variant="soft" size="sm">
            {robotCount > 0 ? `${robotCount} 个机器人` : '等待分配'}
          </Badge>
        </div>
        <span className="shrink-0 text-xs text-foreground-muted">
          {connection === 'live'
            ? 'SSE 实时'
            : connection === 'reconnecting'
              ? '重连中…'
              : '连接中…'}
        </span>
      </header>

      <AssistantRuntimeProvider runtime={runtime}>
        <ThreadPrimitive.Root className="flex min-h-0 flex-1 flex-col">
          <ThreadPrimitive.Viewport className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
            {messages.length === 0 && (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-sm text-foreground-muted">
                <span className="rounded-full bg-background-muted p-3">
                  <Wrench className="size-5" />
                </span>
                <p>任务创建后，调度机器人与机器人的反馈会显示在这里</p>
              </div>
            )}
            <ThreadPrimitive.Messages>
              {({ message }) => (
                <TaskChatMessageItem
                  message={message}
                  busy={busy}
                  canReplyQuestion={(custom) =>
                    task.subStatus === '待反馈' &&
                    (custom.taskId === undefined ||
                      custom.taskId === task.id)
                  }
                  onReplyQuestion={onReplyQuestion}
                />
              )}
            </ThreadPrimitive.Messages>

            <ThreadPrimitive.ViewportFooter className="sticky bottom-0 mt-auto bg-background pt-2">
              <ChatFooter
                task={task}
                agentName={currentAgentName}
                busy={busy}
                robotRunning={robotRunning}
                queuedMessages={queuedMessages}
                hasAcceptanceApplication={hasAcceptanceApplication}
                onAction={onAction}
              />
            </ThreadPrimitive.ViewportFooter>
          </ThreadPrimitive.Viewport>
        </ThreadPrimitive.Root>
      </AssistantRuntimeProvider>
    </section>
  )
}

function ConnectionDot({
  state,
}: {
  state: 'connecting' | 'live' | 'reconnecting'
}) {
  const color =
    state === 'live'
      ? 'bg-success-emphasis'
      : state === 'reconnecting'
        ? 'bg-warning-emphasis'
        : 'bg-foreground-subtle'
  return (
    <span className="relative flex size-2 shrink-0">
      {state === 'live' && (
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-success-emphasis opacity-60 motion-reduce:hidden" />
      )}
      <span className={`relative inline-flex size-2 rounded-full ${color}`} />
    </span>
  )
}

/** 底部输入区：未结束任务均可发送消息，操作按钮统一位于输入框下方 */
function ChatFooter({
  task,
  agentName,
  busy,
  robotRunning,
  queuedMessages,
  hasAcceptanceApplication,
  onAction,
}: {
  task: TaskPackage
  agentName?: string
  busy: boolean
  robotRunning: boolean
  queuedMessages: TaskQueuedUserMessage[]
  hasAcceptanceApplication: boolean
  onAction: (fn: (id: number) => Promise<unknown>) => void
}) {
  const finished = task.status === '已结束'
  const awaitingAcceptance = task.subStatus === '待验收'
  const canAccept =
    !finished && (awaitingAcceptance || hasAcceptanceApplication)
  const placeholder = finished
    ? '任务已结束，不能继续对话'
    : awaitingAcceptance
      ? '输入返工意见，发送后将按验收不通过退回机器人…'
      : robotRunning
        ? '输入消息加入发送队列，当前回复结束后自动发送…'
        : task.subStatus === '待反馈'
          ? '补充资料或确认信息，发送后将排队等待机器人继续执行…'
          : task.subStatus === '待分配' || task.subStatus === '待接受'
            ? '补充任务需求，内容会随任务一起提供…'
            : task.subStatus === '待继续'
              ? '任务正在排队，可继续补充说明…'
              : '继续与机器人对话，Enter 发送，Shift+Enter 换行…'
  const hint =
    task.subStatus === '执行中'
      ? robotRunning
        ? '机器人正在执行，新消息会加入下方发送队列，按顺序发送'
        : queuedMessages.length > 0
          ? '发送队列将在机器人当前轮结束后继续投递'
          : '机器人正在执行，实时输出会同步到对话中'
      : task.subStatus === '待分配'
        ? '任务已创建，等待平台分配机器人'
        : task.subStatus === '待接受'
          ? '任务邀约已下发，等待机器人接受或拒绝'
          : task.subStatus === '待继续'
            ? '反馈已收到，正在排队等待机器人空闲后继续执行'
            : task.subStatus === '待验收'
              ? `机器人已申请验收，验收不通过累计 ${task.acceptRejectCount ?? 0} 次；第 4 次起转任务执行方处理`
              : task.subStatus === '待反馈' && task.ownerTakeoverAt
                ? `验收不通过已转任务执行方${task.ownerTakeoverName ? `「${task.ownerTakeoverName}」` : ''}处理，补充意见后等待机器人继续执行`
                : task.subStatus === '待反馈'
                  ? '等待需求方补充资料或回答机器人提问'
                  : task.subStatus === '完成'
                    ? '任务已完成并验收'
                    : task.subStatus === '已拒绝'
                      ? '机器人已拒绝承接，请查看拒绝理由与分发建议'
                      : task.subStatus === '失败'
                        ? '任务已判定失败，请查看失败原因'
                        : task.subStatus === '取消'
                          ? '任务已取消'
                          : '等待任务状态更新'

  return (
    <div className="rounded-[var(--radius-lg)] border border-border bg-background p-3 shadow-sm">
      {task.missingItems && task.missingItems.length > 0 && (
        <div className="mb-2 rounded-[var(--radius-md)] bg-warning-soft px-3 py-2 text-xs text-warning-foreground">
          <p className="mb-1 flex items-center gap-1.5 font-medium">
            <AlertCircle className="size-3.5" />
            待反馈事项（{task.missingItems.length}）
          </p>
          <ul className="flex max-h-24 list-disc flex-col gap-0.5 overflow-y-auto pl-4">
            {task.missingItems.map((item, index) => (
              <li key={index}>
                {item.item}
                {item.reason ? ` — ${item.reason}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}

      {(task.subStatus === '已拒绝' || task.subStatus === '失败') && (
        <div
          className={`mb-2 rounded-[var(--radius-md)] px-3 py-2 text-xs ${
            task.subStatus === '失败'
              ? 'bg-error-soft text-error-foreground'
              : 'bg-warning-soft text-warning-foreground'
          }`}
        >
          <p className="font-medium">
            {task.subStatus === '已拒绝' ? '拒绝理由' : '失败原因'}
            {task.subStatus === '已拒绝' && task.refusedBy
              ? ` · ${task.refusedBy}`
              : task.subStatus === '失败' && task.failedBy
                ? ` · ${task.failedBy}`
                : ''}
          </p>
          <p className="mt-1 whitespace-pre-wrap break-words leading-relaxed">
            {(task.subStatus === '已拒绝'
              ? task.refusalReason
              : task.failureReason) ?? '未填写理由'}
          </p>
          {task.subStatus === '已拒绝' && task.dispatchSuggestion && (
            <p className="mt-2 whitespace-pre-wrap break-words leading-relaxed">
              <span className="font-medium">分发建议：</span>
              {task.dispatchSuggestion}
            </p>
          )}
        </div>
      )}

      <TaskChatQueuedMessages
        messages={queuedMessages}
        className="mb-2"
      />

      <ComposerPrimitive.Root className="flex items-end gap-2 rounded-[var(--radius-md)] border border-border bg-background px-2 py-1.5 focus-within:border-border-strong">
        <ComposerPrimitive.Input
          rows={2}
          disabled={finished}
          placeholder={placeholder}
          className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-1 py-1.5 text-sm outline-none placeholder:text-foreground-subtle disabled:cursor-not-allowed disabled:opacity-60"
        />
        <ComposerPrimitive.Send
          className={buttonVariants({ variant: 'primary', size: 'icon-sm' })}
          aria-label="发送消息"
          disabled={busy || finished}
        >
          <Send className="size-4" />
        </ComposerPrimitive.Send>
      </ComposerPrimitive.Root>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2">
        <span className="min-w-0 flex-1 truncate text-[11px] text-foreground-muted">
          {hint}
        </span>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {task.subStatus === '执行中' && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => onAction((id) => api.interruptTask(id))}
            >
              暂停
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={busy || finished}
            onClick={() => onAction((id) => api.cancelTask(id))}
          >
            取消
          </Button>
          {task.status === '已结束' && task.subStatus === '完成' && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy || robotRunning}
              onClick={() => onAction((id) => api.generateTaskHandoff(id))}
            >
              {robotRunning ? '复盘生成中…' : '重新生成复盘'}
            </Button>
          )}
          <AssignTaskDialog
            task={task}
            agentName={agentName}
            busy={busy}
            onAssign={(agentId) =>
              onAction((id) => api.assignTask(id, agentId))
            }
          />
          <Button
            size="sm"
            variant="primary"
            disabled={busy || !canAccept}
            onClick={() => onAction((id) => api.acceptTask(id))}
          >
            验收完成
          </Button>
        </div>
      </div>
    </div>
  )
}

/** 分配机器人弹窗：仅列出启用中的工作者 */
function AssignTaskDialog({
  task,
  agentName,
  busy,
  onAssign,
}: {
  task: TaskPackage
  agentName?: string
  busy: boolean
  onAssign: (agentId: number) => void
}) {
  const [open, setOpen] = useState(false)
  const [workers, setWorkers] = useState<Worker[]>([])
  const [agentId, setAgentId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) return
    setLoading(true)
    setError(null)
    setAgentId('')
  }

  useEffect(() => {
    if (!open) return
    api
      .listWorkers({ role: '工作者' })
      .then((list) =>
        setWorkers(
          list.filter(
            (worker) => worker.enabled && worker.id !== task.agentId,
          ),
        ),
      )
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [open, task.agentId])

  const items = Object.fromEntries(
    workers.map((worker) => [String(worker.id), worker.name]),
  )
  const submit = () => {
    const next = Number(agentId)
    if (!Number.isInteger(next) || next < 1) {
      setError('请选择机器人')
      return
    }
    if (next === task.agentId) {
      setError('请选择其他机器人')
      return
    }
    setOpen(false)
    onAssign(next)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button
            size="sm"
            variant="outline"
            disabled={busy || task.status === '已结束'}
          />
        }
      >
        分配
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>分配任务</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 px-6 pb-2 text-sm">
          <p className="text-foreground-muted">
            当前机器人：{agentName ?? (task.agentId ? `#${task.agentId}` : '未分配')}
          </p>
          <label className="flex flex-col gap-1">
            <span>分配给</span>
            <Select
              value={agentId || null}
              onValueChange={(value) =>
                setAgentId((value as string | null) ?? '')
              }
              items={items}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={loading ? '加载机器人…' : '选择机器人'}
                />
              </SelectTrigger>
              <SelectContent>
                {workers.map((worker) => (
                  <SelectItem key={worker.id} value={String(worker.id)}>
                    {worker.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          {workers.length === 0 && !loading && (
            <p className="text-xs text-foreground-muted">暂无启用中的工作者</p>
          )}
          <p className="text-xs text-foreground-muted">
            执行中的任务会先中断旧机器人再重新派发；待验收任务会重新执行。
          </p>
          {error && <p className="text-xs text-error-foreground">{error}</p>}
        </div>
        <DialogFooter>
          <Button size="sm" variant="outline" onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={busy || loading || !agentId}
            onClick={submit}
          >
            确认分配
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
