import { Badge } from '@appica/ui-react/badge'
import type { ProjectStatus } from '../lib/api'

const variantByStatus: Record<
  ProjectStatus,
  'info' | 'primary' | 'soft' | 'warning' | 'success' | 'secondary'
> = {
  待分配: 'info',
  开发中: 'primary',
  已关闭: 'soft',
  暂停中: 'warning',
  测试中: 'success',
  已发布: 'secondary',
}

export function StatusBadge({ status }: { status: ProjectStatus }) {
  return <Badge variant={variantByStatus[status] ?? 'soft'}>{status}</Badge>
}

/** 提测记录状态 → Badge variant：待冒烟黄 / 已通过绿 / 未通过红（未知兜底 soft） */
const releaseVariantByStatus: Record<
  string,
  'warning' | 'success' | 'error' | 'soft'
> = {
  待冒烟: 'warning',
  已通过: 'success',
  未通过: 'error',
}

export function ReleaseStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={releaseVariantByStatus[status] ?? 'soft'}>{status}</Badge>
  )
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

/** 资源状态 → Badge variant：缺失红 / 草稿黄 / 确认绿 / 废弃淡（未知兜底 soft） */const resourceVariantByStatus: Record<
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

/** 任务包状态 → Badge variant（创建=淡/分发=蓝/执行=青/验收=黄/交付=绿/终态=淡） */
const taskStatusVariant: Record<
  string,
  'info' | 'success' | 'warning' | 'error' | 'soft' | 'primary' | 'secondary'
> = {
  草稿: 'soft',
  待补材料: 'warning',
  待调度: 'info',
  待确认: 'warning',
  已派发: 'info',
  执行中: 'primary',
  待验收: 'warning',
  内部完成: 'success',
  已交付: 'success',
  维护中: 'secondary',
  已取消: 'soft',
}

export function TaskStatusBadge({ status }: { status: string }) {
  return <Badge variant={taskStatusVariant[status] ?? 'soft'}>{status}</Badge>
}

/** 机器人实时状态 → Badge variant：空闲淡 / 工作中绿 / 等待黄 / 验收蓝 */
const workerLiveVariant: Record<
  string,
  'soft' | 'success' | 'warning' | 'info'
> = {
  空闲中: 'soft',
  工作中: 'success',
  等待中: 'warning',
  验收中: 'info',
}

export function WorkerLiveBadge({ status }: { status: string }) {
  const variant = workerLiveVariant[status] ?? 'soft'
  return (
    <Badge variant={variant}>
      <span className="mr-1 inline-block size-1.5 rounded-full bg-current" />
      {status}
    </Badge>
  )
}

/** 执行器在线状态：在线绿 / 离线红 */
export function ExecutorOnlineBadge({ online }: { online: boolean }) {
  return (
    <Badge variant={online ? 'success' : 'error'}>
      {online ? '在线' : '离线'}
    </Badge>
  )
}
