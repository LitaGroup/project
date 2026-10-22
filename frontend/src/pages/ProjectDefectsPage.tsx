import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@appica/ui-react/table'
import { Input } from '@appica/ui-react/input'
import {
  Toolbar,
  ToolbarButton,
  ToolbarGroup,
  ToolbarInput,
} from '@appica/ui-react/toolbar'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@appica/ui-react/select'
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogClose,
} from '@appica/ui-react/alert-dialog'
import { Button } from '@appica/ui-react/button'
import {
  api,
  DEFECT_PLATFORMS,
  DEFECT_PRIORITIES,
  DEFECT_STATUSES,
  type Defect,
} from '../lib/api'
import {
  DefectStatusBadge,
  DefectPriorityBadge,
} from '../components/StatusBadge'
import { PageBreadcrumb } from '../components/PageBreadcrumb'
import { NewDefectDialog } from '../components/NewDefectDialog'

/** 项目下的缺陷页：只展示本项目缺陷，支持按 端/状态/优先级 筛选 + 预期与实际模糊搜索 */
export function ProjectDefectsPage() {
  const { id } = useParams<{ id: string }>()
  const projectId = Number(id)

  const [defects, setDefects] = useState<Defect[] | null>(null)
  const [projectName, setProjectName] = useState<string | null>(null)
  const [keyword, setKeyword] = useState('')
  const [platformFilter, setPlatformFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(() => {
    api
      .listDefects(projectId)
      .then(setDefects)
      .catch((e: Error) => setError(e.message))
  }, [projectId])

  useEffect(() => {
    reload()
    api
      .getProject(projectId)
      .then((p) => setProjectName(p.name))
      .catch(() => setProjectName(null))
  }, [projectId, reload])

  const q = keyword.trim().toLowerCase()
  const filtered = (defects ?? []).filter(
    (d) =>
      (!q ||
        d.expected.toLowerCase().includes(q) ||
        d.actual.toLowerCase().includes(q)) &&
      (platformFilter === 'all' || d.platform === platformFilter) &&
      (statusFilter === 'all' || d.status === statusFilter) &&
      (priorityFilter === 'all' || d.priority === priorityFilter),
  )

  // 筛选项 value 与展示文案不同（all → 不限X），必须传 items 映射（Appica 规则）
  const platformItems = Object.fromEntries(
    ['all', ...DEFECT_PLATFORMS].map((p) => [p, p === 'all' ? '不限端' : p]),
  )
  const statusItems = Object.fromEntries(
    ['all', ...DEFECT_STATUSES, ...(defects ?? []).map((d) => d.status)]
      .filter((v, i, arr) => arr.indexOf(v) === i)
      .map((s) => [s, s === 'all' ? '不限状态' : s]),
  )
  const priorityItems = Object.fromEntries(
    ['all', ...DEFECT_PRIORITIES].map((p) => [p, p === 'all' ? '不限优先级' : p]),
  )
  // Markdown 视图：本项目缺陷清单带当前筛选参数（'all'/空串不传；.md 端点无 platform 参数）
  const mdQuery = [
    `projectId=${projectId}`,
    statusFilter !== 'all' && `status=${encodeURIComponent(statusFilter)}`,
    priorityFilter !== 'all' &&
      `priority=${encodeURIComponent(priorityFilter)}`,
    q && `q=${encodeURIComponent(q)}`,
  ]
    .filter(Boolean)
    .join('&')

  return (
    <div>
      <PageBreadcrumb
        items={[
          { label: '项目', to: '/projects' },
          { label: projectName ?? '…', to: `/projects/${projectId}` },
          { label: '缺陷' },
        ]}
      />
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold">缺陷</h1>
          {/* Markdown 视图：后端 .md URL 规范（GET /api/defects.md?projectId=） */}
          <a
            href={`/api/defects.md${mdQuery ? `?${mdQuery}` : ''}`}
            target="_blank"
            rel="noreferrer"
            className="text-sm underline"
            title="Markdown 视图"
          >
            MD
          </a>
        </div>
        <NewDefectDialog
          projects={[{ id: projectId, name: projectName ?? `#${projectId}` }]}
          preset={{ projectId }}
          onCreated={reload}
        />
      </div>
      <Toolbar aria-label="缺陷筛选" className="mb-4">
        <ToolbarInput
          className="w-64"
          render={
            <Input
              placeholder="搜索预期或实际描述…"
              clearable
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onClear={() => setKeyword('')}
              aria-label="搜索预期或实际描述"
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
              className="w-32"
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
              className="w-32"
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
          <Select
            value={priorityFilter}
            onValueChange={(v) => setPriorityFilter(v as string)}
            items={priorityItems}
          >
            <ToolbarButton
              className="w-32"
              render={
                <SelectTrigger aria-label="按优先级筛选">
                  <SelectValue placeholder="优先级" />
                </SelectTrigger>
              }
            />
            <SelectContent>
              {Object.keys(priorityItems).map((p) => (
                <SelectItem key={p} value={p}>
                  {priorityItems[p]}
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
            <TableHead>预期功能描述</TableHead>
            <TableHead className="w-24 text-center">端</TableHead>
            <TableHead className="w-24 text-center">优先级</TableHead>
            <TableHead className="w-24 text-center">状态</TableHead>
            <TableHead className="w-16 text-center">图片</TableHead>
            <TableHead className="w-24 text-center">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((d) => (
            <TableRow key={d.id}>
              <TableCell className="max-w-xl truncate" title={d.expected}>
                <Link
                  to={`/projects/${projectId}/defects/${d.id}`}
                  className="text-foreground-intense underline"
                >
                  {d.expected}
                </Link>
              </TableCell>
              <TableCell className="text-center">{d.platform ?? '—'}</TableCell>
              <TableCell className="text-center">
                <DefectPriorityBadge priority={d.priority} />
              </TableCell>
              <TableCell className="text-center">
                <DefectStatusBadge status={d.status} />
              </TableCell>
              <TableCell className="text-center">
                {(d.images?.length ?? 0) > 0 ? d.images!.length : '—'}
              </TableCell>
              <TableCell className="text-center">
                <DeleteDefectButton defect={d} onDeleted={reload} />
              </TableCell>
            </TableRow>
          ))}
          {defects !== null && filtered.length === 0 && (
            <TableRow>
              <TableCell colSpan={6}>
                {defects.length === 0
                  ? '本项目暂无缺陷，点击"新建缺陷"创建'
                  : '无符合筛选条件的缺陷'}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}

/** 删除缺陷（含变更记录），删除后刷新列表 */
function DeleteDefectButton({
  defect,
  onDeleted,
}: {
  defect: Defect
  onDeleted: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  return (
    <AlertDialog>
      <AlertDialogTrigger>
        <Button variant="outline" size="sm">
          删除
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除缺陷</AlertDialogTitle>
          <AlertDialogDescription>
            确定删除缺陷「{defect.expected.split('\n')[0]}」吗？将删除本地记录及其变更记录，不可恢复。
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && <p className="px-6 text-sm">删除失败:{error}</p>}
        <AlertDialogFooter>
          <AlertDialogClose>
            <Button variant="outline" size="sm">
              取消
            </Button>
          </AlertDialogClose>
          <AlertDialogClose>
            <Button
              variant="destructive"
              onClick={() =>
                api
                  .deleteDefect(defect.id)
                  .then(onDeleted)
                  .catch((e: Error) => setError(e.message))
              }
            >
              确认删除
            </Button>
          </AlertDialogClose>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
