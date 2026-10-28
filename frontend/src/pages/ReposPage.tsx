import { useEffect, useState } from 'react'
import {
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@appica/ui-react/table'
import { ResponsiveTable as Table } from '../components/ResponsiveTable'
import { Input } from '@appica/ui-react/input'
import {
  Toolbar,
  ToolbarButton,
  ToolbarGroup,
  ToolbarInput,
} from '@appica/ui-react/toolbar'
import { Button } from '@appica/ui-react/button'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@appica/ui-react/select'
import {
  api,
  REPO_PLATFORMS,
  REPO_STATUSES,
  type Repo,
  type RepoPlatform,
  type RepoStatus,
} from '../lib/api'

/**
 * 仓库列表（代码分区）：GitHub 组织仓库清单 + 平台侧维护的 端/状态。
 * 支持按 端、状态 筛选与仓库名/描述搜索；状态「忽略」的仓库不再出现在
 * 仓库联想与代码分支候选（存量登记与提交监听保留）。
 */
export function ReposPage() {
  const [repos, setRepos] = useState<Repo[] | null>(null)
  const [keyword, setKeyword] = useState('')
  const [platformFilter, setPlatformFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = () =>
    api
      .listRepos()
      .then(setRepos)
      .catch((e: Error) => setError(e.message))

  useEffect(() => {
    void load()
  }, [])

  const sync = async () => {
    setSyncing(true)
    setError(null)
    try {
      await api.syncRepos()
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSyncing(false)
    }
  }

  const update = async (
    repo: Repo,
    patch: Partial<{ platform: RepoPlatform; status: RepoStatus }>,
  ) => {
    setError(null)
    try {
      const updated = await api.updateRepo(repo.id, patch)
      setRepos((prev) =>
        prev ? prev.map((r) => (r.id === updated.id ? updated : r)) : prev,
      )
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const q = keyword.trim().toLowerCase()
  const filtered = (repos ?? [])
    .filter((r) => platformFilter === 'all' || r.platform === platformFilter)
    .filter((r) => statusFilter === 'all' || r.status === statusFilter)
    .filter(
      (r) =>
        !q ||
        r.name.toLowerCase().includes(q) ||
        r.fullName.toLowerCase().includes(q) ||
        (r.description ?? '').toLowerCase().includes(q),
    )

  const platformItems: Record<string, string> = {
    all: '不限端',
    ...Object.fromEntries(REPO_PLATFORMS.map((p) => [p, p])),
  }
  const statusItems: Record<string, string> = {
    all: '不限状态',
    ...Object.fromEntries(REPO_STATUSES.map((s) => [s, s])),
  }
  const rowPlatformItems: Record<string, string> = Object.fromEntries(
    REPO_PLATFORMS.map((p) => [p, p]),
  )
  const rowStatusItems: Record<string, string> = Object.fromEntries(
    REPO_STATUSES.map((s) => [s, s]),
  )

  return (
    <div>
      <div className="responsive-page-header mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">仓库</h1>
        <Button variant="outline" size="sm" disabled={syncing} onClick={sync}>
          {syncing ? '同步中…' : '同步'}
        </Button>
      </div>
      <Toolbar aria-label="仓库筛选" className="mb-4">
        <ToolbarInput
          className="w-72"
          render={
            <Input
              placeholder="搜索 仓库名 / 描述…"
              clearable
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onClear={() => setKeyword('')}
              aria-label="搜索仓库名或描述"
            />
          }
        />
        <ToolbarGroup aria-label="筛选">
          <Select
            value={platformFilter}
            onValueChange={(v) => setPlatformFilter(v as string)}
            items={platformItems}
          >
            <ToolbarButton
              className="w-36"
              render={
                <SelectTrigger aria-label="按端筛选">
                  <SelectValue placeholder="端" />
                </SelectTrigger>
              }
            />
            <SelectContent>
              {Object.keys(platformItems).map((p) => (
                <SelectItem key={p} value={p}>
                  {platformItems[p]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v as string)}
            items={statusItems}
          >
            <ToolbarButton
              className="w-36"
              render={
                <SelectTrigger aria-label="按状态筛选">
                  <SelectValue placeholder="状态" />
                </SelectTrigger>
              }
            />
            <SelectContent>
              {Object.keys(statusItems).map((s) => (
                <SelectItem key={s} value={s}>
                  {statusItems[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </ToolbarGroup>
      </Toolbar>
      {error && <p className="mb-4 text-sm">操作失败:{error}</p>}
      <Table hoverableRows>
        <TableHeader>
          <TableRow>
            <TableHead>仓库</TableHead>
            <TableHead className="w-32">端</TableHead>
            <TableHead className="w-32">状态</TableHead>
            <TableHead className="w-52">最后更新时间</TableHead>
            <TableHead className="w-80">描述</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="max-w-80">
                <a
                  href={r.htmlUrl ?? `https://github.com/${r.fullName}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium underline"
                >
                  {r.fullName}
                </a>
                {r.language && (
                  <span className="ml-2 text-xs text-foreground-muted">
                    {r.language}
                  </span>
                )}
              </TableCell>
              <TableCell>
                <Select
                  value={r.platform}
                  onValueChange={(v) =>
                    void update(r, { platform: v as RepoPlatform })
                  }
                  items={rowPlatformItems}
                >
                  <SelectTrigger className="w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {REPO_PLATFORMS.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell>
                <Select
                  value={r.status}
                  onValueChange={(v) =>
                    void update(r, { status: v as RepoStatus })
                  }
                  items={rowStatusItems}
                >
                  <SelectTrigger className="w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {REPO_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell>
                {r.lastUpdatedAt
                  ? new Date(r.lastUpdatedAt).toLocaleString()
                  : '—'}
              </TableCell>
              <TableCell
                className="max-w-80 truncate text-foreground-muted"
                title={r.description ?? ''}
              >
                {r.description ?? '—'}
              </TableCell>
            </TableRow>
          ))}
          {repos !== null && filtered.length === 0 && (
            <TableRow>
              <TableCell colSpan={5}>
                {repos.length === 0
                  ? '暂无仓库：请确认已配置 GITHUB_TOKEN，或点击右上角「同步」从 GitHub 组织拉取'
                  : '无匹配的仓库'}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      <p className="mt-4 text-xs text-foreground-muted">
        仓库清单随 GitHub 组织每小时自动同步一次（最后更新时间取 GitHub updated_at）；
        状态改为「忽略」后不再出现在仓库联想与代码分支候选，存量登记与提交监听不受影响。
      </p>
    </div>
  )
}
