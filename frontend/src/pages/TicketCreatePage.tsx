import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@appica/ui-react/card'
import { Button } from '@appica/ui-react/button'
import {
  api,
  TICKET_CATEGORY_DEFINITIONS,
  type TicketCategory,
} from '../lib/api'
import { PageBreadcrumb } from '../components/PageBreadcrumb'
import {
  MarkdownEditor,
  type MarkdownEditorHandle,
} from '../components/MarkdownEditor'

const CATEGORY_PATH: Record<string, string> = {
  方案工单: '/tickets/solution',
  技术工单: '/tickets/tech',
  数据工单: '/tickets/data',
  运维工单: '/tickets/ops',
  需求工单: '/tickets/requirement',
  BUG反馈: '/tickets/bug',
}

/** 新建工单：只需填写描述；处理机器人由该类型绑定的默认调度任务定义自动分配 */
export function TicketCreatePage({ category }: { category: TicketCategory }) {
  const navigate = useNavigate()
  const meta =
    TICKET_CATEGORY_DEFINITIONS.find((item) => item.category === category) ??
    TICKET_CATEGORY_DEFINITIONS[0]
  const listPath = CATEGORY_PATH[category] ?? '/tickets/solution'
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const descriptionRef = useRef<MarkdownEditorHandle>(null)

  const submit = () => {
    setError(null)
    const markdown = descriptionRef.current?.getMarkdown() ?? description
    if (!markdown.trim()) {
      setError('请填写工单描述')
      return
    }
    setSaving(true)
    api
      .createTicket({
        category,
        description: markdown,
      })
      .then((ticket) => navigate(`/tickets/${ticket.id}`))
      .catch((e: Error) => setError(`创建失败：${e.message}`))
      .finally(() => setSaving(false))
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <PageBreadcrumb
            items={[{ label: category, to: listPath }, { label: '新建' }]}
          />
          <h1 className="mt-2 text-2xl font-semibold">新建{category}</h1>
          <p className="mt-1 text-sm text-foreground-muted">
            创建后由「{meta.defaultTemplateName}」绑定的机器人自动受理、澄清并分配后续任务定义
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate(listPath)}>
            取消
          </Button>
          <Button size="sm" onClick={submit} disabled={saving}>
            {saving ? '创建中…' : '创建工单'}
          </Button>
        </div>
      </div>

      {error && (
        <p className="rounded-[var(--radius-md)] bg-error-soft px-3 py-2 text-sm text-error-foreground">
          {error}
        </p>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        <Card className="min-h-64 min-w-0 flex-1">
          <CardHeader className="flex-none">
            <CardTitle>工单描述</CardTitle>
            <CardDescription>
              描述业务目标、背景、期望产出与验收标准；首行将作为工单临时标题
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

        <Card className="w-full shrink-0 lg:min-h-0 lg:w-[24rem]">
          <CardHeader className="flex-none">
            <CardTitle>处理方式</CardTitle>
            <CardDescription>
              无需选择负责人或机器人，平台按工单类型绑定的任务定义自动分配
            </CardDescription>
          </CardHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-4 pb-4">
            <div className="rounded-[var(--radius-md)] bg-background-muted px-3 py-2 text-sm">
              <p className="text-xs text-foreground-muted">工单类型</p>
              <p className="mt-1 font-medium">{category}</p>
              <p className="mt-2 text-xs text-foreground-muted">
                默认调度任务定义
              </p>
              <p className="mt-1 font-medium">{meta.defaultTemplateName}</p>
              <p className="mt-2 text-xs text-foreground-muted">
                处理机器人
              </p>
              <p className="mt-1 font-medium">由任务定义绑定的机器人自动处理</p>
            </div>
            <p className="text-xs text-foreground-muted">
              信息不明确时，调度机器人会在工单对话中向需求方提问；明确后会转交给管理端为该工单配置的后续任务定义。
            </p>
          </div>
        </Card>
      </div>
    </div>
  )
}
