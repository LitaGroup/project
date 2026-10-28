interface PresentedMessage {
  id: string
  role: string
  kind?: string
  taskId?: number
  sender?: { id: string }
  question?: { id: string; state: string }
}

/** A read-only rendering projection. Original snapshots and event order stay intact. */
export function projectConversationMessages<T extends PresentedMessage>(
  source: readonly T[],
  scope: 'debug' | 'task',
): { messages: T[]; pendingQuestions: T[] } {
  const questionKey = (message: T) =>
    `${scope === 'task' ? message.taskId ?? '' : ''}:${message.question!.id}`
  const latest = new Map<string, T>()
  for (const message of source) {
    if (message.question) latest.set(questionKey(message), message)
  }
  const seen = new Set<string>()
  const unique = source.flatMap((message) => {
    if (!message.question) return [message]
    const key = questionKey(message)
    if (seen.has(key)) return []
    seen.add(key)
    return [latest.get(key)!]
  })

  const messages: T[] = []
  const pendingQuestions: T[] = []
  const turns: T[][] = []
  for (const message of unique) {
    if (message.role === 'user' || turns.length === 0) turns.push([])
    turns[turns.length - 1].push(message)
  }
  for (const turn of turns) {
    const receiptsBefore = new Map<number, T[]>()
    const relocated = new Set<T>()
    turn.forEach((message, index) => {
      if (!message.question) return
      if (message.question.state === 'pending') {
        pendingQuestions.push(message)
        relocated.add(message)
        return
      }
      const sameResponse = (candidate: T) =>
        candidate.role === 'assistant' &&
        !candidate.question &&
        candidate.kind !== 'event' &&
        (scope !== 'task' ||
          (candidate.taskId === message.taskId &&
            (!candidate.sender || !message.sender || candidate.sender.id === message.sender.id)))
      let target = -1
      for (let before = index - 1; before >= 0; before--) {
        if (sameResponse(turn[before])) {
          target = before
          break
        }
      }
      if (target < 0) target = turn.findIndex(sameResponse)
      if (target < 0) return // Keep an unassociated receipt in its original place.
      const receipts = receiptsBefore.get(target) ?? []
      receipts.push(message)
      receiptsBefore.set(target, receipts)
      relocated.add(message)
    })
    turn.forEach((message, index) => {
      messages.push(...(receiptsBefore.get(index) ?? []))
      if (!relocated.has(message)) messages.push(message)
    })
  }
  return { messages, pendingQuestions }
}
