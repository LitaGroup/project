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
import { PageBreadcrumb } from '../components/PageBreadcrumb'
import {
  api,
  WORKFLOW_END_NODE,
  type TaskTemplate,
  type TicketWorkflowDefinitionDetail,
  type Worker,
  type WorkflowEdgeDefinition,
  type WorkflowNodeDefinition,
  type WorkflowNodeKind,
  type WorkflowOutcome,
} from '../lib/api'

const LIST_PATH = '/admin/ticket-definitions'
const NO_SELECTION = '__none__'

const NODE_KIND_LABEL: Record<WorkflowNodeKind, string> = {
  operation: '操作节点',
  approval: '审批节点',
  acceptance: '验收节点',
}

const OUTCOME_LABEL: Record<WorkflowOutcome, string> = {
  succeeded: '执行成功',
  failed: '执行失败',
  approved: '审批通过',
  rejected: '审批驳回',
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
  return kind === 'approval'
    ? ['approved', 'rejected']
    : ['succeeded', 'failed']
}

function edgeLabel(outcome: WorkflowOutcome | null): string {
  return outcome ? OUTCOME_LABEL[outcome] : '无条件流转'
}

/** 工单定义编辑：结构化配置节点任务、创建/审批机器人与流转规则 */
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
  const [startNode, setStartNode] = useState('')
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
    setStartNode(value.draft.startNode)
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
          `${template.name} · ${template.type}`,
        ]),
      ),
    }),
    [templates],
  )
  const workerItems = useMemo<Record<string, string>>(
    () => ({
      [NO_SELECTION]: '未选择机器人',
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
  const sourceNodeMap = useMemo(
    () => new Map(nodes.map((node) => [node.key, node])),
    [nodes],
  )

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
      executorWorkerId: null,
      approverWorkerId: null,
      description: null,
    }
    setNodes((current) => [...current, node])
    if (!startNode) setStartNode(key)
  }

  const removeNode = (key: string) => {
    const remaining = nodes.filter((node) => node.key !== key)
    setNodes(remaining)
    setEdges((current) =>
      current.filter((edge) => edge.from !== key && edge.to !== key),
    )
    if (startNode === key) setStartNode(remaining[0]?.key ?? '')
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
    const from = nodes[0]?.key
    if (!from) return
    const source = sourceNodeMap.get(from)
    const used = new Set(
      edges
        .filter((edge) => edge.from === from && edge.outcome)
        .map((edge) => edge.outcome),
    )
    const candidates = source ? outcomeOptions(source.kind) : []
    const hasUnconditional = edges.some(
      (edge) => edge.from === from && !edge.outcome,
    )
    const outcome =
      hasUnconditional || edges.every((edge) => edge.from !== from)
        ? null
        : candidates.find((candidate) => !used.has(candidate)) ?? null
    setEdges((current) => [
      ...current,
      {
        from,
        to: WORKFLOW_END_NODE,
        outcome,
        label: edgeLabel(outcome),
      },
    ])
  }

  const payload = () => ({
    name: name.trim(),
    description: description.trim() || null,
    enabled,
    definition: {
      startNode,
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
    setStartNode(definition.startNode)
    setNodes(definition.nodes)
    setEdges(definition.edges)
    setMessage(
      `已载入 v${detail.published.version} 的流程配置，保存草稿后不会影响已发布版本`,
    )
    setError(null)
  }

  if (!detailIdValid(definitionId)) {
    return <p className="text-sm text-error-foreground">工单定义 ID 不正确</p>
  }
  if (loadError) {
    return (
      <div className="flex flex-col gap-4">
        <PageBreadcrumb
          items={[
            { label: '工单定义', to: LIST_PATH },
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

  return (
    <div className="flex flex-col gap-4 pb-12">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <PageBreadcrumb
            items={[
              { label: '工单定义', to: LIST_PATH },
              { label: detail.category },
            ]}
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold">{name || detail.category}</h1>
            <Badge variant="secondary" size="sm">
              系统内置
            </Badge>
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
            每个节点会创建独立任务；审批节点由审批机器人处理，并可与创建机器人进行节点内沟通
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(LIST_PATH)}
          >
            返回列表
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
            工单类型与编码由平台内置，不可修改；流程发布后生成不可变版本
          </CardDescription>
        </CardHeader>
        <div className="grid gap-4 px-6 pb-6 md:grid-cols-2 xl:grid-cols-4">
          <label className="flex flex-col gap-1 text-sm">
            工单类型
            <div className="flex h-9 items-center rounded-[var(--radius-md)] border border-border-strong bg-background-muted px-3">
              {detail.category}
            </div>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            定义编码
            <div className="flex h-9 items-center rounded-[var(--radius-md)] border border-border-strong bg-background-muted px-3 font-mono text-xs">
              {detail.code}
            </div>
          </label>
          <label className="flex flex-col gap-1 text-sm md:col-span-2">
            流程名称
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="流程名称"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm md:col-span-2 xl:col-span-3">
            流程说明
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="说明该工单流程的适用范围和验证目的"
              rows={2}
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
        </div>
      </Card>

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3">
          <div>
            <CardTitle>流程节点</CardTitle>
            <CardDescription>
              配置节点任务定义、创建机器人与审批机器人；节点标识用于表达流转关系
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={addNode}>
            新增节点
          </Button>
        </CardHeader>
        <div className="flex flex-col gap-4 px-6 pb-6">
          <label className="flex max-w-sm flex-col gap-1 text-sm">
            起始节点
            <Select
              value={startNode || NO_SELECTION}
              onValueChange={(value) =>
                setStartNode(
                  value === NO_SELECTION ? '' : (value as string),
                )
              }
              items={{
                [NO_SELECTION]: '未选择起始节点',
                ...Object.fromEntries(
                  nodes.map((node) => [node.key, node.name]),
                ),
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="选择起始节点" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_SELECTION}>未选择起始节点</SelectItem>
                {nodes.map((node) => (
                  <SelectItem key={node.key} value={node.key}>
                    {node.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          {nodes.length === 0 && (
            <div className="rounded-[var(--radius-md)] border border-dashed border-border-strong px-4 py-10 text-center text-sm text-foreground-muted">
              暂无节点，点击「新增节点」开始配置
            </div>
          )}

          {nodes.map((node, index) => (
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
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeNode(node.key)}
                >
                  删除节点
                </Button>
              </div>

              <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
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
                  <Select
                    value={node.kind}
                    onValueChange={(value) => {
                      const kind = value as WorkflowNodeKind
                      updateNode(index, {
                        kind,
                        approverWorkerId:
                          kind === 'approval' ? node.approverWorkerId : null,
                      })
                    }}
                    items={NODE_KIND_LABEL}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(NODE_KIND_LABEL).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  任务定义
                  <Select
                    value={
                      node.taskTemplateId
                        ? String(node.taskTemplateId)
                        : NO_SELECTION
                    }
                    onValueChange={(value) =>
                      updateNode(index, {
                        taskTemplateId: optionalId(value as string),
                      })
                    }
                    items={templateItems}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="选择任务定义" />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(templateItems).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  创建机器人
                  <Select
                    value={
                      node.executorWorkerId
                        ? String(node.executorWorkerId)
                        : NO_SELECTION
                    }
                    onValueChange={(value) =>
                      updateNode(index, {
                        executorWorkerId: optionalId(value as string),
                      })
                    }
                    items={workerItems}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="选择创建机器人" />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(workerItems).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                {node.kind === 'approval' && (
                  <label className="flex flex-col gap-1 text-sm">
                    审批机器人
                    <Select
                      value={
                        node.approverWorkerId
                          ? String(node.approverWorkerId)
                          : NO_SELECTION
                      }
                      onValueChange={(value) =>
                        updateNode(index, {
                          approverWorkerId: optionalId(value as string),
                        })
                      }
                      items={workerItems}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="选择审批机器人" />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(workerItems).map(([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                )}
                <label className="flex flex-col gap-1 text-sm lg:col-span-2 xl:col-span-3">
                  节点说明
                  <Textarea
                    value={node.description ?? ''}
                    onChange={(event) =>
                      updateNode(index, {
                        description: event.target.value || null,
                      })
                    }
                    placeholder="进入该节点后，机器人需要完成什么？"
                    rows={2}
                  />
                </label>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3">
          <div>
            <CardTitle>流转规则</CardTitle>
            <CardDescription>
              节点任务结束或产生审批结果后进入目标节点；目标选择「流程结束」表示该分支完成
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={addEdge}
            disabled={nodes.length === 0}
          >
            新增流转
          </Button>
        </CardHeader>
        <div className="flex flex-col gap-3 px-6 pb-6">
          {edges.length === 0 && (
            <div className="rounded-[var(--radius-md)] border border-dashed border-border-strong px-4 py-8 text-center text-sm text-foreground-muted">
              暂无流转规则，请至少配置一条到达流程结束的流转
            </div>
          )}
          {edges.map((edge, index) => {
            const source = sourceNodeMap.get(edge.from)
            const outcomes = source ? outcomeOptions(source.kind) : []
            return (
              <div
                key={`${edge.from}:${index}`}
                className="grid items-end gap-3 rounded-[var(--radius-lg)] border border-border-strong p-3 lg:grid-cols-[minmax(0,1fr)_170px_minmax(0,1fr)_minmax(0,1fr)_auto]"
              >
                <label className="flex flex-col gap-1 text-xs text-foreground-muted">
                  来源节点
                  <Select
                    value={edge.from || NO_SELECTION}
                    onValueChange={(value) =>
                      updateEdge(index, {
                        from: value === NO_SELECTION ? '' : (value as string),
                      })
                    }
                    items={{
                      [NO_SELECTION]: '未选择',
                      ...Object.fromEntries(
                        nodes.map((node) => [node.key, node.name]),
                      ),
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="来源节点" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_SELECTION}>未选择</SelectItem>
                      {nodes.map((node) => (
                        <SelectItem key={node.key} value={node.key}>
                          {node.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-foreground-muted">
                  触发结果
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
                      [NO_SELECTION]: '无条件',
                      ...Object.fromEntries(
                        outcomes.map((outcome) => [
                          outcome,
                          OUTCOME_LABEL[outcome],
                        ]),
                      ),
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="触发结果" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_SELECTION}>无条件</SelectItem>
                      {outcomes.map((outcome) => (
                        <SelectItem key={outcome} value={outcome}>
                          {OUTCOME_LABEL[outcome]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-foreground-muted">
                  目标节点
                  <Select
                    value={edge.to || NO_SELECTION}
                    onValueChange={(value) =>
                      updateEdge(index, {
                        to: value === NO_SELECTION ? '' : (value as string),
                      })
                    }
                    items={nodeItems}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="目标节点" />
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
                <label className="flex flex-col gap-1 text-xs text-foreground-muted">
                  展示文案
                  <Input
                    value={edge.label ?? ''}
                    onChange={(event) =>
                      updateEdge(index, {
                        label: event.target.value || null,
                      })
                    }
                    placeholder={edgeLabel(edge.outcome)}
                  />
                </label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setEdges((current) =>
                      current.filter((_, edgeIndex) => edgeIndex !== index),
                    )
                  }
                >
                  删除
                </Button>
              </div>
            )
          })}
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>版本信息</CardTitle>
          <CardDescription>
            发布后的版本不可修改；新工单实例固定使用创建时的发布版本
          </CardDescription>
        </CardHeader>
        <div className="grid gap-3 px-6 pb-6 text-sm md:grid-cols-3">
          <div>
            <p className="text-foreground-muted">最近发布</p>
            <p className="mt-1">
              {detail.latestPublishedVersion
                ? `v${detail.latestPublishedVersion}`
                : '尚未发布'}
            </p>
          </div>
          <div>
            <p className="text-foreground-muted">发布时间</p>
            <p className="mt-1">{formatTime(detail.latestPublishedAt)}</p>
          </div>
          <div>
            <p className="text-foreground-muted">草稿状态</p>
            <p className="mt-1">
              {detail.draftUpdatedAt
                ? `有未发布修改 · ${formatTime(detail.draftUpdatedAt)}`
                : '无未发布修改'}
            </p>
          </div>
        </div>
        {detail.published?.publishedByName && (
          <p className="px-6 pb-6 text-xs text-foreground-muted">
            v{detail.published.version} 由 {detail.published.publishedByName}{' '}
            发布于 {formatTime(detail.published.publishedAt)}
          </p>
        )}
      </Card>

      <div className="flex items-center justify-end gap-2">
        <Link
          to={LIST_PATH}
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          取消
        </Link>
        <Button
          variant="outline"
          size="sm"
          onClick={() => persist(false)}
          disabled={saving}
        >
          保存草稿
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
  )
}

function detailIdValid(value: string | undefined): boolean {
  return Boolean(value && Number.isInteger(Number(value)) && Number(value) > 0)
}
