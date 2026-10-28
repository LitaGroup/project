// Adapted from beUI, MIT License. Copyright (c) 2026 Saurabh Chauhan.
// https://github.com/starc007/ui-components/blob/main/components/motion/digit-swap.tsx

import { m } from 'framer-motion'
import { cx } from './presets'

export interface DigitSwapProps {
  value: number
  className?: string
}

const REEL_DIGITS = Array.from({ length: 20 }, (_, index) => index % 10)
const REEL_LINE_HEIGHT = 1.1

/** Decorative digit reels settle on the original value; stable digits stay still. */
export function DigitSwap({ value, className }: DigitSwapProps) {
  const text = String(value)

  return (
    <span
      data-slot="digit-swap"
      className={cx('inline-flex items-baseline whitespace-nowrap tabular-nums', className)}
    >
      <span className="sr-only">{text}</span>
      <span aria-hidden="true" className="inline-flex items-baseline">
        {Array.from(text, (character, position) => (
          <span
            key={`slot-${position}`}
            data-slot="digit-swap-glyph"
            className={cx(
              'relative inline-block h-[1.1em] shrink-0 leading-[1.1em] [clip-path:inset(0)]',
              /\d/.test(character) ? 'w-[1ch] text-center' : undefined,
            )}
          >
            <span className="invisible">{character}</span>
            {/\d/.test(character) ? (
              <m.span
                key={character}
                data-slot="digit-swap-reel"
                data-digit={character}
                initial={{ y: '0em' }}
                animate={{ y: `${-(10 + Number(character)) * REEL_LINE_HEIGHT}em` }}
                transition={{ duration: 0.28, delay: position * 0.01, ease: [0.2, 0.65, 0.25, 1] }}
                className="absolute inset-x-0 top-0 flex flex-col"
              >
                {REEL_DIGITS.map((digit, row) => (
                  <span key={row} className="flex h-[1.1em] shrink-0 items-center justify-center leading-none">
                    {digit}
                  </span>
                ))}
              </m.span>
            ) : (
              <span className="absolute inset-0 flex items-center justify-center leading-none">
                {character}
              </span>
            )}
          </span>
        ))}
      </span>
    </span>
  )
}
