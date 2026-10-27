import { useEffect, useMemo, useRef, useState } from 'react'
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
  Combobox,
  ComboboxChips,
  ComboboxChip,
  ComboboxValue,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxList,
  ComboboxItem,
  createComboboxItems,
} from '@appica/ui-react/combobox'
import {
  api,
  type TaskTemplate,
  type TaskTypeDef,
  type Worker,
} from '../lib/api'
import { PageBreadcrumb } from '../components/PageBreadcrumb'
import {
  MarkdownEditor,
  type MarkdownEditorHandle,
} from '../components/MarkdownEditor'

const LIST_PATH = '/tasks/templates'

/** 默认兜底任务类型（与后端 TASK_TYPE_DEFAULT 一致） */
const DEFAULT_TASK_TYPE = '其它'

interface AgentOption {
  id: string
  name: string
  enabled: boolean
}

/** 新建任务定义时预置的统一描述结构 */
const DESCRIPTION_TEMPLATE = `## 任务定义描述

> 这类任务的定义，定义什么任务属于这种任务

## 定义任务输入

> 要完成任务需要提供的信息

## 定义任务交付

> 任务最终以什么方式交付`

/**
 * 任务定义新建与编辑（独立页面）。
 * 任务定义用于沉淀一类任务的可复用类型、描述与多个默认处理机器人。
 */
export function TaskTemplateEditPage() {
  const { templateId } = useParams<{ templateId: string }>()
  const navigate = useNavigate()

  const [workers, setWorkers] = useState<Worker[]>([])
  const [taskTypes, setTaskTypes] = useState<TaskTypeDef[]>([])
  const [template, setTemplate] = useState<TaskTemplate | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [taskType, setTaskType] = useState(DEFAULT_TASK_TYPE)
  const [description, setDescription] = useState(DESCRIPTION_TEMPLATE)
  const [agentIds, setAgentIds] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const descriptionRef = useRef<MarkdownEditorHandle>(null)

  const agentOptions = useMemo<AgentOption[]>(
    () =>
      workers.map((worker) => ({
        id: String(worker.id),
        name: worker.name,
        enabled: worker.enabled,
      })),
    [workers],
  )
  const agentItems = useMemo(
    () =>
      createComboboxItems(agentOptions, {
        getValue: (worker) => worker.id,
        getLabel: (worker) => worker.name,
      }),
    [agentOptions],
  )
  const workerNames = useMemo(
    () => new Map(agentOptions.map((worker) => [worker.id, worker.name])),
    [agentOptions],
  )
  const typeNames = useMemo(
    () =>
      Array.from(
        new Set([
          ...taskTypes.map((type) => type.name),
          taskType || DEFAULT_TASK_TYPE,
        ]),
      ),
    [taskTypes, taskType],
  )

  const initialTitle = template ? `编辑「${template.name}」` : '新建任务定义'
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
    api.listTaskTypes().then(setTaskTypes).catch(() => undefined)
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
        setTaskType(t.type || DEFAULT_TASK_TYPE)
        setDescription(t.description ?? '')
        setAgentIds((t.agentIds ?? []).map(String))
      })
      .catch((e: Error) => {
        if (alive) setLoadError(e.message)
      })
    return () => {
      alive = false
    }
  }, [templateId])

  const submit = () => {
    setError(null)
    // 取编辑器当前内容：onChange 有防抖，避免刚输入就保存丢字
    const descriptionText =
      descriptionRef.current?.getMarkdown() ?? description
    const payload = {
      name,
      type: taskType,
      description: descriptionText.trim() || null,
      agentIds: agentIds.map(Number),
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

  const canSave = !!name.trim() && !!taskType.trim() && !saving

  if (loading) {
    return <p className="text-sm text-foreground-muted">加载中…</p>
  }
  if (loadError) {
    return (
      <div className="flex flex-col gap-4">
        <PageBreadcrumb
          items={[{ label: '任务定义', to: LIST_PATH }, { label: '编辑' }]}
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
            items={[{ label: '任务定义', to: LIST_PATH }, { label: initialTitle }]}
          />
          <h1 className="mt-2 text-2xl font-semibold">{pageTitle}</h1>
          <p className="mt-1 text-sm text-foreground-muted">
            沉淀一类任务的可复用定义：任务类型、统一描述、所需输入、交付方式与多个默认处理机器人
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
            <CardTitle>任务定义描述</CardTitle>
            <CardDescription>
              使用 Markdown 统一说明任务范围、完成任务所需输入和最终交付方式
            </CardDescription>
          </CardHeader>
          <div className="relative mx-2 mb-2 min-h-0 flex-1">
            <div className="absolute inset-0 overflow-auto bg-background-muted">
              <MarkdownEditor
                key={`${template?.id ?? 'new'}:description`}
                ref={descriptionRef}
                value={description}
                compact
                appica
                onChange={setDescription}
              />
            </div>
          </div>
        </Card>

        <Card className="w-full shrink-0 lg:min-h-0 lg:w-[26rem]">
          <CardHeader className="flex-none">
            <CardTitle>基础信息</CardTitle>
            <CardDescription>
              任务类型用于分类与筛选，处理机器人可多选并作为默认执行者
            </CardDescription>
          </CardHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-4 pb-4">
            <label className="flex flex-col gap-1 text-sm">
              任务定义名称
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="如：后端接口技术设计"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              任务类型
              <Select
                value={taskType}
                onValueChange={(value) =>
                  setTaskType((value as string) || DEFAULT_TASK_TYPE)
                }
                items={Object.fromEntries(
                  typeNames.map((name) => [name, name]),
                )}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {typeNames.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              处理机器人
              <Combobox
                multiple
                size="sm"
                items={agentItems}
                value={agentIds}
                onValueChange={(value) => setAgentIds(value as string[])}
              >
                <ComboboxChips
                  className="w-full"
                  placeholder="添加处理机器人"
                >
                  <ComboboxValue>
                    {(selected: string[]) =>
                      selected.map((agentId) => (
                        <ComboboxChip key={agentId} aria-label={agentId}>
                          {workerNames.get(agentId) ?? `#${agentId}`}
                        </ComboboxChip>
                      ))
                    }
                  </ComboboxValue>
                </ComboboxChips>
                <ComboboxContent>
                  <ComboboxEmpty>没有匹配的机器人</ComboboxEmpty>
                  <ComboboxList>
                    {(worker: AgentOption) => (
                      <ComboboxItem key={worker.id} value={worker.id}>
                        {worker.name}
                        {worker.enabled ? '' : '（停用）'}
                      </ComboboxItem>
                    )}
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
              <span className="text-xs text-foreground-muted">
                可添加多个；不选择时平台按任务类型继续匹配，仍无法匹配则归入未知任务
              </span>
            </label>
          </div>
        </Card>
      </div>
    </div>
  )
}
