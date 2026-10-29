import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@appica/ui-react/card'
import { Button } from '@appica/ui-react/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@appica/ui-react/select'
import {
  api,
  TICKET_CATEGORY_DEFINITIONS,
  type PlatformUser,
  type TicketAssigneeType,
  type TicketCategory,
  type Worker,
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

/** 新建工单：描述 + 责任方；实际派发严格按该类型的默认调度任务定义执行 */
export function TicketCreatePage({ category }: { category: TicketCategory }) {
  const navigate = useNavigate()
  const meta =
    TICKET_CATEGORY_DEFINITIONS.find((item) => item.category === category) ??
    TICKET_CATEGORY_DEFINITIONS[0]
  const listPath = CATEGORY_PATH[category] ?? '/tickets/solution'
  const [description, setDescription] = useState('')
  const [assigneeType, setAssigneeType] =
    useState<TicketAssigneeType>('user')
  const [assigneeId, setAssigneeId] = useState('')
  const [users, setUsers] = useState<PlatformUser[]>([])
  const [workers, setWorkers] = useState<Worker[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const descriptionRef = useRef<MarkdownEditorHandle>(null)

  useEffect(() => {
    api
      .listUsers()
      .then((rows) => {
        setUsers(rows)
        if (rows[0]) setAssigneeId(String(rows[0].id))
      })
      .catch(() => undefined)
    api
      .listWorkers({ role: '工作者' })
      .then((rows) => setWorkers(rows.filter((worker) => worker.enabled)))
      .catch(() => undefined)
  }, [])

  const assigneeItems = useMemo(
    () =>
      assigneeType === 'user'
        ? Object.fromEntries(
            users.map((user) => [String(user.id), user.name]),
          )
        : Object.fromEntries(
            workers.map((worker) => [String(worker.id), worker.name]),
          ),
    [assigneeType, users, workers],
  )

  const changeAssigneeType = (value: unknown) => {
    const next = value === 'worker' ? 'worker' : 'user'
    setAssigneeType(next)
    const first = next === 'user' ? users[0]?.id : workers[0]?.id
    setAssigneeId(first ? String(first) : '')
  }

  const submit = () => {
    setError(null)
    const markdown = descriptionRef.current?.getMarkdown() ?? description
    if (!markdown.trim()) {
      setError('请填写工单描述')
      return
    }
    if (!assigneeId) {
      setError(assigneeType === 'user' ? '请选择负责人' : '请选择责任机器人')
      return
    }
    setSaving(true)
    api
      .createTicket({
        category,
        description: markdown,
        assigneeType,
        assigneeId: Number(assigneeId),
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
            创建后进入「{meta.defaultTemplateName}」调度，由任务定义绑定的机器人澄清并转交后续任务定义
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
            <CardTitle>工单信息</CardTitle>
            <CardDescription>
              责任方仅记录跟进归属；首次派发固定使用类型绑定的默认任务定义
            </CardDescription>
          </CardHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-4 pb-4">
            <div className="rounded-[var(--radius-md)] bg-background-muted px-3 py-2 text-sm">
              <p className="text-xs text-foreground-muted">工单类型</p>
              <p className="mt-1 font-medium">{category}</p>
              <p className="mt-2 text-xs text-foreground-muted">默认调度任务定义</p>
              <p className="mt-1 font-medium">{meta.defaultTemplateName}</p>
            </div>

            <label className="flex flex-col gap-1 text-sm">
              责任方类型
              <Select
                value={assigneeType}
                onValueChange={changeAssigneeType}
                items={{ user: '负责人', worker: '机器人' }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">负责人</SelectItem>
                  <SelectItem value="worker">机器人</SelectItem>
                </SelectContent>
              </Select>
            </label>

            <label className="flex flex-col gap-1 text-sm">
              {assigneeType === 'user' ? '负责人' : '责任机器人'}
              <Select
                value={assigneeId || null}
                onValueChange={(value) => setAssigneeId((value as string) ?? '')}
                items={assigneeItems}
              >
                <SelectTrigger className="w-full">
                  <SelectValue
                    placeholder={
                      assigneeType === 'user' ? '选择用户' : '选择机器人'
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {assigneeType === 'user'
                    ? users.map((user) => (
                        <SelectItem key={user.id} value={String(user.id)}>
                          {user.name}
                          {user.department ? ` · ${user.department}` : ''}
                        </SelectItem>
                      ))
                    : workers.map((worker) => (
                        <SelectItem key={worker.id} value={String(worker.id)}>
                          {worker.name}
                        </SelectItem>
                      ))}
                </SelectContent>
              </Select>
              <span className="text-xs text-foreground-muted">
                {assigneeType === 'user'
                  ? '用户不存在或停用会导致创建失败'
                  : '调度机器人不能作为责任方'}
              </span>
            </label>
          </div>
        </Card>
      </div>
    </div>
  )
}
