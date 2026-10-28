import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@appica/ui-react/card'
import { Button } from '@appica/ui-react/button'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@appica/ui-react/select'
import { api, type TaskTemplate, type TaskTypeDef } from '../lib/api'
import { PageBreadcrumb } from '../components/PageBreadcrumb'
import {
  MarkdownEditor,
  type MarkdownEditorHandle,
} from '../components/MarkdownEditor'

/**
 * 新建任务（独立页面）：填写任务描述（Markdown），右侧可选任务类型与任务定义。
 * 创建后进入等待分配，由平台按任务定义/类型匹配处理机器人；
 * 无法匹配时归入「未知任务」，交给系统未知任务定义（ID=6）的处理机器人接管。
 */
export function TaskCreatePage() {
  const navigate = useNavigate()
  const [description, setDescription] = useState('')
  const [taskTypes, setTaskTypes] = useState<TaskTypeDef[]>([])
  const [templates, setTemplates] = useState<TaskTemplate[]>([])
  const [taskType, setTaskType] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const descriptionRef = useRef<MarkdownEditorHandle>(null)

  useEffect(() => {
    api.listTaskTypes().then(setTaskTypes).catch(() => undefined)
    api.listTaskTemplates().then(setTemplates).catch(() => undefined)
  }, [])

  const typeItems = useMemo(
    () => Object.fromEntries(taskTypes.map((type) => [type.name, type.name])),
    [taskTypes],
  )
  // 任务类型筛选任务定义；未选类型时展示全部定义
  const filteredTemplates = useMemo(
    () =>
      taskType
        ? templates.filter((template) => template.type === taskType)
        : templates,
    [templates, taskType],
  )
  const templateItems = useMemo(
    () =>
      Object.fromEntries(
        filteredTemplates.map((template) => [
          String(template.id),
          template.name,
        ]),
      ),
    [filteredTemplates],
  )

  /** 切换任务类型：原选中的任务定义不属于新类型时清除 */
  const changeType = (value: string | null) => {
    const next = value ?? ''
    setTaskType(next)
    if (!templateId) return
    const template = templates.find((item) => String(item.id) === templateId)
    if (!next || template?.type !== next) setTemplateId('')
  }

  /** 选择任务定义：仅带出对应的任务类型，不填充任务描述 */
  const changeTemplate = (value: string | null) => {
    const next = value ?? ''
    setTemplateId(next)
    const template = templates.find((item) => String(item.id) === next)
    if (template) setTaskType(template.type)
  }

  const submit = () => {
    setError(null)
    // 取编辑器当前内容：onChange 有防抖，避免刚输入就创建丢字
    const markdown = descriptionRef.current?.getMarkdown() ?? description
    if (!markdown.trim()) {
      setError('请填写任务描述')
      return
    }
    setSaving(true)
    api
      .createTaskPackage({
        description: markdown,
        // 留空不传；平台无法匹配时自动归入「未知任务」
        type: taskType || undefined,
        templateId: templateId ? Number(templateId) : null,
      })
      .then(() => navigate('/tasks/list'))
      .catch((e: Error) => setError(`创建失败：${e.message}`))
      .finally(() => setSaving(false))
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <PageBreadcrumb
            items={[
              { label: '任务', to: '/tasks/list' },
              { label: '新建任务' },
            ]}
          />
          <h1 className="mt-2 text-2xl font-semibold">新建任务</h1>
          <p className="mt-1 text-sm text-foreground-muted">
            填写任务描述即可；创建后进入等待分配，平台会按任务定义和类型匹配处理机器人，无法匹配时自动归入「未知任务」
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate('/tasks/list')}
          >
            取消
          </Button>
          <Button size="sm" onClick={submit} disabled={saving}>
            {saving ? '创建中…' : '创建任务'}
          </Button>
        </div>
      </div>

      {error && (
        <p className="rounded-[var(--radius-md)] bg-background-muted px-3 py-2 text-sm">
          {error}
        </p>
      )}

      {/* 布局参考「新建机器人」：左侧 Markdown 编辑区撑满剩余高度，右侧基础信息独立滚动 */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        <Card className="min-h-64 min-w-0 flex-1">
          <CardHeader className="flex-none">
            <CardTitle>任务描述</CardTitle>
            <CardDescription>
              使用 Markdown 描述任务目标、背景与期望产出，派发时随任务一起下发给机器人
            </CardDescription>
          </CardHeader>
          <div className="relative mx-2 mb-2 min-h-0 flex-1">
            <div className="absolute inset-0 overflow-auto bg-background-muted">
              <MarkdownEditor
                ref={descriptionRef}
                value=""
                compact
                appica
                onChange={setDescription}
              />
            </div>
          </div>
        </Card>

        <Card className="w-full shrink-0 lg:min-h-0 lg:w-[22rem]">
          <CardHeader className="flex-none">
            <CardTitle>基础信息</CardTitle>
            <CardDescription>
              任务类型与任务定义均可留空，无法匹配时自动进入未知任务
            </CardDescription>
          </CardHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-4 pb-4">
            <label className="flex flex-col gap-1 text-sm">
              任务类型
              <Select
                value={taskType || null}
                onValueChange={(value) =>
                  changeType((value as string | null) ?? '')
                }
                items={typeItems}
              >
                <SelectTrigger className="w-full" clearable>
                  <SelectValue placeholder="不指定，由平台自动匹配" />
                </SelectTrigger>
                <SelectContent>
                  {taskTypes.map((type) => (
                    <SelectItem key={type.name} value={type.name}>
                      {type.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-xs text-foreground-muted">
                可留空；无法匹配任务定义/类型时归入未知任务
              </span>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              任务定义
              <Select
                value={templateId || null}
                onValueChange={(value) =>
                  changeTemplate((value as string | null) ?? '')
                }
                items={templateItems}
              >
                <SelectTrigger className="w-full" clearable>
                  <SelectValue placeholder="不指定" />
                </SelectTrigger>
                <SelectContent>
                  {filteredTemplates.map((template) => (
                    <SelectItem key={template.id} value={String(template.id)}>
                      {template.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-xs text-foreground-muted">
                可留空；选中后仅带出该定义的任务类型，不填充任务描述
              </span>
            </label>
          </div>
        </Card>
      </div>
    </div>
  )
}
