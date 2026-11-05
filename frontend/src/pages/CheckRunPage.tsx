import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Badge } from '@appica/ui-react/badge'
import { Button } from '@appica/ui-react/button'
import { api, type CheckRun, type ProjectCheck } from '../lib/api'
import { visibleEventSource } from '../lib/event-source'
import { DetailAgentPanel } from '../components/detail/DetailAgentPanel'
import {
  RunDetailView,
  type RunHistoryItem,
} from '../components/detail/RunDetailView'
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

export function CheckRunPage() {
  const { id, checkId } = useParams<{ id: string; checkId: string }>()
  const projectId = Number(id)
  const checkIdNum = Number(checkId)

  const [check, setCheck] = useState<ProjectCheck | null>(null)
  const [projectName, setProjectName] = useState<string | null>(null)
  const [runs, setRuns] = useState<CheckRun[]>([])
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null)
  const [runData, setRunData] = useState<CheckRun | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  // 仅用于驱动运行中耗时每秒重渲染（SSE 事件间隔可能较长）
  const [now, setNow] = useState(() => Date.now())

  const loadHistory = useCallback(
    () =>
      api.listCheckRuns(checkIdNum).then((list) => {
        setRuns(list)
        setSelectedRunId((cur) => cur ?? list[0]?.id ?? null)
      }),
    [checkIdNum],
  )

  useEffect(() => {
    api
      .getCheck(checkIdNum)
      .then(setCheck)
      .catch((e: Error) => setError(e.message))
    // 面包屑的项目层级
    api
      .getProject(projectId)
      .then((p) => setProjectName(p.name))
      .catch(() => setProjectName(null))
    loadHistory().catch((e: Error) => setError(e.message))
  }, [checkIdNum, projectId, loadHistory])

  // 通过 SSE 订阅选中的运行记录：实时推送进度，终态推送后服务端自动完成
  const loadHistoryRef = useRef(loadHistory)
  useEffect(() => {
    loadHistoryRef.current = loadHistory
  }, [loadHistory])
  useEffect(() => {
    if (selectedRunId === null) return
    let finished = false
    const es = visibleEventSource(`/api/checks/runs/${selectedRunId}/stream`)
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
      .startCheckRun(checkIdNum)
      .then((r) => {
        setSelectedRunId(r.id)
        return loadHistory()
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setStarting(false))
  }

  if (error && !check) return <p>加载失败:{error}</p>

  // 切换选中记录时不展示上一次的旧数据
  const run = selectedRunId !== null && runData?.id === selectedRunId ? runData : null
  const progress =
    run && run.total ? Math.round((run.current / run.total) * 100) : null

  return (
    <RunDetailView
      ai={
        <DetailAgentPanel
          context={{
            type: 'script',
            id: `check:${checkIdNum}`,
            title: `检查 ${check?.code ?? checkIdNum}`,
            summary: [
              check?.scriptPath ? `脚本：${check.scriptPath}` : '',
              run
                ? `最近运行：${runStatusMeta[run.status].text}，当前步骤 ${run.current}/${run.total ?? '—'}`
                : '暂无运行记录',
            ]
              .filter(Boolean)
              .join('；'),
          }}
          emptyTitle={`检查 ${check?.code ?? checkIdNum} 的独立 AI 会话`}
          emptyHint="让 AI 分析当前脚本、运行输出或历史记录"
          placeholder="询问当前检查脚本或运行结果…"
        />
      }
      breadcrumb={[
        { label: '检查', to: '/checks' },
        { label: projectName ?? '…', to: `/projects/${projectId}` },
        { label: check?.code ?? '…' },
      ]}
      title={`检查：${check?.code ?? '…'}`}
      subtitle={
        check?.scriptPath ? (
          <span className="block truncate" title={check.scriptPath}>
            {check.scriptPath}
          </span>
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
      history={toHistory(runs)}
      selectedRunId={selectedRunId}
      onSelectRun={setSelectedRunId}
      terminal={
        run ? <Terminal run={run} scriptPath={check?.scriptPath} /> : undefined
      }
      emptyText="暂无运行记录，点击“运行”开始。"
    />
  )
}
