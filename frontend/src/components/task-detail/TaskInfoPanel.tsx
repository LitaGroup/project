import { AlertCircle } from '@appica/icons-react'
import type { TaskChatQuestion, TaskPackage } from '../../lib/api'
import { formatDuration } from '../../lib/duration'
import { ChatMarkdown } from '../ChatMarkdown'
import { QuestionCard } from '../QuestionCard'

interface TaskInfoPanelProps {
  task: TaskPackage
  agentName?: string
  requesterName: string | null
  agentOwnerName: string | null
  interventionCount: number
  durationMs: number
  busy: boolean
  /** 待回答的机器人提问（交互组件只在信息 Tab 展示） */
  pendingQuestions: TaskChatQuestion[]
  onReplyQuestion: (
    questionId: string,
    answers: string[][] | null,
  ) => Promise<void>
}

/**
 * 任务详情「信息」Tab：任务字段、待处理事项与待回答问题。
 * 不承载任务操作；会话 Tab 只读展示多方交互。
 */
export function TaskInfoPanel({
  task,
  agentName,
  requesterName,
  agentOwnerName,
  interventionCount,
  durationMs,
  busy,
  pendingQuestions,
  onReplyQuestion,
}: TaskInfoPanelProps) {
  const finished = task.status === '已结束'

  return (
    <section className="h-full min-h-0 overflow-y-auto rounded-[var(--radius-lg)] border border-border bg-background">
      <div className="flex flex-col gap-5 p-4">
        <section>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-foreground-intense">
              任务信息
            </h2>
            <span className="font-mono text-xs text-foreground-muted">
              {task.code}
            </span>
          </div>
          <dl className="grid gap-x-5 gap-y-3 text-xs sm:grid-cols-2 xl:grid-cols-3">
            <InfoItem label="需求方" value={requesterName ?? '—'} />
            <InfoItem label="类型" value={task.type} />
            <InfoItem label="任务定义" value={task.templateName ?? '未设置'} />
            <InfoItem label="处理机器人" value={agentName ?? '未分配'} />
            <InfoItem label="执行方" value={agentOwnerName ?? '—'} />
            <InfoItem label="持续时间" value={formatDuration(durationMs)} />
            <InfoItem label="人工介入" value={`${interventionCount} 次`} />
            <InfoItem
              label="验收不通过"
              value={`${task.acceptRejectCount ?? 0} 次`}
            />
            <InfoItem
              label="创建时间"
              value={new Date(task.createdAt).toLocaleString()}
            />
            {task.ownerTakeoverAt && (
              <div className="sm:col-span-2 xl:col-span-3">
                <InfoItem
                  label="执行方接管"
                  value={`${task.ownerTakeoverName ?? '未配置执行方'} · ${new Date(
                    task.ownerTakeoverAt,
                  ).toLocaleString()}`}
                />
              </div>
            )}
          </dl>
        </section>

        <div className="grid gap-4 lg:grid-cols-2">
          <DetailField title="工作计划" value={task.workPlan} />
        </div>

        {task.missingItems && task.missingItems.length > 0 && (
          <div className="rounded-[var(--radius-md)] bg-warning-soft px-3 py-2 text-xs text-warning-foreground">
            <p className="mb-1 flex items-center gap-1.5 font-medium">
              <AlertCircle className="size-3.5" />
              待反馈事项（{task.missingItems.length}）
            </p>
            <ul className="flex list-disc flex-col gap-0.5 pl-4">
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
            className={`rounded-[var(--radius-md)] px-3 py-2 text-xs ${
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
                  busy={busy}
                  disabled={finished || task.subStatus !== '待反馈'}
                  onReply={onReplyQuestion}
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </section>
  )
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-foreground-subtle">{label}</dt>
      <dd className="mt-0.5 break-words text-foreground-emphasis" title={value}>
        {value}
      </dd>
    </div>
  )
}

function DetailField({
  title,
  value,
}: {
  title: string
  value: string | null | undefined
}) {
  return (
    <section className="min-w-0">
      <h3 className="mb-1 text-xs font-medium text-foreground-muted">{title}</h3>
      <div className="min-h-16 rounded-[var(--radius-md)] bg-background-muted px-3 py-2 text-sm text-foreground-emphasis">
        {value?.trim() ? (
          <ChatMarkdown text={value} />
        ) : (
          <span className="text-xs text-foreground-subtle">未填写</span>
        )}
      </div>
    </section>
  )
}
