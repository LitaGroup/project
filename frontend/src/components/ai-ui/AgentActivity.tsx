import type { CSSProperties } from 'react'
import './agent-activity.css'

/**
 * Grid-only adaptation of Beautiful UI's LoadingState (MIT).
 * Copyright (c) 2026 Shane Levine.
 * https://github.com/slev12397/beautiful-ui/blob/main/components/primitives/LoadingState.tsx
 */
const GRID_CYCLE_MS = 650
const GOLDEN_PHASE = 0.61803398875
const CELL_DELAYS = [90, 180, 270, 0, 90, 180, 90, 180, 270]

export function AgentActivity({
  className = '',
  animationSeed = 0,
}: {
  className?: string
  animationSeed?: number
}) {
  const phase = ((animationSeed * GOLDEN_PHASE) % 1) * GRID_CYCLE_MS
  return (
    <span
      aria-hidden
      className={`agent-activity ${className}`}
      style={{ '--ai-grid-duration': `${GRID_CYCLE_MS}ms` } as CSSProperties}
    >
      {CELL_DELAYS.map((delay, index) => (
        <span key={index} style={{ animationDelay: `${delay - phase}ms` }} />
      ))}
    </span>
  )
}
