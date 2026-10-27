interface DurationTask {
  createdAt: string
  status?: string
  updatedAt?: string
  acceptedAt?: string | null
  canceledAt?: string | null
  deliveredAt?: string | null
}

/** 任务持续时间：从创建起算，已结束任务截止完成/取消时间。 */
export function taskDurationMs(task: DurationTask, now = Date.now()): number {
  const start = new Date(task.createdAt).getTime()
  if (!Number.isFinite(start)) return 0
  const finished = task.status === '已结束'
  const end = finished
    ? new Date(
        task.acceptedAt ??
          task.canceledAt ??
          task.deliveredAt ??
          task.updatedAt ??
          now,
      ).getTime()
    : now
  return Math.max(0, (Number.isFinite(end) ? end : now) - start)
}

/** 时长展示：按天/小时/分钟/秒逐级保留最重要两段。 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  if (totalSeconds < 60) return `${totalSeconds} 秒`
  const days = Math.floor(totalSeconds / 86_400)
  const hours = Math.floor((totalSeconds % 86_400) / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  const seconds = totalSeconds % 60
  if (days > 0) return `${days} 天 ${hours} 小时`
  if (hours > 0) return `${hours} 小时 ${minutes} 分钟`
  return `${minutes} 分钟 ${seconds} 秒`
}
