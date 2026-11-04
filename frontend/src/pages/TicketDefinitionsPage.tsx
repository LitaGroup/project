import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '@appica/ui-react/badge'
import { buttonVariants } from '@appica/ui-react/button'
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

/** 管理端工单定义列表：当前只内置「测试工单」，不开放新建与删除 */
export function TicketDefinitionsPage() {
  const [rows, setRows] = useState<TicketWorkflowDefinitionSummary[] | null>(
    null,
  )
  const [error, setError] = useState<string | null>(null)

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

  return (
    <div className="flex flex-col gap-4">
      <div>
        <PageBreadcrumb items={[{ label: '管理' }, { label: '工单定义' }]} />
        <h1 className="mt-2 text-2xl font-semibold">工单定义</h1>
        <p className="mt-1 text-sm text-foreground-muted">
          配置系统内置工单的任务节点、处理机器人与流转规则；当前仅保留「测试工单」用于验证审批流程
        </p>
      </div>

      {error && (
        <p className="rounded-[var(--radius-md)] bg-error-muted px-3 py-2 text-sm text-error-foreground">
          加载失败：{error}
        </p>
      )}

      <Table hoverableRows>
        <TableHeader>
          <TableRow>
            <TableHead className="w-40">工单类型</TableHead>
            <TableHead className="w-56">流程名称</TableHead>
            <TableHead>说明</TableHead>
            <TableHead className="w-28">当前版本</TableHead>
            <TableHead className="w-36">状态</TableHead>
            <TableHead className="w-44">更新时间</TableHead>
            <TableHead className="w-28 text-center">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(rows ?? []).map((row) => {
            const state = workflowState(row)
            return (
              <TableRow key={row.id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{row.category}</span>
                    {row.builtIn && (
                      <Badge variant="secondary" size="sm">
                        系统内置
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <span className="text-sm">{row.name}</span>
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
                  <Link
                    to={`/admin/ticket-definitions/${row.id}`}
                    className={buttonVariants({ variant: 'outline', size: 'sm' })}
                  >
                    编辑定义
                  </Link>
                </TableCell>
              </TableRow>
            )
          })}
          {rows?.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={7}
                className="py-10 text-center text-sm text-foreground-muted"
              >
                暂无工单定义
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <p className="text-xs text-foreground-muted">
        工单定义由平台内置，不支持网页新建或删除。编辑后可先保存草稿，发布后生成不可变版本；已运行实例继续使用原版本。
      </p>
    </div>
  )
}
