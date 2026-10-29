import { useCallback, useEffect, useMemo, useState } from 'react'
import { Badge } from '@appica/ui-react/badge'
import { Button } from '@appica/ui-react/button'
import { Checkbox } from '@appica/ui-react/checkbox'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@appica/ui-react/dialog'
import { Input } from '@appica/ui-react/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@appica/ui-react/table'
import {
  api,
  type TaskTemplate,
  type TicketConfig,
} from '../lib/api'
import { PageBreadcrumb } from '../components/PageBreadcrumb'

/** 系统任务定义：未知任务 + 六类工单调度，不能作为后续转派定义 */
const SYSTEM_TASK_TEMPLATE_IDS = new Set([6, 10, 11, 12, 13, 14, 15])

/** 管理端工单配置：默认调度定义固定，只维护调度机器人可转交的后续任务定义 */
export function TicketConfigPage() {
  const [configs, setConfigs] = useState<TicketConfig[] | null>(null)
  const [templates, setTemplates] = useState<TaskTemplate[]>([])
  const [editing, setEditing] = useState<TicketConfig | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(() => {
    Promise.all([api.listTicketConfigs(), api.listTaskTemplates()])
      .then(([rows, taskTemplates]) => {
        setConfigs(rows)
        setTemplates(taskTemplates)
        setError(null)
      })
      .catch((e: Error) => setError(e.message))
  }, [])

  useEffect(reload, [reload])

  return (
    <div className="flex flex-col gap-4">
      <div>
        <PageBreadcrumb items={[{ label: '管理' }, { label: '工单配置' }]} />
        <h1 className="mt-2 text-2xl font-semibold">工单配置</h1>
        <p className="mt-1 text-sm text-foreground-muted">
          每类工单固定绑定一个系统调度任务定义；调度机器人澄清后只能转交此处配置的后续任务定义
        </p>
      </div>

      {error && <p className="text-sm text-error-foreground">加载失败：{error}</p>}

      <Table hoverableRows>
        <TableHeader>
          <TableRow>
            <TableHead className="w-36">工单类型</TableHead>
            <TableHead className="w-24">开放状态</TableHead>
            <TableHead className="w-64">默认调度任务定义</TableHead>
            <TableHead>可转交的任务定义</TableHead>
            <TableHead className="w-32 text-center">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(configs ?? []).map((config) => (
            <TableRow key={config.category}>
              <TableCell className="font-medium">{config.category}</TableCell>
              <TableCell>
                <Badge variant={config.enabled ? 'success' : 'soft'}>
                  {config.enabled ? '已开放' : '未开放'}
                </Badge>
              </TableCell>
              <TableCell>
                <span className="text-sm">
                  {config.defaultTemplateName}
                  <span className="ml-1 text-xs text-foreground-muted">
                    #{config.defaultTemplateId}
                  </span>
                </span>
              </TableCell>
              <TableCell>
                {config.allowedTemplates.length === 0 ? (
                  <span className="text-xs text-foreground-muted">
                    未配置，调度机器人只能提问，无法转交
                  </span>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {config.allowedTemplates.map((template) => (
                      <Badge
                        key={template.id}
                        variant="secondary"
                        size="sm"
                        title={template.type}
                      >
                        {template.name}
                      </Badge>
                    ))}
                  </div>
                )}
              </TableCell>
              <TableCell className="text-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditing(config)}
                >
                  配置
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <p className="text-xs text-foreground-muted">
        默认调度任务定义的描述与处理机器人在「任务 → 任务定义」中维护；系统定义 ID 6、10-15 不可删除或改名。
      </p>

      {editing && (
        <EditConfigDialog
          config={editing}
          templates={templates}
          open={Boolean(editing)}
          onOpenChange={(open) => {
            if (!open) setEditing(null)
          }}
          onSaved={() => {
            setEditing(null)
            reload()
          }}
          onError={(message) => setError(message)}
        />
      )}
    </div>
  )
}

function EditConfigDialog({
  config,
  templates,
  open,
  onOpenChange,
  onSaved,
  onError,
}: {
  config: TicketConfig
  templates: TaskTemplate[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
  onError: (message: string) => void
}) {
  const candidates = useMemo(
    () =>
      templates
        .filter(
          (template) =>
            !SYSTEM_TASK_TEMPLATE_IDS.has(template.id),
        )
        .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')),
    [templates],
  )
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(config.allowedTemplateIds),
  )
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  const filtered = candidates.filter((template) => {
    const q = query.trim().toLowerCase()
    return (
      !q ||
      template.name.toLowerCase().includes(q) ||
      template.type.toLowerCase().includes(q)
    )
  })

  const toggle = (id: number, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const save = () => {
    setSaving(true)
    setLocalError(null)
    api
      .updateTicketConfig(config.category, [...selected])
      .then(onSaved)
      .catch((e: Error) => {
        setLocalError(e.message)
        onError(e.message)
      })
      .finally(() => setSaving(false))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>配置「{config.category}」后续任务定义</DialogTitle>
          <DialogDescription>
            调度机器人澄清需求后，只能从以下任务定义中选择一个转交；默认调度定义不参与选择
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-3">
            {localError && (
              <p className="text-sm text-error-foreground">{localError}</p>
            )}
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索任务定义名称或类型…"
            />
            <div className="max-h-96 min-h-32 overflow-auto rounded-[var(--radius-md)] border border-border-strong">
              {filtered.length === 0 ? (
                <p className="px-3 py-8 text-center text-sm text-foreground-muted">
                  没有可选的任务定义（系统定义 ID 6、10-15 不参与转派）
                </p>
              ) : (
                filtered.map((template) => (
                  <label
                    key={template.id}
                    className="flex cursor-pointer items-start gap-3 border-b border-border-strong px-3 py-3 last:border-b-0 hover:bg-background-muted"
                  >
                    <Checkbox
                      checked={selected.has(template.id)}
                      onCheckedChange={(checked) =>
                        toggle(template.id, checked === true)
                      }
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">
                          {template.name}
                        </span>
                        <Badge variant="soft" size="sm">
                          {template.type}
                        </Badge>
                        <span className="text-xs text-foreground-muted">
                          #{template.id}
                        </span>
                      </span>
                      {template.description && (
                        <span className="mt-1 line-clamp-2 block text-xs text-foreground-muted">
                          {template.description}
                        </span>
                      )}
                    </span>
                  </label>
                ))
              )}
            </div>
            <p className="text-xs text-foreground-muted">
              已选择 {selected.size} 个任务定义；保存前请确认对应定义已配置启用的处理机器人
            </p>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
