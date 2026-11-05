import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, ListTree } from '@appica/icons-react'
import { Badge } from '@appica/ui-react/badge'
import type { TaskPipelineStage } from '../../lib/api'
import { TaskStatusBadge } from '../StatusBadge'

interface TaskTreeNode {
  stage: TaskPipelineStage
  children: TaskTreeNode[]
}

function sortNodes(nodes: TaskTreeNode[]) {
  nodes.sort(
    (a, b) =>
      a.stage.task.sortOrder - b.stage.task.sortOrder ||
      a.stage.task.id - b.stage.task.id,
  )
}

/** 按 parentId 组装完整任务树；父节点缺失或自引用时作为根节点展示。 */
function buildTaskTree(pipeline: TaskPipelineStage[]) {
  const nodes = new Map<number, TaskTreeNode>()
  for (const stage of pipeline) {
    nodes.set(stage.task.id, { stage, children: [] })
  }

  const roots: TaskTreeNode[] = []
  for (const node of nodes.values()) {
    const { parentId } = node.stage.task
    const parent = parentId === null ? null : nodes.get(parentId)
    if (!parent || parent === node) {
      roots.push(node)
    } else {
      parent.children.push(node)
    }
  }

  sortNodes(roots)
  for (const node of nodes.values()) sortNodes(node.children)

  // 异常循环数据可能没有任何根节点：从未挂载的节点补充入口，渲染层仍有 visited 保护。
  if (roots.length === 0 && nodes.size > 0) {
    const first = Array.from(nodes.values()).sort(
      (a, b) =>
        a.stage.task.sortOrder - b.stage.task.sortOrder ||
        a.stage.task.id - b.stage.task.id,
    )[0]
    roots.push(first)
  }

  return roots
}

/**
 * 任务详情「任务」Tab：展示同一根任务下的完整父子任务树。
 * 数据直接复用任务对话快照的 pipeline，不额外请求接口。
 */
export function TaskTreePanel({
  pipeline,
  currentTaskId,
  onOpenTask,
}: {
  pipeline: TaskPipelineStage[]
  currentTaskId: number
  onOpenTask: (taskId: number) => void
}) {
  const roots = useMemo(() => buildTaskTree(pipeline), [pipeline])
  const [collapsed, setCollapsed] = useState<Set<number>>(() => new Set())

  const toggle = (taskId: number) => {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(taskId)) next.delete(taskId)
      else next.add(taskId)
      return next
    })
  }

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-none border border-border bg-background">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <ListTree className="size-4 text-foreground-subtle" />
          <h2 className="text-sm font-semibold text-foreground-intense">
            任务关系
          </h2>
          <Badge variant="soft" size="sm">
            {pipeline.length} 个任务
          </Badge>
        </div>
        <span className="text-xs text-foreground-muted">
          点击任务可进入对应详情
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {roots.length === 0 ? (
          <p className="px-1 py-2 text-sm text-foreground-muted">
            暂无关联任务
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {roots.map((root) => (
              <TaskTreeRow
                key={root.stage.task.id}
                node={root}
                currentTaskId={currentTaskId}
                collapsed={collapsed}
                visited={new Set()}
                onToggle={toggle}
                onOpenTask={onOpenTask}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

function TaskTreeRow({
  node,
  currentTaskId,
  collapsed,
  visited,
  onToggle,
  onOpenTask,
}: {
  node: TaskTreeNode
  currentTaskId: number
  collapsed: Set<number>
  visited: Set<number>
  onToggle: (taskId: number) => void
  onOpenTask: (taskId: number) => void
}) {
  const task = node.stage.task
  if (visited.has(task.id)) return null
  const nextVisited = new Set(visited).add(task.id)
  const isCollapsed = collapsed.has(task.id)
  const isCurrent = task.id === currentTaskId
  const hasChildren = node.children.length > 0
  const agentName = node.stage.agent?.name

  return (
    <li>
      <div
        className={`group flex items-stretch rounded-[var(--radius-md)] border transition-colors ${
          isCurrent
            ? 'border-primary-strong bg-primary-soft'
            : 'border-transparent hover:border-border hover:bg-background-muted'
        }`}
      >
        <div className="flex shrink-0 items-center pl-1">
          {hasChildren ? (
            <button
              type="button"
              onClick={() => onToggle(task.id)}
              aria-label={isCollapsed ? '展开子任务' : '收起子任务'}
              aria-expanded={!isCollapsed}
              className="flex size-7 items-center justify-center rounded-[var(--radius-sm)] text-foreground-muted transition-colors hover:bg-background hover:text-foreground-intense"
            >
              {isCollapsed ? (
                <ChevronRight className="size-4" />
              ) : (
                <ChevronDown className="size-4" />
              )}
            </button>
          ) : (
            <span className="size-7" />
          )}
        </div>

        <button
          type="button"
          onClick={() => onOpenTask(task.id)}
          aria-current={isCurrent ? 'page' : undefined}
          className="flex min-w-0 flex-1 flex-col gap-1 py-2 pr-3 text-left"
        >
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-mono text-[11px] text-foreground-subtle">
              {task.code}
            </span>
            <span className="min-w-0 break-words text-sm font-medium text-foreground-intense">
              {task.title}
            </span>
            {isCurrent && (
              <Badge variant="primary" size="sm">
                当前任务
              </Badge>
            )}
            {task.parentId === null && (
              <Badge variant="secondary" size="sm">
                根任务
              </Badge>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-foreground-muted">
            <TaskStatusBadge
              status={task.status}
              subStatus={task.subStatus}
              showMain
            />
            <span>类型 · {task.type}</span>
            <span>处理机器人 · {agentName ?? '未分配'}</span>
            {hasChildren && (
              <span>
                {isCollapsed
                  ? `已收起 ${node.children.length} 个子任务`
                  : `${node.children.length} 个子任务`}
              </span>
            )}
          </div>
        </button>
      </div>

      {hasChildren && !isCollapsed && (
        <ul className="relative ml-3 flex flex-col gap-1 border-l border-border pl-1">
          {node.children.map((child) => (
            <TaskTreeRow
              key={child.stage.task.id}
              node={child}
              currentTaskId={currentTaskId}
              collapsed={collapsed}
              visited={nextVisited}
              onToggle={onToggle}
              onOpenTask={onOpenTask}
            />
          ))}
        </ul>
      )}
    </li>
  )
}
