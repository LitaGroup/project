import { useEffect } from 'react'
import './surface-effects.css'

const SURFACE_SELECTOR =
  '[data-slot="card-content"], .task-board-card-surface, .responsive-table-scroll, .ai-composer, .ai-reasoning-trigger, .ai-reasoning, .ai-session-header, .ai-tool-chip'

/** Pointer lighting is confined to existing surfaces and adds no UI controls. */
export function SurfaceEffects() {
  useEffect(() => {
    const page = document.querySelector<HTMLElement>('.square-page')
    if (!page) return

    let activeSurface: HTMLElement | null = null

    const clearSurface = () => {
      activeSurface?.style.removeProperty('--pointer-x')
      activeSurface?.style.removeProperty('--pointer-y')
      activeSurface = null
    }

    const followPointer = (event: PointerEvent) => {
      const surface =
        event.pointerType !== 'touch' && event.target instanceof Element
          ? event.target.closest<HTMLElement>(SURFACE_SELECTOR)
          : null

      if (!surface || !page.contains(surface)) {
        clearSurface()
        return
      }

      if (surface !== activeSurface) {
        clearSurface()
        activeSurface = surface
      }

      const { left, top } = surface.getBoundingClientRect()
      surface.style.setProperty('--pointer-x', `${event.clientX - left + surface.scrollLeft}px`)
      surface.style.setProperty('--pointer-y', `${event.clientY - top}px`)
    }

    page.addEventListener('pointermove', followPointer, { passive: true })
    page.addEventListener('pointerleave', clearSurface, { passive: true })

    return () => {
      page.removeEventListener('pointermove', followPointer)
      page.removeEventListener('pointerleave', clearSurface)
      clearSurface()
    }
  }, [])

  return null
}
