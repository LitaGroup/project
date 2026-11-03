import { useEffect, useState } from 'react'
import { Badge } from '@appica/ui-react/badge'
import {
  api,
  type TaskDocumentContent,
  type TaskDocumentsView,
} from '../../lib/api'
import { TaskMarkdownDocumentView } from './TaskMarkdownDocumentView'

interface TaskDocumentsPanelProps {
  taskId: number
  data: TaskDocumentsView | null
  loading: boolean
  error: string | null
  /** SSE 文档刷新版本，用于重读当前选中文档正文 */
  revision: number
}

/**
 * 任务详情「文档」Tab：任务目录下全部 Markdown 文档 + 文档引用的图片/文件。
 * 文档清单由父页面按任务 SSE 刷新，正文按当前选中项读取。
 */
export function TaskDocumentsPanel({
  taskId,
  data,
  loading,
  error,
  revision,
}: TaskDocumentsPanelProps) {
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const [content, setContent] = useState<TaskDocumentContent | null>(null)
  const [contentLoading, setContentLoading] = useState(false)
  const [contentError, setContentError] = useState<string | null>(null)

  const documents = data?.documents ?? []
  const artifacts = data?.artifacts ?? []
  const images = artifacts.filter((artifact) => artifact.kind === 'image')
  const files = artifacts.filter((artifact) => artifact.kind === 'file')
  const selectedDocument =
    documents.find((doc) => doc.name === selectedName) ?? documents[0] ?? null
  const activeName = selectedDocument?.name ?? null
  const preview = content?.name === activeName ? content : null

  useEffect(() => {
    if (!activeName) return
    let active = true
    // oxlint-disable-next-line react/set-state-in-effect
    setContentLoading(true)
    setContentError(null)
    api
      .getTaskDocument(taskId, activeName)
      .then((next) => {
        if (active) setContent(next)
      })
      .catch((e: Error) => {
        if (active) {
          setContent(null)
          setContentError(e.message)
        }
      })
      .finally(() => {
        if (active) setContentLoading(false)
      })
    return () => {
      active = false
    }
  }, [taskId, activeName, revision])

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-[var(--radius-lg)] border border-border bg-background">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-foreground-intense">
            任务文档
          </h2>
          <Badge variant="soft" size="sm">
            {documents.length} 个文档 · {artifacts.length} 个产物
          </Badge>
        </div>
        <span
          className="min-w-0 truncate font-mono text-[11px] text-foreground-muted"
          title={data?.directory ?? ''}
        >
          {data?.directory ?? '任务目录'}
        </span>
      </header>

      {error && (
        <p
          role="alert"
          className="shrink-0 border-b border-border px-4 py-2 text-xs text-error-foreground"
        >
          文档清单加载失败：{error}
        </p>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 max-lg:grid-rows-[240px_minmax(320px,1fr)] lg:grid-cols-[250px_minmax(0,1fr)]">
        <aside className="min-h-0 overflow-y-auto border-b border-border p-2 lg:border-r lg:border-b-0">
          {loading && documents.length === 0 ? (
            <p className="p-2 text-xs text-foreground-muted">正在加载文档…</p>
          ) : documents.length === 0 ? (
            <p className="p-2 text-xs text-foreground-muted">暂无任务文档</p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {documents.map((doc) => {
                const active = doc.name === activeName
                return (
                  <li key={doc.path}>
                    <button
                      type="button"
                      onClick={() => setSelectedName(doc.name)}
                      className={`w-full rounded-[var(--radius-md)] px-2.5 py-2 text-left transition-colors ${
                        active
                          ? 'bg-background-muted text-foreground-intense'
                          : 'text-foreground-muted hover:bg-background-muted hover:text-foreground-intense'
                      }`}
                    >
                      <span className="block truncate text-sm">{doc.name}</span>
                      <span className="mt-0.5 block truncate text-[11px] text-foreground-subtle">
                        {doc.updatedAt
                          ? new Date(doc.updatedAt).toLocaleString()
                          : '未知更新时间'}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}

          {images.length > 0 && (
            <section className="mt-3 border-t border-border pt-3">
              <h3 className="mb-2 px-1 text-xs font-medium text-foreground-muted">
                图片（{images.length}）
              </h3>
              <div className="grid grid-cols-2 gap-2">
                {images.map((image) => (
                  <a
                    key={image.url}
                    href={image.url}
                    target="_blank"
                    rel="noreferrer"
                    className="group min-w-0 rounded-[var(--radius-md)] border border-border bg-background p-1"
                    title={`${image.name} · 来自 ${image.sourceDocument}`}
                  >
                    <img
                      src={image.url}
                      alt={image.name}
                      className="h-20 w-full rounded-[var(--radius-sm)] object-cover"
                      loading="lazy"
                    />
                    <span className="mt-1 block truncate px-0.5 text-[10px] text-foreground-muted">
                      {image.name}
                    </span>
                  </a>
                ))}
              </div>
            </section>
          )}

          {files.length > 0 && (
            <section className="mt-3 border-t border-border pt-3">
              <h3 className="mb-2 px-1 text-xs font-medium text-foreground-muted">
                文件（{files.length}）
              </h3>
              <ul className="flex flex-col gap-1">
                {files.map((file) => (
                  <li key={file.url} className="min-w-0">
                    <a
                      href={file.url}
                      download
                      target="_blank"
                      rel="noreferrer"
                      className="block rounded-[var(--radius-md)] px-2 py-1.5 text-xs text-foreground-emphasis hover:bg-background-muted"
                      title={`${file.name} · 来自 ${file.sourceDocument}`}
                    >
                      <span className="block truncate underline">
                        {file.name}
                      </span>
                      <span className="mt-0.5 block truncate text-[10px] text-foreground-subtle">
                        {file.sourceDocument}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>

        <div className="min-h-0 min-w-0 p-2">
          {selectedDocument ? (
            <TaskMarkdownDocumentView
              title={selectedDocument.name}
              subtitle={selectedDocument.path}
              meta={
                selectedDocument.updatedAt
                  ? `更新于 ${new Date(
                      selectedDocument.updatedAt,
                    ).toLocaleString()}`
                  : null
              }
              content={preview?.content}
              loading={contentLoading}
              error={contentError}
              emptyText="文档内容为空"
              contentKey={`${selectedDocument.path}:${selectedDocument.updatedAt ?? ''}:${preview?.updatedAt ?? ''}:${preview?.content.length ?? 0}`}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-foreground-muted">
              选择左侧文档查看内容
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
