import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@appica/ui-react/card'
import { Button } from '@appica/ui-react/button'
import { Input } from '@appica/ui-react/input'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@appica/ui-react/select'
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@appica/ui-react/tabs'
import { api, type TaskTemplate, type Worker } from '../lib/api'
import { PageBreadcrumb } from '../components/PageBreadcrumb'
import {
  MarkdownEditor,
  type MarkdownEditorHandle,
} from '../components/MarkdownEditor'

const LIST_PATH = '/tasks/templates'

/** 任务定义的三个 Markdown 字段（Markdown 编辑器同一时间只挂载当前字段） */
type FieldKey = 'description' | 'input' | 'outputSpec'

/**
 * 任务包新建与编辑（独立页面）。
 * 任务包定义一类任务的可复用描述/输入/输出与默认处理机器人。
 */
export function TaskTemplateEditPage() {
  const { templateId } = useParams<{ templateId: string }>()
  const navigate = useNavigate()

  const [workers, setWorkers] = useState<Worker[]>([])
  const [template, setTemplate] = useState<TaskTemplate | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [input, setInput] = useState('')
  const [outputSpec, setOutputSpec] = useState('')
  const [agentId, setAgentId] = useState('')
  const [activeField, setActiveField] = useState<FieldKey>('description')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const descriptionRef = useRef<MarkdownEditorHandle>(null)
  const inputRef = useRef<MarkdownEditorHandle>(null)
  const outputSpecRef = useRef<MarkdownEditorHandle>(null)

  const fieldRefs = {
    description: descriptionRef,
    input: inputRef,
    outputSpec: outputSpecRef,
  }
  const fieldValues = { description, input, outputSpec }
  const fieldSetters = {
    description: setDescription,
    input: setInput,
    outputSpec: setOutputSpec,
  }

  const initialTitle = template ? `编辑「${template.name}」` : '新建任务包'
  const typedName = name.trim()
  const pageTitle = template
    ? typedName
      ? `编辑「${typedName}」`
      : initialTitle
    : typedName || initialTitle
  const loading =
    Boolean(templateId) &&
    !loadError &&
    template?.id !== Number(templateId)

  useEffect(() => {
    api.listWorkers({ role: '工作者' }).then(setWorkers).catch(() => undefined)
  }, [])

  useEffect(() => {
    if (!templateId) return
    let alive = true
    api
      .getTaskTemplate(Number(templateId))
      .then((t) => {
        if (!alive) return
        setLoadError(null)
        setTemplate(t)
        setName(t.name)
        setDescription(t.description ?? '')
        setInput(t.input ?? '')
        setOutputSpec(t.outputSpec ?? '')
        setAgentId(t.agentId ? String(t.agentId) : '')
      })
      .catch((e: Error) => {
        if (alive) setLoadError(e.message)
      })
    return () => {
      alive = false
    }
  }, [templateId])

  /** 切换字段前先把当前编辑器内容落回状态：未挂载的字段靠 state 保存 */
  const handleFieldChange = (value: string | number | null) => {
    const latest = fieldRefs[activeField].current?.getMarkdown()
    if (latest !== undefined) fieldSetters[activeField](latest)
    setActiveField(value as FieldKey)
  }

  const submit = () => {
    setError(null)
    // 取编辑器当前内容：onChange 有防抖，避免刚输入就保存丢字
    const descriptionText =
      descriptionRef.current?.getMarkdown() ?? description
    const inputText = inputRef.current?.getMarkdown() ?? input
    const outputSpecText = outputSpecRef.current?.getMarkdown() ?? outputSpec
    const payload = {
      name,
      description: descriptionText.trim() || null,
      input: inputText.trim() || null,
      outputSpec: outputSpecText.trim() || null,
      agentId: agentId ? Number(agentId) : null,
    }
    setSaving(true)
    const saving$ = template
      ? api.updateTaskTemplate(template.id, payload)
      : api.createTaskTemplate(payload)
    saving$
      .then(() => navigate(LIST_PATH))
      .catch((e: Error) => setError(e.message))
      .finally(() => setSaving(false))
  }

  const canSave = !!name.trim() && !saving

  if (loading) {
    return <p className="text-sm text-foreground-muted">加载中…</p>
  }
  if (loadError) {
    return (
      <div className="flex flex-col gap-4">
        <PageBreadcrumb
          items={[{ label: '任务包', to: LIST_PATH }, { label: '编辑' }]}
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
            items={[{ label: '任务包', to: LIST_PATH }, { label: initialTitle }]}
          />
          <h1 className="mt-2 text-2xl font-semibold">{pageTitle}</h1>
          <p className="mt-1 text-sm text-foreground-muted">
            定义一类任务的描述、输入、输出与默认处理机器人，新建任务时可一键填充
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate(LIST_PATH)}>
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

      {/* 布局参考「新建机器人」：左侧 Markdown 编辑区撑满剩余高度，右侧基础信息独立滚动 */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        <Card className="min-h-64 min-w-0 flex-1">
          <CardHeader className="flex-none">
            <CardTitle>任务定义</CardTitle>
            <CardDescription>
              任务描述、输入、输出均为 Markdown，派发任务时随任务一起下发给机器人
            </CardDescription>
          </CardHeader>
          <Tabs
            value={activeField}
            onValueChange={handleFieldChange}
            variant="line"
            size="sm"
            className="mx-4 mb-2 flex min-h-0 flex-1 flex-col"
          >
            <TabsList>
              <TabsTrigger value="description">任务描述</TabsTrigger>
              <TabsTrigger value="input">任务输入</TabsTrigger>
              <TabsTrigger value="outputSpec">任务输出</TabsTrigger>
            </TabsList>
            {(['description', 'input', 'outputSpec'] as const).map((field) => (
              <TabsContent
                key={field}
                value={field}
                className="min-h-0 flex-1"
              >
                <div className="h-full overflow-auto bg-background-muted">
                  <MarkdownEditor
                    key={`${template?.id ?? 'new'}:${field}`}
                    ref={fieldRefs[field]}
                    value={fieldValues[field]}
                    compact
                    appica
                    onChange={fieldSetters[field]}
                  />
                </div>
              </TabsContent>
            ))}
          </Tabs>
        </Card>

        <Card className="w-full shrink-0 lg:min-h-0 lg:w-[26rem]">
          <CardHeader className="flex-none">
            <CardTitle>基础信息</CardTitle>
            <CardDescription>
              任务包名称用于新建任务时选择，处理机器人作为默认执行者
            </CardDescription>
          </CardHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-4 pb-4">
            <label className="flex flex-col gap-1 text-sm">
              任务包名称
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="如：后端接口技术设计"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              处理机器人
              <Select
                value={agentId || 'none'}
                onValueChange={(v) =>
                  setAgentId(v === 'none' ? '' : (v as string))
                }
                items={{
                  none: '不指定（由调度器分配）',
                  ...Object.fromEntries(
                    workers.map((w) => [
                      String(w.id),
                      `${w.name}${w.enabled ? '' : '（停用）'}`,
                    ]),
                  ),
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">不指定（由调度器分配）</SelectItem>
                  {workers.map((w) => (
                    <SelectItem key={w.id} value={String(w.id)}>
                      {w.name}
                      {w.enabled ? '' : '（停用）'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          </div>
        </Card>
      </div>
    </div>
  )
}
