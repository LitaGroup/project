/**
 * 历史工单类别（旧调度模型遗留）。
 * 工单已改为工作流模型（节点直接绑定任务定义），不再按类别绑定调度定义；
 * 此清单仅用于存量工单的 category 筛选与展示兼容。
 */
export const TICKET_CATEGORIES: readonly string[] = [
  '方案工单',
  '技术工单',
  '数据工单',
  '运维工单',
  '需求工单',
  'BUG反馈',
];

/** 类别存在返回类别名，否则 null（用于筛选参数校验） */
export function findTicketCategory(
  category: string | null | undefined,
): string | null {
  const value = (category ?? '').trim();
  if (!value) return null;
  return TICKET_CATEGORIES.find((item) => item === value) ?? null;
}
