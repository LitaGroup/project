import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
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
import { Badge } from '@appica/ui-react/badge'
import { Button } from '@appica/ui-react/button'
import { Progress } from '@appica/ui-react/progress'
import {
  api,
  SCRIPT_LIBRARY_KIND_ITEMS,
  type ScriptDescriptionStatus,
  type ScriptLibraryRun,
  type ScriptLibraryScriptDetail,
} from '../lib/api'
import { PageBreadcrumb } from '../components/PageBreadcrumb'
import { Terminal } from '../components/Terminal'

/** 描述生成状态展示 */
const descriptionStatusMeta: Record<
  ScriptDescriptionStatus,
  { text: string; variant: 'info' | 'success' | 'error' | 'warning' }
> = {
  pending: { text: '待生成', variant: 'warning' },
  running: { text: '生成中', variant: 'info' },
  done: { text: '已生成', variant: 'success' },
  error: { text: '生成失败', variant: 'error' },
}

const runStatusMeta: Record<
  ScriptLibraryRun['status'],
  { text: string; variant: 'info' | 'success' | 'error' | 'warning' }
> = {
  running: { text: '运行中', variant: 'info' },
  success: { text: '通过', variant: 'success' },
  fail: { text: '未通过', variant: 'error' },
  error: { text: '异常', variant: 'warning' },
}

function RunStatusBadge({ status }: { status: ScriptLibraryRun['status'] }) {
  const meta = runStatusMeta[status]
  return <Badge variant={meta.variant}>{meta.text}</Badge>
}

