import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '@appica/ui-react/badge'
import { Button } from '@appica/ui-react/button'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@appica/ui-react/tabs'
import {
  Check,
  Clock,
  Copy,
  FileText,
  Package,
  Route,
} from '@appica/icons-react'
import type {
  TaskPackage,
  TaskPipelineStage,
} from '../../lib/api'
import { TaskStatusBadge } from '../StatusBadge'
import { MarkdownEditor } from '../MarkdownEditor'
import { SenderLine, WorkerAvatar } from './WorkerAvatar'

interface TaskSidePanelProps {
  task: TaskPackage
  pipeline: TaskPipelineStage[]
}

/**
 * 任务详情页右侧面板：任务详情 + PIPELINE（主任务与各机器人子任务） + 交付物。
 * 交付物同时包含中间机器人产出，便于在验收前回看每一棒交付了什么。
 */
export function TaskSidePanel({ task, pipeline }: TaskSidePanelProps) {
  const [tab, setTab] = useState<'pipeline' | 'detail' | 'deliverables'>(
    'pipeline',
  )
  const deliverables = useMemo(
    () => pipeline.filter((stage) => stage.task.result?.trim()),
    [pipeline],
  )
  const selectedStage =
    pipeline.find((stage) => stage.task.id === task.id) ?? null

  return (
    <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
      <TaskSummary task={task} stage={selectedStage} pipeline={pipeline} />

      <Tabs
        value={tab}
        onValueChange={(value) =>
          setTab(value as 'pipeline' | 'detail' | 'deliverables')
        }
        variant="line"
        className="flex flex-col gap-3"
      >
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="pipeline">流水线 {pipeline.length}</TabsTrigger>
          <TabsTrigger value="detail">详情</TabsTrigger>
          <TabsTrigger value="deliverables">
            交付物 {deliverables.length}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pipeline" className="flex flex-col gap-3">
          {pipeline.map((stage, index) => (
            <PipelineStageCard
              key={stage.task.id}
              stage={stage}
              index={index}
              last={index === pipeline.length - 1}
              selected={stage.task.id === task.id}
              onViewDeliverables={() => setTab('deliverables')}
            />
          ))}
        </TabsContent>

        <TabsContent value="detail" className="flex flex-col gap-3">
          <TaskDetail task={task} />
        </TabsContent>

        <TabsContent value="deliverables" className="flex flex-col gap-3">
          {deliverables.length === 0 ? (
            <EmptyState
              icon={<Package className="size-5" />}
              title="暂无交付物"
              description="机器人执行完成后，最终产出与中间交付物会显示在这里"
            />
          ) : (
            deliverables.map((stage) => (
              <DeliverableCard key={stage.task.id} stage={stage} />
            ))
          )}
        </TabsContent>
      </Tabs>
    </aside>
  )
}

