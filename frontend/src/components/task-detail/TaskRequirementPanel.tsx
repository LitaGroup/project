import { ExternalLink } from '@appica/icons-react'
import { Badge } from '@appica/ui-react/badge'
import type { TaskPackage } from '../../lib/api'
import { ChatMarkdown } from '../ChatMarkdown'

/** 从任务现有 Markdown 字段中提取可直接访问的链接（Markdown 链接 + 裸 URL）。 */
function extractRequirementLinks(fields: Array<string | null | undefined>) {
  const links = new Map<string, string>()
  const markdownLink = /(!?)\[([^\]]*)\]\((https?:\/\/[^\s)]+)(?:\s+["'][^"']*["'])?\)/g
  const bareUrl = /https?:\/\/[^\s<>()[\]"']+/g

  for (const field of fields) {
    if (!field?.trim()) continue

    for (const match of field.matchAll(markdownLink)) {
      // 图片不是需求资料链接，跳过 `![alt](url)`
      if (match[1]) continue
      const url = normalizeUrl(match[3])
      if (!url) continue
      links.set(url, match[2].trim() || url)
    }

    for (const match of field.matchAll(bareUrl)) {
      const url = normalizeUrl(match[0])
      if (!url || links.has(url)) continue
      links.set(url, url)
    }
  }

  return Array.from(links, ([url, label]) => ({ url, label }))
}

function normalizeUrl(value: string) {
  const trimmed = value.trim().replace(/[.,;:!?，。；：！？]+$/, '')
  try {
    const url = new URL(trimmed)
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.toString()
      : null
  } catch {
    return null
  }
}

function nonEmpty(...values: Array<string | null | undefined>) {
  return values.find((value) => Boolean(value?.trim())) ?? null
}

function formatDateTime(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : null
}

/**
 * 任务详情「需求」Tab：把任务现有字段整理为只读需求视图。
 * 不新增持久化字段，链接从已有 Markdown 中提取。
 */
export function TaskRequirementPanel({ task }: { task: TaskPackage }) {
  const originalRequirement = nonEmpty(task.input, task.description)
  const organizedRequirement = nonEmpty(task.content)
  const deliveryExpectation = nonEmpty(task.outputSpec)
  const links = extractRequirementLinks([
    task.input,
    task.description,
    task.content,
    task.outputSpec,
    task.workPlan,
  ])
  const completedAt = formatDateTime(task.acceptedAt ?? task.deliveredAt)

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-[var(--radius-lg)] border border-border bg-background">
      <header className="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground-intense">
            任务需求
          </h2>
          <p className="mt-1 break-words text-xs text-foreground-muted">
            {task.title}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={originalRequirement ? 'soft' : 'outline'} size="sm">
            原始需求
          </Badge>
          <Badge variant={organizedRequirement ? 'success' : 'outline'} size="sm">
            {organizedRequirement ? '已整理' : '待整理'}
          </Badge>
          <Badge variant="secondary" size="sm">
            {links.length} 个链接
          </Badge>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-4 p-4">
          <dl className="grid gap-x-5 gap-y-3 rounded-[var(--radius-md)] bg-background-muted px-3 py-3 text-xs sm:grid-cols-2 xl:grid-cols-4">
            <RequirementMeta label="任务编号" value={task.code} mono />
            <RequirementMeta label="任务类型" value={task.type} />
            <RequirementMeta
              label="任务定义"
              value={task.templateName ?? '未设置'}
            />
            <RequirementMeta
              label="创建时间"
              value={formatDateTime(task.createdAt) ?? '—'}
            />
          </dl>

          <RequirementSection
            title="原始需求"
            emptyText="暂未记录原始需求"
            value={originalRequirement}
          />

          {links.length > 0 && (
            <section>
              <SectionTitle title="相关链接" count={links.length} />
              <ul className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-border p-2">
                {links.map((link) => (
                  <li key={link.url}>
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex min-w-0 items-start gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 no-underline transition-colors hover:bg-background-muted"
                    >
                      <ExternalLink className="mt-0.5 size-3.5 shrink-0 text-foreground-subtle" />
                      <span className="min-w-0">
                        <span className="block break-words text-sm text-foreground-intense underline decoration-border-strong underline-offset-2">
                          {link.label}
                        </span>
                        {link.label !== link.url && (
                          <span className="mt-0.5 block break-all font-mono text-[11px] text-foreground-subtle">
                            {link.url}
                          </span>
                        )}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <RequirementSection
            title="整理后的需求"
            emptyText="暂未生成整理后的需求，可由执行机器人或 AI 补充"
            value={organizedRequirement}
            emphasized
          />

          <div className="grid gap-4 lg:grid-cols-2">
            <RequirementSection
              title="交付预期"
              emptyText="暂未记录交付预期"
              value={deliveryExpectation}
            />

            <section className="min-w-0">
              <SectionTitle title="完成时间预期" />
              <div className="min-h-20 rounded-[var(--radius-md)] bg-background-muted px-3 py-2.5 text-sm text-foreground-emphasis">
                <p className="text-foreground-subtle">
                  当前任务未单独记录预期完成时间，请参考整理后的需求与交付预期中的时间说明。
                </p>
                {completedAt && (
                  <p className="mt-2 text-xs text-foreground-muted">
                    实际完成时间：{completedAt}
                  </p>
                )}
              </div>
            </section>
          </div>
        </div>
      </div>
    </section>
  )
}

function RequirementMeta({
  label,
  value,
  mono = false,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="min-w-0">
      <dt className="text-foreground-subtle">{label}</dt>
      <dd
        className={`mt-0.5 break-words text-foreground-emphasis ${mono ? 'font-mono text-[11px]' : ''}`}
        title={value}
      >
        {value}
      </dd>
    </div>
  )
}

function SectionTitle({ title, count }: { title: string; count?: number }) {
  return (
    <h3 className="mb-1 flex items-center gap-2 text-xs font-medium text-foreground-muted">
      <span>{title}</span>
      {typeof count === 'number' && (
        <span className="text-foreground-subtle">({count})</span>
      )}
    </h3>
  )
}

function RequirementSection({
  title,
  value,
  emptyText,
  emphasized = false,
}: {
  title: string
  value: string | null
  emptyText: string
  emphasized?: boolean
}) {
  return (
    <section className="min-w-0">
      <SectionTitle title={title} />
      <div
        className={`rounded-[var(--radius-md)] px-3 py-2.5 text-sm text-foreground-emphasis ${
          emphasized
            ? 'border border-border bg-background'
            : 'bg-background-muted'
        }`}
      >
        {value ? (
          <ChatMarkdown text={value} />
        ) : (
          <span className="text-xs text-foreground-subtle">{emptyText}</span>
        )}
      </div>
    </section>
  )
}
