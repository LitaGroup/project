import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from '@appica/ui-react/avatar'
import { PlugConnected, Robot, User } from '@appica/icons-react'
import type { TaskChatSender } from '../../lib/api'

/** 用户/系统消息的底色（机器人头像走 RobotAvatar，不使用配色轮换） */
const SENDER_TONES: Record<'user' | 'system', string> = {
  user: 'bg-primary text-primary-foreground',
  system: 'bg-background-muted text-foreground-emphasis',
}

function toneOf(sender: TaskChatSender): string {
  return SENDER_TONES[sender.kind as 'user' | 'system'] ?? 'bg-background-muted text-foreground-emphasis'
}

interface RobotAvatarProps {
  name: string
  avatarUrl?: string | null
  size?: number
  className?: string
  /** 已绑定独立飞书应用：右下角小角标 */
  feishu?: boolean
}

/**
 * 机器人头像（机器人/调度机器人通用）：
 * 设置了头像显示图片；未设置或加载失败显示纯黑占位（黑图）+ 一圈边框。
 * feishu=true 时右下角叠加「已连接飞书」小角标。
 */
export function RobotAvatar({
  name,
  avatarUrl,
  size = 32,
  className = '',
  feishu = false,
}: RobotAvatarProps) {
  const badge = Math.max(12, Math.round(size * 0.42))
  return (
    <span
      className={`relative inline-flex shrink-0 ${className}`}
      style={{ width: size, height: size }}
    >
      <Avatar size={size} className="shrink-0">
        {avatarUrl ? <AvatarImage src={avatarUrl} alt={name} /> : null}
        <AvatarFallback className="worker-avatar-empty ring-1 ring-border-strong" />
      </Avatar>
      {feishu && (
        <span
          title="已连接飞书"
          className="absolute -right-1 -bottom-1 flex items-center justify-center rounded-full border border-border bg-background"
          style={{ width: badge, height: badge }}
        >
          <PlugConnected className="size-[62%] text-foreground-intense" />
        </span>
      )}
    </span>
  )
}

interface WorkerAvatarProps {
  sender: TaskChatSender
  size?: number
  className?: string
}

/** 对话/PIPELINE 共用的发送方头像：机器人走 RobotAvatar，用户/系统保留图标样式 */
export function WorkerAvatar({
  sender,
  size = 32,
  className = '',
}: WorkerAvatarProps) {
  if (sender.kind === 'worker' || sender.kind === 'scheduler') {
    return (
      <RobotAvatar
        name={sender.name}
        avatarUrl={sender.avatarUrl}
        size={size}
        className={className}
      />
    )
  }

  const icon =
    sender.kind === 'system' ? (
      <Robot className="size-[55%]" />
    ) : sender.kind === 'user' ? (
      <User className="size-[55%]" />
    ) : null

  return (
    <Avatar size={size} className={`shrink-0 ${className}`}>
      <AvatarFallback className={`${toneOf(sender)} font-medium`}>
        {icon ?? (sender.name.trim().slice(0, 1) || '?')}
      </AvatarFallback>
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