function TaskSummary({
  task,
  stage,
  pipeline,
}: {
  task: TaskPackage
  stage: TaskPipelineStage | null
  pipeline: TaskPipelineStage[]
}) {
  const rootStage = pipeline.find((item) => item.task.id === item.task.rootId)
  return (
    <section className="rounded-[var(--radius-lg)] border border-border bg-background p-4">
      <div className="flex flex-wrap items-center gap-2">
        <TaskStatusBadge status={task.status} subStatus={task.subStatus} />
        <Badge variant="soft" size="sm">
          {task.type}
        </Badge>
        <span className="font-mono text-xs text-foreground-muted">
          {task.code}
        </span>
      </div>
      <h2 className="mt-2 text-base font-semibold text-foreground-intense">
        {task.title}
      </h2>
      {task.parentId && rootStage && (
        <p className="mt-1 text-xs text-foreground-muted">
          所属主任务：
          <Link to={`/tasks/${rootStage.task.id}`} className="underline">
            {rootStage.task.code} {rootStage.task.title}
          </Link>
        </p>
      )}
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
        <InfoRow label="机器人" value={stage?.agent?.name ?? '未分配'} />
        <InfoRow label="调度机器人" value={stage?.scheduler?.name ?? '—'} />
        <InfoRow
          label="创建时间"
          value={new Date(task.createdAt).toLocaleString()}
        />
        <InfoRow
          label="更新时间"
          value={new Date(task.updatedAt).toLocaleString()}
        />
        {task.executorId && (
          <InfoRow label="执行器" value={`#${task.executorId}`} mono />
        )}
        {task.opencodeSessionId && (
          <InfoRow
            label="会话"
            value={task.opencodeSessionId}
            mono
            span={2}
          />
        )}
        {task.acceptedBy && (
          <InfoRow
            label="验收"
            value={`${task.acceptedBy}${task.acceptedAt ? ` · ${new Date(task.acceptedAt).toLocaleString()}` : ''}`}
            span={2}
          />
        )}
        {task.canceledAt && (
          <InfoRow
            label="取消时间"
            value={new Date(task.canceledAt).toLocaleString()}
            span={2}
          />
        )}
      </dl>
    </section>
  )
}

function InfoRow({
  label,
  value,
  mono,
  span,
}: {
  label: string
  value: string
  mono?: boolean
  span?: 2
}) {
  return (
    <div className={span === 2 ? 'col-span-2' : ''}>
      <dt className="text-foreground-subtle">{label}</dt>
      <dd
        className={`mt-0.5 truncate text-foreground-emphasis ${mono ? 'font-mono text-[11px]' : ''}`}
        title={value}
      >
        {value}
      </dd>
    </div>
  )
}

