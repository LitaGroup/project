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
import { api, type ExportRun, type ProjectExport } from '../lib/api'
import { PageBreadcrumb } from '../components/PageBreadcrumb'
import { Terminal } from '../components/Terminal'

const runStatusMeta: Record<
  ExportRun['status'],
  { text: string; variant: 'info' | 'success' | 'error' | 'warning' }
> = {
  running: { text: '运行中', variant: 'info' },
  success: { text: '成功', variant: 'success' },
  fail: { text: '失败', variant: 'error' },
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
    <div className="flex h-full gap-6">
      {/* 左侧：终端输出（撑满剩余高度，底部与页面对齐） */}
      <div className="flex min-w-0 flex-1 flex-col gap-6">
        <PageBreadcrumb
          items={[
            { label: '导出', to: '/exports' },
            { label: projectName ?? '…', to: `/projects/${projectId}` },
            { label: exportItem?.code ?? '…' },
          ]}
        />
        <section className="flex min-h-0 flex-1 flex-col">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold">
                导出：{exportItem?.code ?? '…'}
              </h2>
              {exportItem && (
                <p className="text-sm" title={exportItem.scriptPath}>
                  {exportItem.scriptPath}
                </p>
              )}
            </div>
            <Button size="sm" onClick={startRun} disabled={starting}>
              {starting ? '启动中…' : '运行'}
            </Button>
          </div>
          {error && <p className="mb-2 text-sm">操作失败:{error}</p>}
          {!run && <p className="text-sm">暂无运行记录，点击"运行"开始。</p>}
          {run && <Terminal run={run} scriptPath={exportItem?.scriptPath} />}
        </section>
      </div>

      {/* 右侧：运行状态 + 产物文件 + 历史记录 */}
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

        {run && files.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>产物文件</CardTitle>
            </CardHeader>
            <ul className="flex flex-col gap-2 px-6 pb-6 text-sm">
              {files.map((f) => (
                <li key={f.file} className="flex flex-col">
                  <a
                    href={exportFileUrl(run, f.file)}
                    download
                    className="truncate underline"
                    title={f.file}
                  >
                    {f.title || f.file}
                  </a>
                  {f.title && f.title !== f.file && (
                    <span className="truncate text-xs text-foreground-muted">
                      {f.file}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        )}

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
