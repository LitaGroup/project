import type { ReactNode } from 'react'
import { Progress } from '@appica/ui-react/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@appica/ui-react/select'
import { PageBreadcrumb, type Crumb } from '../PageBreadcrumb'
import { DetailPageLayout } from './DetailPageLayout'

export interface RunHistoryItem {
  id: number
  /** 展示在运行历史下拉中的完整文案 */
  label: string
}

export interface RunSummary {
  statusBadge: ReactNode
  total: number | null
  current: number
  progress: number | null
  duration: string
  message?: string | null
}

interface RunDetailViewProps {
  ai: ReactNode
  breadcrumb: Crumb[]
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
  error?: string | null
  run: RunSummary | null
  history: RunHistoryItem[]
  selectedRunId: number | null
  onSelectRun: (id: number) => void
  terminal?: ReactNode
  /** 终端上方附加区域（如脚本源码） */
  beforeTerminal?: ReactNode
  /** 终端下方附加区域（产物、失败项、计划等），高度受限可滚动 */
  extra?: ReactNode
  emptyText: string
}

/**
 * 脚本类详情页统一正文：检查/测试/导出/定时任务/脚本库。
 * 运行状态与历史收进正文顶部摘要和下拉，不再占用独立业务侧栏；
 * 右侧仅保留「我的 AI」。
 */
export function RunDetailView({
  ai,
  breadcrumb,
  title,
  subtitle,
  actions,
  error,
  run,
  history,
  selectedRunId,
  onSelectRun,
  terminal,
  beforeTerminal,
  extra,
  emptyText,
}: RunDetailViewProps) {
  const historyItems = Object.fromEntries(
    history.map((item) => [String(item.id), item.label]),
  )

  return (
    <DetailPageLayout ai={ai}>
      <div className="flex h-full min-h-0 flex-col gap-4">
        <PageBreadcrumb items={breadcrumb} />

        <header className="flex shrink-0 flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold text-foreground-intense">
              {title}
            </h1>
            {subtitle && (
              <div className="mt-1 min-w-0 text-sm text-foreground-muted">
                {subtitle}
              </div>
            )}
          </div>
          {actions && (
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {actions}
            </div>
          )}
        </header>

        {error && (
          <p
            role="alert"
            className="shrink-0 rounded-[var(--radius-md)] bg-error-soft px-3 py-2 text-sm text-error-foreground"
          >
            操作失败：{error}
          </p>
        )}

        <section className="shrink-0 rounded-[var(--radius-lg)] border border-border bg-background px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
            {run ? (
              <>
                <span className="flex items-center gap-2">
                  <span className="text-xs text-foreground-subtle">状态</span>
                  {run.statusBadge}
                </span>
                <span className="text-xs text-foreground-muted">
                  总步数 <strong className="text-foreground-emphasis">{run.total ?? '—'}</strong>
                </span>
                <span className="text-xs text-foreground-muted">
                  当前步数{' '}
                  <strong className="text-foreground-emphasis">{run.current}</strong>
                </span>
                <div className="min-w-36 flex-1">
                  <Progress value={run.progress} />
                </div>
                <span className="text-xs text-foreground-muted">
                  进度{' '}
                  <strong className="text-foreground-emphasis">
                    {run.progress !== null ? `${run.progress}%` : '—'}
                  </strong>
                </span>
                <span className="text-xs text-foreground-muted">
                  耗时{' '}
                  <strong className="text-foreground-emphasis">{run.duration}</strong>
                </span>
              </>
            ) : (
              <span className="text-sm text-foreground-muted">{emptyText}</span>
            )}

            <Select
              value={selectedRunId !== null ? String(selectedRunId) : ''}
              onValueChange={(value) => {
                if (value) onSelectRun(Number(value))
              }}
              items={historyItems}
            >
              <SelectTrigger className="ml-auto h-8 w-60 max-w-full">
                <SelectValue placeholder="运行历史" />
              </SelectTrigger>
              <SelectContent>
                {history.map((item) => (
                  <SelectItem key={item.id} value={String(item.id)}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {run?.message && (
            <p
              className="mt-2 line-clamp-2 break-words text-xs text-foreground-muted"
              title={run.message}
            >
              {run.message}
            </p>
          )}
        </section>

        {beforeTerminal}

        <section className="flex min-h-0 flex-1 flex-col">
          {terminal ?? (
            <p className="text-sm text-foreground-muted">{emptyText}</p>
          )}
        </section>

        {extra && (
          <section className="max-h-52 shrink-0 overflow-y-auto">
            {extra}
          </section>
        )}
      </div>
    </DetailPageLayout>
  )
}
