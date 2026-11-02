/** opencode 思考等级（variant）展示名 */
const VARIANT_LABELS: Record<string, string> = {
  none: '关闭',
  off: '关闭',
  disabled: '关闭',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
  max: '最大',
  thinking: '思考',
  on: '开启',
  enabled: '开启',
};

/** 思考等级展示名：未知变体直接显示 id */
export function variantLabel(id: string): string {
  return VARIANT_LABELS[id] ?? id;
}
