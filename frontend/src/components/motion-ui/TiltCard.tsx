// Adapted from beUI, MIT License. Copyright (c) 2026 Saurabh Chauhan.
// https://github.com/starc007/ui-components/blob/main/components/motion/tilt-card.tsx

import type { PointerEvent, ReactNode } from 'react'
import { m, useMotionTemplate, useMotionValue, useSpring } from 'framer-motion'
import { cx, SPRING_MOUSE } from './presets'

export interface TiltCardProps {
  children: ReactNode
  className?: string
  maxTilt?: number
}

/** A low-amplitude inner wrapper; it adds no translation, scale, or clipping. */
export function TiltCard({ children, className, maxTilt = 2 }: TiltCardProps) {
  const limit = Number.isFinite(maxTilt) ? Math.min(2, Math.max(0, maxTilt)) : 2
  const rotateX = useMotionValue(0)
  const rotateY = useMotionValue(0)
  const springX = useSpring(rotateX, SPRING_MOUSE)
  const springY = useSpring(rotateY, SPRING_MOUSE)
  const transform = useMotionTemplate`perspective(1000px) rotateX(${springX}deg) rotateY(${springY}deg)`

  const followPointer = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') return
    const rect = event.currentTarget.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
    const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))
    rotateX.set((0.5 - y) * limit * 2)
    rotateY.set((x - 0.5) * limit * 2)
  }

  const settle = () => {
    rotateX.set(0)
    rotateY.set(0)
  }

  return (
    <m.div
      data-slot="tilt-card"
      onPointerMove={followPointer}
      onPointerLeave={settle}
      onPointerCancel={settle}
      style={{ transform, transformStyle: 'preserve-3d', transformOrigin: '50% 50%' }}
      className={cx('relative', className)}
    >
      {children}
    </m.div>
  )
}
