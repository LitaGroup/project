import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle } from '@appica/icons-react'
import { Badge } from '@appica/ui-react/badge'
import { Button } from '@appica/ui-react/button'
import { Textarea } from '@appica/ui-react/textarea'
import type {
  TaskChatMessage,
  TaskChatQuestion,
  TaskPackage,
  TicketWorkflowView,
} from '../../lib/api'
import { MarkdownViewer } from '../MarkdownViewer'
import { QuestionCard } from '../QuestionCard'

const NODE_KIND_LABEL: Record<string, string> = {
  start: '起始',
  operation: '操作',
  approval: '审批',
  acceptance: '验收',
}

const NODE_KIND_VARIANT: Record<
  string,
  'primary' | 'info' | 'warning' | 'soft'
> = {
  start: 'soft',
  operation: 'primary',
  approval: 'warning',
  acceptance: 'info',
}

interface TicketCurrentNodePanelProps {
  workflow: TicketWorkflowView
  /** 当前节点任务（来自 PIPELINE 阶段快照） */
  currentTask: TaskPackage | null
  /** 当前节点执行机器人名称 */
  agentName: string | null
  /** 当前节点任务的消息（含补充沟通记录） */
  messages: TaskChatMessage[]
  /** 待回答的机器人提问 */
  pendingQuestions: TaskChatQuestion[]
  replying: boolean
  onReplyQuestion: (
    questionId: string,
    answers: string[][] | null,
  ) => Promise<void>
  /** 提交补充内容；失败时抛错由输入区展示 */
  onSend: (content: string) => Promise<void>
}

/**
 * 工单详情「当前」Tab：当前节点信息与记录、待补充事项（待反馈/提问）、
 * 需求方补充沟通记录与补充输入框。
 */
