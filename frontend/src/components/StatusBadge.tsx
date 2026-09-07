import { Badge } from '@appica/ui-react/badge'
import type { ProjectStatus } from '../lib/api'

const variantByStatus: Record<ProjectStatus, 'info' | 'primary' | 'soft' | 'warning'> = {
  计划中: 'info',
  进行中: 'primary',
  已结束: 'soft',
  暂停: 'warning',
}

export function StatusBadge({ status }: { status: ProjectStatus }) {
  return <Badge variant={variantByStatus[status] ?? 'soft'}>{status}</Badge>
}

/** 缺陷状态 → Badge variant（乱填/未知状态兜底 soft） */
const defectVariantByStatus: Record<
  string,
  'info' | 'success' | 'soft' | 'warning' | 'secondary'
> = {
  open: 'info',
  reopen: 'warning',
  fixed: 'success',
  closed: 'soft',
  invalid: 'secondary',
}

export function DefectStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={defectVariantByStatus[status] ?? 'soft'}>{status}</Badge>
  )
}
