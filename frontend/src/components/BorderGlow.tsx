import type { CSSProperties, ReactNode } from 'react'
import './border-glow.css'
import './gemini-glow.css'

const BORDER_GLOW_DURATION = 6
const DURATION_VARIATION_STEP = 0.08
const DURATION_VARIANTS = 13
const GOLDEN_PHASE = 0.61803398875

type MotionStyle = CSSProperties & {
  '--task-motion-phase': number
  '--task-motion-duration': string
  '--task-motion-delay': string
}

/**
 * A softly concentrated spectrum rotates around a thin, uninterrupted ring.
 * Visual reference: https://design.google/library/gemini-ai-visual-design
 */
export function BorderGlow({
  children,
  animationSeed,
  className = '',
}: {
  children: ReactNode
  animationSeed: number
  className?: string
}) {
  const phase = (animationSeed * GOLDEN_PHASE) % 1
  const duration =
    BORDER_GLOW_DURATION +
    (((animationSeed * 37) % DURATION_VARIANTS) - 6) * DURATION_VARIATION_STEP
  const motionStyle: MotionStyle = {
    '--task-motion-phase': phase,
    '--task-motion-duration': `${duration}s`,
    '--task-motion-delay': `${-phase * duration}s`,
  }

  return (
    <div className={`border-glow ${className}`} style={motionStyle}>
      <span aria-hidden className="border-glow__aura" />
      <span aria-hidden className="border-glow__ring" />
      <div className="border-glow__content">{children}</div>
    </div>
  )
}
