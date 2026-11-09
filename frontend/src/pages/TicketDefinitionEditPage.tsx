import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Badge } from '@appica/ui-react/badge'
import { Button, buttonVariants } from '@appica/ui-react/button'
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
import { Switch } from '@appica/ui-react/switch'
import { Textarea } from '@appica/ui-react/textarea'
import { MermaidDiagram } from '../components/MermaidDiagram'
import { PageBreadcrumb } from '../components/PageBreadcrumb'
import {
  api,
  WORKFLOW_END_NODE,
  type TaskTemplate,
  type TicketWorkflowDefinitionDetail,
  type TicketWorkflowInputField,
  type Worker,
  type WorkflowEdgeDefinition,
  type WorkflowNodeDefinition,
  type WorkflowNodeKind,
  type WorkflowOutcome,
} from '../lib/api'

const NO_SELECTION = '__none__'

const NODE_KIND_LABEL: Record<WorkflowNodeKind, string> = {
  start: '起始节点',
  operation: '操作节点',
  approval: '审批节点',
  acceptance: '验收节点',
}

const OUTCOME_LABEL: Record<WorkflowOutcome, string> = {
  succeeded: '执行成功',
  failed: '执行失败',
  approved: '通过',
  rejected: '驳回',
}

const FIELD_TYPE_LABEL: Record<TicketWorkflowInputField['type'], string> = {
  text: '单行文本',
  textarea: '多行文本',
  number: '数字',
  date: '日期',
  select: '单选',
  file: '文件',
}

function formatTime(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('zh-CN', {
    hour12: false,
    timeZone: 'Asia/Shanghai',
  })
}

function optionalId(value: string): number | null {
  return value === NO_SELECTION ? null : Number(value)
}

function nextNodeKey(nodes: WorkflowNodeDefinition[]): string {
  const used = new Set(nodes.map((node) => node.key))
  let index = 1
  while (used.has(`node-${index}`)) index += 1
  return `node-${index}`
}

function outcomeOptions(kind: WorkflowNodeKind): WorkflowOutcome[] {
  if (kind === 'operation') return ['succeeded', 'failed']
  if (kind === 'approval' || kind === 'acceptance') {
    return ['approved', 'rejected']
  }
  return []
}

function edgeLabel(outcome: WorkflowOutcome | null): string {
  if (!outcome) return '无条件流转'
  return OUTCOME_LABEL[outcome]
}

