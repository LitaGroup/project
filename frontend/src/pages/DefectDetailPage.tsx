import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Viewer } from '@bytemd/react'
import gfm from '@bytemd/plugin-gfm'
import 'bytemd/dist/index.css'
import 'github-markdown-css/github-markdown.css'
import {
  Card,
  CardHeader,
  CardTitle,
} from '@appica/ui-react/card'
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
  DialogClose,
} from '@appica/ui-react/dialog'
import {
  Autocomplete,
  AutocompleteInput,
  AutocompleteContent,
  AutocompleteEmpty,
  AutocompleteList,
  AutocompleteItem,
} from '@appica/ui-react/autocomplete'
import { Button } from '@appica/ui-react/button'
import { Badge } from '@appica/ui-react/badge'
import { Textarea } from '@appica/ui-react/textarea'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@appica/ui-react/select'
import {
  api,
  DEFECT_PLATFORMS,
  DEFECT_PRIORITIES,
  DEFECT_STATUSES,
  type Defect,
  type DefectChangeRecord,
  type DefectPriority,
  type DefectStatus,
  type ProjectTest,
  type TestRun,
} from '../lib/api'
import { DefectStatusBadge, DefectPriorityBadge } from '../components/StatusBadge'
import { PageBreadcrumb } from '../components/PageBreadcrumb'
import { Terminal } from '../components/Terminal'
import { DefectImagesField } from '../components/DefectImagesField'

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

/** 时间展示：空值显示 — */
function formatTime(value: string | null): string {
  return value ? new Date(value).toLocaleString() : '—'
}

const plugins = [gfm()]

/** 明细文本内联：折行折叠为空格，避免破坏 Markdown 结构 */
function inline(value: string): string {
  return value.replace(/\s*\n\s*/g, ' ').trim()
}

/**
 * 把一次运行整理成 Markdown 报告：脚本 message 作为概述，
 * 逐项明细（步骤/预期/实际/信息）按结果图标列出，供 Viewer 渲染。
 */
function buildRunMarkdown(run: TestRun): string {
  const blocks: string[] = []
  const message = run.message?.trim()
  if (message) blocks.push(message)
  for (const it of run.items ?? []) {
    const icon =
      it.status === 'success'
        ? '✅'
        : it.status === 'fail'
          ? '❌'
          : it.status === 'skip'
            ? '⏭️'
            : '•'
    const head = `${icon} **${it.no !== undefined ? `${it.no}. ` : ''}${inline(
      it.title ?? it.message ?? '步骤',
    )}**`
    const sub: string[] = []
    if (it.expect) sub.push(`- 预期：${inline(it.expect)}`)
    if (it.real) sub.push(`- 实际：${inline(it.real)}`)
    if (it.message && it.message !== it.title) {
      sub.push(`- 信息：${inline(it.message)}`)
    }
    blocks.push([head, ...sub].join('\n'))
  }
  return blocks.join('\n\n')
}

