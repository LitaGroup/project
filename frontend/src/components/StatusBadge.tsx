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

/** 资源状态 → Badge variant：缺失红 / 草稿黄 / 确认绿 / 废弃淡（未知兜底 soft） */
const resourceVariantByStatus: Record<
  string,
  'error' | 'success' | 'soft' | 'warning' | 'secondary'
> = {
  缺失: 'error',
  草稿: 'warning',
  确认: 'success',
  废弃: 'secondary',
}

export function ResourceStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={resourceVariantByStatus[status] ?? 'soft'}>{status}</Badge>
  )
}

/** 节点状态 → Badge variant：准备中蓝 / 提前达成、达成绿 / 延期红 / 取消淡（未知兜底 soft） */
const milestoneVariantByStatus: Record<
  string,
  'info' | 'success' | 'error' | 'soft'
> = {
  准备中: 'info',
  提前达成: 'success',
  达成: 'success',
  延期: 'error',
  取消: 'soft',
}

export function MilestoneStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={milestoneVariantByStatus[status] ?? 'soft'}>{status}</Badge>
  )
}
