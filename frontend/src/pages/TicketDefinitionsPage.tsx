import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Badge } from '@appica/ui-react/badge'
import { Button, buttonVariants } from '@appica/ui-react/button'
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
import { Textarea } from '@appica/ui-react/textarea'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@appica/ui-react/table'
import { PageBreadcrumb } from '../components/PageBreadcrumb'
import { api, type TicketWorkflowDefinitionSummary } from '../lib/api'

function formatTime(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('zh-CN', {
    hour12: false,
    timeZone: 'Asia/Shanghai',
  })
}

function workflowState(row: TicketWorkflowDefinitionSummary): {
  label: string
  variant: 'success' | 'warning' | 'soft'
} {
  if (!row.enabled) return { label: '已停用', variant: 'soft' }
  if (!row.latestPublishedVersion) return { label: '未发布', variant: 'soft' }
  if (
    row.draftUpdatedAt &&
    (!row.latestPublishedAt ||
      new Date(row.draftUpdatedAt) > new Date(row.latestPublishedAt))
  ) {
    return { label: '有未发布修改', variant: 'warning' }
  }
  return { label: '已发布', variant: 'success' }
}

/** 管理端工单配置：工单工作流清单、新建与编辑发布 */
export function TicketDefinitionsPage() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<TicketWorkflowDefinitionSummary[] | null>(
    null,
  )
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)

  const reload = useCallback(() => {
    api
      .listTicketWorkflowDefinitions()
      .then((list) => {
        setRows(list)
        setError(null)
      })
      .catch((e: Error) => setError(e.message))
  }, [])

  useEffect(reload, [reload])

  const create = () => {
    setSaving(true)
    setLocalError(null)
    api
      .createTicketWorkflowDefinition({
        name: name.trim(),
        description: description.trim() || null,
      })
      .then((detail) => {
        setCreating(false)
        setName('')
        setDescription('')
        navigate(`/admin/ticket-config/${detail.id}`)
      })
      .catch((e: Error) => setLocalError(e.message))
      .finally(() => setSaving(false))
  }

  const remove = async (row: TicketWorkflowDefinitionSummary) => {
    if (!window.confirm(`确定删除工单配置「${row.name}」？`)) return
    setError(null)
    try {
      await api.deleteTicketWorkflowDefinition(row.id)
      reload()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <PageBreadcrumb items={[{ label: '管理' }, { label: '工单配置' }]} />
          <h1 className="mt-2 text-2xl font-semibold">工单配置</h1>
          <p className="mt-1 text-sm text-foreground-muted">
            配置工单工作流的起始字段、审批/操作节点与验收方式；发布后才能发起工单
          </p>
        </div>
        <Button size="sm" onClick={() => setCreating(true)}>
          新建工单配置
        </Button>
      </div>

      {error && (
        <p className="rounded-[var(--radius-md)] bg-error-muted px-3 py-2 text-sm text-error-foreground">
          {error}
        </p>
      )}

      <Table hoverableRows>
        <TableHeader>
          <TableRow>
            <TableHead className="w-64">配置名称</TableHead>
            <TableHead>说明</TableHead>
            <TableHead className="w-28">当前版本</TableHead>
            <TableHead className="w-36">状态</TableHead>
            <TableHead className="w-44">更新时间</TableHead>
            <TableHead className="w-36 text-center">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(rows ?? []).map((row) => {
            const state = workflowState(row)
            return (
              <TableRow key={row.id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{row.name}</span>
                    {row.builtIn && (
                      <Badge variant="secondary" size="sm">
                        系统内置
                      </Badge>
                    )}
                  </div>
                  <span className="mt-0.5 block font-mono text-xs text-foreground-muted">
                    {row.code}
                  </span>
                </TableCell>
                <TableCell>
                  <span className="line-clamp-2 text-sm text-foreground-muted">
                    {row.description || '—'}
                  </span>
                </TableCell>
                <TableCell>
                  {row.latestPublishedVersion ? (
                    <Badge variant="outline" size="sm">
                      v{row.latestPublishedVersion}
                    </Badge>
                  ) : (
                    <span className="text-sm text-foreground-muted">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant={state.variant} size="sm">
                    {state.label}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm text-foreground-muted">
                  {formatTime(row.updatedAt)}
                </TableCell>
                <TableCell className="text-center">
                  <div className="flex justify-center gap-2">
                    <Link
                      to={`/admin/ticket-config/${row.id}`}
                      className={buttonVariants({ variant: 'outline', size: 'sm' })}
                    >
                      编辑
                    </Link>
                    {!row.builtIn && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void remove(row)}
                      >
                        删除
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            )
          })}
          {rows?.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={6}
                className="py-10 text-center text-sm text-foreground-muted"
              >
                暂无工单配置，点右上角「新建工单配置」创建
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <p className="text-xs text-foreground-muted">
        只有「已启用且已发布」的工单配置会出现在顶部「工单」左侧导航；新建工单固定使用最新发布版本。
      </p>

      <Dialog
        open={creating}
        onOpenChange={(open) => {
          if (!open) setCreating(false)
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>新建工单配置</DialogTitle>
            <DialogDescription>
              先创建配置骨架，再编辑起始字段、节点任务与流转规则并发布
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <div className="flex flex-col gap-3">
              {localError && (
                <p className="text-sm text-error-foreground">{localError}</p>
              )}
              <label className="flex flex-col gap-1.5 text-sm">
                配置名称
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="如：数据导出工单"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                配置说明
                <Textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="说明工单适用范围与验收标准"
                  rows={4}
                />
              </label>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setCreating(false)}>
              取消
            </Button>
            <Button size="sm" onClick={create} disabled={saving || !name.trim()}>
              {saving ? '创建中…' : '创建'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