export function TicketCurrentNodePanel({
  workflow,
  currentTask,
  agentName,
  messages,
  pendingQuestions,
  replying,
  onReplyQuestion,
  onSend,
}: TicketCurrentNodePanelProps) {
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

  const node = workflow.currentNodeKey
    ? workflow.nodes.find((item) => item.key === workflow.currentNodeKey) ?? null
    : null
  const currentRun = workflow.currentNodeKey
    ? [...workflow.runs]
        .filter((run) => run.nodeKey === workflow.currentNodeKey)
        .reduce<TicketWorkflowView['runs'][number] | null>(
          (latest, run) => (!latest || run.id > latest.id ? run : latest),
          null,
        )
    : null
  const taskFinished = currentTask ? currentTask.status === '已结束' : false
  const missingItems = currentTask?.missingItems ?? []
  /** 仅在机器人等待用户补充（待反馈事项 / 待回答提问）时展示补充输入框 */
  const hasPendingSupplement =
    missingItems.length > 0 || pendingQuestions.length > 0
  const canSend = Boolean(currentTask) && !taskFinished && hasPendingSupplement

  const supplements = messages
    .filter(
      (message) =>
        message.taskId === currentTask?.id &&
        message.kind === 'message' &&
        message.role === 'user',
    )
    .sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    )

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const content = draft.trim()
    if (!content || sending || !canSend) return
    setSending(true)
    setSendError(null)
    try {
      await onSend(content)
      // oxlint-disable-next-line react/set-state-in-event-handler
      setDraft('')
    } catch (e) {
      setSendError((e as Error).message)
    } finally {
      setSending(false)
    }
  }

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-5 p-4">
          {/* 当前节点 */}
          <section>
            <h2 className="mb-2 text-sm font-semibold text-foreground-intense">
              当前节点
            </h2>
            {!node ? (
              <div className="rounded-[var(--radius-md)] bg-background-muted px-3 py-2 text-sm text-foreground-muted">
                流程已结束（{workflow.status}）
                {currentTask && (
                  <Link
                    to={`/tasks/${currentTask.id}`}
                    className="ml-1 font-mono text-xs hover:underline"
                  >
                    {currentTask.code}
                  </Link>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-2 rounded-[var(--radius-md)] bg-background-muted px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-foreground-intense">
                    {node.name}
                  </span>
                  <Badge
                    variant={NODE_KIND_VARIANT[node.kind] ?? 'soft'}
                    size="sm"
                  >
                    {NODE_KIND_LABEL[node.kind] ?? node.kind}
                  </Badge>
                  {currentRun && (
                    <>
                      <Badge variant="soft" size="sm">
                        {currentRun.status}
                      </Badge>
                      <span className="text-xs text-foreground-muted">
                        第 {currentRun.attempt} 次执行
                      </span>
                      {currentRun.startedAt && (
                        <span className="text-xs text-foreground-muted">
                          开始于 {new Date(currentRun.startedAt).toLocaleString()}
                        </span>
                      )}
                    </>
                  )}
                </div>
                <p className="text-xs text-foreground-muted">
                  处理机器人：{agentName ?? currentRun?.agentName ?? '分配中'}
                  {currentTask && (
                    <>
                      <span className="mx-1">·</span>
                      任务{' '}
                      <Link
                        to={`/tasks/${currentTask.id}`}
                        className="font-mono hover:underline"
                      >
                        {currentTask.code}
                      </Link>
                      <span className="mx-1">·</span>
                      {currentTask.subStatus ?? currentTask.status}
                    </>
                  )}
                </p>
                {node.description?.trim() && (
                  <MarkdownViewer
                    text={node.description}
                    className="text-sm"
                  />
                )}
              </div>
            )}
          </section>

          {/* 待补充事项 */}
          {missingItems.length > 0 && (
            <div className="rounded-[var(--radius-md)] bg-warning-soft px-3 py-2 text-xs text-warning-foreground">
              <p className="mb-1 flex items-center gap-1.5 font-medium">
                <AlertCircle className="size-3.5" />
                待反馈事项（{missingItems.length}）
              </p>
              <ul className="flex list-disc flex-col gap-0.5 pl-4">
                {missingItems.map((item, index) => (
                  <li key={index}>
                    {item.item}
                    {item.reason ? ` — ${item.reason}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {pendingQuestions.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold text-foreground-intense">
                待回答问题（{pendingQuestions.length}）
              </h2>
              <div className="flex flex-col gap-3">
                {pendingQuestions.map((question) => (
                  <QuestionCard
                    key={question.id}
                    question={question}
                    busy={replying}
                    disabled={taskFinished || currentTask?.subStatus !== '待反馈'}
                    onReply={onReplyQuestion}
                  />
                ))}
              </div>
            </section>
          )}

          {/* 补充记录 */}
          <section>
            <h2 className="mb-2 text-sm font-semibold text-foreground-intense">
              补充记录（{supplements.length}）
            </h2>
            {supplements.length === 0 ? (
              <p className="text-sm text-foreground-muted">
                暂无补充，机器人缺少信息时会在这里提问或标记待反馈事项
              </p>
            ) : (
              <ol className="flex flex-col gap-3">
                {supplements.map((message) => (
                  <li
                    key={message.id}
                    className="rounded-[var(--radius-md)] border border-border px-3 py-2"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-medium text-foreground-emphasis">
                        {message.sender?.name ?? '发起人'}
                      </span>
                      <time className="text-[11px] text-foreground-subtle">
                        {new Date(message.createdAt).toLocaleString()}
                      </time>
                      {message.status === 'error' && (
                        <Badge variant="error" size="sm">
                          发送失败
                        </Badge>
                      )}
                    </div>
                    <MarkdownViewer
                      text={message.content}
                      className="mt-1 text-sm"
                    />
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>

      {/* 补充输入框 */}
      {canSend && (
        <form
          onSubmit={(event) => void submit(event)}
          className="shrink-0 border-t border-border px-4 py-3"
        >
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="补充需求信息、回答节点问题…"
            rows={3}
            aria-label="补充内容"
          />
          {sendError && (
            <p role="alert" className="mt-1 text-xs text-error-foreground">
              补充发送失败：{sendError}
            </p>
          )}
          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="text-xs text-foreground-muted">
              {currentTask?.subStatus === '执行中'
                ? '机器人执行中，补充内容将在本轮结束后送达'
                : '补充内容将记录到当前节点任务'}
            </p>
            <Button type="submit" size="sm" disabled={sending || !draft.trim()}>
              {sending ? '发送中…' : '发送补充'}
            </Button>
          </div>
        </form>
      )}
    </section>
  )
}
