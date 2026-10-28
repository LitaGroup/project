import { Badge } from '@appica/ui-react/badge'
import type { TaskEvent, TaskPackage } from '../../lib/api'
import { formatDuration } from '../../lib/duration'

interface TaskSidePanelProps {
  task: TaskPackage
  agentName?: string
  requesterName: string | null
  agentOwnerName: string | null
  interventionCount: number
  durationMs: number
  events: TaskEvent[]
}

/**
 * 任务详情右侧单面板：上半部分为任务关键信息，下半部分为任务事件时间线。
 * 对话、操作按钮均在左侧完成。
 */
export function TaskSidePanel({
  task,
  agentName,
  requesterName,
  agentOwnerName,
  interventionCount,
  durationMs,
  events,
}: TaskSidePanelProps) {
  return (
    <aside className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[var(--radius-lg)] border border-border bg-background">
      <section className="shrink-0 border-b border-border p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground-intense">
            任务信息
          </h2>
          <span className="font-mono text-xs text-foreground-muted">
            {task.code}
          </span>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
          <InfoItem label="需求人" value={requesterName ?? '—'} />
          <InfoItem label="所属项目" value="—" />
          <InfoItem label="类型" value={task.type} />
          <InfoItem label="定义" value={task.templateName ?? '未设置'} />
          <InfoItem label="机器人" value={agentName ?? '未分配'} />
          <InfoItem label="负责人" value={agentOwnerName ?? '—'} />
          <InfoItem label="持续时间" value={formatDuration(durationMs)} />
          <InfoItem label="介入次数" value={`${interventionCount} 次`} />
          <InfoItem
            label="验收不通过"
            value={`${task.acceptRejectCount ?? 0} 次`}
          />
          {task.ownerTakeoverAt && (
            <div className="col-span-2">
              <InfoItem
                label="负责人接管"
                value={`${task.ownerTakeoverName ?? '未配置负责人'} · ${new Date(
                  task.ownerTakeoverAt,
                ).toLocaleString()}`}
              />
            </div>
          )}
        </dl>
      </section>

      <section className="flex min-h-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center justify-between gap-2 px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground-intense">
            任务事件
          </h2>
          <span className="text-xs text-foreground-muted">
            {events.length} 条
          </span>
        </header>
        {events.length === 0 ? (
          <div className="flex flex-1 items-center justify-center px-4 text-center text-sm text-foreground-muted">
            暂无任务事件
          </div>
        ) : (
          <ol className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-4">
            {events.map((event) => (
              <EventItem key={event.id} event={event} />
            ))}
          </ol>
        )}
      </section>
    </aside>
  )
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-foreground-subtle">{label}</dt>
      <dd
        className="mt-0.5 truncate text-foreground-emphasis"
        title={value}
      >
        {value}
      </dd>
    </div>
  )
}

function EventItem({ event }: { event: TaskEvent }) {
  return (
    <li className="relative flex gap-3 pb-4 last:pb-0">
      <span className="relative mt-1 flex shrink-0 flex-col items-center">
        <span className="size-2 rounded-full bg-border-strong" />
        <span className="mt-1 w-px flex-1 bg-border" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <time className="text-[11px] text-foreground-subtle">
            {new Date(event.createdAt).toLocaleString()}
          </time>
          <EventTypeBadge type={event.type} />
          {event.operator && (
            <span className="text-[11px] text-foreground-muted">
              {event.operator}
            </span>
          )}
        </div>
        <p
          className="mt-1 line-clamp-2 break-words text-xs leading-relaxed text-foreground-emphasis"
          title={event.content}
        >
          {event.content}
        </p>
      </div>
    </li>
  )
}

function EventTypeBadge({ type }: { type: string }) {
  const variant =
    type === '状态变更'
      ? 'info'
      : type === '分配'
        ? 'primary'
        : type === '提问'
          ? 'warning'
          : type === '反馈'
            ? 'success'
            : 'soft'
  return (
    <Badge variant={variant} size="sm">
      {type}
    </Badge>
  )
}
