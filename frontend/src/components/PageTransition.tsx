import type { ReactNode } from 'react'
import { m } from 'framer-motion'
import { pageTransition, pageVariants } from '../lib/motion'

/** 内容区轻量进入：只动页面内容，不移动顶栏和侧栏。 */
export function PageTransition({
  pageKey,
  children,
}: {
  pageKey: string
  children: ReactNode
}) {
  return (
    <m.div
      key={pageKey}
      className="h-full"
      variants={pageVariants}
      initial="initial"
      animate="animate"
      transition={pageTransition}
    >
      {children}
    </m.div>
  )
}
