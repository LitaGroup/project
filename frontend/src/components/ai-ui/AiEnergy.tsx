import type { CSSProperties } from 'react'
import './ai-energy.css'

/** Original subdued activity glow, rendered behind the existing avatar. */
export function AiEnergy({
  className = '',
  active = false,
  size = 72,
}: {
  className?: string
  active?: boolean
  size?: number
}) {
  return (
    <span
      aria-hidden="true"
      data-active={active}
      className={`ai-energy ${className}`}
      style={{ '--ai-energy-size': `${size}px` } as CSSProperties}
    >
      <span className="ai-energy__field">
        <span className="ai-energy__ring" />
      </span>
    </span>
  )
}

const WAVE_HEIGHTS = [0.2, 0.34, 0.58, 0.82, 0.48, 0.68, 1, 0.72, 0.44, 0.76, 0.94, 0.6, 0.36, 0.64, 0.82, 0.48, 0.28, 0.16]

/** A decorative activity waveform, driven only by an existing running flag. */
export function AiWaveform({
  className = '',
  active = false,
}: {
  className?: string
  active?: boolean
}) {
  return (
    <span aria-hidden="true" data-active={active} className={`ai-waveform ${className}`}>
      {WAVE_HEIGHTS.map((height, index) => (
        <span
          key={index}
          style={{
            '--ai-wave-height': height,
            '--ai-wave-step': index / (WAVE_HEIGHTS.length - 1),
          } as CSSProperties}
        />
      ))}
    </span>
  )
}
