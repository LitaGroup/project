import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button, buttonVariants } from '@appica/ui-react/button'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@appica/ui-react/card'
import { Input } from '@appica/ui-react/input'
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverTitle,
  PopoverDescription,
} from '@appica/ui-react/popover'
import { api, type Project, type Worker } from '../lib/api'
import { PageBreadcrumb } from '../components/PageBreadcrumb'
import { BacklogSelection } from '../components/BacklogSelection'
import { useAuth } from '../context/AuthContext'

/** 成功反馈停留时长 */
const SUCCESS_STAY_MS = 2_000
/** 失败反馈停留时长 */
const FAILURE_STAY_MS = 5_000

type ActionFeedback =
  | { kind: 'success'; message: string }
  | { kind: 'failure'; message: string }
  | null

/**
 * 新建 W1 周迭代：填写唯一标识/名称/起止日期，并从需求池勾选需求、
 * 逐条指定负责人机器人后创建；选中需求即转为该迭代的 backlog。
 */
export function IterationEditPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const isAdmin = user?.role === '管理员'

  const [projects, setProjects] = useState<Project[] | null>(null)
  const [workers, setWorkers] = useState<Worker[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [startAt, setStartAt] = useState('')
  const [endAt, setEndAt] = useState('')
  const [drafts, setDrafts] = useState<Map<number, number | null>>(new Map())
  const [pending, setPending] = useState(false)
  const [createdId, setCreatedId] = useState<number | null>(null)
  const [feedback, setFeedback] = useState<ActionFeedback>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([api.listProjects(), api.listWorkers({ role: '工作者' })])
      .then(([projectRows, workerRows]) => {
        if (cancelled) return
        setProjects(projectRows)
        setWorkers(
          workerRows.filter(
            (worker) =>
              worker.enabled && !worker.personalAgentUserId,
          ),
        )
        setLoadError(null)
      })
      .catch((e: Error) => {
        if (!cancelled) setLoadError(e.message)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }
  useEffect(() => clearTimer, [])

  const showFeedback = (
    next: NonNullable<ActionFeedback>,
    stayMs: number,
    after?: () => void,
  ) => {
    clearTimer()
    setFeedback(next)
    timerRef.current = setTimeout(() => {
      setFeedback(null)
      after?.()
    }, stayMs)
  }

  const selectedItems = useMemo(
    () =>
      [...drafts.entries()]
        .filter((entry): entry is [number, number] => entry[1] !== null)
        .map(([projectId, ownerWorkerId]) => ({ projectId, ownerWorkerId })),
    [drafts],
  )
  const missingOwnerCount = useMemo(
    () => [...drafts.values()].filter((owner) => owner === null).length,
    [drafts],
  )

  if (!isAdmin) {
    return (
      <div>
        <PageBreadcrumb
          items={[{ label: '迭代', to: '/iterations' }, { label: '新建 W1 迭代' }]}
        />
        <p className="mt-4 text-sm">仅管理员可创建迭代。</p>
        <Link to="/iterations" className="mt-2 inline-block text-sm underline">
          返回迭代列表
        </Link>
      </div>
    )
  }

  const submit = () => {
    if (pending) return
    if (!code.trim() || !name.trim()) {
      showFeedback({ kind: 'failure', message: '请填写迭代标识与名称' }, FAILURE_STAY_MS)
      return
    }
    if (!startAt || !endAt) {
      showFeedback({ kind: 'failure', message: '请填写开始日期与结束日期' }, FAILURE_STAY_MS)
      return
    }
    if (startAt > endAt) {
      showFeedback({ kind: 'failure', message: '开始日期不能晚于结束日期' }, FAILURE_STAY_MS)
      return
    }
    if (drafts.size === 0) {
      showFeedback({ kind: 'failure', message: '请至少选择一个需求' }, FAILURE_STAY_MS)
      return
    }
    if (missingOwnerCount > 0) {
      showFeedback(
        { kind: 'failure', message: '每条已选需求都要指定负责人' },
        FAILURE_STAY_MS,
      )
      return
    }

    setPending(true)
    api
      .createIteration({ code: code.trim(), name: name.trim(), startAt, endAt })
      .then((iteration) =>
        api
          .createBacklogs(iteration.id, selectedItems)
          .then(() => iteration)
          .catch((error: Error) => {
            setCreatedId(iteration.id)
            throw error
          }),
      )
      .then((iteration) => {
        showFeedback(
          { kind: 'success', message: '迭代已创建' },
          SUCCESS_STAY_MS,
          () => navigate(`/iterations/${iteration.id}`, { replace: true }),
        )
      })
      .catch((e: Error) => {
        showFeedback(
          { kind: 'failure', message: e.message || '创建失败，请稍后重试' },
          FAILURE_STAY_MS,
        )
      })
      .finally(() => setPending(false))
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <PageBreadcrumb
            items={[{ label: '迭代', to: '/iterations' }, { label: '新建 W1 迭代' }]}
          />
          <h1 className="mt-2 text-2xl font-semibold">新建 W1 迭代</h1>
          <p className="mt-1 text-sm text-foreground-muted">
            填写唯一标识与起止日期，勾选需求并逐条指定负责人；选中需求将转为该迭代的迭代项
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/iterations"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            取消
          </Link>
          <Popover
            open={feedback !== null}
            onOpenChange={(open) => {
              if (!open && feedback?.kind === 'failure') {
                clearTimer()
                setFeedback(null)
              }
            }}
          >
            <PopoverTrigger
              render={
                <Button
                  size="sm"
                  onClick={submit}
                  disabled={pending || feedback?.kind === 'success'}
                >
                  {pending ? '创建中…' : '创建迭代'}
                </Button>
              }
            />
            <PopoverContent side="top" align="center">
              {feedback?.kind === 'success' && (
                <>
                  <PopoverTitle>成功</PopoverTitle>
                  <PopoverDescription>{feedback.message}</PopoverDescription>
                </>
              )}
              {feedback?.kind === 'failure' && (
                <>
                  <PopoverTitle>失败</PopoverTitle>
                  <PopoverDescription>{feedback.message}</PopoverDescription>
                </>
              )}
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {createdId !== null && (
        <p className="mb-4 text-sm">
          迭代已创建但迭代项转入失败，可前往{' '}
          <Link to={`/iterations/${createdId}`} className="underline">
            迭代详情
          </Link>{' '}
          继续添加需求。
        </p>
      )}
      {loadError && <p className="mb-4 text-sm">加载失败:{loadError}</p>}

      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>迭代信息</CardTitle>
            <CardDescription>
              标识用于唯一识别（如 W2026-46），起止日期决定是否为当前迭代
            </CardDescription>
          </CardHeader>
          <div className="grid grid-cols-1 gap-4 px-4 pb-4 md:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              唯一标识
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="如 W2026-46"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              迭代名称
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="如 第 46 周迭代"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              开始日期
              <Input
                type="date"
                value={startAt}
                onChange={(e) => setStartAt(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              结束日期
              <Input
                type="date"
                value={endAt}
                onChange={(e) => setEndAt(e.target.value)}
              />
            </label>
          </div>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>选择需求</CardTitle>
            <CardDescription>
              从需求池勾选需求，并为每条需求指定负责人机器人（AI 或真人）；负责人为机器人时自动创建交付任务
            </CardDescription>
          </CardHeader>
          <div className="px-4 pb-4">
            {projects && workers ? (
              <BacklogSelection
                projects={projects}
                workers={workers}
                drafts={drafts}
                onChange={setDrafts}
              />
            ) : (
              !loadError && <p className="text-sm text-foreground-muted">加载中…</p>
            )}
          </div>
        </Card>
      </div>
    </div>
  )
}