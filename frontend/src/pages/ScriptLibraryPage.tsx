import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@appica/ui-react/table'
import { Badge } from '@appica/ui-react/badge'
import { Button } from '@appica/ui-react/button'
import { Input } from '@appica/ui-react/input'
import { Toolbar, ToolbarButton, ToolbarGroup, ToolbarInput } from '@appica/ui-react/toolbar'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@appica/ui-react/select'
import {
  api,
  SCRIPT_LIBRARY_KIND_ITEMS,
  type Project,
  type ScriptDescriptionStatus,
  type ScriptLibraryKind,
  type ScriptLibraryListResponse,
  type ScriptLibraryRun,
  type ScriptLibrarySyncStatus,
} from '../lib/api'

const PAGE_SIZE = 50

/** 描述生成状态展示 */
const descriptionStatusMeta: Record<
  ScriptDescriptionStatus,
  { text: string; variant: 'info' | 'success' | 'error' | 'warning' }
> = {
  pending: { text: '待生成', variant: 'warning' },
  running: { text: '生成中', variant: 'info' },
  done: { text: '已生成', variant: 'success' },
  error: { text: '生成失败', variant: 'error' },
}

/** 最近运行状态展示 */
const runStatusMeta: Record<
  ScriptLibraryRun['status'],
  { text: string; variant: 'info' | 'success' | 'error' | 'warning' }
> = {
  running: { text: '运行中', variant: 'info' },
  success: { text: '通过', variant: 'success' },
  fail: { text: '未通过', variant: 'error' },
  error: { text: '异常', variant: 'warning' },
}

function LatestRunBadge({ run }: { run: ScriptLibraryRun }) {
  const meta = runStatusMeta[run.status]
  return (
    <span className="flex items-center gap-2">
      <Badge variant={meta.variant}>{meta.text}</Badge>
      <span className="text-xs text-foreground-muted">
        {new Date(run.startedAt).toLocaleString()}
      </span>
    </span>
  )
}

/** 同步状态行文案：仓库@分支 · 提交短 SHA · 上次同步时间与来源（失败附错误） */
function SyncStatusLine({ status }: { status: ScriptLibrarySyncStatus }) {
  const short = status.currentRevision?.slice(0, 7) ?? '—'
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-foreground-muted">
      <span>
        {status.repo}@{status.branch}
      </span>
      <span title={status.currentRevision ?? ''}>提交 {short}</span>
      {status.lastSyncAt && (
        <span>
          上次同步 {new Date(status.lastSyncAt).toLocaleString()}
          {status.lastSource ? `（${status.lastSource}）` : ''}
          {status.lastDurationMs !== null &&
            ` · ${(status.lastDurationMs / 1000).toFixed(1)}s`}
        </span>
      )}
      {status.syncing && <Badge variant="info">同步中…</Badge>}
      {status.lastSyncOk === false && status.lastError && (
        <span className="text-foreground-intense" title={status.lastError}>
          同步失败：{status.lastError}
        </span>
      )}
      {status.descriptions && (
        <span title="脚本描述生成队列（脚本描述机器人）">
          描述：已生成 {status.descriptions.done}
          {status.descriptions.pending > 0 && ` · 待生成 ${status.descriptions.pending}`}
          {status.descriptions.running > 0 && ` · 生成中 ${status.descriptions.running}`}
          {status.descriptions.error > 0 && ` · 失败 ${status.descriptions.error}`}
        </span>
      )}
      {!status.githubConfigured && <span>未配置 GITHUB_TOKEN，跳过远端比对直接拉取</span>}
    </p>
  )
}

/**
 * 脚本库：scripts 仓库 main 分支 projects/ 目录下的全部脚本
 * （.check.ts 检查 / .test.ts 测试 / .export.ts 导出），支持搜索、类型筛选与直接运行。
 */
