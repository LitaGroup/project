import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Badge } from '@appica/ui-react/badge'
import { Button } from '@appica/ui-react/button'
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@appica/ui-react/card'
import { Input } from '@appica/ui-react/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@appica/ui-react/select'
import { api } from '../lib/api'
import { MarkdownEditor } from '../components/MarkdownEditor'
import { PageBreadcrumb } from '../components/PageBreadcrumb'

const NO_OPTION = '__none__'

function readFile(file: File): Promise<string> {
  const body = new FormData()
  body.append('file', file)
  return fetch('/api/files/upload.md', { method: 'POST', body })
    .then(async (response) => {
      const text = await response.text()
      if (!response.ok) throw new Error(text || '文件上传失败')
      const match = text.match(/\(\/(files\/[^)\s]+)\)/)
      if (!match) throw new Error('上传结果中缺少文件地址')
      return `/${match[1]}`
    })
}

/** 新建工作流工单：按工单配置起始节点的结构化字段发起 */
export function TicketCreatePage() {
  const { definitionId } = useParams<{ definitionId: string }>()
  const id = Number(definitionId)
  const navigate = useNavigate()
  const [detail, setDetail] = useState<
    Awaited<ReturnType<typeof api.getTicketWorkflowDefinition>> | null
  >(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [uploading, setUploading] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({})

  useEffect(() => {
    if (!Number.isInteger(id) || id <= 0) {
      setError('工单配置 ID 不正确')
      return
    }
    api
      .getTicketWorkflowDefinition(id)
      .then((row) => {
        setDetail(row)
        const defaults: Record<string, string> = {}
        for (const field of row.published?.definition.nodes.find((node) => node.kind === 'start')?.inputFields ?? []) {
          defaults[field.key] = field.defaultValue == null ? '' : String(field.defaultValue)
        }
        setValues(defaults)
        setError(null)
      })
      .catch((e: Error) => setError(e.message))
  }, [id])

  const published = detail?.published?.definition ?? null
  const start = useMemo(
    () => published?.nodes.find((node) => node.kind === 'start') ?? null,
    [published],
  )
  const fields = start?.inputFields ?? []
  const publishable = Boolean(detail?.enabled && detail.latestPublishedVersion)
  const missingRequired = fields.some(
    (field) => field.required && !(values[field.key] ?? '').trim(),
  )

  const submit = () => {
    if (!detail) return
    setError(null)
    setSaving(true)
    api
      .createTicket({
        workflowDefinitionId: detail.id,
        title: values.title?.trim() || undefined,
        inputValues: values,
      })
      .then((ticket) => navigate(`/tickets/${ticket.id}`))
      .catch((e: Error) => setError(`创建失败：${e.message}`))
      .finally(() => setSaving(false))
  }

  const update = (key: string, value: string) =>
    setValues((current) => ({ ...current, [key]: value }))

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <PageBreadcrumb
            items={[
              { label: '工单', to: `/tickets/wf/${id}` },
              { label: detail?.name ?? '新建' },
            ]}
          />
          <h1 className="mt-2 text-2xl font-semibold">
            发起{detail?.name ?? '工单'}
          </h1>
          <p className="mt-1 text-sm text-foreground-muted">
            工单创建后固定使用 v{detail?.latestPublishedVersion ?? '-'} 工作流；由发起机器人负责最终验收
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate(`/tickets/wf/${id}`)}>
            取消
          </Button>
          <Button size="sm" onClick={submit} disabled={saving || !publishable || missingRequired}>
            {saving ? '创建中…' : '创建工单'}
          </Button>
        </div>
      </div>

      {error && (
        <p className="rounded-[var(--radius-md)] bg-error-muted px-3 py-2 text-sm text-error-foreground">
          {error}
        </p>
      )}
      {!detail && !error && <p className="text-sm text-foreground-muted">加载中…</p>}
      {detail && !publishable && (
        <p className="rounded-[var(--radius-md)] bg-error-muted px-3 py-2 text-sm text-error-foreground">
          该工单配置还没有发布版本，请先在「管理 → 工单配置」发布。
        </p>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        <Card className="min-w-0 flex-1">
          <CardHeader className="flex-none">
            <CardTitle>工单信息</CardTitle>
            <CardDescription>
              由起始节点定义；必填字段完整后才能创建
            </CardDescription>
          </CardHeader>
          <div className="grid gap-4 px-4 pb-4 md:grid-cols-2">
            {fields.map((field) => (
              <label
                key={field.key}
                className={`flex flex-col gap-1.5 text-sm ${
                  field.type === 'textarea' ? 'md:col-span-2' : ''
                }`}
              >
                <span className="flex items-center gap-1">
                  {field.label}
                  {field.required && <span className="text-error-foreground">*</span>}
                  <Badge variant="outline" size="sm">
                    {field.type === 'text' && '文本'}
                    {field.type === 'textarea' && '多行文本'}
                    {field.type === 'number' && '数字'}
                    {field.type === 'date' && '日期'}
                    {field.type === 'select' && '单选'}
                    {field.type === 'multiselect' && '多选'}
                    {field.type === 'file' && '文件'}
                  </Badge>
                </span>
                {field.type === 'textarea' ? (
                  <div className="h-56 md-editor-scroll rounded-none border border-border-strong bg-background-muted">
                    <MarkdownEditor
                      key={`${start?.key ?? 'start'}-${field.key}`}
                      value={values[field.key] ?? ''}
                      compact
                      appica
                      onChange={(markdown) => update(field.key, markdown)}
                    />
                  </div>
                ) : field.type === 'select' ? (
                  <Select
                    value={values[field.key] || NO_OPTION}
                    onValueChange={(value) =>
                      update(field.key, value === NO_OPTION ? '' : String(value))
                    }
                    items={{
                      [NO_OPTION]: field.placeholder ?? '请选择',
                      ...Object.fromEntries(
                        (field.options ?? []).map((option) => [option, option]),
                      ),
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={field.placeholder ?? '请选择'} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_OPTION}>
                        {field.placeholder ?? '请选择'}
                      </SelectItem>
                      {(field.options ?? []).map((option) => (
                        <SelectItem key={option} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : field.type === 'multiselect' ? (
                  <Select
                    multiple
                    value={(values[field.key] ?? '').split(',').filter(Boolean)}
                    onValueChange={(value) =>
                      update(field.key, (value as string[]).join(','))
                    }
                    items={Object.fromEntries(
                      (field.options ?? []).map((option) => [option, option]),
                    )}
                  >
                    <SelectTrigger clearable>
                      <SelectValue placeholder={field.placeholder ?? '请选择'}>
                        {(selected: string[]) =>
                          selected.length === 0
                            ? (field.placeholder ?? '请选择')
                            : selected.join('、')
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {(field.options ?? []).map((option) => (
                        <SelectItem key={option} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : field.type === 'file' ? (
                  <span className="flex items-center gap-2">
                    <input
                      ref={(element) => {
                        fileRefs.current[field.key] = element
                      }}
                      type="file"
                      className="text-sm"
                      onChange={async (event) => {
                        const file = event.target.files?.[0]
                        if (!file) return
                        setUploading(field.key)
                        setError(null)
                        try {
                          update(field.key, await readFile(file))
                        } catch (e) {
                          setError((e as Error).message)
                        } finally {
                          setUploading(null)
                          const fileInput = fileRefs.current[field.key]
                          if (fileInput) fileInput.value = ''
                        }
                      }}
                    />
                    {uploading === field.key && (
                      <span className="text-xs text-foreground-muted">上传中…</span>
                    )}
                  </span>
                ) : (
                  <Input
                    type={field.type === 'date' ? 'date' : field.type === 'number' ? 'number' : 'text'}
                    value={values[field.key] ?? ''}
                    onChange={(event) => update(field.key, event.target.value)}
                    placeholder={field.placeholder ?? ''}
                  />
                )}
                {field.type === 'file' && values[field.key] && (
                  <span className="truncate text-xs text-foreground-muted">
                    已上传：{values[field.key]}
                  </span>
                )}
              </label>
            ))}
            {fields.length === 0 && (
              <p className="text-sm text-foreground-muted">
                该流程起始节点未配置输入字段
              </p>
            )}
          </div>
        </Card>

        <Card className="w-full shrink-0 lg:w-[24rem]">
          <CardHeader className="flex-none">
            <CardTitle>处理流程</CardTitle>
            <CardDescription>创建后按发布版本自动推进节点任务</CardDescription>
          </CardHeader>
          <div className="flex flex-col gap-2 px-4 pb-4 text-sm">
            {(published?.nodes ?? []).map((node) => (
              <div
                key={node.key}
                className="rounded-[var(--radius-md)] bg-background-muted px-3 py-2"
              >
                <p className="flex items-center gap-2 font-medium">
                  {node.name}
                  <Badge variant="secondary" size="sm">
                    {node.kind === 'start' && '起始'}
                    {node.kind === 'operation' && '操作'}
                    {node.kind === 'approval' && '审批'}
                    {node.kind === 'acceptance' && '验收'}
                  </Badge>
                </p>
                {node.description && (
                  <p className="mt-1 line-clamp-3 text-xs text-foreground-muted">
                    {node.description}
                  </p>
                )}
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}
