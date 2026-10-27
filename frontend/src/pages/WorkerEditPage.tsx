import { useEffect, useMemo, useRef, useState } from 'react'
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
  type WorkerRole,
  type WorkerSkill,
  type WorkerSkillCatalogItem,
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
  const [ownerUserId, setOwnerUserId] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [error, setError] = useState<string | null>(null)
  /** 配置已落库但工作环境初始化失败时的提示（重试保存不会再重复创建） */
  const [initError, setInitError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [initializing, setInitializing] = useState(false)
  const [optimizePhase, setOptimizePhase] = useState<OptimizePhase>('idle')
  const [optimizeSnapshot, setOptimizeSnapshot] = useState<string | null>(null)
  const [optimizeError, setOptimizeError] = useState<string | null>(null)
  const [editorEpoch, setEditorEpoch] = useState(0)
  const promptRef = useRef<MarkdownEditorHandle>(null)
  const editorEpochRef = useRef(0)

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

  const executor = executors.find((e) => String(e.id) === executorId)
  const providers = executor?.providersCache ?? []
  const provider = providers.find((p) => p.id === providerId)
  const models = provider?.models ?? []

  const submit = async () => {
    if (saving || initializing) return
    setError(null)
    setInitError(null)
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
      // 2. 再调用执行器，把 AGENTS.md 与技能同步到工位
      setSaving(false)
      stage = 'init'
      setInitializing(true)
      await api.initializeWorker(saved.id)
      navigate(listPath)
    } catch (e) {
      const message = e instanceof Error ? e.message : '保存失败'
      if (stage === 'init') setInitError(message)
      else setError(message)
    } finally {
      setSaving(false)
      setInitializing(false)
    }
  }

  // 只要有名称就允许点击保存；缺少执行器/供应商/模型时点击后给出明确提示，
  // 避免按钮静默置灰导致无法判断原因
  const canSave = !!name.trim() && !saving && !initializing
  const busy = saving || initializing

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
      setOptimizeError('请先填写 AGENTS.md 内容')
      return
    }
    setOptimizeError(null)
    setOptimizePhase('loading')
    try {
      const optimized = await api.optimizeWorkerPrompt({
        prompt: current,
        workerId: worker?.id ?? null,
        executorId: executorId ? Number(executorId) : null,
        providerId: providerId || null,
        modelId: modelId || null,
      })
      if (!optimized.trim()) throw new Error('执行器返回内容为空')
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
              ? '系统调度机器人：历史识别与调度能力保留，新任务由平台直接识别分配'
              : '机器人的负责人对机器人的产出结果负责'}
          </p>
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
              名称、简介与任务定义用于平台识别分配，执行器与模型决定运行位置
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
            <WorkerSkillSection
              skills={skills}
              onChange={setSkills}
              pickerOpen={skillPickerOpen}
              onPickerOpenChange={setSkillPickerOpen}
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