function mermaidSafe(value: string): string {
  return value
    .replace(/["\r\n]/g, ' ')
    .replace(/[{}[\]()<>]/g, ' ')
    .trim()
}

function buildFlowchart(
  nodes: WorkflowNodeDefinition[],
  edges: WorkflowEdgeDefinition[],
): string {
  if (nodes.length === 0) return 'flowchart TD\n  empty[暂无节点]'
  const shape = (node: WorkflowNodeDefinition): string => {
    const label = mermaidSafe(node.name)
    if (node.kind === 'start') return `${node.key}(["${label}"])`
    if (node.kind === 'approval') return `${node.key}{"${label}"}`
    if (node.kind === 'acceptance') return `${node.key}{{"${label}"}}`
    return `${node.key}["${label}"]`
  }
  const lines = ['flowchart TD']
  for (const node of nodes) lines.push(`  ${shape(node)}`)
  lines.push(`  ${WORKFLOW_END_NODE}(["流程结束"])`)
  for (const edge of edges) {
    const label = edge.label?.trim() || edgeLabel(edge.outcome)
    lines.push(
      `  ${edge.from} -->|"${mermaidSafe(label)}"| ${
        edge.to === WORKFLOW_END_NODE ? WORKFLOW_END_NODE : edge.to
      }`,
    )
  }
  return lines.join('\n')
}

/** 工单配置编辑：结构化配置起始字段、节点任务、负责机器人与流转规则 */
export function TicketDefinitionEditPage() {
  const { definitionId } = useParams<{ definitionId: string }>()
  const navigate = useNavigate()

  const [detail, setDetail] =
    useState<TicketWorkflowDefinitionDetail | null>(null)
  const [templates, setTemplates] = useState<TaskTemplate[]>([])
  const [workers, setWorkers] = useState<Worker[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [nodes, setNodes] = useState<WorkflowNodeDefinition[]>([])
  const [edges, setEdges] = useState<WorkflowEdgeDefinition[]>([])

  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const applyDetail = (value: TicketWorkflowDefinitionDetail) => {
    setDetail(value)
    setName(value.name)
    setDescription(value.description ?? '')
    setEnabled(value.enabled)
    setNodes(value.draft.nodes)
    setEdges(value.draft.edges)
  }

  useEffect(() => {
    if (!definitionId) return
    let alive = true
    Promise.all([
      api.getTicketWorkflowDefinition(Number(definitionId)),
      api.listTaskTemplates(),
      api.listWorkers(),
    ])
      .then(([definition, taskTemplates, publicWorkers]) => {
        if (!alive) return
        setLoadError(null)
        applyDetail(definition)
        setTemplates(
          [...taskTemplates].sort((a, b) =>
            a.name.localeCompare(b.name, 'zh-CN'),
          ),
        )
        setWorkers(
          [...publicWorkers].sort((a, b) =>
            a.name.localeCompare(b.name, 'zh-CN'),
          ),
        )
      })
      .catch((e: Error) => {
        if (alive) setLoadError(e.message)
      })
    return () => {
      alive = false
    }
  }, [definitionId])

  const templateItems = useMemo<Record<string, string>>(
    () => ({
      [NO_SELECTION]: '未选择任务定义',
      ...Object.fromEntries(
        templates.map((template) => [
          String(template.id),
          template.name,
        ]),
      ),
    }),
    [templates],
  )
  const workerItems = useMemo<Record<string, string>>(
    () => ({
      [NO_SELECTION]: '未选择负责机器人',
      ...Object.fromEntries(
        workers.map((worker) => [
          String(worker.id),
          worker.enabled ? worker.name : `${worker.name}（已停用）`,
        ]),
      ),
    }),
    [workers],
  )
  const nodeItems = useMemo<Record<string, string>>(
    () => ({
      ...Object.fromEntries(nodes.map((node) => [node.key, node.name])),
      [WORKFLOW_END_NODE]: '流程结束',
    }),
    [nodes],
  )
  const startNode = nodes.find((node) => node.kind === 'start')
  const acceptanceNodes = nodes.filter((node) => node.kind === 'acceptance')
  const acceptanceNode = acceptanceNodes[0]

  const updateNode = (
    index: number,
    patch: Partial<WorkflowNodeDefinition>,
  ) => {
    setNodes((current) =>
      current.map((node, i) => (i === index ? { ...node, ...patch } : node)),
    )
  }

  const addNode = () => {
    const key = nextNodeKey(nodes)
    const node: WorkflowNodeDefinition = {
      key,
      name: `新节点 ${nodes.length + 1}`,
      kind: 'operation',
      taskTemplateId: null,
      responsibleWorkerId: null,
      inputFields: null,
      autoAccept: false,
      description: null,
    }
    const insertAt = acceptanceNode
      ? nodes.findIndex((item) => item.key === acceptanceNode.key)
      : nodes.length
    setNodes((current) => [
      ...current.slice(0, insertAt),
      node,
      ...current.slice(insertAt),
    ])
    // 首个业务节点自动接在起始节点后面，减少空配置
    if (startNode && !edges.some((edge) => edge.from === startNode.key)) {
      setEdges((current) => [
        ...current,
        {
          from: startNode.key,
          to: key,
          outcome: null,
          label: '开始处理',
        },
      ])
    }
  }

  const removeNode = (key: string) => {
    const node = nodes.find((item) => item.key === key)
    if (!node || node.kind === 'start') return
    if (
      node.kind === 'acceptance' &&
      nodes.filter((item) => item.kind === 'acceptance').length <= 1
    ) {
      return
    }
    setNodes(nodes.filter((item) => item.key !== key))
    setEdges((current) =>
      current.filter((edge) => edge.from !== key && edge.to !== key),
    )
  }

  const updateEdge = (
    index: number,
    patch: Partial<WorkflowEdgeDefinition>,
  ) => {
    setEdges((current) =>
      current.map((edge, i) => (i === index ? { ...edge, ...patch } : edge)),
    )
  }

  const addEdge = () => {
    const from = startNode?.key ?? nodes[0]?.key
    if (!from) return
    const source = nodes.find((node) => node.key === from)
    const options = source ? outcomeOptions(source.kind) : []
    const outcome = options[0] ?? null
    setEdges((current) => [
      ...current,
      {
        from,
        to: acceptanceNode?.key ?? WORKFLOW_END_NODE,
        outcome,
        label: edgeLabel(outcome),
      },
    ])
  }

  const updateInputField = (
    nodeIndex: number,
    fieldIndex: number,
    patch: Partial<TicketWorkflowInputField>,
  ) => {
    setNodes((current) =>
      current.map((node, i) => {
        if (i !== nodeIndex) return node
        const fields = (node.inputFields ?? []).map((field, j) =>
          j === fieldIndex ? { ...field, ...patch } : field,
        )
        return { ...node, inputFields: fields }
      }),
    )
  }

  const addInputField = (nodeIndex: number) => {
    setNodes((current) =>
      current.map((node, i) => {
        if (i !== nodeIndex) return node
        const fields = node.inputFields ?? []
        let index = fields.length + 1
        const used = new Set(fields.map((field) => field.key))
        while (used.has(`field${index}`)) index += 1
        return {
          ...node,
          inputFields: [
            ...fields,
            {
              key: `field${index}`,
              label: `字段 ${index}`,
              type: 'text',
              required: false,
              placeholder: '',
              defaultValue: null,
            },
          ],
        }
      }),
    )
  }

  const removeInputField = (nodeIndex: number, fieldIndex: number) => {
    setNodes((current) =>
      current.map((node, i) => {
        if (i !== nodeIndex) return node
        return {
          ...node,
          inputFields: (node.inputFields ?? []).filter((_, j) => j !== fieldIndex),
        }
      }),
    )
  }

  const payload = () => ({
    name: name.trim(),
    description: description.trim() || null,
    enabled,
    definition: {
      startNode: startNode?.key ?? '',
      nodes,
      edges: edges.map((edge) => ({
        ...edge,
        label: edge.label?.trim() || edgeLabel(edge.outcome),
      })),
    },
  })

  const persist = (publish: boolean) => {
    if (!detail) return
    setSaving(true)
    setMessage(null)
    setError(null)
    const request = publish
      ? api.publishTicketWorkflow(detail.id, payload())
      : api.saveTicketWorkflowDraft(detail.id, payload())
    request
      .then((updated) => {
        applyDetail(updated)
        setMessage(
          publish
            ? `已发布 v${updated.latestPublishedVersion}，后续新建工单将使用该版本`
            : '草稿已保存；发布后才会生成新版本',
        )
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setSaving(false))
  }

  const loadPublished = () => {
    if (!detail?.published) return
    const definition = detail.published.definition
    setName(detail.published.name)
    setDescription(detail.published.description ?? '')
    setNodes(definition.nodes)
    setEdges(definition.edges)
    setMessage(
      `已载入 v${detail.published.version} 的流程配置，保存草稿后不会影响已发布版本`,
    )
    setError(null)
  }

  if (!definitionId || Number.isNaN(Number(definitionId))) {
    return <p className="text-sm text-error-foreground">工单配置 ID 不正确</p>
  }
  if (loadError) {
    return (
      <div className="flex flex-col gap-4">
        <PageBreadcrumb
          items={[
            { label: '工单配置', to: '/admin/ticket-config' },
            { label: '编辑' },
          ]}
        />
        <p className="text-sm text-error-foreground">加载失败：{loadError}</p>
      </div>
    )
  }
  if (!detail) {
    return <p className="text-sm text-foreground-muted">加载中…</p>
  }

  const flowchart = buildFlowchart(nodes, edges)

  return (
    <div className="flex flex-col gap-4 pb-12">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <PageBreadcrumb
            items={[
              { label: '工单配置', to: '/admin/ticket-config' },
              { label: detail.category },
            ]}
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold">{name || detail.category}</h1>
            {detail.builtIn && (
              <Badge variant="secondary" size="sm">
                系统内置
              </Badge>
            )}
            {detail.latestPublishedVersion ? (
              <Badge variant="outline" size="sm">
                当前发布 v{detail.latestPublishedVersion}
              </Badge>
            ) : (
              <Badge variant="soft" size="sm">
                未发布
              </Badge>
            )}
            {!enabled && (
              <Badge variant="soft" size="sm">
                已停用
              </Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-foreground-muted">
            审批节点由负责机器人处理；操作节点按任务定义自动分配；验收只能由工单发起机器人操作
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/admin/ticket-config"
            className={buttonVariants({ variant: 'ghost', size: 'sm' })}
          >
            返回列表
          </Link>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate(`/tickets/wf/${detail.id}`)}
          >
            查看工单
          </Button>
          {detail.published && (
            <Button
              variant="outline"
              size="sm"
              onClick={loadPublished}
              disabled={saving}
            >
              载入已发布版本
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => persist(false)}
            disabled={saving}
          >
            {saving ? '处理中…' : '保存草稿'}
          </Button>
          <Button
            size="sm"
            onClick={() => persist(true)}
            disabled={saving || !enabled}
          >
            发布新版本
          </Button>
        </div>
      </div>

      {(message || error) && (
        <p
          className={`rounded-[var(--radius-md)] px-3 py-2 text-sm ${
            error
              ? 'bg-error-muted text-error-foreground'
              : 'bg-success-muted text-success-foreground'
          }`}
        >
          {error ?? message}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>基本信息</CardTitle>
          <CardDescription>
            配置编码由平台生成；流程发布后生成不可变版本
          </CardDescription>
        </CardHeader>
        <div className="grid gap-4 px-6 pb-6 md:grid-cols-2 xl:grid-cols-4">
          <label className="flex flex-col gap-1 text-sm">
            配置编码
            <div className="flex h-9 items-center rounded-[var(--radius-md)] border border-border-strong bg-background-muted px-3 font-mono text-xs">
              {detail.code}
            </div>
          </label>
          <label className="flex flex-col gap-1 text-sm md:col-span-2">
            配置名称
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="工单配置名称"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            启用状态
            <span className="flex h-9 items-center gap-2">
              <Switch
                size="sm"
                checked={enabled}
                onCheckedChange={setEnabled}
              />
              <span className="text-foreground-muted">
                {enabled ? '启用（允许发布）' : '停用'}
              </span>
            </span>
          </label>
          <label className="flex flex-col gap-1 text-sm md:col-span-2 xl:col-span-3">
            配置说明
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="说明该工单流程的适用范围和验收目的"
              rows={2}
            />
          </label>
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_28rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-3">
              <div>
                <CardTitle>流程节点</CardTitle>
                <CardDescription>
                  起始节点固定存在；至少保留一个验收节点，可添加审批、操作或更多验收节点
                </CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={addNode}>
                新增节点
              </Button>
            </CardHeader>
            <div className="flex flex-col gap-4 px-6 pb-6">
              {nodes.map((node, index) => {
                const acceptanceCount = nodes.filter(
                  (item) => item.kind === 'acceptance',
                ).length
                const fixed =
                  node.kind === 'start' ||
                  (node.kind === 'acceptance' && acceptanceCount <= 1)
                return (
                  <div
                    key={node.key}
                    className="rounded-[var(--radius-lg)] border border-border-strong p-4"
                  >
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" size="sm">
                          {index + 1}
                        </Badge>
                        <span className="font-medium">{node.name}</span>
                        <Badge variant="secondary" size="sm">
                          {NODE_KIND_LABEL[node.kind]}
                        </Badge>
                        <span className="font-mono text-xs text-foreground-muted">
                          {node.key}
                        </span>
                      </div>
                      {!fixed && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeNode(node.key)}
                        >
                          删除节点
                        </Button>
                      )}
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="flex flex-col gap-1 text-sm">
                        节点名称
                        <Input
                          value={node.name}
                          onChange={(event) =>
                            updateNode(index, { name: event.target.value })
                          }
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-sm">
                        节点类型
                        {fixed ? (
                          <div className="flex h-9 items-center rounded-[var(--radius-md)] border border-border-strong bg-background-muted px-3">
                            {NODE_KIND_LABEL[node.kind]}
                          </div>
                        ) : (
                          <Select
                            value={node.kind}
                            onValueChange={(value) => {
                              const kind = value as WorkflowNodeKind
                              updateNode(index, {
                                kind,
                                taskTemplateId:
                                  kind === 'operation' || kind === 'approval'
                                    ? node.taskTemplateId
                                    : null,
                                responsibleWorkerId:
                                  kind === 'approval'
                                    ? node.responsibleWorkerId
                                    : null,
                                inputFields:
                                  kind === 'start' ? node.inputFields : null,
                                autoAccept: kind === 'acceptance' ? node.autoAccept : false,
                              })
                            }}
                            items={{
                              operation: NODE_KIND_LABEL.operation,
                              approval: NODE_KIND_LABEL.approval,
                              acceptance: NODE_KIND_LABEL.acceptance,
                            }}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="operation">
                                {NODE_KIND_LABEL.operation}
                              </SelectItem>
                              <SelectItem value="approval">
                                {NODE_KIND_LABEL.approval}
                              </SelectItem>
                              <SelectItem value="acceptance">
                                {NODE_KIND_LABEL.acceptance}
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                      </label>

                      {(node.kind === 'operation' || node.kind === 'approval') && (
                        <label className="flex flex-col gap-1 text-sm">
                          任务定义
                          <Select
                            value={node.taskTemplateId ? String(node.taskTemplateId) : NO_SELECTION}
                            onValueChange={(value) =>
                              updateNode(index, { taskTemplateId: optionalId(String(value)) })
                            }
                            items={templateItems}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="选择任务定义" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NO_SELECTION}>
                                未选择任务定义
                              </SelectItem>
                              {templates.map((template) => (
                                <SelectItem
                                  key={template.id}
                                  value={String(template.id)}
                                >
                                  {template.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </label>
                      )}

                      {node.kind === 'approval' && (
                        <label className="flex flex-col gap-1 text-sm">
                          负责机器人
                          <Select
                            value={
                              node.responsibleWorkerId
                                ? String(node.responsibleWorkerId)
                                : NO_SELECTION
                            }
                            onValueChange={(value) =>
                              updateNode(index, {
                                responsibleWorkerId: optionalId(String(value)),
                              })
                            }
                            items={workerItems}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="选择负责机器人" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NO_SELECTION}>
                                未选择负责机器人
                              </SelectItem>
                              {workers.map((worker) => (
                                <SelectItem
                                  key={worker.id}
                                  value={String(worker.id)}
                                >
                                  {worker.enabled
                                    ? worker.name
                                    : `${worker.name}（已停用）`}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </label>
                      )}

                      {node.kind === 'operation' && (
                        <div className="flex items-end text-sm text-foreground-muted">
                          处理机器人由任务定义自动分配
                        </div>
                      )}
                    </div>

                    {node.kind === 'start' && (
                      <div className="mt-4 rounded-[var(--radius-md)] bg-background-muted p-3">
                        <div className="mb-3 flex items-center justify-between gap-2">
                          <p className="text-sm font-medium">起始输入字段</p>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => addInputField(index)}
                          >
                            新增字段
                          </Button>
                        </div>
                        <div className="flex flex-col gap-3">
                          {(node.inputFields ?? []).map((field, fieldIndex) => (
                            <div
                              // 用下标做 key：标识可直接编辑，不能把可编辑值当 key，
                              // 否则每次按键都会重挂载输入框导致失焦
                              key={fieldIndex}
                              className="rounded-[var(--radius-md)] border border-border-strong bg-background p-3"
                            >
                              <div className="grid gap-2 md:grid-cols-4">
                                <label className="flex flex-col gap-1 text-xs">
                                  标识
                                  <Input
                                    value={field.key}
                                    onChange={(event) =>
                                      updateInputField(index, fieldIndex, {
                                        key: event.target.value,
                                      })
                                    }
                                  />
                                </label>
                                <label className="flex flex-col gap-1 text-xs">
                                  名称
                                  <Input
                                    value={field.label}
                                    onChange={(event) =>
                                      updateInputField(index, fieldIndex, {
                                        label: event.target.value,
                                      })
                                    }
                                  />
                                </label>
                                <label className="flex flex-col gap-1 text-xs">
                                  类型
                                  <Select
                                    value={field.type}
                                    onValueChange={(value) =>
                                      updateInputField(index, fieldIndex, {
                                        type: value as TicketWorkflowInputField['type'],
                                        ...(value === 'select'
                                          ? { options: field.options ?? [] }
                                          : { options: undefined }),
                                      })
                                    }
                                    items={FIELD_TYPE_LABEL}
                                  >
                                    <SelectTrigger>
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {(
                                        Object.entries(FIELD_TYPE_LABEL) as Array<
                                          [
                                            TicketWorkflowInputField['type'],
                                            string,
                                          ]
                                        >
                                      ).map(([value, label]) => (
                                        <SelectItem key={value} value={value}>
                                          {label}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </label>
                                <label className="flex items-center gap-2 text-xs">
                                  <input
                                    type="checkbox"
                                    checked={field.required}
                                    onChange={(event) =>
                                      updateInputField(index, fieldIndex, {
                                        required: event.target.checked,
                                      })
                                    }
                                  />
                                  必填
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="ml-auto"
                                    onClick={() =>
                                      removeInputField(index, fieldIndex)
                                    }
                                  >
                                    删除
                                  </Button>
                                </label>
                                <label className="flex flex-col gap-1 text-xs md:col-span-2">
                                  占位提示
                                  <Input
                                    value={field.placeholder ?? ''}
                                    onChange={(event) =>
                                      updateInputField(index, fieldIndex, {
                                        placeholder: event.target.value,
                                      })
                                    }
                                  />
                                </label>
                                <label className="flex flex-col gap-1 text-xs md:col-span-2">
                                  {field.type === 'select' ? '选项（逗号分隔）' : '默认值'}
                                  <Input
                                    value={
                                      field.type === 'select'
                                        ? (field.options ?? []).join(',')
                                        : field.defaultValue == null
                                          ? ''
                                          : String(field.defaultValue)
                                    }
                                    onChange={(event) =>
                                      updateInputField(index, fieldIndex, {
                                        ...(field.type === 'select'
                                          ? {
                                              options: event.target.value
                                                .split(',')
                                                .map((item) => item.trim())
                                                .filter(Boolean),
                                            }
                                          : { defaultValue: event.target.value }),
                                      })
                                    }
                                  />
                                </label>
                              </div>
                            </div>
                          ))}
                          {(node.inputFields ?? []).length === 0 && (
                            <p className="text-xs text-foreground-muted">
                              暂无输入字段；工单发起表单将只使用流程说明
                            </p>
                          )}
                        </div>
                      </div>
                    )}

                    {node.kind === 'acceptance' && (
                      <div className="mt-4 flex items-center gap-2 rounded-[var(--radius-md)] bg-background-muted px-3 py-2 text-sm">
                        <Switch
                          size="sm"
                          checked={node.autoAccept}
                          onCheckedChange={(checked) =>
                            updateNode(index, { autoAccept: checked })
                          }
                        />
                        自动验收：前序节点成功到达后直接验收通过并完成工单
                      </div>
                    )}

                    <label className="mt-4 flex flex-col gap-1 text-sm">
                      节点说明
                      <Textarea
                        value={node.description ?? ''}
                        onChange={(event) =>
                          updateNode(index, { description: event.target.value })
                        }
                        placeholder="作为节点任务上下文下发"
                        rows={2}
                      />
                    </label>
                  </div>
                )
              })}
            </div>
          </Card>

          <Card>
            <CardHeader className="flex-row items-start justify-between gap-3">
              <div>
                <CardTitle>流转规则</CardTitle>
                <CardDescription>
                  起始节点只能无条件流出；审批/操作/验收按结果流转，审批通过/驳回、操作成功/失败可直接结束流程
                </CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={addEdge}>
                新增流转
              </Button>
            </CardHeader>
            <div className="flex flex-col gap-3 px-6 pb-6">
              {edges.map((edge, index) => {
                const source = nodes.find((node) => node.key === edge.from)
                const options = source ? outcomeOptions(source.kind) : []
                return (
                  <div
                    key={`${edge.from}-${edge.outcome ?? 'none'}-${index}`}
                    className="grid items-end gap-2 rounded-[var(--radius-md)] border border-border-strong p-3 md:grid-cols-[10rem_10rem_10rem_minmax(0,1fr)_auto]"
                  >
                    <label className="flex flex-col gap-1 text-xs">
                      来源
                      <Select
                        value={edge.from}
                        onValueChange={(value) => {
                          const nextSource = nodes.find(
                            (node) => node.key === value,
                          )
                          const nextOptions = nextSource
                            ? outcomeOptions(nextSource.kind)
                            : []
                          const nextOutcome =
                            nextSource?.kind === 'start'
                              ? null
                              : (nextOptions[0] ?? null)
                          updateEdge(index, {
                            from: String(value),
                            outcome: nextOutcome,
                            label: edgeLabel(nextOutcome),
                          })
                        }}
                        items={nodeItems}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {nodes.map((node) => (
                            <SelectItem key={node.key} value={node.key}>
                              {node.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </label>
                    <label className="flex flex-col gap-1 text-xs">
                      目标
                      <Select
                        value={edge.to}
                        onValueChange={(value) =>
                          updateEdge(index, { to: String(value) })
                        }
                        items={nodeItems}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {nodes.map((node) => (
                            <SelectItem key={node.key} value={node.key}>
                              {node.name}
                            </SelectItem>
                          ))}
                          <SelectItem value={WORKFLOW_END_NODE}>
                            流程结束
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </label>
                    <label className="flex flex-col gap-1 text-xs">
                      结果
                      {source?.kind === 'start' ? (
                        <div className="flex h-9 items-center rounded-[var(--radius-md)] border border-border-strong bg-background-muted px-3">
                          无条件
                        </div>
                      ) : (
                        <Select
                          value={edge.outcome ?? NO_SELECTION}
                          onValueChange={(value) => {
                            const outcome =
                              value === NO_SELECTION
                                ? null
                                : (value as WorkflowOutcome)
                            updateEdge(index, {
                              outcome,
                              label: edgeLabel(outcome),
                            })
                          }}
                          items={{
                            [NO_SELECTION]: '无条件流转',
                            ...Object.fromEntries(
                              options.map((item) => [item, OUTCOME_LABEL[item]]),
                            ),
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NO_SELECTION}>
                              无条件流转
                            </SelectItem>
                            {options.map((item) => (
                              <SelectItem key={item} value={item}>
                                {OUTCOME_LABEL[item]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </label>
                    <label className="flex flex-col gap-1 text-xs">
                      展示文案
                      <Input
                        value={edge.label ?? ''}
                        onChange={(event) =>
                          updateEdge(index, { label: event.target.value })
                        }
                      />
                    </label>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setEdges(edges.filter((_, i) => i !== index))
                      }
                    >
                      删除
                    </Button>
                  </div>
                )
              })}
              {edges.length === 0 && (
                <div className="rounded-[var(--radius-md)] border border-dashed border-border-strong px-4 py-8 text-center text-sm text-foreground-muted">
                  暂无流转规则
                </div>
              )}
            </div>
          </Card>
        </div>

        <Card className="h-fit xl:sticky xl:top-4">
          <CardHeader>
            <CardTitle>实时流程图</CardTitle>
            <CardDescription>根据当前节点与流转规则即时生成</CardDescription>
          </CardHeader>
          <div className="overflow-auto px-4 pb-4">
            <MermaidDiagram code={flowchart} />
          </div>
          <div className="border-t border-border-strong px-4 py-3 text-xs text-foreground-muted">
            <p>最近草稿保存：{formatTime(detail.draftUpdatedAt)}</p>
            <p className="mt-1">
              最近发布：{formatTime(detail.latestPublishedAt)}
            </p>
          </div>
        </Card>
      </div>
    </div>
  )
}
