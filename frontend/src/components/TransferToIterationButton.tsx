import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@appica/ui-react/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
  DialogClose,
} from '@appica/ui-react/dialog'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@appica/ui-react/select'
import { api, type IterationSummary, type Worker } from '../lib/api'
import { useAuth } from '../context/AuthContext'

const SUCCESS_STAY_MS = 2_000

/**
 * 需求详情「转入迭代」：选择一个进行中的迭代（T0 或 W1）与负责人机器人，
 * 把当前需求转成该迭代的 backlog。仅管理员可见。
 */
export function TransferToIterationButton({
  projectId,
  projectName,
}: {
  projectId: number
  projectName: string
}) {
  const { user } = useAuth()
  const isAdmin = user?.role === '管理员'
  const [open, setOpen] = useState(false)
  const [iterations, setIterations] = useState<IterationSummary[] | null>(null)
  const [workers, setWorkers] = useState<Worker[] | null>(null)
  const [iterationId, setIterationId] = useState<string | undefined>(undefined)
  const [ownerId, setOwnerId] = useState<string | undefined>(undefined)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    [],
  )

  const load = useCallback(() => {
    setError(null)
    setSuccess(null)
    Promise.all([api.listIterations(), api.listWorkers({ role: '工作者' })])
      .then(([iterationRows, workerRows]) => {
        setIterations(iterationRows.filter((it) => it.status === '进行中'))
        setWorkers(
          workerRows.filter(
            (worker) => worker.enabled && !worker.personalAgentUserId,
          ),
        )
      })
      .catch((e: Error) => setError(e.message))
  }, [])

  if (!isAdmin) return null

  const iterationItems = Object.fromEntries(
    (iterations ?? []).map((it) => [String(it.id), `${it.code} ${it.name}`]),
  )
  const workerItems = Object.fromEntries(
    (workers ?? []).map((w) => [String(w.id), w.name]),
  )

  const submit = () => {
    if (pending) return
    const targetIteration = Number(iterationId)
    const targetOwner = Number(ownerId)
    if (!targetIteration || !targetOwner) {
      setError('请选择迭代与负责人机器人')
      return
    }
    setPending(true)
    setError(null)
    api
      .createBacklogs(targetIteration, [
        { projectId, ownerWorkerId: targetOwner },
      ])
      .then(() => {
        setSuccess(`已将「${projectName}」转入迭代`)
        timerRef.current = setTimeout(() => {
          setSuccess(null)
          setOpen(false)
        }, SUCCESS_STAY_MS)
      })
      .catch((e: Error) => setError(e.message || '转入失败'))
      .finally(() => setPending(false))
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setOpen(true)
          load()
        }}
      >
        转入迭代
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>转入迭代</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-sm">
                目标迭代
                <Select
                  value={iterationId}
                  onValueChange={(v) => setIterationId(v as string)}
                  items={iterationItems}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="选择 T0 或 W1 迭代" />
                  </SelectTrigger>
                  <SelectContent>
                    {(iterations ?? []).map((it) => (
                      <SelectItem key={it.id} value={String(it.id)}>
                        {it.code} {it.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                负责人机器人
                <Select
                  value={ownerId}
                  onValueChange={(v) => setOwnerId(v as string)}
                  items={workerItems}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="选择负责人（AI 或真人）" />
                  </SelectTrigger>
                  <SelectContent>
                    {(workers ?? []).map((worker) => (
                      <SelectItem key={worker.id} value={String(worker.id)}>
                        {worker.name}
                        {worker.runtime === 'human' ? '（真人）' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <p className="text-sm text-foreground-muted">
                产品/技术成员会按需求人员自动带入；负责人为机器人时将自动创建交付任务。
              </p>
              {error && <p className="text-sm">失败:{error}</p>}
              {success && <p className="text-sm">{success}</p>}
            </div>
          </DialogBody>
          <DialogFooter>
            <DialogClose>
              <Button variant="outline" size="sm">取消</Button>
            </DialogClose>
            <Button
              size="sm"
              onClick={submit}
              disabled={pending || success !== null}
            >
              {pending ? '转入中…' : '确认转入'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}