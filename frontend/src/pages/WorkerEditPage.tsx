import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AnimatePresence, m } from 'framer-motion'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@appica/ui-react/card'
import { Button } from '@appica/ui-react/button'
import { Loader } from '@appica/ui-react/loader'
import { Input } from '@appica/ui-react/input'
import { Textarea } from '@appica/ui-react/textarea'
import { Badge } from '@appica/ui-react/badge'
import { Checkbox } from '@appica/ui-react/checkbox'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@appica/ui-react/select'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@appica/ui-react/dialog'
import {
  api,
  type Executor,
  type PlatformUser,
  type Worker,
  type WorkerInitializeSnapshot,
  type WorkerInitializeStatus,
  type WorkerOptimizeSnapshot,
  type WorkerRole,
  type WorkerSkill,
  type WorkerSkillCatalogItem,
  type WorkerStandard,
  type WorkerStandardCatalogItem,
} from '../lib/api'
import { PageBreadcrumb } from '../components/PageBreadcrumb'
import { RobotAvatar } from '../components/task-detail/WorkerAvatar'
import {
  MarkdownEditor,
  type MarkdownEditorHandle,
} from '../components/MarkdownEditor'

type OptimizePhase = 'idle' | 'loading' | 'review'

/** 新建机器人（含系统调度机器人编辑）时的默认 AGENTS.md 模板（与 AI 优化的结构保持一致） */
const NEW_PROMPT_TEMPLATE = `## 角色定义
（待补充：身份、定位、服务的对象与最终目标）

## 角色职责
- （待补充：可执行的职责清单，说明做什么、何时做、做到什么程度）

## 背景知识
- （待补充：业务背景、领域知识、数据与系统约定）

## 需要技能
- （待补充：工具、技术栈、方法论与协作能力）

## 接受任务
- 可接受的任务类型：（待补充）
- 输入要求：（待补充）
- 产出要求：（待补充）
- 边界与拒收条件：（待补充）`

/**
 * 机器人新建与编辑（独立页面，调度机器人与工作者共用）。
 * 新建一律为自定义工作者；编辑时以服务端返回的 role 为准（系统调度机器人也在此配置）。
 */
