// Adapted from beUI, MIT License. Copyright (c) 2026 Saurabh Chauhan.
// https://github.com/starc007/ui-components/blob/main/components/motion/action-swap.tsx

import type { ReactNode } from 'react'
import { AnimatePresence, m } from 'framer-motion'
import { cx, EASE_OUT, SPRING_SWAP } from './presets'

export interface ActionSwapProps {
  children: ReactNode
  swapKey: string | number
  className?: string
}

/** A decorative slot inside the existing button; it owns no action state. */
export function ActionSwapIcon({ children, swapKey, className }: ActionSwapProps) {
  return (
    <span
      aria-hidden="true"
      data-slot="action-swap-icon"
      className={cx('relative inline-grid shrink-0 place-items-center overflow-hidden', className)}
    >
      <AnimatePresence initial={false} mode="popLayout">
        <m.span
          key={swapKey}
          initial={{ opacity: 0, scale: 0.4, filter: 'blur(2px)' }}
          animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
          exit={{ opacity: 0, scale: 0.4, filter: 'blur(2px)', transition: { duration: 0.14, ease: EASE_OUT } }}
          transition={SPRING_SWAP}
          className="col-start-1 row-start-1 inline-flex items-center justify-center"
        >
          {children}
        </m.span>
      </AnimatePresence>
    </span>
  )
}

/** Only the displayed label changes; the enclosing button keeps its handlers. */
export function ActionSwapText({ children, swapKey, className }: ActionSwapProps) {
  return (
    <span
      data-slot="action-swap-text"
      className={cx('relative inline-block max-w-full whitespace-nowrap align-bottom', className)}
      style={{ clipPath: 'inset(0 -999px)' }}
    >
      <span className="sr-only">{children}</span>
      <span aria-hidden="true" className="invisible inline-block whitespace-nowrap">
        {children}
      </span>
      <AnimatePresence initial={false}>
        <m.span
          key={swapKey}
          aria-hidden="true"
          initial={{ opacity: 0, y: '90%', filter: 'blur(2px)' }}
          animate={{ opacity: 1, y: '0%', filter: 'blur(0px)' }}
          exit={{ opacity: 0, y: '-90%', filter: 'blur(2px)', transition: { duration: 0.14, ease: EASE_OUT } }}
          transition={SPRING_SWAP}
          className="absolute inset-x-0 top-0 inline-block max-w-full truncate"
        >
          {children}
        </m.span>
      </AnimatePresence>
    </span>
  )
}
