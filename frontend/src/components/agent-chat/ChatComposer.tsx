import type { ComponentType, ReactNode } from 'react'
import { Button } from '@appica/ui-react/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@appica/ui-react/tooltip'
import { ArrowUp, Loader, Paperclip, X } from '@appica/icons-react'
import type { WorkerDebugAttachment } from '../../lib/api'

type ChatTone = 'default' | 'success' | 'danger'

const TONE_CLASS: Record<ChatTone, string> = {
  default: '',
  success: 'text-success-foreground',
  danger: 'text-error-foreground',
}

/** 输入区外框（对话框 + 操作栏），两个 AI 交互面板共用同一视觉结构 */
export function ChatComposerFrame({
  top,
  left,
  right,
  children,
  className,
  singleLine = false,
}: {
  top?: ReactNode
  left?: ReactNode
  right?: ReactNode
  children: ReactNode
  className?: string
  /** 操作栏强制单行：右侧区域弹性压缩不换行（按钮较多且面板较窄的场景使用） */
  singleLine?: boolean
}) {
  return (
    <div
      className={`rounded-[var(--radius-lg)] border border-border bg-background focus-within:border-border-strong ${
        className ?? ''
      }`}
    >
      {top}
      {children}
      <div
        className={
          singleLine
            ? 'flex min-h-10 items-center justify-between gap-2 px-2 py-1.5'
            : 'flex min-h-10 flex-wrap items-center justify-between gap-2 px-2 py-1.5'
        }
      >
        <div
          className={
            singleLine
              ? 'flex shrink-0 items-center gap-1'
              : 'flex min-w-0 flex-wrap items-center gap-1'
          }
        >
          {left}
        </div>
        <div
          className={
            singleLine
              ? 'flex min-w-0 flex-1 items-center justify-end gap-1.5'
              : 'flex shrink-0 flex-wrap items-center justify-end gap-1.5'
          }
        >
          {right}
        </div>
      </div>
    </div>
  )
}

/** 输入区底部容器：统一底部分隔线与内边距 */
export function ChatComposerDock({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={`shrink-0 border-t border-border bg-background p-3 ${
        className ?? ''
      }`}
    >
      {children}
    </div>
  )
}

/** 任务/AGENT 操作按钮：只显示图标，悬浮显示名称 */
export function ChatActionIcon({
  label,
  icon: Icon,
  onClick,
  disabled = false,
  busy = false,
  tone = 'default',
}: {
  label: string
  icon: ComponentType<{ className?: string }>
  onClick: () => void
  disabled?: boolean
  busy?: boolean
  tone?: ChatTone
}) {
  return (
    <TooltipProvider delay={200}>
      <Tooltip>
        <TooltipTrigger render={<span className="inline-flex" />}>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            disabled={disabled || busy}
            onClick={onClick}
            className={TONE_CLASS[tone]}
          >
            {busy ? (
              <Loader className="size-4 animate-spin" />
            ) : (
              <Icon className="size-4" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/** 发送按钮：仅一个朝上的箭头 */
export function ChatSendButton({
  onClick,
  disabled = false,
  label = '发送消息',
}: {
  onClick: () => void
  disabled?: boolean
  label?: string
}) {
  return (
    <Button
      type="button"
      variant="primary"
      size="icon-sm"
      className="rounded-full"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      <ArrowUp className="size-4" />
    </Button>
  )
}

/** 已上传附件清单（输入框上方） */
export function ChatAttachmentChips({
  files,
  onRemove,
}: {
  files: WorkerDebugAttachment[]
  onRemove?: (index: number) => void
}) {
  if (files.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5 px-2 pt-2">
      {files.map((file, index) => (
        <span
          key={`${file.url}-${index}`}
          className="inline-flex max-w-full items-center gap-1 rounded-[var(--radius-sm)] bg-background-muted px-2 py-1 text-[11px] text-foreground-emphasis"
        >
          <Paperclip className="size-3 shrink-0" />
          <span className="truncate" title={file.name}>
            {file.name}
          </span>
          {onRemove && (
            <button
              type="button"
              aria-label={`移除附件 ${file.name}`}
              className="shrink-0 rounded-full text-foreground-subtle hover:text-foreground-intense"
              onClick={() => onRemove(index)}
            >
              <X className="size-3" />
            </button>
          )}
        </span>
      ))}
    </div>
  )
}