export function WorkerEditPage() {
  const { workerId } = useParams<{ workerId: string }>()
  const navigate = useNavigate()

  const [role, setRole] = useState<WorkerRole>('工作者')
  const [executors, setExecutors] = useState<Executor[]>([])
  const [users, setUsers] = useState<PlatformUser[]>([])
  const [worker, setWorker] = useState<Worker | null>(null)
  const [loading, setLoading] = useState(Boolean(workerId))
  const [loadError, setLoadError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [intro, setIntro] = useState('')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [executorId, setExecutorId] = useState('')
  const [providerId, setProviderId] = useState('')
  const [modelId, setModelId] = useState('')
  const [prompt, setPrompt] = useState(workerId ? '' : NEW_PROMPT_TEMPLATE)
  const [skills, setSkills] = useState<WorkerSkill[]>([])
  const [skillPickerOpen, setSkillPickerOpen] = useState(false)
  const [standards, setStandards] = useState<WorkerStandard[]>([])
  const [standardPickerOpen, setStandardPickerOpen] = useState(false)
  const [ownerUserId, setOwnerUserId] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [error, setError] = useState<string | null>(null)
  /** 配置已落库但工作环境初始化失败时的提示（重试保存不会再重复创建） */
  const [initError, setInitError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [initializing, setInitializing] = useState(false)
  /** 工作环境初始化进度（异步任务，SSE 实时推送） */
  const [initStatus, setInitStatus] = useState<WorkerInitializeStatus>('idle')
  const [initLines, setInitLines] = useState<string[]>([])
  /** 非 null 时订阅该机器人的初始化 SSE 进度流 */
  const [trackedWorkerId, setTrackedWorkerId] = useState<number | null>(null)
  const [optimizePhase, setOptimizePhase] = useState<OptimizePhase>('idle')
  const [optimizeSnapshot, setOptimizeSnapshot] = useState<string | null>(null)
  const [optimizeError, setOptimizeError] = useState<string | null>(null)
  /** 非 null 时订阅该优化任务的 SSE 进度流 */
  const [optimizeRunId, setOptimizeRunId] = useState<string | null>(null)
  const [optimizeLines, setOptimizeLines] = useState<string[]>([])
  const [editorEpoch, setEditorEpoch] = useState(0)
  const promptRef = useRef<MarkdownEditorHandle>(null)
  const editorEpochRef = useRef(0)
  /** 初始化成功后延迟回列表的定时器（卸载时清理） */
  const navigateTimerRef = useRef<number | null>(null)

  const listPath = '/tasks/workers'
  const isScheduler = role === '调度器'
  /** 面包屑固定用初始标题；页面大标题跟随名称输入变化 */
  const initialTitle = worker ? `编辑「${worker.name}」` : '新建机器人'
  const typedName = name.trim()
  const pageTitle = worker
    ? typedName
      ? `编辑「${typedName}」`
      : initialTitle
    : typedName || initialTitle

  useEffect(() => {
    api.listExecutors().then(setExecutors).catch(() => undefined)
    api.listUsers().then(setUsers).catch(() => undefined)
  }, [])

  useEffect(() => {
    if (!workerId) return
    let alive = true
    api
      .getWorker(Number(workerId))
      .then((w) => {
        if (!alive) return
        setWorker(w)
        setRole(w.role)
        setName(w.name)
        setIntro(w.intro ?? '')
        setAvatarUrl(w.avatarUrl)
        setExecutorId(w.executorId ? String(w.executorId) : '')
        setProviderId(w.providerId ?? '')
        setModelId(w.modelId ?? '')
        setPrompt(w.prompt ?? '')
        setSkills(
          (w.skills ?? []).filter(
            (skill): skill is WorkerSkill => typeof skill.url === 'string',
          ),
        )
        setStandards(
          (w.standards ?? []).filter(
            (standard): standard is WorkerStandard =>
              typeof standard.url === 'string' &&
              typeof standard.path === 'string' &&
              typeof standard.directory === 'string',
          ),
        )
        setOwnerUserId(w.ownerUserId ? String(w.ownerUserId) : '')
        setEnabled(w.enabled)
      })
      .catch((e: Error) => setLoadError(e.message))
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [workerId])

  /** 以一份初始化快照校准本地进度状态并开始订阅 SSE */
  const beginTracking = useCallback(
    (workerId: number, snapshot: WorkerInitializeSnapshot) => {
      setInitStatus(snapshot.status)
      setInitLines(snapshot.lines)
      setInitError(snapshot.status === 'failed' ? snapshot.error : null)
      setInitializing(snapshot.status === 'running')
      setTrackedWorkerId(workerId)
    },
    [],
  )

  // 编辑页挂载时探测一次：刷新页面时若有进行中的初始化，恢复进度展示
  useEffect(() => {
    if (!workerId) return
    let alive = true
    api
      .getWorkerInitialize(Number(workerId))
      .then((snapshot) => {
        if (alive && snapshot.status === 'running') {
          beginTracking(Number(workerId), snapshot)
        }
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [workerId, beginTracking])

  // 初始化进度 SSE：snapshot 校准全量状态，line 增量推送；终态后由服务端完成流
  useEffect(() => {
    if (trackedWorkerId === null) return
    const source = new EventSource(
      `/api/workers/${trackedWorkerId}/initialize/stream`,
    )
    source.onmessage = (event: MessageEvent<string>) => {
      let payload:
        | { type: 'snapshot'; snapshot: WorkerInitializeSnapshot }
        | { type: 'line'; line: string }
        | { type: 'ping' }
        | { type?: string }
      try {
        payload = JSON.parse(event.data) as typeof payload
      } catch {
        return
      }
      if (payload.type === 'line' && 'line' in payload && payload.line) {
        setInitLines((prev) => [...prev.slice(-199), payload.line])
        return
      }
      if (payload.type !== 'snapshot' || !('snapshot' in payload)) return
      const snapshot = payload.snapshot
      if (snapshot.status === 'running') {
        // 断线重连后以服务端快照校准（防止漏收增量行）
        setInitStatus('running')
        if (snapshot.lines.length) setInitLines(snapshot.lines)
        return
      }
      if (snapshot.status === 'idle') {
        // 服务端无任务（平台重启丢失）：提示重试
        setInitStatus('idle')
        setInitError('初始化进程已中断（平台已重启），请重试保存')
        setInitializing(false)
        setTrackedWorkerId(null)
        source.close()
        return
      }
      setInitStatus(snapshot.status)
      if (snapshot.lines.length) setInitLines(snapshot.lines)
      if (snapshot.status === 'failed') {
        setInitError(snapshot.error ?? '未知错误')
        setInitializing(false)
        setTrackedWorkerId(null)
        source.close()
        return
      }
      // success：停留片刻展示完成行，再回列表
      setInitializing(false)
      source.close()
      navigateTimerRef.current = window.setTimeout(() => {
        navigate(listPath)
      }, 1200)
    }
    return () => {
      source.close()
      if (navigateTimerRef.current !== null) {
        window.clearTimeout(navigateTimerRef.current)
        navigateTimerRef.current = null
      }
    }
  }, [trackedWorkerId, navigate, listPath])

  const executor = executors.find((e) => String(e.id) === executorId)
  const providers = executor?.providersCache ?? []
  const provider = providers.find((p) => p.id === providerId)
  const models = provider?.models ?? []

  const submit = async () => {
    if (saving || initializing) return
    setError(null)
    setInitError(null)
    setInitStatus('idle')
    setInitLines([])
    // 初始化必须在机器人选择的执行器上执行，供应商/模型用于创建同步会话
    if (!executorId || !providerId || !modelId) {
      setError('请先选择执行器、供应商与模型；否则无法初始化工作环境')
      return
    }
    // 取编辑器当前内容：onChange 有防抖，避免刚输入就保存丢字
    const promptText = promptRef.current?.getMarkdown() ?? prompt
    const payload = {
      name,
      intro: intro.trim() || null,
      avatarUrl: avatarUrl?.trim() || null,
      runtime: 'opencode' as const,
      executorId: executorId ? Number(executorId) : null,
      providerId: providerId || null,
      modelId: modelId || null,
      prompt: promptText.trim() || null,
      skills,
      standards,
      ownerUserId: ownerUserId ? Number(ownerUserId) : null,
      enabled,
    }
    let stage: 'save' | 'init' = 'save'
    setSaving(true)
    try {
      // 1. 先落库期望配置；初始化失败时保留配置，重试保存不会重复创建
      const saved = worker
        ? await api.updateWorker(worker.id, payload)
        : await api.createWorker(payload)
      setWorker(saved)
      // 2. 启动工位同步（异步任务，立即返回运行快照）：
      //    停留在本页经 SSE 展示进度，成功后自动回列表，失败提示可重试保存
      setSaving(false)
      stage = 'init'
      setInitializing(true)
      const snapshot = await api.initializeWorker(saved.id)
      beginTracking(saved.id, snapshot)
    } catch (e) {
      const message = e instanceof Error ? e.message : '保存失败'
      if (stage === 'init') {
        setInitError(message)
        setInitializing(false)
      } else {
        setError(message)
      }
    } finally {
      setSaving(false)
    }
  }

  // 只要有名称就允许点击保存；缺少执行器/供应商/模型时点击后给出明确提示，
  // 避免按钮静默置灰导致无法判断原因
  const canSave = !!name.trim() && !saving && !initializing
  const busy = saving || initializing

  /** 替换编辑器内容：换 key 重新挂载（MarkdownEditor 为非受控组件） */
  const replacePrompt = useCallback((next: string) => {
    editorEpochRef.current += 1
    setEditorEpoch(editorEpochRef.current)
    setPrompt(next)
  }, [])

  /** 只接收当前编辑器实例的变更，避免替换时旧实例的防抖回调覆盖新内容 */
  const handlePromptChange = (markdown: string, epoch: number) => {
    if (epoch !== editorEpochRef.current) return
    setPrompt(markdown)
  }

  /** 优化成功：以返回时刻编辑器里的最新内容作为撤销快照，避免优化期间的手动编辑丢失 */
  const acceptOptimized = useCallback(
    (optimized: string) => {
      const text = optimized.trim()
      if (!text) {
        setOptimizeError('执行器返回内容为空')
        setOptimizePhase('idle')
        return
      }
      setOptimizeSnapshot(promptRef.current?.getMarkdown() ?? text)
      replacePrompt(text)
      setOptimizePhase('review')
    },
    [replacePrompt],
  )

  const optimizePrompt = async () => {
    if (optimizePhase === 'loading') return
    const current = promptRef.current?.getMarkdown() ?? prompt
    if (!current.trim()) {
      setOptimizeError('请先填写 AGENTS.md 内容')
      return
    }
    setOptimizeError(null)
    setOptimizeLines([])
    setOptimizePhase('loading')
    try {
      // 异步任务：先拿到运行快照，再经 SSE 订阅进度与最终结果（同步长请求会被网关 504 掐断）
      const snapshot = await api.startWorkerPromptOptimize({
        prompt: current,
        workerId: worker?.id ?? null,
        executorId: executorId ? Number(executorId) : null,
        providerId: providerId || null,
        modelId: modelId || null,
      })
      setOptimizeLines(snapshot.lines)
      if (snapshot.status === 'running') {
        setOptimizeRunId(snapshot.runId)
        return
      }
      setOptimizeRunId(null)
      if (snapshot.status === 'failed') {
        throw new Error(snapshot.error ?? '优化失败')
      }
      acceptOptimized(snapshot.prompt ?? '')
    } catch (e) {
      setOptimizeError(e instanceof Error ? e.message : '优化失败')
      setOptimizePhase('idle')
    }
  }

  // 优化进度 SSE：snapshot 校准全量状态，line 增量推送；终态后由服务端完成流
  useEffect(() => {
    if (!optimizeRunId) return
    const source = new EventSource(
      `/api/workers/optimize-prompt/${encodeURIComponent(optimizeRunId)}/stream`,
    )
    source.onmessage = (event: MessageEvent<string>) => {
      let payload:
        | { type: 'snapshot'; snapshot: WorkerOptimizeSnapshot }
        | { type: 'line'; line: string }
        | { type: 'ping' }
        | { type?: string }
      try {
        payload = JSON.parse(event.data) as typeof payload
      } catch {
        return
      }
      if (payload.type === 'line' && 'line' in payload && payload.line) {
        setOptimizeLines((prev) => [...prev.slice(-49), payload.line])
        return
      }
      if (payload.type !== 'snapshot' || !('snapshot' in payload)) return
      const snapshot = payload.snapshot
      if (snapshot.status === 'running') {
        // 断线重连后以服务端快照校准（防止漏收增量行）
        if (snapshot.lines.length) setOptimizeLines(snapshot.lines)
        return
      }
      source.close()
      setOptimizeRunId(null)
      if (snapshot.status === 'failed') {
        setOptimizeError(snapshot.error ?? '未知错误')
        setOptimizePhase('idle')
        return
      }
      acceptOptimized(snapshot.prompt ?? '')
    }
    return () => source.close()
  }, [optimizeRunId, acceptOptimized])

  const undoOptimize = () => {
    if (optimizeSnapshot === null) return
    replacePrompt(optimizeSnapshot)
    setOptimizeSnapshot(null)
    setOptimizePhase('idle')
    setOptimizeError(null)
  }

  const applyOptimize = () => {
    setOptimizeSnapshot(null)
    setOptimizePhase('idle')
    setOptimizeError(null)
  }

  if (loading) {
    return <p className="text-sm text-foreground-muted">加载中…</p>
  }
  if (loadError) {
    return (
      <div className="flex flex-col gap-4">
        <PageBreadcrumb
          items={[
            { label: '机器人', to: listPath },
            { label: '编辑' },
          ]}
        />
        <p className="text-sm">加载失败：{loadError}</p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <PageBreadcrumb
            items={[
              { label: '机器人', to: listPath },
              { label: initialTitle },
            ]}
          />
          <h1 className="mt-2 text-2xl font-semibold">{pageTitle}</h1>
          <p className="mt-1 text-sm text-foreground-muted">
            {isScheduler
              ? '系统调度机器人：保留历史调度能力，新任务由平台自动匹配分配'
              : '机器人的上级对机器人的产出结果负责'}
          </p>
          {initStatus !== 'idle' && (
            <InitTicker status={initStatus} lines={initLines} />
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate(listPath)}>
            取消
          </Button>
          <Button size="sm" onClick={submit} disabled={!canSave}>
            {saving ? '保存中…' : initializing ? '初始化环境中…' : '保存'}
          </Button>
        </div>
      </div>
      {(error || initError) && (
        <p className="rounded-[var(--radius-md)] bg-background-muted px-3 py-2 text-sm">
          {error
            ? `保存失败：${error}`
            : `配置已保存，但工作环境初始化失败：${initError}。可修正后重试保存。`}
        </p>
      )}

      {/* 左右两栏：左侧机器人定义 AGENTS.md（撑满剩余高度），右侧基础信息（独立滚动） */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        <Card className="min-h-64 min-w-0 flex-1">
          <CardHeader className="flex-none">
            <CardTitle>机器人定义 AGENTS.md</CardTitle>
            <CardDescription>
              机器人的工作基本原则（Markdown），保存后写入工作目录的 AGENTS.md
            </CardDescription>
          </CardHeader>
          <div className="relative mx-2 mb-2 min-h-0 flex-1">
            <div className="absolute inset-0 overflow-auto bg-background-muted">
              <MarkdownEditor
                key={editorEpoch}
                ref={promptRef}
                value={prompt}
                compact
                appica
                readOnly={optimizePhase === 'loading'}
                onChange={(markdown) =>
                  handlePromptChange(markdown, editorEpoch)
                }
              />
            </div>
            <div className="absolute right-3 bottom-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-col items-end gap-2">
              {optimizePhase === 'loading' && optimizeLines.length > 0 && (
                <p className="max-w-full truncate rounded-[var(--radius-md)] border border-border-strong bg-background px-3 py-2 text-xs text-foreground-muted shadow-md">
                  {optimizeLines[optimizeLines.length - 1]}
                </p>
              )}
              {optimizeError && (
                <p className="rounded-[var(--radius-md)] border border-border-strong bg-background px-3 py-2 text-xs text-foreground-muted shadow-md">
                  优化失败：{optimizeError}
                </p>
              )}
              <div className="flex items-center gap-2">
                {optimizePhase === 'idle' && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="shadow-md"
                    onClick={() => void optimizePrompt()}
                  >
                    <OptimizeIcon />
                    优化
                  </Button>
                )}
                {optimizePhase === 'loading' && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="shadow-md"
                    disabled
                  >
                    <Loader
                      variant="dots"
                      currentColor
                      className="text-sm"
                    />
                    优化中…
                  </Button>
                )}
                {optimizePhase === 'review' && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      className="shadow-md"
                      onClick={undoOptimize}
                    >
                      撤销
                    </Button>
                    <Button
                      size="sm"
                      className="shadow-md"
                      onClick={applyOptimize}
                    >
                      应用
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        </Card>

        <Card className="w-full shrink-0 lg:min-h-0 lg:w-[26rem]">
          <CardHeader className="flex-none">
            <CardTitle>基础信息</CardTitle>
            <CardDescription>
              名称、简介与任务定义用于平台匹配任务与分配机器人，执行器与模型决定运行位置
            </CardDescription>
          </CardHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-4 pb-4">
            {worker?.system && (
              <p className="rounded-[var(--radius-md)] bg-background-muted px-3 py-2 text-xs text-foreground-muted">
                系统机器人（ID {worker.id}）由代码内置，可在此调整配置与启用状态，但网页不能删除。
              </p>
            )}
            <WorkerAvatarField value={avatarUrl} onChange={setAvatarUrl} />
            <div className="flex gap-4">
              <label className="flex flex-1 flex-col gap-1 text-sm">
                名称
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={isScheduler ? '如：调度机器人' : '如：前端工程师'}
                />
              </label>
              <label className="flex w-32 flex-col gap-1 text-sm">
                启用
                <Select
                  value={enabled ? 'on' : 'off'}
                  onValueChange={(v) => setEnabled(v === 'on')}
                  items={{ on: '启用', off: '停用' }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="on">启用</SelectItem>
                    <SelectItem value="off">停用</SelectItem>
                  </SelectContent>
                </Select>
              </label>
            </div>
            <label className="flex flex-col gap-1 text-sm">
              简介
              <Textarea
                rows={3}
                value={intro}
                onChange={(e) => setIntro(e.target.value)}
                placeholder="擅长什么、能接什么任务，供调度机器人与外部选择"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              上级
              <Select
                value={ownerUserId || 'none'}
                onValueChange={(v) => setOwnerUserId(v === 'none' ? '' : (v as string))}
                items={{
                  none: '未指定',
                  ...Object.fromEntries(users.map((u) => [String(u.id), u.name])),
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择上级" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">未指定</SelectItem>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={String(u.id)}>
                      {u.name}
                      {u.department ? `（${u.department}）` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            {worker?.workdir && (
              <p className="text-xs text-foreground-muted">
                工位：<code>{worker.workdir}</code>
              </p>
            )}
            <WorkerSkillSection
              skills={skills}
              onChange={setSkills}
              pickerOpen={skillPickerOpen}
              onPickerOpenChange={setSkillPickerOpen}
              disabled={busy}
            />
            <WorkerStandardSection
              standards={standards}
              onChange={setStandards}
              pickerOpen={standardPickerOpen}
              onPickerOpenChange={setStandardPickerOpen}
              disabled={busy}
            />
            <div className="border-t border-border-strong" />
            <label className="flex flex-col gap-1 text-sm">
                执行器
                <Select
                  value={executorId || 'none'}
                  onValueChange={(v) => {
                    const next = v === 'none' ? '' : (v as string)
                    setExecutorId(next)
                    setProviderId('')
                    setModelId('')
                    const exec = executors.find((e) => String(e.id) === next)
                    if (exec && !exec.providersCache?.length) {
                      api.syncExecutorProviders(exec.id).catch(() => undefined)
                    }
                  }}
                  items={{
                    none: '未选择',
                    ...Object.fromEntries(executors.map((e) => [String(e.id), e.name])),
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="选择执行器" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">未选择</SelectItem>
                    {executors.map((e) => (
                      <SelectItem key={e.id} value={String(e.id)}>
                        {e.name}（{e.online ? '在线' : '离线'}）
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {executor && !executor.providersCache?.length && (
                  <span className="text-xs text-foreground-muted">
                    该执行器还没有供应商缓存，请先到「执行器」页同步
                  </span>
                )}
              </label>
            <div className="flex gap-4">
              <label className="flex flex-1 flex-col gap-1 text-sm">
                供应商
                <Select
                  value={providerId || 'none'}
                  onValueChange={(v) => {
                    setProviderId(v === 'none' ? '' : (v as string))
                    setModelId('')
                  }}
                  items={{
                    none: '未选择',
                    ...Object.fromEntries(providers.map((p) => [p.id, p.name ?? p.id])),
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="选择供应商" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">未选择</SelectItem>
                    {providers.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name ?? p.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="flex flex-1 flex-col gap-1 text-sm">
                模型
                <Select
                  value={modelId || 'none'}
                  onValueChange={(v) => setModelId(v === 'none' ? '' : (v as string))}
                  items={{
                    none: '未选择',
                    ...Object.fromEntries(models.map((m) => [m.id, m.name ?? m.id])),
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="选择模型" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">未选择</SelectItem>
                    {models.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name ?? m.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}

/** 技能选择/清单展示：保存时仅保存技能库 SKILL.md 引用，初始化任务负责安装到工位 */
function WorkerSkillSection({
  skills,
  onChange,
  pickerOpen,
  onPickerOpenChange,
  disabled,
}: {
  skills: WorkerSkill[]
  onChange: (skills: WorkerSkill[]) => void
  pickerOpen: boolean
  onPickerOpenChange: (open: boolean) => void
  disabled: boolean
}) {
  const remove = (path: string) =>
    onChange(skills.filter((skill) => skill.path !== path))

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm">技能</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => onPickerOpenChange(true)}
        >
          添加技能
        </Button>
      </div>
      {skills.length === 0 ? (
        <p className="text-xs text-foreground-muted">
          未选择技能；保存后会同步清空工位中的旧技能目录
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {skills.map((skill) => (
            <div
              key={skill.path}
              className="flex items-start gap-2 rounded-[var(--radius-md)] bg-background-muted px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm">{skill.name}</span>
                  {skill.version && (
                    <Badge variant="soft" size="sm">
                      v{skill.version}
                    </Badge>
                  )}
                </div>
                <p className="mt-0.5 truncate font-mono text-xs text-foreground-muted">
                  {skill.path}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled}
                onClick={() => remove(skill.path)}
              >
                移除
              </Button>
            </div>
          ))}
        </div>
      )}
      <WorkerSkillPickerDialog
        open={pickerOpen}
        onOpenChange={onPickerOpenChange}
        selected={skills}
        onToggle={(item, checked) => {
          if (checked) {
            if (!skills.some((skill) => skill.path === item.path)) {
              onChange([...skills, item])
            }
            return
          }
          onChange(skills.filter((skill) => skill.path !== item.path))
        }}
      />
    </div>
  )
}

/** 技能库多选弹窗：读取后端缓存的 Gitea docs/skills 目录 */
function WorkerSkillPickerDialog({
  open,
  onOpenChange,
  selected,
  onToggle,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  selected: WorkerSkill[]
  onToggle: (item: WorkerSkillCatalogItem, checked: boolean) => void
}) {
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<WorkerSkillCatalogItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const selectedPaths = useMemo(
    () => new Set(selected.map((skill) => skill.path)),
    [selected],
  )

  useEffect(() => {
    if (!open) return
    let alive = true
    // 输入防抖后走服务端搜索，避免每敲一个字符都请求 Gitea 缓存清单
    const timer = window.setTimeout(() => {
      setLoading(true)
      setError(null)
      api
        .listWorkerSkillCatalog(query)
        .then((result) => {
          if (alive) setItems(result)
        })
        .catch((e: Error) => {
          if (alive) setError(e.message)
        })
        .finally(() => {
          if (alive) setLoading(false)
        })
    }, 200)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [open, query])

  const groups = useMemo(() => {
    const map = new Map<string, WorkerSkillCatalogItem[]>()
    for (const item of items) {
      const group = item.path.split('/')[0] || '其它'
      if (!map.has(group)) map.set(group, [])
      map.get(group)!.push(item)
    }
    return [...map.entries()]
  }, [items])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>添加技能</DialogTitle>
          <DialogDescription>
            从技能库选择 SKILL.md，保存后会安装或更新到机器人工作目录
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-3">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索技能名称、描述或路径"
            />
            {error && <p className="text-sm text-error-foreground">{error}</p>}
            <div className="max-h-96 min-h-32 overflow-auto rounded-[var(--radius-md)] border border-border-strong">
              {loading && items.length === 0 ? (
                <div className="flex h-32 items-center justify-center text-sm text-foreground-muted">
                  <Loader variant="dots" currentColor className="mr-2" />
                  加载中…
                </div>
              ) : items.length === 0 ? (
                <div className="flex h-32 items-center justify-center px-4 text-center text-sm text-foreground-muted">
                  {error ? '技能库不可用' : '没有匹配的技能'}
                </div>
              ) : (
                groups.map(([group, groupItems]) => (
                  <div key={group}>
                    <div className="sticky top-0 z-10 border-b border-border-strong bg-background px-3 py-2 text-xs font-medium text-foreground-muted">
                      {group}
                    </div>
                    {groupItems.map((item) => {
                      const checked = selectedPaths.has(item.path)
                      return (
                        <label
                          key={item.path}
                          className="flex cursor-pointer items-start gap-3 border-b border-border-strong px-3 py-3 last:border-b-0 hover:bg-background-muted"
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(checked) =>
                              onToggle(item, checked === true)
                            }
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex min-w-0 items-center gap-2">
                              <span className="truncate text-sm font-medium">
                                {item.name}
                              </span>
                              {item.version && (
                                <Badge variant="soft" size="sm">
                                  v{item.version}
                                </Badge>
                              )}
                            </span>
                            {item.description && (
                              <span className="mt-1 block line-clamp-2 text-xs text-foreground-muted">
                                {item.description}
                              </span>
                            )}
                            <span className="mt-1 block truncate font-mono text-xs text-foreground-muted">
                              {item.path}
                            </span>
                          </span>
                        </label>
                      )
                    })}
                  </div>
                ))
              )}
            </div>
            <p className="text-xs text-foreground-muted">
              已选择 {selected.length} 个技能；清单以保存时的选择为准
            </p>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button size="sm" onClick={() => onOpenChange(false)}>
            完成
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** 规范选择/清单展示：保存时仅保存规范库 README 引用，初始化任务负责整目录同步到工位 docs */
function WorkerStandardSection({
  standards,
  onChange,
  pickerOpen,
  onPickerOpenChange,
  disabled,
}: {
  standards: WorkerStandard[]
  onChange: (standards: WorkerStandard[]) => void
  pickerOpen: boolean
  onPickerOpenChange: (open: boolean) => void
  disabled: boolean
}) {
  const remove = (path: string) =>
    onChange(standards.filter((standard) => standard.path !== path))

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm">规范</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => onPickerOpenChange(true)}
        >
          添加规范
        </Button>
      </div>
      {standards.length === 0 ? (
        <p className="text-xs text-foreground-muted">
          未选择规范；保存初始化后会按选中目录同步到工位 docs
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {standards.map((standard) => (
            <div
              key={standard.path}
              className="flex items-start gap-2 rounded-[var(--radius-md)] bg-background-muted px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm">{standard.name}</span>
                  {standard.version && (
                    <Badge variant="soft" size="sm">
                      v{standard.version}
                    </Badge>
                  )}
                </div>
                <p className="mt-0.5 truncate font-mono text-xs text-foreground-muted">
                  {standard.directory}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled}
                onClick={() => remove(standard.path)}
              >
                移除
              </Button>
            </div>
          ))}
        </div>
      )}
      <WorkerStandardPickerDialog
        open={pickerOpen}
        onOpenChange={onPickerOpenChange}
        selected={standards}
        onToggle={(item, checked) => {
          if (checked) {
            if (!standards.some((standard) => standard.path === item.path)) {
              onChange([...standards, item])
            }
            return
          }
          onChange(standards.filter((standard) => standard.path !== item.path))
        }}
      />
    </div>
  )
}

/** 规范库多选弹窗：读取后端缓存的 Gitea docs/standard 目录 README 清单 */
function WorkerStandardPickerDialog({
  open,
  onOpenChange,
  selected,
  onToggle,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  selected: WorkerStandard[]
  onToggle: (item: WorkerStandardCatalogItem, checked: boolean) => void
}) {
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<WorkerStandardCatalogItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const selectedPaths = useMemo(
    () => new Set(selected.map((standard) => standard.path)),
    [selected],
  )

  useEffect(() => {
    if (!open) return
    let alive = true
    // 输入防抖后走服务端搜索，避免每敲一个字符都请求 Gitea 缓存清单
    const timer = window.setTimeout(() => {
      setLoading(true)
      setError(null)
      api
        .listWorkerStandardCatalog(query)
        .then((result) => {
          if (alive) setItems(result)
        })
        .catch((e: Error) => {
          if (alive) setError(e.message)
        })
        .finally(() => {
          if (alive) setLoading(false)
        })
    }, 200)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [open, query])

  const groups = useMemo(() => {
    const map = new Map<string, WorkerStandardCatalogItem[]>()
    for (const item of items) {
      const group = item.directory.split('/')[0] || '其它'
      if (!map.has(group)) map.set(group, [])
      map.get(group)!.push(item)
    }
    return [...map.entries()]
  }, [items])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>添加规范</DialogTitle>
          <DialogDescription>
            从规范库选择目录 README.md；保存初始化后会同步该目录下的全部文档到机器人工作目录
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-3">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索规范名称、描述或路径"
            />
            {error && <p className="text-sm text-error-foreground">{error}</p>}
            <div className="max-h-96 min-h-32 overflow-auto rounded-[var(--radius-md)] border border-border-strong">
              {loading && items.length === 0 ? (
                <div className="flex h-32 items-center justify-center text-sm text-foreground-muted">
                  <Loader variant="dots" currentColor className="mr-2" />
                  加载中…
                </div>
              ) : items.length === 0 ? (
                <div className="flex h-32 items-center justify-center px-4 text-center text-sm text-foreground-muted">
                  {error ? '规范库不可用' : '没有匹配的规范'}
                </div>
              ) : (
                groups.map(([group, groupItems]) => (
                  <div key={group}>
                    <div className="sticky top-0 z-10 border-b border-border-strong bg-background px-3 py-2 text-xs font-medium text-foreground-muted">
                      {group}
                    </div>
                    {groupItems.map((item) => {
                      const checked = selectedPaths.has(item.path)
                      return (
                        <label
                          key={item.path}
                          className="flex cursor-pointer items-start gap-3 border-b border-border-strong px-3 py-3 last:border-b-0 hover:bg-background-muted"
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(checked) =>
                              onToggle(item, checked === true)
                            }
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex min-w-0 items-center gap-2">
                              <span className="truncate text-sm font-medium">
                                {item.name}
                              </span>
                              {item.version && (
                                <Badge variant="soft" size="sm">
                                  v{item.version}
                                </Badge>
                              )}
                            </span>
                            {item.description && (
                              <span className="mt-1 block line-clamp-2 text-xs text-foreground-muted">
                                {item.description}
                              </span>
                            )}
                            <span className="mt-1 block truncate font-mono text-xs text-foreground-muted">
                              {item.directory}
                            </span>
                          </span>
                        </label>
                      )
                    })}
                  </div>
                ))
              )}
            </div>
            <p className="text-xs text-foreground-muted">
              已选择 {selected.length} 个规范；初始化以保存时的选择为准
            </p>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button size="sm" onClick={() => onOpenChange(false)}>
            完成
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * 工作环境初始化进度条（页头标题下方的单行展示）。
 * 只显示最新一行进度；新行自下而上滑入、旧行向上滑出（overflow-hidden 裁切）。
 */
function InitTicker({
  status,
  lines,
}: {
  status: 'running' | 'success' | 'failed'
  lines: string[]
}) {
  const index = lines.length - 1
  const line = index >= 0 ? lines[index] : '正在连接执行器…'
  const lineClass =
    status === 'failed'
      ? 'text-error-foreground'
      : status === 'success'
        ? 'text-success-foreground'
        : 'text-foreground-muted'
  return (
    <div
      className="relative mt-2 h-5 overflow-hidden"
      role="status"
      aria-live="polite"
    >
      <AnimatePresence initial={false}>
        {/* key 取行下标：每条新进度都会触发一次「下方滑入」动画 */}
        <m.span
          key={index}
          initial={{ y: '100%', opacity: 0 }}
          animate={{ y: '0%', opacity: 1 }}
          exit={{ y: '-100%', opacity: 0 }}
          transition={{ duration: 0.35, ease: 'easeInOut' }}
          className="absolute inset-0 flex items-center gap-2 text-sm"
        >
          {status === 'running' && (
            <Loader
              variant="dots"
              currentColor
              className="shrink-0 text-xs"
            />
          )}
          <span className={`min-w-0 truncate ${lineClass}`}>{line}</span>
        </m.span>
      </AnimatePresence>
    </div>
  )
}

/** 头像边长（上传前统一裁剪/缩放到的像素尺寸，兼顾清晰度与存储） */
const AVATAR_SIZE = 256

/**
 * 把任意尺寸图片居中裁剪为正方形并缩放到 AVATAR_SIZE。
 * 裁剪/缩放失败（如浏览器不支持 createImageBitmap）时回退原图。
 */
async function cropToSquare(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file, {
      imageOrientation: 'from-image',
    })
    const side = Math.min(bitmap.width, bitmap.height)
    const sx = (bitmap.width - side) / 2
    const sy = (bitmap.height - side) / 2
    const canvas = document.createElement('canvas')
    canvas.width = AVATAR_SIZE
    canvas.height = AVATAR_SIZE
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas 不可用')
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE)
    bitmap.close()
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/png'),
    )
    if (!blob) throw new Error('图片编码失败')
    return blob
  } catch {
    return file
  }
}

/**
 * 机器人头像字段：经 POST /api/images 上传（png/jpg/gif/webp），值为 /images/... 路径。
 * 上传成功即本地预览，随「保存」一并提交；「移除」清空（保存后回退为默认黑图占位）。
 */
function WorkerAvatarField({
  value,
  onChange,
}: {
  value: string | null
  onChange: (value: string | null) => void
}) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const upload = (file: File) => {
    setUploading(true)
    setError(null)
    // 头像必须为正方形：上传前居中裁剪（非正方形图直传会被 object-cover 居中裁出「拉长」观感）
    cropToSquare(file)
      .then((square) => api.uploadImage(new File([square], 'avatar.png', { type: 'image/png' })))
      .then((result) => onChange(result.url))
      .catch((e: Error) => setError(e.message))
      .finally(() => {
        setUploading(false)
        if (fileRef.current) fileRef.current.value = ''
      })
  }

  return (
    <div className="flex items-center gap-3">
      <RobotAvatar name="头像预览" avatarUrl={value} size={56} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
          >
            {uploading ? '上传中…' : value ? '更换头像' : '上传头像'}
          </Button>
          {value && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={uploading}
              onClick={() => {
                setError(null)
                onChange(null)
              }}
            >
              移除
            </Button>
          )}
        </div>
        <span className="text-xs text-foreground-muted">
          自动居中裁剪为正方形，用于机器人列表与任务对话展示
        </span>
        {error && (
          <span className="text-xs text-error-foreground">上传失败：{error}</span>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) upload(file)
        }}
      />
    </div>
  )
}

/** 悬浮「优化」按钮的 Sparkles 图标（随 Button 的 currentColor 着色） */
function OptimizeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3l1.8 4.7 4.7 1.8-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3Z" />
      <path d="M18.5 15l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9.9-2.1Z" />
    </svg>
  )
}
