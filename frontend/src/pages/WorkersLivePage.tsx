import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Card,
  CardHeader,
  CardTitle,
} from '@appica/ui-react/card'
import { api, type Worker } from '../lib/api'
import { WorkerLiveBadge } from '../components/StatusBadge'

/** 工作概览：机器人实时状态卡片墙（5s 轮询；工作中呼吸动画） */
export function WorkersLivePage() {
  const [workers, setWorkers] = useState<Worker[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const tick = () => {
      api
        .listWorkersLive()
        .then((list) => {
          if (!cancelled) setWorkers(list)
        })
        .catch((e: Error) => {
          if (!cancelled) setError(e.message)
        })
    }
    tick()
    const timer = setInterval(tick, 5000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  const agents = workers.filter((w) => w.role === '工作者')
  const schedulers = workers.filter((w) => w.role === '调度器')

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">工作概览</h1>
        <p className="mt-1 text-sm text-foreground-muted">
          机器人实时状态（每 5 秒刷新）：空闲中 / 工作中 / 等待中 / 验收中
        </p>
      </div>
      {error && <p className="text-sm">加载失败:{error}</p>}

      <section>
        <h2 className="mb-3 text-lg font-semibold">机器人（{agents.length}）</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {agents.map((w) => (
            <WorkerCard key={w.id} worker={w} />
          ))}
          {agents.length === 0 && (
            <p className="text-sm text-foreground-muted">
              暂无机器人，到「机器人」页创建
            </p>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">
          调度器（{schedulers.length}）
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {schedulers.map((w) => (
            <WorkerCard key={w.id} worker={w} />
          ))}
          {schedulers.length === 0 && (
            <p className="text-sm text-foreground-muted">
              暂无调度器，到「调度器」页创建
            </p>
          )}
        </div>
      </section>
    </div>
  )
}

function WorkerCard({ worker }: { worker: Worker }) {
  const working = worker.liveStatus === '工作中'
  return (
    <Card className={working ? 'ring-1 ring-success/40' : undefined}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span className="truncate">{worker.name}</span>
          <span className={working ? 'animate-pulse' : undefined}>
            <WorkerLiveBadge status={worker.liveStatus} />
          </span>
        </CardTitle>
      </CardHeader>
      <div className="px-6 pb-6">
        <div className="flex flex-col gap-2 text-sm">
          {worker.intro && (
            <p className="line-clamp-2 text-foreground-muted" title={worker.intro}>
              {worker.intro}
            </p>
          )}
          <p className="text-xs text-foreground-muted">
            {worker.runtime === 'pi' ? '内置 PI' : 'opencode'} ·{' '}
            {worker.providerId ?? '-'}/{worker.modelId ?? '-'}
            {worker.ownerName ? ` · 负责人 ${worker.ownerName}` : ''}
          </p>
          {worker.activeTask ? (
            <p className="text-sm">
              当前任务：
              <Link
                to={`/tasks/${worker.activeTask.id}`}
                className="underline"
              >
                {worker.activeTask.code} {worker.activeTask.title}
              </Link>
            </p>
          ) : (
            <p className="text-sm text-foreground-muted">暂无进行中的任务</p>
          )}
        </div>
      </div>
    </Card>
  )
}