/** 耗时展示：运行中按 startedAt 实时计算，结束后用落库的 durationMs */
function formatDuration(run: ScriptLibraryRun, now: number): string {
  const ms =
    run.durationMs ??
    (run.status === 'running'
      ? now - new Date(run.startedAt).getTime()
      : null)
  if (ms === null) return '—'
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`
}

/** 产物文件下载地址：/export-files/library/{runId}/{file}（file 逐段编码，支持子目录） */
function libraryFileUrl(run: ScriptLibraryRun, file: string): string {
  const encoded = file.split('/').map(encodeURIComponent).join('/')
  return `/export-files/library/${run.id}/${encoded}`
}

/**
 * 脚本库脚本详情：源码查看 + 直接运行（无需登记到项目）。
 * 左侧终端实时输出，右侧运行状态 / 产物文件（导出脚本）/ 运行历史。
 */
export function ScriptLibraryDetailPage() {
  const [searchParams] = useSearchParams()
  const scriptPath = searchParams.get('path') ?? ''

  const [script, setScript] = useState<ScriptLibraryScriptDetail | null>(null)
  const [runs, setRuns] = useState<ScriptLibraryRun[]>([])
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null)
  const [runData, setRunData] = useState<ScriptLibraryRun | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [showSource, setShowSource] = useState(false)
  // 仅用于驱动运行中耗时每秒重渲染
  const [now, setNow] = useState(() => Date.now())

  const loadHistory = useCallback(() => {
    if (!scriptPath) return Promise.resolve()
    return api.listLibraryRuns(scriptPath).then((list) => {
      setRuns(list)
      setSelectedRunId((cur) => cur ?? list[0]?.id ?? null)
    })
  }, [scriptPath])

  useEffect(() => {
    if (!scriptPath) return
    api
      .getLibraryScript(scriptPath)
      .then(setScript)
      .catch((e: Error) => setError(e.message))
    loadHistory().catch((e: Error) => setError(e.message))
  }, [scriptPath, loadHistory])

  // 通过 SSE 订阅选中的运行记录：实时推送进度，终态推送后服务端自动完成
  const loadHistoryRef = useRef(loadHistory)
  useEffect(() => {
    loadHistoryRef.current = loadHistory
  }, [loadHistory])
  useEffect(() => {
    if (selectedRunId === null) return
    let finished = false
    const es = new EventSource(`/api/script-library/runs/${selectedRunId}/stream`)
    es.onmessage = (e: MessageEvent<string>) => {
      const r = JSON.parse(e.data) as ScriptLibraryRun
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
    if (!scriptPath) return
    setStarting(true)
    setError(null)
    api
      .startLibraryRun(scriptPath)
      .then((r) => {
        setSelectedRunId(r.id)
        return loadHistory()
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setStarting(false))
  }

  const regenerateDescription = () => {
    if (!scriptPath) return
    setRegenerating(true)
    setError(null)
    api
      .regenerateLibraryDescription(scriptPath)
      .then(() => {
        // 转入待生成后刷新详情（状态徽标更新为"待生成"）
        return api.getLibraryScript(scriptPath).then(setScript)
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setRegenerating(false))
  }

  if (!scriptPath) return <p>缺少 path 参数</p>

  // 切换选中记录时不展示上一次的旧数据
  const run =
    selectedRunId !== null && runData?.id === selectedRunId ? runData : null
  const progress =
    run && run.total ? Math.round((run.current / run.total) * 100) : null
  const files = run?.files ?? []

  return (
    <div className="flex h-full gap-6">
      {/* 左侧：脚本信息 + 终端输出（撑满剩余高度） */}
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <PageBreadcrumb
          items={[
            { label: '脚本库', to: '/docs/scripts' },
            { label: scriptPath },
          ]}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-xl font-semibold">
              <span className="truncate" title={scriptPath}>
                {scriptPath.split('/').pop() ?? scriptPath}
              </span>
              {script && (
                <Badge variant="secondary">
                  {SCRIPT_LIBRARY_KIND_ITEMS[script.kind]}
                </Badge>
              )}
            </h2>
            <p className="mt-0.5 truncate text-sm text-foreground-muted" title={scriptPath}>
              {scriptPath}
              {script?.revision && ` · 提交 ${script.revision.slice(0, 7)}`}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {script && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowSource((v) => !v)}
              >
                {showSource ? '收起源码' : '查看源码'}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={regenerateDescription}
              disabled={regenerating || !script || script.descriptionStatus === 'running'}
            >
              {regenerating ? '提交中…' : '重新生成描述'}
            </Button>
            {script?.githubUrl && (
              <Button variant="ghost" size="sm" render={<a href={script.githubUrl} target="_blank" rel="noreferrer" />}>
                GitHub
              </Button>
            )}
            <Button size="sm" onClick={startRun} disabled={starting || !script}>
              {starting ? '启动中…' : '运行'}
            </Button>
          </div>
        </div>

        {script && (script.description || script.descriptionStatus) && (
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <span className="shrink-0 text-foreground-muted">描述：</span>
            {script.description ? (
              <span>{script.description}</span>
            ) : (
              <span className="text-foreground-muted">
                尚未生成，由「脚本描述机器人」分析代码后自动补充
              </span>
            )}
            {script.descriptionStatus && script.descriptionStatus !== 'done' && (
              <Badge variant={descriptionStatusMeta[script.descriptionStatus].variant}>
                {descriptionStatusMeta[script.descriptionStatus].text}
              </Badge>
            )}
          </p>
        )}

        {error && <p className="text-sm">操作失败:{error}</p>}

        {showSource && script && (
          <pre className="max-h-72 shrink-0 overflow-auto rounded-[var(--radius-md)] bg-background-muted p-4 font-mono text-xs leading-5">
            {script.content}
          </pre>
        )}

        <section className="flex min-h-0 flex-1 flex-col">
          {!run && !error && (
            <p className="text-sm">暂无运行记录，点击"运行"开始。</p>
          )}
          {run && <Terminal run={run} scriptPath={run.scriptPath} />}
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
                    href={libraryFileUrl(run, f.file)}
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

        {script && script.projectIds.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>已登记项目</CardTitle>
            </CardHeader>
            <p className="px-6 pb-6 text-sm">
              {script.projectIds.map((pid, i) => (
                <span key={pid}>
                  {i > 0 && '、'}
                  <Link
                    to={`/projects/${pid}`}
                    className="text-foreground-intense underline"
                  >
                    项目 #{pid}
                  </Link>
                </span>
              ))}
            </p>
          </Card>
        )}
      </aside>
    </div>
  )
}
