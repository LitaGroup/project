// Adapted from beUI, MIT License. Copyright (c) 2026 Saurabh Chauhan.
// https://github.com/starc007/ui-components/blob/main/lib/ease.ts

export const EASE_OUT = [0.16, 1, 0.3, 1] as const

export const SPRING_SWAP = {
  type: 'spring',
  stiffness: 460,
  damping: 30,
  mass: 0.55,
} as const

export const SPRING_MOUSE = {
  stiffness: 200,
  damping: 25,
  mass: 0.3,
} as const

export function cx(...values: Array<string | undefined>) {
  return values.filter(Boolean).join(' ')
}
