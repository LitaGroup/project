import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Badge } from '@appica/ui-react/badge'
import { Button } from '@appica/ui-react/button'
import { api, type ExportRun, type ProjectExport } from '../lib/api'
import { DetailAgentPanel } from '../components/detail/DetailAgentPanel'
import {
  RunDetailView,
  type RunHistoryItem,
} from '../components/detail/RunDetailView'
import { Terminal } from '../components/Terminal'

const runStatusMeta: Record<
  ExportRun['status'],
  { text: string; variant: 'info' | 'success' | 'error' | 'warning' }
> = {
  running: { text: '运行中', variant: 'info' },
  success: { text: '通过', variant: 'success' },
  fail: { text: '未通过', variant: 'error' },
  error: { text: '异常', variant: 'warning' },
}

function RunStatusBadge({ status }: { status: ExportRun['status'] }) {
  const meta = runStatusMeta[status]
  return <Badge variant={meta.variant}>{meta.text}</Badge>
}

/** 耗时展示：运行中按 startedAt 实时计算，结束后用落库的 durationMs */
function formatDuration(run: ExportRun, now: number): string {
  const ms =
    run.durationMs ??
    (run.status === 'running'
      ? now - new Date(run.startedAt).getTime()
      : null)
  if (ms === null) return '—'
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`
}

function toHistory(runs: ExportRun[]): RunHistoryItem[] {
  return runs.slice(0, 5).map((run) => ({
    id: run.id,
    label: `${new Date(run.startedAt).toLocaleString()} · ${runStatusMeta[run.status].text}`,
  }))
}

/** 产物文件下载地址：/export-files/{exportId}/{runId}/{file}（file 逐段编码，支持子目录） */
function exportFileUrl(run: ExportRun, file: string): string {
  const encoded = file.split('/').map(encodeURIComponent).join('/')
  return `/export-files/${run.exportId}/${run.id}/${encoded}`
}

export function ExportRunPage() {
  const { id, exportId } = useParams<{ id: string; exportId: string }>()
  const projectId = Number(id)
  const exportIdNum = Number(exportId)

  const [exportItem, setExportItem] = useState<ProjectExport | null>(null)
  const [projectName, setProjectName] = useState<string | null>(null)
  const [runs, setRuns] = useState<ExportRun[]>([])
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null)
  const [runData, setRunData] = useState<ExportRun | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  // 仅用于驱动运行中耗时每秒重渲染
  const [now, setNow] = useState(() => Date.now())

  const loadHistory = useCallback(
    () =>
      api.listExportRuns(exportIdNum).then((list) => {
        setRuns(list)
        setSelectedRunId((cur) => cur ?? list[0]?.id ?? null)
      }),
    [exportIdNum],
  )

  useEffect(() => {
    api
      .getExport(exportIdNum)
      .then(setExportItem)
      .catch((e: Error) => setError(e.message))
    // 面包屑的项目层级
    api
      .getProject(projectId)
      .then((p) => setProjectName(p.name))
      .catch(() => setProjectName(null))
    loadHistory().catch((e: Error) => setError(e.message))
  }, [exportIdNum, projectId, loadHistory])

  // 通过 SSE 订阅选中的运行记录：实时推送进度，终态推送后服务端自动完成
  const loadHistoryRef = useRef(loadHistory)
  useEffect(() => {
    loadHistoryRef.current = loadHistory
  }, [loadHistory])
  useEffect(() => {
    if (selectedRunId === null) return
    let finished = false
    const es = new EventSource(`/api/exports/runs/${selectedRunId}/stream`)
    es.onmessage = (e: MessageEvent<string>) => {
      const r = JSON.parse(e.data) as ExportRun
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
      .startExportRun(exportIdNum)
      .then((r) => {
        setSelectedRunId(r.id)
        return loadHistory()
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setStarting(false))
  }

  if (error && !exportItem) return <p>加载失败:{error}</p>

  // 切换选中记录时不展示上一次的旧数据
  const run = selectedRunId !== null && runData?.id === selectedRunId ? runData : null
  const progress =
    run && run.total ? Math.round((run.current / run.total) * 100) : null
  const files = run?.files ?? []

  return (
    <RunDetailView
      ai={
        <DetailAgentPanel
          context={{
            type: 'script',
            id: `export:${exportIdNum}`,
            title: `导出 ${exportItem?.code ?? exportIdNum}`,
            summary: [
              exportItem?.scriptPath ? `脚本：${exportItem.scriptPath}` : '',
              run
                ? `最近运行：${runStatusMeta[run.status].text}，产物 ${files.length} 个`
                : '暂无运行记录',
            ]
              .filter(Boolean)
              .join('；'),
          }}
          emptyTitle={`导出 ${exportItem?.code ?? exportIdNum} 的独立 AI 会话`}
          emptyHint="让 AI 分析当前导出脚本、运行输出或产物"
          placeholder="询问当前导出脚本或产物…"
        />
      }
      breadcrumb={[
        { label: '导出', to: '/exports' },
        { label: projectName ?? '…', to: `/projects/${projectId}` },
        { label: exportItem?.code ?? '…' },
      ]}
      title={`导出：${exportItem?.code ?? '…'}`}
      subtitle={
        exportItem?.scriptPath ? (
          <span className="block truncate" title={exportItem.scriptPath}>
            {exportItem.scriptPath}
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
        run ? <Terminal run={run} scriptPath={exportItem?.scriptPath} /> : undefined
      }
      emptyText="暂无运行记录，点击“运行”开始。"
      extra={
        run && files.length > 0 ? (
          <section className="rounded-[var(--radius-lg)] border border-border bg-background p-3">
            <h2 className="mb-2 text-sm font-semibold text-foreground-intense">
              产物文件
            </h2>
            <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
              {files.map((f) => (
                <li key={f.file} className="flex min-w-0 flex-col">
                  <a
                    href={exportFileUrl(run, f.file)}
                    download
                    className="max-w-80 truncate underline"
                    title={f.file}
                  >
                    {f.title || f.file}
                  </a>
                  {f.title && f.title !== f.file && (
                    <span className="max-w-80 truncate text-xs text-foreground-muted">
                      {f.file}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ) : undefined
      }
    />
  )
}
