import { useCallback, useEffect, useRef, useState } from 'react'
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
import { Input } from '@appica/ui-react/input'
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
  DEFECT_STATUSES,
  type Defect,
  type DefectStatus,
  type ProjectTest,
  type TestRun,
} from '../lib/api'
import { DefectStatusBadge, DefectSourceBadge } from '../components/StatusBadge'
import { PageBreadcrumb } from '../components/PageBreadcrumb'
import { Terminal } from '../components/Terminal'

const plugins = [gfm()]

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

/** 缺陷详情：简述 + 操作步骤/预期/实际 + 截图 + 属性编辑，状态/端变更后回写飞书 */
export function DefectDetailPage() {
  const { id, defectId } = useParams<{ id: string; defectId: string }>()
  const projectId = Number(id)
  const defectIdNum = Number(defectId)

  const [defect, setDefect] = useState<Defect | null>(null)
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

  const reload = useCallback(() => {
    api
      .getDefect(defectIdNum)
      .then(setDefect)
      .catch((e: Error) => setError(e.message))
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
        // 运行通过后后端会自动把缺陷流转为"修复"，刷新详情以反映状态/时间
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
      {/* 左侧：简述 + 操作步骤/预期/实际 + 截图 */}
      <div className="flex min-w-0 flex-1 flex-col gap-6">
        <PageBreadcrumb
          items={[
            { label: '缺陷', to: '/defects' },
            { label: projectName ?? '…', to: `/projects/${projectId}` },
            { label: defect.title },
          ]}
        />
        <section>
          <h2 className="mb-3 text-xl font-semibold">简述</h2>
          <Card>
            <p className="px-6 py-4 text-sm">{defect.title}</p>
          </Card>
        </section>
        <section>
          <h2 className="mb-3 text-xl font-semibold">操作步骤与关键信息</h2>
          <Card>
            <div className="markdown-body px-6 py-4 text-sm">
              <Viewer
                value={
                  defect.steps ??
                  defect.description ??
                  '*（未填写操作步骤）*'
                }
                plugins={plugins}
              />
            </div>
          </Card>
        </section>
        <section>
          <h2 className="mb-3 text-xl font-semibold">预期</h2>
          <Card>
            <p className="whitespace-pre-wrap px-6 py-4 text-sm">
              {defect.expected ?? '—'}
            </p>
          </Card>
        </section>
        <section>
          <h2 className="mb-3 text-xl font-semibold">实际</h2>
          <Card>
            <p className="whitespace-pre-wrap px-6 py-4 text-sm">
              {defect.actual ?? '—'}
            </p>
          </Card>
        </section>
        {defect.images && defect.images.length > 0 && (
          <section>
            <h2 className="mb-3 text-xl font-semibold">
              截图（{defect.images.length}）
            </h2>
            <div className="flex flex-wrap gap-3">
              {defect.images.map((p) => (
                <a
                  key={p}
                  href={`/images/${p}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <img
                    src={`/images/${p}`}
                    alt="缺陷截图"
                    className="h-40 rounded-[var(--radius-md)] border border-border-strong object-cover"
                  />
                </a>
              ))}
            </div>
          </section>
        )}
        {defect.remark && (
          <section>
            <h2 className="mb-3 text-xl font-semibold">备注</h2>
            <p className="whitespace-pre-wrap text-sm">{defect.remark}</p>
          </section>
        )}
        <section>
          <h2 className="mb-3 text-xl font-semibold">测试运行结果</h2>
          {defect.testScript ? (
            run ? (
              <Card>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-6 pt-4 text-sm">
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
                  {run.message && (
                    <span className="w-full whitespace-pre-wrap text-foreground-muted">
                      {run.message}
                    </span>
                  )}
                </div>
                {streamError && (
                  <p className="px-6 pt-2 text-sm">{streamError}</p>
                )}
                <div className="flex h-72 flex-col p-4">
                  <Terminal run={run} scriptPath={defect.testScript} />
                </div>
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
              <dt>端</dt>
              <dd className="flex items-center gap-1">
                <span>{defect.platform ?? '—'}</span>
                <EditPlatformDialog defect={defect} onSaved={reload} />
              </dd>
            </div>
            <div className="flex justify-between">
              <dt>开发</dt>
              <dd>{defect.developer ?? '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt>测试</dt>
              <dd>{defect.tester ?? '—'}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt>用例</dt>
              <dd className="flex items-center gap-1">
                <span
                  className="max-w-40 truncate"
                  title={defect.testScript ?? ''}
                >
                  {test?.code ?? defect.testScript ?? '—'}
                </span>
                <EditTestScriptDialog defect={defect} onSaved={reload} />
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt>来源</dt>
              <dd>
                <DefectSourceBadge source={defect.source} />
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
            <div className="flex justify-between">
              <dt>飞书记录</dt>
              <dd>{defect.feishuRecordId ?? '—'}</dd>
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
                用例运行通过后自动流转为"修复"
              </p>
            ) : (
              <p className="text-xs text-foreground-muted">
                未配置用例，可手动标记修复
              </p>
            )}
          </div>
        </Card>
      </aside>
    </div>
  )
}

/** 修改状态：改"修复"时后端校验测试脚本（有脚本须最近一次运行通过）；变更后回写飞书 */
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

/** 编辑内容：简述 + 操作步骤（Markdown，可上传图片）+ 预期 + 实际 + 开发 + 测试 */
function EditContentDialog({
  defect,
  onSaved,
}: {
  defect: Defect
  onSaved: () => void
}) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [steps, setSteps] = useState('')
  const [expected, setExpected] = useState('')
  const [actual, setActual] = useState('')
  const [developer, setDeveloper] = useState('')
  const [tester, setTester] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const stepsRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) {
      setTitle(defect.title)
      setSteps(defect.steps ?? defect.description ?? '')
      setExpected(defect.expected ?? '')
      setActual(defect.actual ?? '')
      setDeveloper(defect.developer ?? '')
      setTester(defect.tester ?? '')
      setError(null)
    }
  }

  const uploadImage = (file: File) => {
    setUploading(true)
    setError(null)
    api
      .uploadImage(file)
      .then(({ url }) => {
        const textarea = stepsRef.current
        const markdown = `![](${url})`
        if (textarea) {
          const start = textarea.selectionStart ?? steps.length
          const end = textarea.selectionEnd ?? steps.length
          const next = `${steps.slice(0, start)}${markdown}${steps.slice(end)}`
          setSteps(next)
          requestAnimationFrame(() => {
            textarea.focus()
            textarea.setSelectionRange(start + markdown.length, start + markdown.length)
          })
        } else {
          setSteps((prev) => `${prev}${markdown}`)
        }
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => {
        setUploading(false)
        if (fileRef.current) fileRef.current.value = ''
      })
  }

  const submit = () => {
    if (!title.trim()) {
      setError('简述（标题）不能为空')
      return
    }
    setSaving(true)
    setError(null)
    api
      .updateDefect(defect.id, {
        title,
        steps,
        expected,
        actual,
        developer,
        tester,
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
            <label className="flex flex-col gap-1 text-sm">
              简述
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="简要描述"
              />
            </label>
            <div className="flex flex-col gap-1 text-sm">
              <div className="flex items-center justify-between">
                <span>操作步骤与关键信息（Markdown）</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={uploading}
                  onClick={() => fileRef.current?.click()}
                >
                  {uploading ? '上传中…' : '上传图片'}
                </Button>
              </div>
              <Textarea
                ref={stepsRef}
                value={steps}
                onChange={(e) => setSteps(e.target.value)}
                rows={6}
                placeholder="1. 操作步骤…&#10;2. 关键信息…"
              />
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) uploadImage(file)
                }}
              />
            </div>
            <label className="flex flex-col gap-1 text-sm">
              预期
              <Textarea
                value={expected}
                onChange={(e) => setExpected(e.target.value)}
                rows={2}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              实际
              <Textarea
                value={actual}
                onChange={(e) => setActual(e.target.value)}
                rows={2}
              />
            </label>
            <div className="grid grid-cols-2 gap-4">
              <label className="flex flex-col gap-1 text-sm">
                开发
                <Input
                  value={developer}
                  onChange={(e) => setDeveloper(e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                测试
                <Input
                  value={tester}
                  onChange={(e) => setTester(e.target.value)}
                />
              </label>
            </div>
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

/** 编辑端：下拉选择 前端/后端/APP端/未知（默认），变更后回写飞书 */
function EditPlatformDialog({
  defect,
  onSaved,
}: {
  defect: Defect
  onSaved: () => void
}) {
  const [open, setOpen] = useState(false)
  const [platform, setPlatform] = useState('未知')
  const [error, setError] = useState<string | null>(null)

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) {
      setPlatform(defect.platform ?? '未知')
      setError(null)
    }
  }

  const submit = () => {
    setError(null)
    api
      .updateDefect(defect.id, { platform })
      .then(() => {
        setOpen(false)
        onSaved()
      })
      .catch((e: Error) => setError(e.message))
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger>
        <Button variant="ghost" size="sm">
          编辑
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>编辑端</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-sm">
              端
              <Select
                value={platform}
                onValueChange={(v) => setPlatform(v as string)}
                items={Object.fromEntries(DEFECT_PLATFORMS.map((p) => [p, p]))}
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
            {error && <p className="text-sm">保存失败:{error}</p>}
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose>
            <Button variant="outline" size="sm">
              取消
            </Button>
          </DialogClose>
          <Button size="sm" onClick={submit}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** 编辑测试脚本：带搜索的选择器，从项目已登记的测试中选取（存脚本相对路径） */
function EditTestScriptDialog({
  defect,
  onSaved,
}: {
  defect: Defect
  onSaved: () => void
}) {
  const [open, setOpen] = useState(false)
  const [testScript, setTestScript] = useState('')
  const [tests, setTests] = useState<ProjectTest[]>([])
  const [error, setError] = useState<string | null>(null)

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) {
      setTestScript(defect.testScript ?? '')
      setError(null)
      api
        .listTests(defect.projectId)
        .then(setTests)
        .catch(() => setTests([]))
    }
  }

  const submit = () => {
    setError(null)
    api
      .updateDefect(defect.id, { testScript })
      .then(() => {
        setOpen(false)
        onSaved()
      })
      .catch((e: Error) => setError(e.message))
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger>
        <Button variant="ghost" size="sm">
          编辑
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>编辑用例</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-sm">
              测试（从项目已登记的测试中选择，可搜索，清除可留空）
              <Autocomplete
                items={tests.map((t) => t.scriptPath)}
                value={testScript}
                onValueChange={(v) => setTestScript(v as string)}
                clearable
              >
                <AutocompleteInput
                  placeholder="搜索测试编号或脚本…"
                  aria-label="测试"
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
            <p className="text-xs text-foreground-muted">
              配置后标记修复前须该用例最近一次运行通过
            </p>
            {error && <p className="text-sm">保存失败:{error}</p>}
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose>
            <Button variant="outline" size="sm">
              取消
            </Button>
          </DialogClose>
          <Button size="sm" onClick={submit}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
