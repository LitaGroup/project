import type { ReactNode } from 'react'
import { domMax, LazyMotion, MotionConfig } from 'framer-motion'

/** 全站动画基础设施：按需加载动画能力，并遵循系统「减少动态效果」设置。 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={domMax}>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  )
}
