import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Badge } from '@appica/ui-react/badge'
import { Button } from '@appica/ui-react/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@appica/ui-react/select'
import {
  api,
  type AppVersion,
  type Project,
  type ProjectTest,
  type TestRun,
} from '../lib/api'
import { visibleEventSource } from '../lib/event-source'
import { DetailAgentPanel } from '../components/detail/DetailAgentPanel'
import {
  RunDetailView,
  type RunHistoryItem,
} from '../components/detail/RunDetailView'
import { NewDefectDialog } from '../components/NewDefectDialog'
import { Terminal } from '../components/Terminal'

const runStatusMeta: Record<
  TestRun['status'],
  { text: string; variant: 'info' | 'success' | 'error' | 'warning' }
> = {
  queued: { text: '排队中', variant: 'info' },
  running: { text: '运行中', variant: 'info' },
  success: { text: '通过', variant: 'success' },
  fail: { text: '未通过', variant: 'error' },
  error: { text: '异常', variant: 'warning' },
}

function RunStatusBadge({ status }: { status: TestRun['status'] }) {
  const meta = runStatusMeta[status]
  return <Badge variant={meta.variant}>{meta.text}</Badge>
}

/** 耗时展示：运行中按 startedAt 实时计算，结束后用落库的 durationMs */
function formatDuration(run: TestRun, now: number): string {
  const ms =
    run.durationMs ??
    (run.status === 'running'
      ? now - new Date(run.startedAt).getTime()
      : null)
  if (ms === null) return '—'
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`
}

function toHistory(runs: TestRun[]): RunHistoryItem[] {
  return runs.slice(0, 5).map((run) => ({
    id: run.id,
    label: `${new Date(run.startedAt).toLocaleString()} · ${runStatusMeta[run.status].text}`,
  }))
}

export function TestRunPage() {
  const { id, testId } = useParams<{ id: string; testId: string }>()
  const projectId = Number(id)
  const testIdNum = Number(testId)

  const [test, setTest] = useState<ProjectTest | null>(null)
  const [projectName, setProjectName] = useState<string | null>(null)
  const [runs, setRuns] = useState<TestRun[]>([])
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null)
  const [runData, setRunData] = useState<TestRun | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  // APP 测试运行需选 app 版本
  const [appVersions, setAppVersions] = useState<AppVersion[]>([])
  const [appVersionId, setAppVersionId] = useState<number | null>(null)
  // 仅用于驱动运行中耗时每秒重渲染
  const [now, setNow] = useState(() => Date.now())

  const loadHistory = useCallback(
    () =>
      api.listTestRuns(testIdNum).then((list) => {
        setRuns(list)
        setSelectedRunId((cur) => cur ?? list[0]?.id ?? null)
      }),
    [testIdNum],
  )

  useEffect(() => {
    api
      .getTest(testIdNum)
      .then((t) => {
        setTest(t)
        // APP 测试（device=android/ios）：加载匹配的 app 版本列表，默认选最新一条
        if (t.device === 'android' || t.device === 'ios') {
          api
            .listAppVersions(t.projectId ?? projectId)
            .then((list) => {
              const matched = list.filter((v) => v.platform === t.device)
              setAppVersions(matched)
              setAppVersionId(matched[0]?.id ?? null)
            })
            .catch(() => undefined)
        }
      })
      .catch((e: Error) => setError(e.message))
    // 面包屑的项目层级
    api
      .getProject(projectId)
      .then((p) => setProjectName(p.name))
      .catch(() => setProjectName(null))
    loadHistory().catch((e: Error) => setError(e.message))
  }, [testIdNum, projectId, loadHistory])

  // 通过 SSE 订阅选中的运行记录：实时推送进度，终态推送后服务端自动完成
  const loadHistoryRef = useRef(loadHistory)
  useEffect(() => {
    loadHistoryRef.current = loadHistory
  }, [loadHistory])
  useEffect(() => {
    if (selectedRunId === null) return
    let finished = false
    const es = visibleEventSource(`/api/tests/runs/${selectedRunId}/stream`)
    es.onmessage = (e: MessageEvent<string>) => {
      const r = JSON.parse(e.data) as TestRun
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
      .startTestRun(
        testIdNum,
        test?.device === 'android' || test?.device === 'ios'
          ? (appVersionId ?? undefined)
          : undefined,
      )
      .then((r) => {
        setSelectedRunId(r.id)
        return loadHistory()
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setStarting(false))
  }

  if (error && !test) return <p>加载失败:{error}</p>

  // 切换选中记录时不展示上一次的旧数据
  const run = selectedRunId !== null && runData?.id === selectedRunId ? runData : null
  const progress =
    run && run.total ? Math.round((run.current / run.total) * 100) : null
  // 失败项：可一键生成缺陷（来源=脚本，预填步骤/预期/实际）
  const failedItems = (run?.items ?? []).filter((i) => i.status === 'fail')
  const defectProject = {
    id: projectId,
    name: projectName ?? `#${projectId}`,
  } as Project

  return (
    <RunDetailView
      ai={
        <DetailAgentPanel
          context={{
            type: 'script',
            id: `test:${testIdNum}`,
            title: `测试 ${test?.code ?? testIdNum}`,
            summary: [
              test?.scriptPath ? `脚本：${test.scriptPath}` : '',
              test?.device ? `执行设备：${test.device}` : '',
              run
                ? `最近运行：${runStatusMeta[run.status].text}，当前步骤 ${run.current}/${run.total ?? '—'}`
                : '暂无运行记录',
            ]
              .filter(Boolean)
              .join('；'),
          }}
          emptyTitle={`测试 ${test?.code ?? testIdNum} 的独立 AI 会话`}
          emptyHint="让 AI 分析当前用例、运行输出或失败项"
          placeholder="询问当前测试用例或运行结果…"
        />
      }
      breadcrumb={[
        { label: '测试', to: '/tests' },
        { label: projectName ?? '…', to: `/projects/${projectId}` },
        { label: test?.code ?? '…' },
      ]}
      title={`测试：${test?.code ?? '…'}`}
      subtitle={
        test?.scriptPath ? (
          <span className="block truncate" title={test.scriptPath}>
            {test.scriptPath}
          </span>
        ) : undefined
      }
      actions={
        <>
          {test?.device !== 'h5' &&
            test?.device !== 'server' &&
            appVersions.length > 0 && (
              <Select
                value={appVersionId !== null ? String(appVersionId) : ''}
                onValueChange={(v) => setAppVersionId(v ? Number(v) : null)}
                items={Object.fromEntries(
                  appVersions.map((v) => [
                    String(v.id),
                    `${v.appTarget} ${v.version}`,
                  ]),
                )}
              >
                <SelectTrigger className="w-56">
                  <SelectValue placeholder="选择 app 版本" />
                </SelectTrigger>
                <SelectContent>
                  {appVersions.map((v) => (
                    <SelectItem key={v.id} value={String(v.id)}>
                      {v.appTarget} {v.version}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          <Button
            size="sm"
            onClick={startRun}
            // APP 测试可不选 app 版本（后端 appVersionId 可空：跳过装 app，依赖预装环境）
            disabled={starting}
          >
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
      terminal={
        run ? <Terminal run={run} scriptPath={test?.scriptPath} /> : undefined
      }
      emptyText="暂无运行记录，点击“运行”开始。"
      extra={
        failedItems.length > 0 ? (
          <section className="rounded-[var(--radius-lg)] border border-border bg-background p-3">
            <h2 className="mb-2 text-sm font-semibold text-foreground-intense">
              失败项（{failedItems.length}）
            </h2>
            <div className="flex flex-col gap-2">
              {failedItems.map((item, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between gap-2 text-sm"
                >
                  <span
                    className="min-w-0 flex-1 truncate"
                    title={item.title ?? item.message ?? ''}
                  >
                    {item.no !== undefined ? `${item.no}. ` : ''}
                    {item.title ?? item.message ?? '失败项'}
                  </span>
                  <NewDefectDialog
                    projects={[defectProject]}
                    preset={{
                      projectId,
                      testScript: test?.scriptPath,
                      expected: item.expect ?? item.title ?? item.message,
                      actual: item.real ?? item.message,
                    }}
                    trigger={
                      <Button variant="outline" size="sm">
                        生成缺陷
                      </Button>
                    }
                  />
                </div>
              ))}
            </div>
          </section>
        ) : undefined
      }
    />
  )
}