/** 缺陷详情：预期/实际 + 图片 + 测试运行结果 + 变更记录；属性只保留 端/预期/实际/图片/用例脚本/状态 */
export function DefectDetailPage() {
  const { id, defectId } = useParams<{ id: string; defectId: string }>()
  const projectId = Number(id)
  const defectIdNum = Number(defectId)

  const [defect, setDefect] = useState<Defect | null>(null)
  const [records, setRecords] = useState<DefectChangeRecord[]>([])
  const [projectName, setProjectName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // 测试运行结果：当前展示的运行（默认该测试最近一次），运行验证后实时订阅更新
  const [run, setRun] = useState<TestRun | null>(null)
  const [runId, setRunId] = useState<number | null>(null)
  const [streamError, setStreamError] = useState<string | null>(null)
  // 用例：按 testScript 匹配到的已登记测试（用于展示测试名称而非脚本路径）
  const [test, setTest] = useState<ProjectTest | null>(null)
  // 仅用于驱动运行中耗时每秒重渲染
  const [now, setNow] = useState(() => Date.now())
  // 原始输出默认折叠，运行结果以 Markdown 文本描述为主
  const [showRaw, setShowRaw] = useState(false)

  const reload = useCallback(() => {
    api
      .getDefect(defectIdNum)
      .then(setDefect)
      .catch((e: Error) => setError(e.message))
    // 变更记录与缺陷同刷：状态流转/编辑/运行验证成功后都能看到新记录
    api
      .listDefectRecords(defectIdNum)
      .then(setRecords)
      .catch(() => setRecords([]))
  }, [defectIdNum])

  useEffect(() => {
    reload()
    api
      .getProject(projectId)
      .then((p) => setProjectName(p.name))
      .catch(() => setProjectName(null))
  }, [projectId, reload])

  const onVerifyStarted = useCallback((r: TestRun) => {
    setRun(r)
    setRunId(r.id)
    setStreamError(null)
  }, [])

  const testScript = defect?.testScript ?? null
  const defectProjectId = defect?.projectId ?? null
  const runMarkdown = run ? buildRunMarkdown(run) : ''

  // 加载测试运行结果：按 defect.testScript 找到登记的测试，取其最近一次运行
  useEffect(() => {
    if (!testScript) return
    api
      .listTests(defectProjectId ?? undefined)
      .then((tests) => tests.find((t) => t.scriptPath === testScript) ?? null)
      .then((t) => {
        setTest(t)
        if (t) return api.listTestRuns(t.id)
        return Promise.resolve<TestRun[]>([])
      })
      .then((runs) => {
        const last = runs[0] ?? null
        setRun(last)
        setRunId(last?.id ?? null)
      })
      .catch(() => {
        setRun(null)
        setRunId(null)
      })
  }, [testScript, defectProjectId])

  // SSE 实时订阅选中的运行记录：运行中逐条推送，终态推送后自动完成
  useEffect(() => {
    if (!testScript || runId === null) return
    let finished = false
    const es = new EventSource(`/api/tests/runs/${runId}/stream`)
    es.onmessage = (e: MessageEvent<string>) => {
      const r = JSON.parse(e.data) as TestRun
      setRun(r)
      setNow(Date.now())
      // queued（远程执行排队中）也是活跃状态，不能关闭流
      if (r.status !== 'running' && r.status !== 'queued') {
        finished = true
        es.close()
        // 脚本回归通过后后端会自动把"修复"态缺陷流转为"关闭"，刷新详情以反映状态/时间
        if (r.status === 'success') reload()
      }
    }
    es.onerror = () => {
      es.close()
      if (!finished) setStreamError('实时连接中断，结果可能不完整')
    }
    const clock = setInterval(() => setNow(Date.now()), 1000)
    return () => {
      es.close()
      clearInterval(clock)
    }
  }, [runId, testScript, reload])

  if (error && !defect) return <p>加载失败:{error}</p>
  if (!defect) return <p>加载中…</p>

  return (
    <div className="flex gap-6">
      {/* 左侧：预期 + 实际 + 图片 + 测试运行结果 + 变更记录 */}
      <div className="flex min-w-0 flex-1 flex-col gap-6">
        <PageBreadcrumb
          items={[
            { label: '缺陷', to: '/defects' },
            { label: projectName ?? '…', to: `/projects/${projectId}` },
            { label: defect.expected.split('\n')[0] || `缺陷 ${defect.id}` },
          ]}
        />
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <section>
            <h2 className="mb-3 text-xl font-semibold">预期功能描述</h2>
            <Card>
              <p className="whitespace-pre-wrap px-6 py-4 text-sm">
                {defect.expected}
              </p>
            </Card>
          </section>
          <section>
            <h2 className="mb-3 text-xl font-semibold">实际结果描述</h2>
            <Card>
              <p className="whitespace-pre-wrap px-6 py-4 text-sm">
                {defect.actual}
              </p>
            </Card>
          </section>
        </div>
        {defect.images && defect.images.length > 0 && (
          <section>
            <h2 className="mb-3 text-xl font-semibold">
              图片（{defect.images.length}）
            </h2>
            <div className="flex flex-wrap gap-3">
              {defect.images.map((img) => (
                <a key={img} href={img} target="_blank" rel="noreferrer">
                  <img
                    src={img}
                    alt="缺陷图片"
                    className="h-40 rounded-[var(--radius-md)] border border-border-strong object-cover"
                  />
                </a>
              ))}
            </div>
          </section>
        )}
        <section>
          <h2 className="mb-3 text-xl font-semibold">测试运行结果</h2>
          {defect.testScript ? (
            run ? (
              <Card>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border-strong px-6 py-4 text-sm">
                  <RunStatusBadge status={run.status} />
                  <span>
                    开始：{new Date(run.startedAt).toLocaleString()}
                  </span>
                  <span>耗时：{formatDuration(run, now)}</span>
                  {run.total !== null && (
                    <span>
                      步骤：{run.current}/{run.total}
                    </span>
                  )}
                  {run.success !== null && (
                    <span>
                      成功{' '}
                      <span className="text-success-emphasis">{run.success}</span>
                      /失败{' '}
                      <span
                        className={
                          (run.fail ?? 0) > 0
                            ? 'text-error-emphasis'
                            : 'text-success-emphasis'
                        }
                      >
                        {run.fail}
                      </span>
                      /跳过 {run.skip ?? 0}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowRaw((v) => !v)}
                    className="ml-auto text-xs text-foreground-muted underline"
                  >
                    {showRaw ? '隐藏原始输出' : '显示原始输出'}
                  </button>
                </div>
                <div className="markdown-body px-6 py-4 text-sm">
                  {runMarkdown ? (
                    <Viewer value={runMarkdown} plugins={plugins} />
                  ) : (
                    <p className="text-foreground-muted">
                      （本次运行未产生文本描述，可查看原始输出）
                    </p>
                  )}
                </div>
                {streamError && (
                  <p className="px-6 pb-2 text-sm">{streamError}</p>
                )}
                {showRaw && (
                  <div className="flex h-72 flex-col p-4 pt-0">
                    <Terminal run={run} scriptPath={defect.testScript} />
                  </div>
                )}
              </Card>
            ) : (
              <Card>
                <p className="px-6 py-4 text-sm">
                  该用例暂无运行记录，点击"运行验证"开始。
                </p>
              </Card>
            )
          ) : (
            <Card>
              <p className="px-6 py-4 text-sm">
                未配置用例，暂无运行结果。
              </p>
            </Card>
          )}
        </section>
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xl font-semibold">
              变更记录（{records.length}）
            </h2>
            <AddRecordDialog defectId={defectIdNum} onSaved={reload} />
          </div>
          {records.length === 0 ? (
            <Card>
              <p className="px-6 py-4 text-sm">暂无变更记录。</p>
            </Card>
          ) : (
            <Card>
              <ul className="flex flex-col divide-y px-6 py-2 text-sm">
                {records.map((r) => (
                  <li key={r.id} className="flex flex-col gap-1 py-3">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <DefectStatusBadge status={r.status} />
                      <Badge variant="soft">{r.source}</Badge>
                      <span className="text-xs text-foreground-muted">
                        {formatTime(r.createdAt)}
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap">{r.content}</p>
                    {r.remark && (
                      <p className="whitespace-pre-wrap text-foreground-muted">
                        {r.remark}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </section>
      </div>

      {/* 右侧：属性 */}
      <aside className="w-80 shrink-0">
        <Card>
          <CardHeader>
            <CardTitle>缺陷信息</CardTitle>
          </CardHeader>
          <dl className="flex flex-col gap-3 px-6 pb-6 text-sm">
            <div className="flex items-center justify-between">
              <dt>状态</dt>
              <dd className="flex items-center gap-2">
                <DefectStatusBadge status={defect.status} />
                <StatusSelect defect={defect} onChanged={reload} />
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt>优先级</dt>
              <dd>
                <DefectPriorityBadge priority={defect.priority} />
              </dd>
            </div>
            <div className="flex justify-between">
              <dt>端</dt>
              <dd>{defect.platform ?? '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt>图片</dt>
              <dd>{defect.images?.length ?? 0} 张</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt>用例</dt>
              <dd>
                <span
                  className="max-w-40 truncate"
                  title={defect.testScript ?? ''}
                >
                  {test?.code ?? defect.testScript ?? '—'}
                </span>
              </dd>
            </div>
            <div className="flex justify-between">
              <dt>创建时间</dt>
              <dd>{formatTime(defect.createdAt)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>修复时间</dt>
              <dd>{formatTime(defect.fixedAt)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>验证时间</dt>
              <dd>{formatTime(defect.verifiedAt)}</dd>
            </div>
          </dl>
          <div className="flex flex-col gap-2 px-6 pb-6">
            <EditContentDialog defect={defect} onSaved={reload} />
            <VerifyButton
              defect={defect}
              running={run?.status === 'running' || run?.status === 'queued'}
              onStarted={onVerifyStarted}
            />
            {defect.testScript ? (
              <p className="text-xs text-foreground-muted">
                脚本回归通过后自动流转为"关闭"
              </p>
            ) : (
              <p className="text-xs text-foreground-muted">
                未配置用例，可手动标记修复/关闭
              </p>
            )}
          </div>
        </Card>
      </aside>
    </div>
  )
}

/** 修改状态：置"修复"表示研发已修复；脚本回归通过后自动关闭 */
function StatusSelect({
  defect,
  onChanged,
}: {
  defect: Defect
  onChanged: () => void
}) {
  const [error, setError] = useState<string | null>(null)

  const change = (status: string) => {
    if (status === defect.status) return
    setError(null)
    api
      .updateDefect(defect.id, { status: status as DefectStatus })
      .then(onChanged)
      .catch((e: Error) => setError(e.message))
  }

  const options = DEFECT_STATUSES.includes(defect.status as DefectStatus)
    ? DEFECT_STATUSES
    : [...DEFECT_STATUSES, defect.status]

  return (
    <span className="flex flex-col items-end gap-1">
      <Select
        value={defect.status}
        onValueChange={(v) => change(v as string)}
        items={Object.fromEntries(options.map((s) => [s, s]))}
      >
        <SelectTrigger className="w-28">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((s) => (
            <SelectItem key={s} value={s}>
              {s}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error && <span className="text-xs">{error}</span>}
    </span>
  )
}

/** 运行验证：启动缺陷测试脚本的一次运行，结果实时展示在"测试运行结果"板块。
    按钮状态：运行验证(可点) → 启动中(禁用) → 运行中(禁用) → 运行验证(可点) */
function VerifyButton({
  defect,
  running,
  onStarted,
}: {
  defect: Defect
  running: boolean
  onStarted: (run: TestRun) => void
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!defect.testScript) return null

  const run = () => {
    setLoading(true)
    setError(null)
    api
      .verifyDefect(defect.id)
      .then(onStarted)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }

  const disabled = loading || running

  return (
    <>
      <Button
        size="sm"
        className="w-full"
        onClick={run}
        disabled={disabled}
        title={error ?? '运行用例验证缺陷是否已修复'}
      >
        {loading ? '启动中…' : running ? '运行中…' : '运行验证'}
      </Button>
      {error && <p className="mt-2 text-xs">操作失败:{error}</p>}
    </>
  )
}

/** 编辑内容：端 + 预期 + 实际 + 图片（多张）+ 用例脚本 */
function EditContentDialog({
  defect,
  onSaved,
}: {
  defect: Defect
  onSaved: () => void
}) {
  const [open, setOpen] = useState(false)
  const [platform, setPlatform] = useState('未知')
  const [priority, setPriority] = useState('中')
  const [expected, setExpected] = useState('')
  const [actual, setActual] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [testScript, setTestScript] = useState('')
  const [tests, setTests] = useState<ProjectTest[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) {
      setPlatform(defect.platform ?? '未知')
      setPriority(defect.priority ?? '中')
      setExpected(defect.expected)
      setActual(defect.actual)
      setImages(defect.images ?? [])
      setTestScript(defect.testScript ?? '')
      setError(null)
      api
        .listTests(defect.projectId)
        .then(setTests)
        .catch(() => setTests([]))
    }
  }

  const submit = () => {
    if (!expected.trim()) {
      setError('预期功能描述不能为空')
      return
    }
    if (!actual.trim()) {
      setError('实际结果描述不能为空')
      return
    }
    setSaving(true)
    setError(null)
    api
      .updateDefect(defect.id, {
        platform,
        priority: priority as DefectPriority,
        expected,
        actual,
        images,
        testScript,
      })
      .then(() => {
        setOpen(false)
        onSaved()
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setSaving(false))
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger>
        <Button variant="outline" size="sm" className="w-full">
          编辑内容
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>编辑缺陷内容</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-4">
              <label className="flex flex-col gap-1 text-sm">
                端
                <Select
                  value={platform}
                  onValueChange={(v) => setPlatform(v as string)}
                  items={Object.fromEntries(
                    DEFECT_PLATFORMS.map((p) => [p, p]),
                  )}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="选择端" />
                  </SelectTrigger>
                  <SelectContent>
                    {DEFECT_PLATFORMS.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                优先级
                <Select
                  value={priority}
                  onValueChange={(v) => setPriority(v as string)}
                  items={Object.fromEntries(
                    DEFECT_PRIORITIES.map((p) => [p, p]),
                  )}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="选择优先级" />
                  </SelectTrigger>
                  <SelectContent>
                    {DEFECT_PRIORITIES.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            </div>
            <label className="flex flex-col gap-1 text-sm">
              预期功能描述
              <Textarea
                value={expected}
                onChange={(e) => setExpected(e.target.value)}
                rows={3}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              实际结果描述
              <Textarea
                value={actual}
                onChange={(e) => setActual(e.target.value)}
                rows={3}
              />
            </label>
            <DefectImagesField value={images} onChange={setImages} />
            <label className="flex flex-col gap-1 text-sm">
              用例脚本（从项目已登记的测试中选择，可搜索，清除可留空）
              <Autocomplete
                items={tests.map((t) => t.scriptPath)}
                value={testScript}
                onValueChange={(v) => setTestScript(v as string)}
                clearable
              >
                <AutocompleteInput
                  placeholder="搜索测试编号或脚本…"
                  aria-label="用例脚本"
                />
                <AutocompleteContent>
                  <AutocompleteEmpty>未找到匹配的测试</AutocompleteEmpty>
                  <AutocompleteList>
                    {(item: string) => {
                      const t = tests.find((x) => x.scriptPath === item)
                      return (
                        <AutocompleteItem key={item} value={item}>
                          {t ? `${t.code}（${t.scriptPath}）` : item}
                        </AutocompleteItem>
                      )
                    }}
                  </AutocompleteList>
                </AutocompleteContent>
              </Autocomplete>
            </label>
            {error && <p className="text-sm">保存失败:{error}</p>}
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose>
            <Button variant="outline" size="sm">
              取消
            </Button>
          </DialogClose>
          <Button size="sm" onClick={submit} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** 追加变更记录：变更内容（必填）+ 备注（选填），状态自动取缺陷当前状态 */
function AddRecordDialog({
  defectId,
  onSaved,
}: {
  defectId: number
  onSaved: () => void
}) {
  const [open, setOpen] = useState(false)
  const [content, setContent] = useState('')
  const [remark, setRemark] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) {
      setContent('')
      setRemark('')
      setError(null)
    }
  }

  const submit = () => {
    if (!content.trim()) {
      setError('变更内容不能为空')
      return
    }
    setSaving(true)
    setError(null)
    api
      .addDefectRecord(defectId, { content, remark: remark || undefined })
      .then(() => {
        setOpen(false)
        onSaved()
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setSaving(false))
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger>
        <Button variant="outline" size="sm">
          添加记录
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>添加变更记录</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-sm">
              变更内容
              <Textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={3}
                placeholder="本次变更说明…"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              备注
              <Textarea
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
                rows={2}
                placeholder="补充说明（可空）"
              />
            </label>
            {error && <p className="text-sm">保存失败:{error}</p>}
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose>
            <Button variant="outline" size="sm">
              取消
            </Button>
          </DialogClose>
          <Button size="sm" onClick={submit} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
