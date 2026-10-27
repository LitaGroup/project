import type { ReactNode } from 'react'
import { domMax, LazyMotion, MotionConfig } from 'framer-motion'

/** 全站动画基础设施：按需加载，按本次 UI 设计持续启用动效。 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={domMax}>
      <MotionConfig reducedMotion="never">{children}</MotionConfig>
    </LazyMotion>
  )
}
