import { useCallback, useRef } from 'react'
import type { KeyboardEvent } from 'react'

/**
 * compositionend 之后部分浏览器/输入法仍会补发 Enter keydown，
 * 这段时间内的 Enter 一律视为输入法确认，不触发发送。
 */
const IME_ENTER_GUARD_MS = 100

export interface ImeEnterGuard {
  /** 挂在输入框的 onCompositionStart */
  onCompositionStart: () => void
  /** 挂在输入框的 onCompositionEnd */
  onCompositionEnd: () => void
  /** 当前 Enter 是否属于输入法确认（含 compositionend 后补发的 Enter） */
  isImeEnter: (event: KeyboardEvent<HTMLElement>) => boolean
}

/**
 * 统一的输入法 Enter 防护：
 * - 组合输入中的 Enter（isComposing / keyCode 229）
 * - compositionend 后紧跟的确认 Enter
 * 命中时调用方应直接返回，不要 preventDefault，避免候选词无法上屏。
 */
export function useImeEnterGuard(): ImeEnterGuard {
  const composingRef = useRef(false)
  const compositionEndedAtRef = useRef(0)

  const onCompositionStart = useCallback(() => {
    composingRef.current = true
  }, [])

  const onCompositionEnd = useCallback(() => {
    composingRef.current = false
    compositionEndedAtRef.current = performance.now()
  }, [])

  const isImeEnter = useCallback((event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Enter') return false
    if (composingRef.current) return true
    const native = event.nativeEvent
    if (native.isComposing || native.keyCode === 229) return true
    return performance.now() - compositionEndedAtRef.current < IME_ENTER_GUARD_MS
  }, [])

  return { onCompositionStart, onCompositionEnd, isImeEnter }
}
