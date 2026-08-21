import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  Card,
  CardHeader,
  CardTitle,
} from '@appica/ui-react/card'
import {
  Table,
  TableBody,
  TableRow,
  TableCell,
} from '@appica/ui-react/table'
import { Button } from '@appica/ui-react/button'
import { Badge } from '@appica/ui-react/badge'
import { Progress } from '@appica/ui-react/progress'
import { api, type CheckRun, type ProjectCheck } from '../lib/api'
import { PageBreadcrumb } from '../components/PageBreadcrumb'

const runStatusMeta: Record<
  CheckRun['status'],
  { text: string; variant: 'info' | 'success' | 'error' | 'warning' }
> = {
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

/** 终端样式面板（Gruvbox Dark 主题，见 index.css）：原样打印脚本输出行，
    按协议类型着色，运行中自动滚到底部 */
function Terminal({
  run,
  scriptPath,
}: {
  run: CheckRun
  scriptPath?: string
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const lineCount = run.output?.length ?? 0

  useEffect(() => {
    const box = boxRef.current
    if (box) box.scrollTop = box.scrollHeight
  }, [lineCount])

  return (
    <div
      ref={boxRef}
      className="terminal-gruvbox min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-all rounded-[var(--radius-md)] p-4 font-mono text-xs leading-5"
    >
      <p>
        <span className="term-prompt">$</span>{' '}
        <span className="term-muted">node {scriptPath ?? ''}</span>
      </p>
      {(run.output ?? []).map((line, i) => (
        <p key={i} className={terminalLineClass(line)}>
          {line}
        </p>
      ))}
      {run.status === 'running' && (
        <span className="term-muted animate-pulse">▊</span>
      )}
    </div>
  )
}

/** 终端行着色（Gruvbox）：失败红、跳过黄、start/done 青、日志灰，其余默认前景色 */
function terminalLineClass(line: string): string {
  if (line.includes('"status":"fail"')) return 'term-error'
  if (line.includes('"status":"skip"')) return 'term-warning'
  if (line.startsWith('[start]') || line.startsWith('[done]')) {
    return 'term-info'
  }
  if (line.startsWith('[log]') || !line.startsWith('[')) {
    return 'term-muted'
  }
  return ''
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
  // 仅用于驱动运行中耗时每秒重渲染（轮询本身也会触发）
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
    const es = new EventSource(`/api/checks/runs/${selectedRunId}/stream`)
    es.onmessage = (e: MessageEvent<string>) => {
      const r = JSON.parse(e.data) as CheckRun
      setRunData(r)
      setNow(Date.now())
      if (r.status !== 'running') {
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
    <div className="flex h-full gap-6">
      {/* 左侧：终端输出（撑满剩余高度，底部与页面对齐） */}
      <div className="flex min-w-0 flex-1 flex-col gap-6">
        <PageBreadcrumb
          items={[
            { label: '检查', to: '/checks' },
            { label: projectName ?? '…', to: `/projects/${projectId}` },
            { label: check?.code ?? '…' },
          ]}
        />
        <section className="flex min-h-0 flex-1 flex-col">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold">
                检查：{check?.code ?? '…'}
              </h2>
              {check && (
                <p className="text-sm" title={check.scriptPath}>
                  {check.scriptPath}
                </p>
              )}
            </div>
            <Button size="sm" onClick={startRun} disabled={starting}>
              {starting ? '启动中…' : '运行'}
            </Button>
          </div>
          {error && <p className="mb-2 text-sm">操作失败:{error}</p>}
          {!run && <p className="text-sm">暂无运行记录，点击"运行"开始。</p>}
          {run && <Terminal run={run} scriptPath={check?.scriptPath} />}
        </section>
      </div>

      {/* 右侧：运行状态 + 历史记录 */}
      <aside className="flex w-80 shrink-0 flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>运行状态</CardTitle>
          </CardHeader>
          {run ? (
            <dl className="flex flex-col gap-3 px-6 pb-6 text-sm">
              <div className="flex justify-between">
                <dt>状态</dt>
                <dd>
                  <RunStatusBadge status={run.status} />
                </dd>
              </div>
              <div className="flex justify-between">
                <dt>总步数</dt>
                <dd>{run.total ?? '—'}</dd>
              </div>
              <div className="flex justify-between">
                <dt>当前步数</dt>
                <dd>{run.current}</dd>
              </div>
              <div className="flex flex-col gap-1">
                <div className="flex justify-between">
                  <dt>进度</dt>
                  <dd>{progress !== null ? `${progress}%` : '—'}</dd>
                </div>
                <Progress value={progress} />
              </div>
              <div className="flex justify-between">
                <dt>耗时</dt>
                <dd>{formatDuration(run, now)}</dd>
              </div>
              {run.message && (
                <div className="flex flex-col gap-1">
                  <dt>消息</dt>
                  <dd className="whitespace-pre-wrap">{run.message}</dd>
                </div>
              )}
            </dl>
          ) : (
            <p className="px-6 pb-6 text-sm">暂无运行记录</p>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>运行历史</CardTitle>
          </CardHeader>
          {/* 只展示最近 5 条，无标题行（列义自明） */}
          <Table>
            <TableBody>
              {runs.slice(0, 5).map((r) => (
                <TableRow
                  key={r.id}
                  className={
                    r.id === selectedRunId ? 'bg-background-muted' : undefined
                  }
                  onClick={() => setSelectedRunId(r.id)}
                >
                  <TableCell>
                    {new Date(r.startedAt).toLocaleString()}
                  </TableCell>
                  <TableCell className="w-20">
                    <RunStatusBadge status={r.status} />
                  </TableCell>
                </TableRow>
              ))}
              {runs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={2}>暂无运行记录</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Card>
      </aside>
    </div>
  )
}
