import type { TaskChatQuestion } from './api'

/** 提问状态文案（消息头部的状态提示；disabledText 由调用方按场景传入） */
export function questionStatusLabel(
  question: TaskChatQuestion,
  disabledText = '暂不可回答',
  disabled = false,
): string {
  if (question.state === 'pending') return disabled ? disabledText : '等待回答'
  if (question.state === 'answered') return '已回答'
  if (question.state === 'rejected') return '已跳过'
  return '已失效'
}
