import type { Transition, Variants } from 'framer-motion'

/** 全站动画预设：集中维护节奏，页面不单独散落时长与缓动。 */
export const pageTransition: Transition = {
  duration: 0.16,
  ease: [0.22, 1, 0.36, 1],
}

export const pageVariants: Variants = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
}

export const navIndicatorTransition: Transition = {
  duration: 0.2,
  ease: [0.22, 1, 0.36, 1],
}

/** 任务看板卡片：列表刷新时轻量重排，新增/移除不打断注意力。 */
export const boardCardTransition: Transition = {
  duration: 0.22,
  ease: [0.22, 1, 0.36, 1],
}

export const boardCardVariants: Variants = {
  initial: { opacity: 0, y: 10, scale: 0.985 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -4, scale: 0.985 },
}

/** 看板数字与日志展开的短促过渡，避免 5 秒轮询产生明显跳动。 */
export const boardDetailTransition: Transition = {
  duration: 0.18,
  ease: [0.22, 1, 0.36, 1],
}

/** 本次 UI 设计固定启用动态效果，原生滚动沿用同一视觉配置。 */
export function prefersReducedMotion(): boolean {
  return false
}
