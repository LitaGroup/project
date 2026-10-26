import {
  Avatar,
  AvatarFallback,
} from '@appica/ui-react/avatar'
import { Route, Robot, User } from '@appica/icons-react'
import type { TaskChatSender } from '../../lib/api'

/** 不同机器人使用不同头像底色；按 workerId 稳定取色，避免每次渲染跳色 */
const WORKER_TONES = [
  'bg-info-soft text-foreground-intense',
  'bg-success-soft text-foreground-intense',
  'bg-warning-soft text-foreground-intense',
  'bg-error-soft text-foreground-intense',
  'bg-primary-soft text-foreground-intense',
  'bg-background-strong text-foreground-intense',
] as const

function toneOf(sender: TaskChatSender): string {
  if (sender.kind === 'user') return 'bg-primary text-primary-foreground'
  if (sender.kind === 'scheduler')
    return 'bg-info-soft text-foreground-intense'
  if (sender.kind === 'system')
    return 'bg-background-muted text-foreground-emphasis'
  const index = Math.abs(sender.workerId ?? sender.id.length) % WORKER_TONES.length
  return WORKER_TONES[index]
}

interface WorkerAvatarProps {
  sender: TaskChatSender
  size?: number
  className?: string
}

/** 对话/PIPELINE 共用的发送方头像：机器人首字 + 稳定底色，调度器/系统带图标 */
export function WorkerAvatar({
  sender,
  size = 32,
  className = '',
}: WorkerAvatarProps) {
  const icon =
    sender.kind === 'scheduler' ? (
      <Route className="size-[55%]" />
    ) : sender.kind === 'system' ? (
      <Robot className="size-[55%]" />
    ) : sender.kind === 'user' ? (
      <User className="size-[55%]" />
    ) : null

  return (
    <Avatar size={size} className={`shrink-0 ${className}`}>
      {icon ? (
        <AvatarFallback className={`${toneOf(sender)} font-medium`}>
          {icon}
        </AvatarFallback>
      ) : (
        <AvatarFallback className={`${toneOf(sender)} font-medium`}>
          {sender.name.trim().slice(0, 1) || '?'}
        </AvatarFallback>
      )}
    </Avatar>
  )
}

/** 头像 + 名称 + 角色标签，供消息头部与阶段卡片复用 */
export function SenderLine({
  sender,
  time,
  align = 'left',
}: {
  sender: TaskChatSender
  time?: string
  align?: 'left' | 'right'
}) {
  return (
    <div
      className={`flex items-center gap-2 text-xs ${align === 'right' ? 'justify-end' : ''}`}
    >
      <span className="font-medium text-foreground-intense">{sender.name}</span>
      {sender.roleLabel && (
        <span className="rounded-full bg-background-muted px-1.5 py-0.5 text-[10px] text-foreground-muted">
          {sender.roleLabel}
        </span>
      )}
      {time && (
        <time className="text-[11px] text-foreground-subtle">
          {new Date(time).toLocaleString()}
        </time>
      )}
    </div>
  )
}
