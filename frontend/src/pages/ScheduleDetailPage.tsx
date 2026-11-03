import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Badge } from '@appica/ui-react/badge'
import { Button } from '@appica/ui-react/button'
import {
  api,
  type CheckRun,
  type ProjectCheck,
  type ProjectSchedule,
} from '../lib/api'
import { DetailAgentPanel } from '../components/detail/DetailAgentPanel'
import {
  RunDetailView,
  type RunHistoryItem,
} from '../components/detail/RunDetailView'
import { DeleteScheduleButton, ScheduleFormDialog } from './ProjectDetailPage'
import { Terminal } from '../components/Terminal'

const runStatusMeta: Record<
  CheckRun['status'],
  { text: string; variant: 'info' | 'success' | 'error' | 'warning' }
> = {
  queued: { text: '排队中', variant: 'info' },
  running: { text: '运行中', variant: 'info' },
  success: { text: '通过', variant: 'success' },
  fail: { text: '未通过', variant: 'error' },
  error: { text: '异常', variant: 'warning' },
}

function RunStatusBadge({ status }: { status: CheckRun['status'] }) {
  const meta = runStatusMeta[status]
  return <Badge variant={meta.variant}>{meta.text}</Badge>
}

/** 耗时展示：运行中按 startedAt 实时计算，结束后用落库的 durationMs */
function formatDuration(run: CheckRun, now: number): string {
  const ms =
    run.durationMs ??
    (run.status === 'running'
      ? now - new Date(run.startedAt).getTime()
      : null)
  if (ms === null) return '—'
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`
}

function toHistory(runs: CheckRun[]): RunHistoryItem[] {
  return runs.slice(0, 5).map((run) => ({
    id: run.id,
    label: `${new Date(run.startedAt).toLocaleString()} · ${runStatusMeta[run.status].text}`,
  }))
}

/** 定时任务详情页：任务信息 + 该任务触发的检查脚本运行 */
export function ScheduleDetailPage() {
  const { id, scheduleId } = useParams<{
    id: string
    scheduleId: string
  }>()
  const projectId = Number(id)
  const scheduleIdNum = Number(scheduleId)
  const navigate = useNavigate()

  const [schedule, setSchedule] = useState<ProjectSchedule | null>(null)
  const [projectName, setProjectName] = useState<string | null>(null)
  const [check, setCheck] = useState<ProjectCheck | null>(null)
  const [checks, setChecks] = useState<ProjectCheck[]>([])
  const [runs, setRuns] = useState<CheckRun[]>([])
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null)
  const [runData, setRunData] = useState<CheckRun | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  // 仅用于驱动运行中耗时每秒重渲染
  const [now, setNow] = useState(() => Date.now())

  const loadHistory = useCallback(
    () =>
      api.listScheduleRuns(scheduleIdNum).then((list) => {
        setRuns(list)
        setSelectedRunId((cur) => cur ?? list[0]?.id ?? null)
      }),
    [scheduleIdNum],
  )

  const loadSchedule = useCallback(
    () =>
      api
        .getSchedule(scheduleIdNum)
        .then((s) => {
          setSchedule(s)
          return api.getCheck(s.checkId)
        })
        .then(setCheck)
        .catch((e: Error) => setError(e.message)),
    [scheduleIdNum],
  )

  useEffect(() => {
    loadSchedule()
    // 面包屑的项目层级
    api
      .getProject(projectId)
      .then((p) => setProjectName(p.name))
      .catch(() => setProjectName(null))
    // 编辑表单的检查脚本选项
    api
      .listChecks(projectId)
      .then(setChecks)
      .catch(() => setChecks([]))
    loadHistory().catch((e: Error) => setError(e.message))
  }, [projectId, loadSchedule, loadHistory])

  // 通过 SSE 订阅选中的运行记录：实时推送进度，终态推送后服务端自动完成
  const loadHistoryRef = useRef(loadHistory)
  useEffect(() => {
    loadHistoryRef.current = loadHistory
  }, [loadHistory])
  useEffect(() => {
    if (selectedRunId === null) return
    let finished = false
    const es = new EventSource(`/api/checks/runs/${selectedRunId}/stream`)
    es.onmessage = (e: MessageEvent<string>) => {
      const r = JSON.parse(e.data) as CheckRun
      setRunData(r)
      setNow(Date.now())
      // queued（远程执行排队中）也是活跃状态，不能关闭流
      if (r.status !== 'running' && r.status !== 'queued') {
        finished = true
        es.close()
        void loadHistoryRef.current()
      }
    }
    es.onerror = () => {
      es.close()
      if (!finished) setError('实时连接中断')
    }
    // 耗时展示每秒走字（SSE 事件间隔可能较长）
    const clock = setInterval(() => setNow(Date.now()), 1000)
    return () => {
      es.close()
      clearInterval(clock)
    }
  }, [selectedRunId])

  const startRun = () => {
    setStarting(true)
    setError(null)
    api
      .runSchedule(scheduleIdNum)
      .then((r) => {
        setSelectedRunId(r.id)
        return loadHistory()
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setStarting(false))
  }

  if (error && !schedule) return <p>加载失败:{error}</p>

  // 切换选中记录时不展示上一次的旧数据
  const run = selectedRunId !== null && runData?.id === selectedRunId ? runData : null
  const progress =
    run && run.total ? Math.round((run.current / run.total) * 100) : null
  const history = toHistory(runs)

  return (
    <RunDetailView
      ai={
        <DetailAgentPanel
          context={{
            type: 'script',
            id: `schedule:${scheduleIdNum}`,
            title: `定时任务 ${schedule?.title ?? scheduleIdNum}`,
            summary: [
              schedule?.cron ? `cron：${schedule.cron}` : '',
              check?.scriptPath ? `脚本：${check.scriptPath}` : '',
              run
                ? `最近运行：${runStatusMeta[run.status].text}，当前步骤 ${run.current}/${run.total ?? '—'}`
                : '暂无运行记录',
            ]
              .filter(Boolean)
              .join('；'),
          }}
          emptyTitle={`定时任务 ${schedule?.title ?? scheduleIdNum} 的独立 AI 会话`}
          emptyHint="让 AI 分析调度计划、脚本或历史运行结果"
          placeholder="询问当前定时任务或运行结果…"
        />
      }
      breadcrumb={[
        { label: '定时任务', to: '/schedules' },
        { label: projectName ?? '…', to: `/projects/${projectId}` },
        { label: schedule?.title ?? '…' },
      ]}
      title={`定时任务：${schedule?.title ?? '…'}`}
      subtitle={
        schedule ? (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1" title={check?.scriptPath}>
            <code>{schedule.cron}</code>
            <span>·</span>
            <span>
              下次执行：
              {schedule.nextRunAt
                ? new Date(schedule.nextRunAt).toLocaleString()
                : '—'}
            </span>
            <span>·</span>
            <span>已运行 {schedule.runCount} 次</span>
            {check && (
              <>
                <span>·</span>
                <span>
                  脚本：
                  <Link
                    to={`/projects/${projectId}/checks/${check.id}`}
                    className="underline"
                  >
                    {check.code}
                  </Link>
                </span>
              </>
            )}
          </p>
        ) : undefined
      }
      actions={
        <Button size="sm" onClick={startRun} disabled={starting}>
          {starting ? '启动中…' : '运行'}
        </Button>
      }
      error={error}
      run={
        run
          ? {
              statusBadge: <RunStatusBadge status={run.status} />,
              total: run.total,
              current: run.current,
              progress,
              duration: formatDuration(run, now),
              message: run.message,
            }
          : null
      }
      history={history}
      selectedRunId={selectedRunId}
      onSelectRun={setSelectedRunId}
      terminal={
        run ? <Terminal run={run} scriptPath={check?.scriptPath} /> : undefined
      }
      emptyText="暂无运行记录，点击“运行”手动触发一次。"
      extra={
        schedule ? (
          <div className="grid gap-3 lg:grid-cols-2">
            <section className="rounded-[var(--radius-lg)] border border-border bg-background p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-foreground-intense">
                  任务操作
                </h2>
                <Badge variant={schedule.enabled ? 'success' : 'secondary'}>
                  {schedule.enabled ? '已启用' : '已停用'}
                </Badge>
              </div>
              <div className="flex flex-wrap gap-2">
                <ScheduleFormDialog
                  projectId={projectId}
                  checks={checks}
                  schedule={schedule}
                  onSaved={loadSchedule}
                />
                <DeleteScheduleButton
                  schedule={schedule}
                  onDeleted={() =>
                    api
                      .deleteSchedule(schedule.id)
                      .then(() => navigate(`/projects/${projectId}`))
                      .catch((e: Error) => setError(e.message))
                  }
                />
              </div>
            </section>

            <section className="rounded-[var(--radius-lg)] border border-border bg-background p-3">
              <h2 className="mb-2 text-sm font-semibold text-foreground-intense">
                计划
              </h2>
              {schedule.nextRuns ? (
                <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                  {schedule.nextRuns.map((t) => (
                    <li key={t}>{new Date(t).toLocaleString()}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-foreground-muted">
                  已停用，暂无执行计划
                </p>
              )}
            </section>
          </div>
        ) : undefined
      }
    />
  )
}
