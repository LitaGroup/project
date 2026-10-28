import { useState } from 'react'
import { buttonVariants } from '@appica/ui-react/button'
import { Check, MessageCircleQuestion } from '@appica/icons-react'
import type { TaskChatQuestion } from '../lib/api'
import { questionStatusLabel } from '../lib/question'
import './beui/beui.css'

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
 * 多问题 + 选项 + 自由输入 + 跳过，提交后变成回执。
 */
export function QuestionCard({
  question,
  disabled = false,
  busy = false,
  onReply,
}: QuestionCardProps) {
  const [picked, setPicked] = useState<Record<number, string[]>>({})
  const [texts, setTexts] = useState<Record<number, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pending = question.state === 'pending'
  const interactive = pending && !disabled && !busy

  const answersOf = (index: number): string[] => {
    const info = question.questions[index]
    const picks = picked[index] ?? []
    const text = (texts[index] ?? '').trim()
    const values = [...picks]
    if (info?.custom !== false && text && !values.includes(text)) {
      values.push(text)
    }
    return values
  }

  const canSubmit =
    question.questions.length > 0 &&
    question.questions.every((_, index) => answersOf(index).length > 0)

  const toggle = (index: number, label: string, multiple: boolean) => {
    if (!interactive) return
    setPicked((current) => {
      const values = current[index] ?? []
      if (multiple) {
        return {
          ...current,
          [index]: values.includes(label)
            ? values.filter((value) => value !== label)
            : [...values, label],
        }
      }
      return {
        ...current,
        [index]: values.includes(label) ? [] : [label],
      }
    })
  }

  const submit = async (skip: boolean) => {
    if (submitting) return
    if (!skip && !canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      await onReply(
        question.id,
        skip ? null : question.questions.map((_, index) => answersOf(index)),
      )
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="beui-approval-card" data-question-id={question.id} data-question-state={question.state}>
      <div className="beui-approval-heading">
        <MessageCircleQuestion className="size-4" />
        机器人向你提问
        {pending && <span className="beui-approval-badge">{questionStatusLabel(question, undefined, disabled)}</span>}
      </div>

      {pending ? (
        <div className="beui-approval-form">
          <div className="beui-approval-fields space-y-3">
            {question.questions.map((info, index) => {
              const multiple = info.multiple === true
              const picks = picked[index] ?? []
              return (
                <div key={index} className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    {info.header && (
                      <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-medium text-foreground-muted">
                        {info.header}
                      </span>
                    )}
                    {multiple && (
                      <span className="text-[10px] text-foreground-subtle">
                        可多选
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-medium text-foreground-intense">
                    {info.question}
                  </p>
                  {info.options && info.options.length > 0 && (
                    <div className="grid gap-1.5">
                      {info.options.map((option) => {
                        const active = picks.includes(option.label)
                        return (
                          <button
                            key={option.label}
                            type="button"
                            aria-pressed={active}
                            disabled={!interactive || submitting}
                            onClick={() => toggle(index, option.label, multiple)}
                            className={`flex w-full items-start gap-2 rounded-[var(--radius-md)] border px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                              active
                                ? 'border-primary-strong bg-primary-soft text-foreground-intense'
                                : 'border-border bg-background hover:border-border-strong'
                            }`}
                          >
                            <span
                              className={`mt-0.5 flex size-4 shrink-0 items-center justify-center border ${
                                multiple
                                  ? 'rounded-[var(--radius-sm)]'
                                  : 'rounded-full'
                              } ${
                                active
                                  ? 'border-primary-strong bg-primary text-primary-foreground'
                                  : 'border-border-strong'
                              }`}
                            >
                              {active && <Check className="size-3" />}
                            </span>
                            <span className="min-w-0">
                              <span className="block font-medium">
                                {option.label}
                              </span>
                              {option.description && (
                                <span className="mt-0.5 block text-xs text-foreground-muted">
                                  {option.description}
                                </span>
                              )}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                  {info.custom !== false && (
                    <input
                      value={texts[index] ?? ''}
                      disabled={!interactive || submitting}
                      onChange={(event) =>
                        setTexts((current) => ({
                          ...current,
                          [index]: event.target.value,
                        }))
                      }
                      placeholder="也可以直接输入你的回答"
                      className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none placeholder:text-foreground-subtle focus:border-border-strong disabled:opacity-60"
                    />
                  )}
                </div>
              )
            })}

            {error && (
              <p role="alert" className="text-xs text-error-foreground">
                {error}
              </p>
            )}
          </div>

          <div className="beui-approval-actions">
            <p className="text-[11px] text-foreground-muted">
              {question.questions.length > 1
                ? `共 ${question.questions.length} 个问题，全部回答后可提交`
                : '选择选项或输入回答'}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={!interactive || submitting}
                onClick={() => void submit(true)}
                className="text-xs text-foreground-muted underline underline-offset-2 disabled:opacity-50"
              >
                跳过
              </button>
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
            </div>
          </div>
        </div>
      ) : (
        <details className="beui-approval-receipt">
          <summary>确认记录 · {questionStatusLabel(question)}</summary>
        <div className="space-y-2">
          {question.questions.map((info, index) => (
            <div key={index} className="space-y-1">
              <p className="text-xs text-foreground-muted">
                {info.header || `问题 ${index + 1}`}
              </p>
              <p className="text-sm text-foreground-emphasis">
                {info.question}
              </p>
              {question.state === 'answered' ? (
                <div className="flex flex-wrap gap-1.5">
                  {(question.answers?.[index] ?? []).map((answer) => (
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
        </details>
      )}
    </div>
  )
}
