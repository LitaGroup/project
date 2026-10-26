import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
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
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@appica/ui-react/select'
import {
  api,
  type Executor,
  type PlatformUser,
  type Worker,
  type WorkerRole,
} from '../lib/api'
import { PageBreadcrumb } from '../components/PageBreadcrumb'
import {
  MarkdownEditor,
  type MarkdownEditorHandle,
} from '../components/MarkdownEditor'

type OptimizePhase = 'idle' | 'loading' | 'review'

/** 新建机器人/调度器时的默认角色 PROMPT 模板（与 AI 优化的结构保持一致） */
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
 * 机器人/调度器新建与编辑（独立页面）。
 * title 与 role 由路由决定：新建时 role 取传入值，编辑时以服务端返回的 role 为准。
 */
export function WorkerEditPage({ role: roleProp }: { role: WorkerRole }) {
  const { workerId } = useParams<{ workerId: string }>()
  const navigate = useNavigate()

  const [role, setRole] = useState<WorkerRole>(roleProp)
  const [executors, setExecutors] = useState<Executor[]>([])
  const [users, setUsers] = useState<PlatformUser[]>([])
  const [worker, setWorker] = useState<Worker | null>(null)
  const [loading, setLoading] = useState(Boolean(workerId))
  const [loadError, setLoadError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [intro, setIntro] = useState('')
  const [executorId, setExecutorId] = useState('')
  const [providerId, setProviderId] = useState(
    roleProp === '调度器' ? 'deepseek' : '',
  )
  const [modelId, setModelId] = useState(
    roleProp === '调度器' ? 'deepseek-v4-flash' : '',
  )
  const [prompt, setPrompt] = useState(workerId ? '' : NEW_PROMPT_TEMPLATE)
  const [ownerUserId, setOwnerUserId] = useState('')
  const [materials, setMaterials] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [optimizePhase, setOptimizePhase] = useState<OptimizePhase>('idle')
  const [optimizeSnapshot, setOptimizeSnapshot] = useState<string | null>(null)
  const [optimizeError, setOptimizeError] = useState<string | null>(null)
  const [editorEpoch, setEditorEpoch] = useState(0)
  const promptRef = useRef<MarkdownEditorHandle>(null)
  const editorEpochRef = useRef(0)

  const listPath = role === '调度器' ? '/tasks/schedulers' : '/tasks/workers'
  const isScheduler = role === '调度器'
  /** 面包屑固定用初始标题；页面大标题跟随名称输入变化 */
  const initialTitle = worker
    ? `编辑「${worker.name}」`
    : isScheduler
      ? '新建调度器'
      : '新建机器人'
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
        setExecutorId(w.executorId ? String(w.executorId) : '')
        setProviderId(w.providerId ?? '')
        setModelId(w.modelId ?? '')
        setPrompt(w.prompt ?? '')
        setOwnerUserId(w.ownerUserId ? String(w.ownerUserId) : '')
        setMaterials(w.materials ?? '')
        setEnabled(w.enabled)
      })
      .catch((e: Error) => setLoadError(e.message))
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [workerId, roleProp])

  const executor = executors.find((e) => String(e.id) === executorId)
  const providers = isScheduler
    ? [
        {
          id: 'deepseek',
          name: 'DeepSeek',
          models: [
            { id: 'deepseek-v4-flash', name: 'deepseek-v4-flash（快）' },
            { id: 'deepseek-v4-pro', name: 'deepseek-v4-pro（强）' },
          ],
        },
      ]
    : (executor?.providersCache ?? [])
  const provider = providers.find((p) => p.id === providerId)
  const models = provider?.models ?? []

  const submit = () => {
    setError(null)
    // 取编辑器当前内容：onChange 有防抖，避免刚输入就保存丢字
    const promptText = promptRef.current?.getMarkdown() ?? prompt
    const payload = {
      name,
      intro: intro.trim() || null,
      role,
      runtime: isScheduler ? ('pi' as const) : ('opencode' as const),
      executorId: isScheduler ? null : executorId ? Number(executorId) : null,
      providerId: providerId || null,
      modelId: modelId || null,
      prompt: promptText.trim() || null,
      ownerUserId: ownerUserId ? Number(ownerUserId) : null,
      materials: isScheduler ? materials.trim() || null : null,
      enabled,
    }
    setSaving(true)
    const saving$ = worker
      ? api.updateWorker(worker.id, payload)
      : api.createWorker(payload)
    saving$
      .then(() => navigate(listPath))
      .catch((e: Error) => setError(e.message))
      .finally(() => setSaving(false))
  }

  const canSave =
    !!name.trim() &&
    !!providerId &&
    !!modelId &&
    (isScheduler || !!executorId) &&
    !saving

  /** 替换编辑器内容：换 key 重新挂载（MarkdownEditor 为非受控组件） */
  const replacePrompt = (next: string) => {
    editorEpochRef.current += 1
    setEditorEpoch(editorEpochRef.current)
    setPrompt(next)
  }

  /** 只接收当前编辑器实例的变更，避免替换时旧实例的防抖回调覆盖新内容 */
  const handlePromptChange = (markdown: string, epoch: number) => {
    if (epoch !== editorEpochRef.current) return
    setPrompt(markdown)
  }

  const optimizePrompt = async () => {
    if (optimizePhase === 'loading') return
    const current = promptRef.current?.getMarkdown() ?? prompt
    if (!current.trim()) {
      setOptimizeError('请先填写角色 PROMPT 内容')
      return
    }
    setOptimizeError(null)
    setOptimizePhase('loading')
    try {
      const optimized = await api.optimizeWorkerPrompt(current)
      if (!optimized.trim()) throw new Error('PI Agent 返回内容为空')
      // 以返回时刻编辑器里的最新内容作为撤销快照，避免优化期间的手动编辑丢失
      setOptimizeSnapshot(promptRef.current?.getMarkdown() ?? current)
      replacePrompt(optimized)
      setOptimizePhase('review')
    } catch (e) {
      setOptimizeError(e instanceof Error ? e.message : '优化失败')
      setOptimizePhase('idle')
    }
  }

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
            { label: listPath === '/tasks/schedulers' ? '调度器' : '机器人', to: listPath },
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
              { label: isScheduler ? '调度器' : '机器人', to: listPath },
              { label: initialTitle },
            ]}
          />
          <h1 className="mt-2 text-2xl font-semibold">{pageTitle}</h1>
          <p className="mt-1 text-sm text-foreground-muted">
            {isScheduler
              ? '调度器 = 平台进程内 PI Agent（DeepSeek）：任务识别 → 材料审查 → 拆解/分配建议'
              : '机器人的负责人对机器人的产出结果负责'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate(listPath)}>
            取消
          </Button>
          <Button size="sm" onClick={submit} disabled={!canSave}>
            {saving ? '保存中…' : '保存'}
          </Button>
        </div>
      </div>
      {error && (
        <p className="rounded-[var(--radius-md)] bg-background-muted px-3 py-2 text-sm">
          保存失败：{error}
        </p>
      )}

      {/* 左右两栏：左侧角色定义 PROMPT（撑满剩余高度），右侧基础信息（独立滚动） */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        <Card className="min-h-64 min-w-0 flex-1">
          <CardHeader className="flex-none">
            <CardTitle>角色定义 PROMPT</CardTitle>
            <CardDescription>
              角色 PROMPT（Markdown），派发任务时随任务一起下发给该机器人
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
              名称与简介供调度器识别，执行器与模型决定运行位置
            </CardDescription>
          </CardHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-4 pb-4">
            <div className="flex gap-4">
              <label className="flex flex-1 flex-col gap-1 text-sm">
                名称
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={isScheduler ? '如：调度器-项目负责人' : '如：前端工程师'}
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
                placeholder="擅长什么、能接什么任务，供调度器与外部选择"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              责任人（验收产出）
              <Select
                value={ownerUserId || 'none'}
                onValueChange={(v) => setOwnerUserId(v === 'none' ? '' : (v as string))}
                items={{
                  none: '未指定',
                  ...Object.fromEntries(users.map((u) => [String(u.id), u.name])),
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择责任人" />
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
            <div className="border-t border-border-strong" />
            {!isScheduler && (
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
            )}
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
            {isScheduler && (
              <label className="flex flex-col gap-1 text-sm">
                调度材料（负责人提供的背景约定，调度时附加给 PI）
                <Textarea
                  rows={5}
                  value={materials}
                  onChange={(e) => setMaterials(e.target.value)}
                />
              </label>
            )}
          </div>
        </Card>
      </div>
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
