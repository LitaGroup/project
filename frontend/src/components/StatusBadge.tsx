import { Badge } from '@appica/ui-react/badge'
import type { ProjectStatus } from '../lib/api'

const variantByStatus: Record<ProjectStatus, 'info' | 'primary' | 'light' | 'warning'> = {
  计划中: 'info',
  进行中: 'primary',
  已结束: 'light',
  暂停: 'warning',
}

export function StatusBadge({ status }: { status: ProjectStatus }) {
  return <Badge variant={variantByStatus[status] ?? 'light'}>{status}</Badge>
}

/** 缺陷状态 → Badge variant（乱填/未知状态兜底 light） */
const defectVariantByStatus: Record<
  string,
  'info' | 'success' | 'light' | 'warning' | 'secondary'
> = {
  open: 'info',
  reopen: 'warning',
  fixed: 'success',
  closed: 'light',
  invalid: 'secondary',
}

export function DefectStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={defectVariantByStatus[status] ?? 'light'}>{status}</Badge>
  )
}
