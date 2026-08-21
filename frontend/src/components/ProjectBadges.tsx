import { Badge } from '@appica/ui-react/badge'
import type { ProjectType } from '../lib/api'

type BadgeVariant =
  | 'error'
  | 'primary'
  | 'secondary'
  | 'success'
  | 'warning'
  | 'info'
  | 'light'

const variantByType: Record<ProjectType, BadgeVariant> = {
  活动: 'primary',
  功能: 'success',
  游戏: 'warning',
  数据: 'info',
  后台: 'secondary',
  技术: 'error',
  其它: 'light',
}

export function TypeBadge({ type }: { type: ProjectType }) {
  return <Badge variant={variantByType[type] ?? 'light'}>{type}</Badge>
}

/** 优先级取值仅 S0/P0/P1/P2/- */
const variantByPriority: Record<string, BadgeVariant> = {
  S0: 'error',
  P0: 'warning',
  P1: 'primary',
  P2: 'info',
}

export function PriorityBadge({ priority }: { priority: string }) {
  const variant = variantByPriority[priority]
  if (!variant) return <>{priority || '—'}</>
  return <Badge variant={variant}>{priority}</Badge>
}