export function ScriptLibraryPage() {
  const [data, setData] = useState<ScriptLibraryListResponse | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [status, setStatus] = useState<ScriptLibrarySyncStatus | null>(null)
  const [keyword, setKeyword] = useState('')
  const [kindFilter, setKindFilter] = useState<'all' | ScriptLibraryKind>('all')
  const [page, setPage] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)

  const load = useCallback(
    (q: string, kind: 'all' | ScriptLibraryKind, current: number) =>
      api
        .listLibraryScripts({
          q: q.trim() || undefined,
          kind: kind === 'all' ? undefined : kind,
          page: current,
          pageSize: PAGE_SIZE,
        })
        .then(setData)
        .catch((e: Error) => setError(e.message)),
    [],
  )

  // 搜索防抖 + 类型/页码变化重新加载
  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1)
      void load(keyword, kindFilter, 1)
    }, 300)
    return () => clearTimeout(timer)
  }, [keyword, kindFilter, load])

  useEffect(() => {
    api.listProjects().then(setProjects).catch(() => undefined)
  }, [])

  // 同步状态：挂载拉一次 + 30s 轮询（同步中可看到进展）
  useEffect(() => {
    const refresh = () =>
      api.getLibraryStatus().then(setStatus).catch(() => undefined)
    refresh()
    const timer = setInterval(refresh, 30_000)
    return () => clearInterval(timer)
  }, [])

  // 页码变化（非第一页触发）重新加载
  const pageRef = useRef(1)
  useEffect(() => {
    if (page === pageRef.current) return
    pageRef.current = page
    void load(keyword, kindFilter, page)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page])

  const manualSync = () => {
    setSyncing(true)
    api
      .syncLibrary()
      .then(setStatus)
      .catch((e: Error) => setError(e.message))
      .finally(() => setSyncing(false))
  }

  const projectName = new Map(projects.map((p) => [p.id, p.name]))
  const items = data?.items ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const kindItems: Record<string, string> = {
    all: '全部类型',
    ...SCRIPT_LIBRARY_KIND_ITEMS,
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">脚本库</h1>
        <Button
          variant="outline"
          size="sm"
          onClick={manualSync}
          disabled={syncing || (status?.syncing ?? false)}
        >
          {syncing ? '同步中…' : '立即同步'}
        </Button>
      </div>
      {status && (
        <div className="mb-4">
          <SyncStatusLine status={status} />
        </div>
      )}
      <Toolbar aria-label="脚本库筛选" className="mb-4">
        <ToolbarInput
          className="w-72"
          render={
            <Input
              placeholder="搜索脚本路径…"
              clearable
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onClear={() => setKeyword('')}
              aria-label="搜索脚本路径"
            />
          }
        />
        <ToolbarGroup aria-label="类型筛选">
          <Select
            value={kindFilter}
            onValueChange={(v) => setKindFilter(v as 'all' | ScriptLibraryKind)}
            items={kindItems}
          >
            <ToolbarButton
              className="w-32"
              render={
                <SelectTrigger aria-label="按类型筛选">
                  <SelectValue placeholder="类型" />
                </SelectTrigger>
              }
            />
            <SelectContent>
              {Object.keys(kindItems).map((k) => (
                <SelectItem key={k} value={k}>
                  {kindItems[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </ToolbarGroup>
      </Toolbar>

      {error && <p className="mb-4 text-sm">加载失败:{error}</p>}

      <Table hoverableRows>
        <TableHeader>
          <TableRow>
            <TableHead>脚本</TableHead>
            <TableHead className="w-20">类型</TableHead>
            <TableHead>描述</TableHead>
            <TableHead className="w-40">所属目录</TableHead>
            <TableHead className="w-36">项目</TableHead>
            <TableHead className="w-52">最近运行</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((s) => (
            <TableRow key={s.path}>
              <TableCell className="max-w-sm truncate">
                <Link
                  to={`/docs/scripts/detail?path=${encodeURIComponent(s.path)}`}
                  className="text-foreground-intense underline"
                  title={s.path}
                >
                  {s.path}
                </Link>
              </TableCell>
              <TableCell>
                <Badge variant="secondary">
                  {SCRIPT_LIBRARY_KIND_ITEMS[s.kind]}
                </Badge>
              </TableCell>
              <TableCell className="max-w-md">
                {s.description ? (
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate" title={s.description}>
                      {s.description}
                    </span>
                    {s.descriptionStatus && s.descriptionStatus !== 'done' && (
                      <Badge variant={descriptionStatusMeta[s.descriptionStatus].variant}>
                        {descriptionStatusMeta[s.descriptionStatus].text}
                      </Badge>
                    )}
                  </span>
                ) : s.descriptionStatus ? (
                  <Badge variant={descriptionStatusMeta[s.descriptionStatus].variant}>
                    {descriptionStatusMeta[s.descriptionStatus].text}
                  </Badge>
                ) : (
                  '—'
                )}
              </TableCell>
              <TableCell className="max-w-40 truncate" title={s.path}>
                {s.path.split('/').slice(0, -1).join('/')}
              </TableCell>
              <TableCell className="max-w-36 truncate">
                {s.projectIds.length === 0
                  ? '—'
                  : s.projectIds.slice(0, 2).map((pid, i) => (
                      <span key={pid}>
                        {i > 0 && '、'}
                        <Link
                          to={`/projects/${pid}`}
                          className="text-foreground-intense underline"
                        >
                          {projectName.get(pid) ?? `#${pid}`}
                        </Link>
                      </span>
                    ))}
                {s.projectIds.length > 2 && (
                  <span className="text-foreground-muted">
                    {' '}
                    +{s.projectIds.length - 2}
                  </span>
                )}
              </TableCell>
              <TableCell>
                {s.latestRun ? <LatestRunBadge run={s.latestRun} /> : '—'}
              </TableCell>
            </TableRow>
          ))}
          {data !== null && items.length === 0 && (
            <TableRow>
              <TableCell colSpan={6}>
                {total === 0
                  ? 'projects/ 目录下暂无 .check.ts / .test.ts / .export.ts 脚本'
                  : '无匹配的脚本'}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <div className="mt-4 flex items-center justify-between text-xs text-foreground-muted">
        <span>
          共 {total} 个脚本 · 第 {data?.page ?? 1}/{totalPages} 页
        </span>
        <span className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            上一页
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            下一页
          </Button>
        </span>
      </div>
      <p className="mt-3 text-xs text-foreground-muted">
        脚本来源：LitaGroup/scripts 仓库 main 分支 projects/ 目录，每分钟自动同步；
        点击脚本可直接运行（无需登记到项目），项目内已登记脚本的运行入口不受影响。
      </p>
    </div>
  )
}
