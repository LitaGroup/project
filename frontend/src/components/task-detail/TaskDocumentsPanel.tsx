import { useMemo } from 'react'
import { Badge } from '@appica/ui-react/badge'
import type { TaskDocumentEntry, TaskDocumentsView } from '../../lib/api'

interface TaskDocumentsPanelProps {
  data: TaskDocumentsView | null
  loading: boolean
  error: string | null
}

/** 文档按来源任务分组：第一组为当前任务，其后是各子任务（深度优先）。 */
interface TaskDocumentGroup {
  key: string
  label: string
  /** 是否当前任务分组 */
  current: boolean
  documents: TaskDocumentEntry[]
}

function groupTaskDocuments(
  data: TaskDocumentsView | null,
): TaskDocumentGroup[] {
  const groups: TaskDocumentGroup[] = []
  const indexes = new Map<string, number>()
  for (const doc of data?.documents ?? []) {
    const key = doc.taskId != null ? `task:${doc.taskId}` : 'self'
    let index = indexes.get(key)
    if (index == null) {
      const current =
        doc.taskId != null && data?.taskId != null
          ? doc.taskId === data.taskId
          : groups.length === 0
      const label = current
        ? '当前任务'
        : [doc.taskCode, doc.taskTitle].filter(Boolean).join(' ') || '子任务'
      index = groups.length
      indexes.set(key, index)
      groups.push({ key, label, current, documents: [] })
    }
    groups[index].documents.push(doc)
  }
  return groups
}

/**
 * 任务详情「文档」Tab：展示当前任务与全部子任务（递归）的文档索引，按来源任务分组。
 * 每条展示标题、描述（存在时）与文件路径；点击后新窗口打开文档详情页。
 * 文档中引用的图片/文件保留为链接清单，不再在 Tab 内预览正文。
 */
export function TaskDocumentsPanel({
  data,
  loading,
  error,
}: TaskDocumentsPanelProps) {
  const groups = useMemo(() => groupTaskDocuments(data), [data])
  const documents = data?.documents ?? []
  const artifacts = data?.artifacts ?? []
  const images = artifacts.filter((artifact) => artifact.kind === 'image')
  const files = artifacts.filter((artifact) => artifact.kind === 'file')

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

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {loading && documents.length === 0 ? (
          <p className="px-1 py-2 text-sm text-foreground-muted">
            正在加载文档…
          </p>
        ) : groups.length === 0 ? (
          <p className="px-1 py-2 text-sm text-foreground-muted">
            暂无任务文档
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {groups.map((group) => (
              <section key={group.key} className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <h3 className="text-xs font-medium text-foreground-muted">
                    {group.label}
                  </h3>
                  {group.current && (
                    <Badge variant="soft" size="sm">
                      当前
                    </Badge>
                  )}
                </div>
                <ul className="flex flex-col gap-2">
                  {group.documents.map((doc) => (
                    <li key={doc.path}>
                      <a
                        href={doc.url}
                        target="_blank"
                        rel="noreferrer"
                        className="block rounded-[var(--radius-md)] border border-border bg-background px-3 py-2.5 no-underline transition-colors hover:border-border-strong hover:bg-background-muted"
                        title={doc.path}
                      >
                        <span className="block break-words text-sm font-medium text-foreground-intense underline decoration-border-strong underline-offset-2">
                          {doc.title || doc.name}
                        </span>
                        {doc.description && (
                          <span className="mt-1 block break-words text-xs leading-relaxed text-foreground-muted">
                            {doc.description}
                          </span>
                        )}
                        <span className="mt-1 block break-all font-mono text-[11px] text-foreground-subtle">
                          {doc.path}
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}

        {images.length > 0 && (
          <section className="mt-4 border-t border-border pt-3">
            <h3 className="mb-2 text-xs font-medium text-foreground-muted">
              图片（{images.length}）
            </h3>
            <ul className="flex flex-col gap-1.5">
              {images.map((image) => (
                <li key={image.url}>
                  <a
                    href={image.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block rounded-[var(--radius-md)] px-2 py-1.5 no-underline hover:bg-background-muted"
                    title={image.url}
                  >
                    <span className="block break-words text-xs text-foreground-emphasis underline decoration-border-strong underline-offset-2">
                      {image.name}
                      {image.taskCode &&
                        image.taskId != null &&
                        image.taskId !== data?.taskId && (
                          <span className="ml-1 text-[10px] text-foreground-subtle no-underline">
                            {image.taskCode}
                          </span>
                        )}
                    </span>
                    <span className="mt-0.5 block break-all font-mono text-[10px] text-foreground-subtle">
                      {image.url}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        {files.length > 0 && (
          <section className="mt-4 border-t border-border pt-3">
            <h3 className="mb-2 text-xs font-medium text-foreground-muted">
              文件（{files.length}）
            </h3>
            <ul className="flex flex-col gap-1.5">
              {files.map((file) => (
                <li key={file.url}>
                  <a
                    href={file.url}
                    download
                    target="_blank"
                    rel="noreferrer"
                    className="block rounded-[var(--radius-md)] px-2 py-1.5 no-underline hover:bg-background-muted"
                    title={file.url}
                  >
                    <span className="block break-words text-xs text-foreground-emphasis underline decoration-border-strong underline-offset-2">
                      {file.name}
                      {file.taskCode &&
                        file.taskId != null &&
                        file.taskId !== data?.taskId && (
                          <span className="ml-1 text-[10px] text-foreground-subtle no-underline">
                            {file.taskCode}
                          </span>
                        )}
                    </span>
                    <span className="mt-0.5 block break-all font-mono text-[10px] text-foreground-subtle">
                      {file.url}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </section>
  )
}
