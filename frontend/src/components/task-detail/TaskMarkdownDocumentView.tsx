import {
  useEffect,
  useMemo,
  useState,
  type ReactNode,
  type Ref,
} from 'react'
import { Link } from 'react-router-dom'
import { knowledgeWebPath } from '../../lib/api'
import {
  MarkdownEditor,
  type MarkdownEditorHandle,
} from '../MarkdownEditor'

/** MarkdownEditor 是非受控组件：内容一旦变化必须换 key 重新挂载，避免继续显示旧正文。 */
function contentFingerprint(content: string): string {
  let hash = 2166136261
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `${content.length}:${(hash >>> 0).toString(36)}`
}

interface TaskMarkdownDocumentViewProps {
  title: string
  subtitle?: ReactNode
  meta?: ReactNode
  /** 标题栏右侧操作（如交付文档编辑/保存） */
  actions?: ReactNode
  /** 标题栏下方的提示或报错区域 */
  notice?: ReactNode
  /** 悬浮在底部的内容（如交付文档状态） */
  footer?: ReactNode
  content: string | null | undefined
  loading?: boolean
  error?: string | null
  emptyText: string
  /** 内容版本 key：变化时重新挂载编辑器 */
  contentKey?: string | number | null
  /** 编辑模式：即使正文为空也渲染编辑器 */
  editing?: boolean
  /** 编辑模式下的编辑器 ref，保存前取实时正文 */
  editorRef?: Ref<MarkdownEditorHandle>
}

interface HandoffDocumentStatusProps {
  path?: string | null
  version?: number | null
  updatedAt?: string | null
  exists?: boolean
  loading?: boolean
}

const RELATIVE_TIME_LIMIT_MS = 7 * 24 * 60 * 60 * 1000

/** 超过 7 天时按本地时区展示为 YYYY-MM-DD HH:mm:ss。 */
function formatAbsoluteTime(date: Date): string {
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/** 7 天内展示相对时间，超过 7 天展示绝对时间。 */
function formatUpdatedAt(value: string | null | undefined, now: number): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const elapsed = Math.max(0, now - date.getTime())
  if (elapsed >= RELATIVE_TIME_LIMIT_MS) {
    return `${formatAbsoluteTime(date)}更新`
  }

  const totalSeconds = Math.floor(elapsed / 1000)
  if (totalSeconds < 60) return `${totalSeconds}秒前更新`
  const totalMinutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (totalMinutes < 60) return `${totalMinutes}分${seconds}秒前更新`
  const hours = Math.floor(totalMinutes / 60)
  if (hours < 24) return `${hours}小时${totalMinutes % 60}分前更新`
  const days = Math.floor(hours / 24)
  return `${days}天${hours % 24}小时前更新`
}

/** 交付文档底部悬浮状态：气泡悬浮在右下角。 */
export function HandoffDocumentStatus({
  path,
  version,
  updatedAt,
  exists = false,
  loading = false,
}: HandoffDocumentStatusProps) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!updatedAt) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [updatedAt])

  const updatedLabel = formatUpdatedAt(updatedAt, now)
  const detail = loading
    ? '加载中…'
    : exists
      ? `v${version ?? 0}${updatedLabel ? ` · ${updatedLabel}` : ''}`
      : path
        ? '尚未创建'
        : null
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-end px-3">
      <span className="pointer-events-none min-w-0 max-w-full truncate rounded-full bg-background-muted px-3 py-1.5 text-[11px] text-foreground-muted shadow-md">
        {path ? (
          <Link
            to={knowledgeWebPath(path)}
            title="查看交付文档"
            className="pointer-events-auto hover:text-foreground-intense hover:underline"
          >
            交付文档
          </Link>
        ) : (
          '交付文档'
        )}
        {detail ? ` · ${detail}` : null}
      </span>
    </div>
  )
}

/** 任务详情中交付/复盘/任务文档的 Markdown 阅读区；工作台交付 Tab 可切换为编辑态。 */
export function TaskMarkdownDocumentView({
  title,
  subtitle,
  meta,
  actions,
  notice,
  footer,
  content,
  loading = false,
  error,
  emptyText,
  contentKey,
  editing = false,
  editorRef,
}: TaskMarkdownDocumentViewProps) {
  const hasContent = Boolean(content?.trim())
  const editorKey = useMemo(
    () =>
      `${contentKey ?? ''}:${contentFingerprint(content ?? '')}:${
        editing ? 'edit' : 'read'
      }`,
    [content, contentKey, editing],
  )
  return (
    <section className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-none border border-border bg-background">
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
        {(meta || actions) && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs text-foreground-muted">
            {meta}
            {actions}
          </div>
        )}
      </header>

      {notice && (
        <div className="shrink-0 border-b border-border px-4 py-2 text-xs">
          {notice}
        </div>
      )}

      {error && (
        <p
          role="alert"
          className="shrink-0 border-b border-border px-4 py-2 text-xs text-error-foreground"
        >
          文档加载失败：{error}
        </p>
      )}

      {!hasContent && !editing ? (
        <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-sm text-foreground-muted">
          {loading ? '正在加载文档…' : error ? '暂时无法展示文档' : emptyText}
        </div>
      ) : (
        <div className="md-editor-scroll min-h-0 flex-1">
          <MarkdownEditor
            key={editorKey}
            ref={editing ? editorRef : undefined}
            value={content ?? ''}
            readOnly={!editing}
            compact={editing}
            appica={editing}
          />
        </div>
      )}
      {footer}
    </section>
  )
}
