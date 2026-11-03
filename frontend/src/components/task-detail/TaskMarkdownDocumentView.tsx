import type { ReactNode } from 'react'
import { MarkdownEditor } from '../MarkdownEditor'

interface TaskMarkdownDocumentViewProps {
  title: string
  subtitle?: ReactNode
  meta?: ReactNode
  content: string | null | undefined
  loading?: boolean
  error?: string | null
  emptyText: string
  /** 内容版本 key：变化时重新挂载只读编辑器 */
  contentKey?: string | number | null
}

/** 任务详情中交付/复盘/任务文档的只读 Markdown 阅读区。 */
export function TaskMarkdownDocumentView({
  title,
  subtitle,
  meta,
  content,
  loading = false,
  error,
  emptyText,
  contentKey,
}: TaskMarkdownDocumentViewProps) {
  const hasContent = Boolean(content?.trim())
  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-[var(--radius-lg)] border border-border bg-background">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground-intense">
            {title}
          </h2>
          {subtitle && (
            <div className="mt-0.5 text-xs text-foreground-muted">
              {subtitle}
            </div>
          )}
        </div>
        {meta && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs text-foreground-muted">
            {meta}
          </div>
        )}
      </header>

      {error && (
        <p
          role="alert"
          className="shrink-0 border-b border-border px-4 py-2 text-xs text-error-foreground"
        >
          文档加载失败：{error}
        </p>
      )}

      {!hasContent ? (
        <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-sm text-foreground-muted">
          {loading ? '正在加载文档…' : error ? '暂时无法展示文档' : emptyText}
        </div>
      ) : (
        <div className="md-editor-scroll min-h-0 flex-1">
          <MarkdownEditor
            key={contentKey ?? content}
            value={content ?? ''}
            readOnly
          />
        </div>
      )}
    </section>
  )
}
