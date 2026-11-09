import { useCallback, useEffect, useState } from 'react'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@appica/ui-react/table'
import { Input } from '@appica/ui-react/input'
import { Toolbar, ToolbarInput } from '@appica/ui-react/toolbar'
import { Badge } from '@appica/ui-react/badge'
import { Button } from '@appica/ui-react/button'
import { api, type McpCallLogItem, type McpLogPage } from '../lib/api'

const PAGE_SIZE = 50

/** 调用状态 → Badge（complete 绿 / question 黄 / error·conflict 红 / interrupted 淡） */
function statusVariant(status: string): 'success' | 'warning' | 'error' | 'secondary' {
  switch (status) {
    case 'complete':
      return 'success'
    case 'question':
      return 'warning'
    case 'error':
    case 'conflict':
      return 'error'
    default:
      return 'secondary'
  }
}

const STATUS_LABELS: Record<string, string> = {
  complete: '完成',
  question: '提问',
  error: '失败',
  interrupted: '中断',
  conflict: '冲突',
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  return `${Math.floor(seconds / 60)}m${Math.round(seconds % 60)}s`
}

/**
 * 管理区「MCP 调用」：外部 AI Agent 经 MCP 调用平台机器人的审计列表。
 * 展示 时间/调用方/机器人/工具/状态/耗时/消息长度，支持 用户·机器人·会话 模糊搜索与分页。
 */
export function McpLogsPage() {
  const [data, setData] = useState<McpLogPage | null>(null)
  const [keyword, setKeyword] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    (targetPage: number, q: string) => {
      setError(null)
      api
        .listMcpLogs({ q: q || undefined, page: targetPage, pageSize: PAGE_SIZE })
        .then(setData)
        .catch((e: Error) => setError(e.message))
    },
    [],
  )

  useEffect(() => {
    load(page, query)
  }, [load, page, query])

  const totalPages =
    data === null ? 1 : Math.max(1, Math.ceil(data.total / data.pageSize))

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">MCP 调用</h1>
        {data && (
          <p className="text-sm text-foreground-muted">共 {data.total} 条</p>
        )}
      </div>
      <Toolbar aria-label="MCP 调用搜索" className="mb-4">
        <ToolbarInput
          className="w-72"
          render={
            <Input
              placeholder="搜索调用方、机器人、会话…（回车搜索）"
              clearable
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onClear={() => {
                setKeyword('')
                setPage(1)
                setQuery('')
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setPage(1)
                  setQuery(keyword.trim())
                }
              }}
              aria-label="搜索调用方、机器人或会话"
            />
          }
        />
      </Toolbar>
      {error && <p className="mb-4 text-sm">加载失败:{error}</p>}
      <Table hoverableRows>
        <TableHeader>
          <TableRow>
            <TableHead className="w-44">时间</TableHead>
            <TableHead className="w-28">调用方</TableHead>
            <TableHead className="w-40">机器人</TableHead>
            <TableHead className="w-28">工具</TableHead>
            <TableHead className="w-20 text-center">状态</TableHead>
            <TableHead className="w-20 text-right">耗时</TableHead>
            <TableHead className="w-24 text-right">消息/回复</TableHead>
            <TableHead className="w-36">会话</TableHead>
            <TableHead>错误</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(data?.items ?? []).map((log: McpCallLogItem) => (
            <TableRow key={log.id}>
              <TableCell className="whitespace-nowrap text-foreground-muted">
                {new Date(log.createdAt).toLocaleString()}
              </TableCell>
              <TableCell className="font-medium text-foreground-intense">
                {log.userName}
              </TableCell>
              <TableCell>
                {log.workerName}
                <span className="ml-1 text-foreground-muted">#{log.workerId}</span>
              </TableCell>
              <TableCell className="text-foreground-muted">{log.tool}</TableCell>
              <TableCell className="text-center">
                <Badge variant={statusVariant(log.status)}>
                  {STATUS_LABELS[log.status] ?? log.status}
                </Badge>
              </TableCell>
              <TableCell className="text-right text-foreground-muted">
                {formatDuration(log.durationMs)}
              </TableCell>
              <TableCell className="text-right text-foreground-muted">
                {log.messageLength}
                {log.contentLength !== null ? ` / ${log.contentLength}` : ' / —'}
              </TableCell>
              <TableCell className="font-mono text-xs text-foreground-muted">
                {log.sessionId}
              </TableCell>
              <TableCell className="max-w-96 truncate text-foreground-muted" title={log.error ?? undefined}>
                {log.error ?? '—'}
              </TableCell>
            </TableRow>
          ))}
          {data !== null && data.items.length === 0 && (
            <TableRow>
              <TableCell colSpan={9}>
                {data.total === 0 ? '暂无调用记录' : '无匹配的调用记录'}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      {data && totalPages > 1 && (
        <div className="mt-4 flex items-center justify-end gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            上一页
          </Button>
          <span className="text-sm text-foreground-muted">
            {page} / {totalPages}
          </span>
          <Button
            variant="secondary"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            下一页
          </Button>
        </div>
      )}
    </div>
  )
}
