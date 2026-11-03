import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Badge } from '@appica/ui-react/badge'
import { Button } from '@appica/ui-react/button'
import {
  api,
  SCRIPT_LIBRARY_KIND_ITEMS,
  type ScriptDescriptionStatus,
  type ScriptLibraryRun,
  type ScriptLibraryScriptDetail,
} from '../lib/api'
import { DetailAgentPanel } from '../components/detail/DetailAgentPanel'
import {
  RunDetailView,
  type RunHistoryItem,
} from '../components/detail/RunDetailView'
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

function toHistory(runs: ScriptLibraryRun[]): RunHistoryItem[] {
  return runs.slice(0, 5).map((run) => ({
    id: run.id,
    label: `${new Date(run.startedAt).toLocaleString()} · ${runStatusMeta[run.status].text}`,
  }))
}

/** 产物文件下载地址：/export-files/library/{runId}/{file}（file 逐段编码，支持子目录） */
function libraryFileUrl(run: ScriptLibraryRun, file: string): string {
  const encoded = file.split('/').map(encodeURIComponent).join('/')
  return `/export-files/library/${run.id}/${encoded}`
}

/**
 * 脚本库脚本详情：源码查看 + 直接运行（无需登记到项目）。
 * 正文承载脚本信息、终端与运行资料，右侧统一为「我的 AI」。
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
        // 转入待生成后刷新详情（状态徽标更新为“待生成”）
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
  const fileName = scriptPath.split('/').pop() ?? scriptPath

  return (
    <RunDetailView
      ai={
        <DetailAgentPanel
          context={{
            type: 'script',
            id: `library:${scriptPath}`,
            title: `脚本 ${fileName}`,
            summary: [
              script?.kind ? `类型：${SCRIPT_LIBRARY_KIND_ITEMS[script.kind]}` : '',
              `路径：${scriptPath}`,
              script?.description ? `描述：${script.description}` : '',
              run
                ? `最近运行：${runStatusMeta[run.status].text}，产物 ${files.length} 个`
                : '暂无运行记录',
            ]
              .filter(Boolean)
              .join('；'),
          }}
          emptyTitle={`${fileName} 的独立 AI 会话`}
          emptyHint="让 AI 分析脚本源码、描述或运行结果"
          placeholder="询问当前脚本或运行结果…"
        />
      }
      breadcrumb={[
        { label: '脚本库', to: '/docs/scripts' },
        { label: scriptPath },
      ]}
      title={fileName}
      subtitle={
        <p className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 truncate" title={scriptPath}>
            {scriptPath}
          </span>
          {script && (
            <Badge variant="secondary">
              {SCRIPT_LIBRARY_KIND_ITEMS[script.kind]}
            </Badge>
          )}
          {script?.revision && (
            <span className="text-xs text-foreground-subtle">
              提交 {script.revision.slice(0, 7)}
            </span>
          )}
          {script && (script.description || script.descriptionStatus) && (
            <span className="flex min-w-0 items-center gap-2">
              <span className="shrink-0 text-foreground-subtle">描述：</span>
              <span className="min-w-0 truncate" title={script.description ?? ''}>
                {script.description ?? '尚未生成'}
              </span>
              {script.descriptionStatus &&
                script.descriptionStatus !== 'done' && (
                  <Badge
                    variant={
                      descriptionStatusMeta[script.descriptionStatus].variant
                    }
                  >
                    {descriptionStatusMeta[script.descriptionStatus].text}
                  </Badge>
                )}
            </span>
          )}
        </p>
      }
      actions={
        <>
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
            disabled={
              regenerating || !script || script.descriptionStatus === 'running'
            }
          >
            {regenerating ? '提交中…' : '重新生成描述'}
          </Button>
          {script?.githubUrl && (
            <Button
              variant="ghost"
              size="sm"
              render={
                <a
                  href={script.githubUrl}
                  target="_blank"
                  rel="noreferrer"
                />
              }
            >
              GitHub
            </Button>
          )}
          <Button size="sm" onClick={startRun} disabled={starting || !script}>
            {starting ? '启动中…' : '运行'}
          </Button>
        </>
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
      beforeTerminal={
        showSource && script ? (
          <pre className="max-h-64 shrink-0 overflow-auto rounded-[var(--radius-md)] bg-background-muted p-4 font-mono text-xs leading-5">
            {script.content}
          </pre>
        ) : undefined
      }
      terminal={
        run ? <Terminal run={run} scriptPath={run.scriptPath} /> : undefined
      }
      emptyText="暂无运行记录，点击“运行”开始。"
      extra={
        files.length > 0 || script?.projectIds.length ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {run && files.length > 0 && (
              <section className="rounded-[var(--radius-lg)] border border-border bg-background p-3">
                <h2 className="mb-2 text-sm font-semibold text-foreground-intense">
                  产物文件
                </h2>
                <ul className="flex flex-col gap-1.5 text-sm">
                  {files.map((f) => (
                    <li key={f.file} className="flex min-w-0 flex-col">
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
              </section>
            )}
            {script && script.projectIds.length > 0 && (
              <section className="rounded-[var(--radius-lg)] border border-border bg-background p-3">
                <h2 className="mb-2 text-sm font-semibold text-foreground-intense">
                  已登记项目
                </h2>
                <p className="text-sm">
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
              </section>
            )}
          </div>
        ) : undefined
      }
    />
  )
}
