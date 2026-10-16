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

/** 缺陷状态 → Badge variant：开放红 / 修复蓝 / 关闭绿（未知兜底 soft） */
const defectVariantByStatus: Record<
  string,
  'info' | 'success' | 'error' | 'soft' | 'warning' | 'secondary'
> = {
  开放: 'error',
  修复: 'info',
  关闭: 'success',
}

export function DefectStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={defectVariantByStatus[status] ?? 'soft'}>{status}</Badge>
  )
}

/** 缺陷优先级 → Badge variant：高红 / 中黄 / 低淡（未知兜底 soft） */
const defectPriorityVariant: Record<
  string,
  'error' | 'warning' | 'soft'
> = {
  高: 'error',
  中: 'warning',
  低: 'soft',
}

export function DefectPriorityBadge({ priority }: { priority: string }) {
  return (
    <Badge variant={defectPriorityVariant[priority] ?? 'soft'}>
      {priority}
    </Badge>
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

/** 代码分支归类 → Badge variant：后端蓝 / H5 青 / 安卓绿 / IOS 紫 / 其它淡（未知兜底 soft） */
const codeBranchVariantByCategory: Record<
  string,
  'info' | 'success' | 'primary' | 'secondary' | 'soft'
> = {
  后端: 'info',
  H5: 'primary',
  安卓: 'success',
  IOS: 'secondary',
  其它: 'soft',
}

export function CodeBranchCategoryBadge({ category }: { category: string }) {
  return (
    <Badge variant={codeBranchVariantByCategory[category] ?? 'soft'}>
      {category}
    </Badge>
  )
}