function PipelineStageCard({
  stage,
  index,
  last,
  selected,
  onViewDeliverables,
}: {
  stage: TaskPipelineStage
  index: number
  last: boolean
  selected: boolean
  onViewDeliverables: () => void
}) {
  const task = stage.task
  const running = task.subStatus === '执行中' || task.subStatus === '识别中'
  const dotClass = running
    ? 'animate-pulse bg-info-emphasis'
    : task.subStatus === '完成'
      ? 'bg-success-emphasis'
      : task.subStatus === '取消'
        ? 'bg-error-emphasis'
        : task.subStatus === '待验收' || task.subStatus === '待反馈'
          ? 'bg-warning-emphasis'
          : 'bg-border-strong'
  const sender = stage.agent ?? stage.scheduler
  return (
    <div className="relative pl-6">
      <span
        className={`absolute left-[7px] top-3 z-10 size-2.5 rounded-full ring-4 ring-background ${dotClass}`}
      />
      {!last && (
        <span className="absolute left-[11px] top-5 h-[calc(100%-8px)] w-px bg-border" />
      )}
      <div
        className={`rounded-[var(--radius-lg)] border p-3 ${
          selected
            ? 'border-info-emphasis bg-info-soft/30'
            : 'border-border bg-background'
        }`}
      >
        <div className="flex items-start gap-2.5">
          {sender ? (
            <WorkerAvatar sender={sender} size={30} />
          ) : (
            <span className="flex size-[30px] shrink-0 items-center justify-center rounded-full bg-background-muted text-foreground-muted">
              <Route className="size-4" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-medium text-foreground-intense">
                {sender?.name ?? '未分配机器人'}
              </span>
              {sender?.roleLabel && (
                <span className="text-[10px] text-foreground-subtle">
                  {sender.roleLabel}
                </span>
              )}
              <Badge variant="soft" size="sm">
                {task.parentId ? `阶段 ${index + 1}` : '主任务'}
              </Badge>
              {selected && (
                <Badge variant="info" size="sm">
                  当前
                </Badge>
              )}
            </div>
            <Link
              to={`/tasks/${task.id}`}
              className="mt-1 block truncate text-sm font-medium text-foreground-emphasis hover:underline"
              title={task.title}
            >
              {task.code} {task.title}
            </Link>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-foreground-muted">
              <TaskStatusBadge status={task.status} subStatus={task.subStatus} />
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3" />
                {new Date(task.updatedAt).toLocaleString()}
              </span>
              {task.result?.trim() && (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 underline underline-offset-2"
                  onClick={onViewDeliverables}
                >
                  <FileText className="size-3" />
                  交付物
                </button>
              )}
            </div>
            {task.result?.trim() && (
              <p className="mt-2 line-clamp-2 rounded-[var(--radius-sm)] bg-background-muted px-2 py-1 text-[11px] leading-relaxed text-foreground-muted">
                {plainPreview(task.result)}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/** 交付物预览：去掉 Markdown 标记，让 PIPELINE 卡片保持单行摘要 */
function plainPreview(value: string, limit = 180): string {
  return value
    .replace(/```[\s\S]*?```/g, ' [代码] ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[>*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit)
}

function TaskDetail({ task }: { task: TaskPackage }) {
  return (
    <>
      {task.missingItems && task.missingItems.length > 0 && (
        <section className="rounded-[var(--radius-lg)] border border-warning-emphasis bg-warning-soft p-3 text-xs text-warning-foreground">
          <h3 className="mb-1 font-medium">待反馈事项</h3>
          <ul className="flex list-disc flex-col gap-1 pl-4">
            {task.missingItems.map((item, index) => (
              <li key={index}>
                <span className="font-medium">{item.item}</span>
                {item.reason ? ` — ${item.reason}` : ''}
              </li>
            ))}
          </ul>
        </section>
      )}
      <MarkdownSection title="任务描述" value={task.description} />
      <MarkdownSection title="任务输入" value={task.input} />
      <MarkdownSection title="输出要求" value={task.outputSpec} />
      <MarkdownSection title="工作计划" value={task.workPlan} />
    </>
  )
}

function MarkdownSection({
  title,
  value,
}: {
  title: string
  value: string | null
}) {
  if (!value?.trim()) return null
  return (
    <section className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-background">
      <h3 className="border-b border-border px-3 py-2 text-xs font-medium text-foreground-intense">
        {title}
      </h3>
      <MarkdownEditor
        key={`${title}:${value}`}
        value={value}
        readOnly
        appica
      />
    </section>
  )
}

function DeliverableCard({ stage }: { stage: TaskPipelineStage }) {
  const [copied, setCopied] = useState(false)
  const task = stage.task
  const sender = stage.agent ?? stage.scheduler
  const content = task.result?.trim() ?? ''

  const copy = () => {
    if (!navigator.clipboard) return
    void navigator.clipboard
      .writeText(content)
      .then(() => {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => undefined)
  }

  return (
    <section className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-background">
      <header className="flex items-start gap-2.5 border-b border-border px-3 py-2.5">
        {sender && <WorkerAvatar sender={sender} size={28} />}
        <div className="min-w-0 flex-1">
          <SenderLine
            sender={
              sender ?? {
                id: 'system',
                name: '系统',
                kind: 'system',
                roleLabel: '系统',
              }
            }
          />
          <p className="mt-0.5 truncate text-xs text-foreground-muted">
            {task.code} {task.title}
          </p>
        </div>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="复制交付物"
          onClick={copy}
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </Button>
      </header>
      <MarkdownEditor
        key={`${task.id}:${task.updatedAt}`}
        value={content}
        readOnly
        appica
      />
    </section>
  )
}

function EmptyState({
  icon,
  title,
  description,
}: {
  icon: ReactNode
  title: string
  description: string
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-[var(--radius-lg)] border border-dashed border-border bg-background-muted px-6 py-10 text-center">
      <span className="rounded-full bg-background p-2.5 text-foreground-muted">
        {icon}
      </span>
      <p className="text-sm font-medium text-foreground-intense">{title}</p>
      <p className="max-w-60 text-xs text-foreground-muted">{description}</p>
    </div>
  )
}
