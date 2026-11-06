import { useState } from 'react'
import { buttonVariants } from '@appica/ui-react/button'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  MessageCircleQuestion,
} from '@appica/icons-react'
import type { TaskChatQuestion } from '../lib/api'
import { useImeEnterGuard } from '../lib/ime-enter'

interface QuestionCardProps {
  question: TaskChatQuestion
  /** 会话/任务已结束（提问不可再答）；缺省 false，提问 pending 即可作答 */
  disabled?: boolean
  /** 外部繁忙状态（提交中、上下文不可用等） */
  busy?: boolean
  /** 回答（answers）或跳过（null）机器人提问 */
  onReply: (questionId: string, answers: string[][] | null) => Promise<void>
}

/**
 * 机器人提问卡片主体（任务详情页与机器人调试页共用）：
 * 逐题回答 + 单选/多选选项 + 自由输入 + 跳过，最后统一提交。
 */
export function QuestionCard({
  question,
  disabled = false,
  busy = false,
  onReply,
}: QuestionCardProps) {
  const [picked, setPicked] = useState<Record<number, string[]>>({})
  const [texts, setTexts] = useState<Record<number, string>>({})
  const [index, setIndex] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const imeEnter = useImeEnterGuard()
  const pending = question.state === 'pending'
  const interactive = pending && !disabled && !busy
  const total = question.questions.length
  const currentIndex = Math.min(index, Math.max(total - 1, 0))
  const current = question.questions[currentIndex]
  const isLast = currentIndex >= total - 1

  const answersOf = (questionIndex: number): string[] => {
    const info = question.questions[questionIndex]
    const picks = picked[questionIndex] ?? []
    const text = (texts[questionIndex] ?? '').trim()
    const values = [...picks]
    if (info?.custom !== false && text && !values.includes(text)) {
      values.push(text)
    }
    return values
  }

  const canSubmit =
    total > 0 && question.questions.every((_, itemIndex) => answersOf(itemIndex).length > 0)

  const select = (questionIndex: number, label: string, multiple: boolean) => {
    if (!interactive || submitting) return
    setPicked((values) => {
      const picks = values[questionIndex] ?? []
      if (multiple) {
        return {
          ...values,
          [questionIndex]: picks.includes(label)
            ? picks.filter((value) => value !== label)
            : [...picks, label],
        }
      }
      return { ...values, [questionIndex]: [label] }
    })
    if (!multiple && questionIndex < total - 1) {
      setIndex(questionIndex + 1)
    }
  }

  const next = (questionIndex: number) => {
    if (!interactive || submitting || questionIndex >= total - 1) return
    if (answersOf(questionIndex).length === 0) return
    setIndex(questionIndex + 1)
  }

  const back = (questionIndex: number) => {
    if (submitting || questionIndex <= 0) return
    setIndex(questionIndex - 1)
  }

  const submit = async (skip: boolean) => {
    if (submitting) return
    if (!skip && !canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      await onReply(
        question.id,
        skip ? null : question.questions.map((_, itemIndex) => answersOf(itemIndex)),
      )
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="rounded-[var(--radius-lg)] rounded-tl-sm border border-border bg-background-subtle px-4 py-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-3 text-xs font-medium text-info-foreground">
        <span className="flex items-center gap-2">
          <MessageCircleQuestion className="size-4" />
          机器人向你提问
        </span>
        {pending && total > 1 && (
          <span className="font-normal tabular-nums text-foreground-muted">
            第 {currentIndex + 1} / {total} 题
          </span>
        )}
      </div>

      {pending ? (
        total === 0 ? (
          <p className="text-xs text-foreground-subtle">本轮已结束，提问已失效</p>
        ) : (
          <div className="space-y-3">
            {total > 1 && (
              <div className="h-1 overflow-hidden rounded-full bg-background-muted">
                <div
                  className="h-full rounded-full bg-primary transition-[width]"
                  style={{ width: `${((currentIndex + 1) / total) * 100}%` }}
                />
              </div>
            )}

            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                {current?.header && (
                  <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-medium text-foreground-muted">
                    {current.header}
                  </span>
                )}
                {current?.multiple && (
                  <span className="text-[10px] text-foreground-subtle">
                    可多选
                  </span>
                )}
              </div>
              <p className="text-sm font-medium text-foreground-intense">
                {current?.question}
              </p>

              {current?.options && current.options.length > 0 && (
                <div
                  role={current.multiple ? 'group' : 'radiogroup'}
                  aria-label={current.question}
                  className="grid gap-1.5"
                >
                  {current.options.map((option) => {
                    const active = (picked[currentIndex] ?? []).includes(
                      option.label,
                    )
                    return (
                      <button
                        key={option.label}
                        type="button"
                        role={current.multiple ? undefined : 'radio'}
                        aria-checked={current.multiple ? undefined : active}
                        aria-pressed={current.multiple ? active : undefined}
                        disabled={!interactive || submitting}
                        onClick={() =>
                          select(
                            currentIndex,
                            option.label,
                            current.multiple === true,
                          )
                        }
                        className={`flex w-full items-start gap-2.5 rounded-[var(--radius-md)] border px-3 py-2.5 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                          active
                            ? 'border-primary-strong bg-primary-soft text-foreground-intense'
                            : 'border-border bg-background hover:border-border-strong'
                        }`}
                      >
                        <span
                          className={`mt-0.5 flex size-4 shrink-0 items-center justify-center border ${
                            current.multiple
                              ? 'rounded-[var(--radius-sm)]'
                              : 'rounded-full'
                          } ${
                            active
                              ? 'border-primary-strong bg-primary text-primary-foreground'
                              : 'border-border-strong bg-background'
                          }`}
                        >
                          {active &&
                            (current.multiple ? (
                              <Check className="size-3" />
                            ) : (
                              <span className="size-1.5 rounded-full bg-primary-foreground" />
                            ))}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium">{option.label}</span>
                          {option.description && (
                            <span className="mt-0.5 block text-xs text-foreground-muted">
                              {option.description}
                            </span>
                          )}
                        </span>
                        {active && !current.multiple && (
                          <Check className="mt-0.5 size-3.5 shrink-0 text-primary-strong" />
                        )}
                      </button>
                    )
                  })}
                </div>
              )}

              {current?.custom !== false && (
                <div className="space-y-1">
                  <input
                    value={texts[currentIndex] ?? ''}
                    disabled={!interactive || submitting}
                    onChange={(event) =>
                      setTexts((values) => ({
                        ...values,
                        [currentIndex]: event.target.value,
                      }))
                    }
                    onCompositionStart={imeEnter.onCompositionStart}
                    onCompositionEnd={imeEnter.onCompositionEnd}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter') return
                      if (imeEnter.isImeEnter(event)) return
                      event.preventDefault()
                      if (submitting || answersOf(currentIndex).length === 0) {
                        return
                      }
                      if (!isLast) next(currentIndex)
                    }}
                    placeholder={
                      isLast
                        ? current?.options?.length
                          ? '补充回答'
                          : '输入回答'
                        : current?.options?.length
                          ? '补充回答，按 Enter 进入下一题'
                          : '输入回答，按 Enter 进入下一题'
                    }
                    className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none placeholder:text-foreground-subtle focus:border-border-strong disabled:opacity-60"
                  />
                  {isLast && (
                    <p className="text-[11px] text-foreground-subtle">
                      最后一题按 Enter 不会提交，请点击下方“提交回答”。
                    </p>
                  )}
                </div>
              )}
            </div>

            {error && (
              <p role="alert" className="text-xs text-error-foreground">
                {error}
              </p>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  disabled={!interactive || submitting}
                  onClick={() => void submit(true)}
                  className="text-xs text-foreground-muted underline underline-offset-2 disabled:opacity-50"
                >
                  跳过
                </button>
                {currentIndex > 0 && (
                  <button
                    type="button"
                    disabled={!interactive || submitting}
                    onClick={() => back(currentIndex)}
                    className="inline-flex items-center gap-0.5 text-xs text-foreground-muted disabled:opacity-50"
                  >
                    <ChevronLeft className="size-3.5" />
                    上一题
                  </button>
                )}
              </div>

              {isLast ? (
                <button
                  type="button"
                  disabled={!interactive || submitting || !canSubmit}
                  onClick={() => void submit(false)}
                  className={buttonVariants({
                    variant: 'primary',
                    size: 'sm',
                  })}
                >
                  {submitting ? '提交中…' : '提交回答'}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={
                    !interactive ||
                    submitting ||
                    answersOf(currentIndex).length === 0
                  }
                  onClick={() => next(currentIndex)}
                  className={buttonVariants({
                    variant: 'outline',
                    size: 'sm',
                  })}
                >
                  下一题
                  <ChevronRight className="size-3.5" />
                </button>
              )}
            </div>
          </div>
        )
      ) : (
        <div className="space-y-2">
          {question.questions.map((info, itemIndex) => (
            <div key={itemIndex} className="space-y-1">
              <p className="text-xs text-foreground-muted">
                {info.header || `问题 ${itemIndex + 1}`}
              </p>
              <p className="text-sm text-foreground-emphasis">
                {info.question}
              </p>
              {question.state === 'answered' ? (
                <div className="flex flex-wrap gap-1.5">
                  {(question.answers?.[itemIndex] ?? []).map((answer) => (
                    <span
                      key={answer}
                      className="rounded-full border border-border bg-background px-2 py-0.5 text-xs text-foreground-emphasis"
                    >
                      {answer}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-foreground-subtle">
                  {question.state === 'rejected'
                    ? '已跳过本次提问'
                    : '本轮已结束，提问已失效'}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
