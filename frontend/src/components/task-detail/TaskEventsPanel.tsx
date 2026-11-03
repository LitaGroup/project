import { Badge } from '@appica/ui-react/badge'
import type { TaskEvent } from '../../lib/api'

/** 任务详情「事件」Tab：完整任务事件时间线（SSE 刷新由父页面驱动）。 */
export function TaskEventsPanel({ events }: { events: TaskEvent[] }) {
  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-[var(--radius-lg)] border border-border bg-background">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-3">
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
        <ol className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4">
          {events.map((event) => (
            <li key={event.id} className="relative flex gap-3 pb-5 last:pb-0">
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
                <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground-emphasis">
                  {event.content}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
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
