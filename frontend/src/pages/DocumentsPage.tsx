import { useEffect, useState } from 'react'
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
import { Input } from '@appica/ui-react/input'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@appica/ui-react/select'
import {
  api,
  DOCUMENT_TYPES,
  type Project,
  type ProjectDocument,
} from '../lib/api'
import { ProjectFilterSelect } from '../components/ProjectFilterSelect'
import { useProjectIdParam } from '../components/useProjectIdParam'

/** 文档来源取值（后端存储原文）：飞书同步 / 平台内直接编写 */
const DOCUMENT_SOURCES = ['飞书', '-'] as const

/** 文档全局列表：全部项目的文档（标题/类型/来源/项目），支持标题模糊搜索 */
export function DocumentsPage() {
  const [documents, setDocuments] = useState<ProjectDocument[] | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [keyword, setKeyword] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [error, setError] = useState<string | null>(null)
  const [projectFilter, setProjectFilter] = useProjectIdParam()

  useEffect(() => {
    api
      .listDocuments()
      .then(setDocuments)
      .catch((e: Error) => setError(e.message))
    api.listProjects().then(setProjects).catch(() => undefined)
  }, [])

  const projectName = new Map(projects.map((p) => [p.id, p.name]))

  const q = keyword.trim().toLowerCase()
  const filtered = (documents ?? []).filter((d) => {
    if (q && !d.title.toLowerCase().includes(q)) return false
    if (typeFilter !== 'all' && d.type !== typeFilter) return false
    if (sourceFilter !== 'all' && d.source !== sourceFilter) return false
    if (projectFilter !== 'all' && String(d.projectId) !== projectFilter) return false
    return true
  })

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">文档</h1>
      </div>

      <div className="mb-4 flex gap-2">
        <ProjectFilterSelect
          projects={projects}
          value={projectFilter}
          onChange={setProjectFilter}
        />
        <Input
          className="w-64"
          placeholder="搜索标题…"
          clearable
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onClear={() => setKeyword('')}
        />
        <Select
          value={typeFilter}
          onValueChange={(v) => setTypeFilter(v as string)}
          items={{
            all: '不限类型',
            ...Object.fromEntries(DOCUMENT_TYPES.map((t) => [t, t])),
          }}
        >
          <SelectTrigger className="w-36">
            <SelectValue placeholder="类型" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">不限类型</SelectItem>
            {DOCUMENT_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={sourceFilter}
          onValueChange={(v) => setSourceFilter(v as string)}
          items={{ all: '不限来源', 飞书: '飞书', '-': '手写' }}
        >
          <SelectTrigger className="w-36">
            <SelectValue placeholder="来源" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">不限来源</SelectItem>
            {DOCUMENT_SOURCES.map((s) => (
              <SelectItem key={s} value={s}>
                {s === '-' ? '手写' : s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error && <p className="mb-4 text-sm">加载失败:{error}</p>}

      <Table hoverableRows>
        <TableHeader>
          <TableRow>
            <TableHead>标题</TableHead>
            <TableHead className="w-24 text-center">类型</TableHead>
            <TableHead className="w-24 text-center">来源</TableHead>
            <TableHead>项目</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((d) => (
            <TableRow key={d.id}>
              <TableCell className="max-w-xl truncate" title={d.title}>
                <Link
                  to={`/documents/${d.id}`}
                  className="text-foreground-intense underline"
                >
                  {d.title}
                </Link>
              </TableCell>
              <TableCell className="text-center">
                <Badge variant="secondary">{d.type}</Badge>
              </TableCell>
              <TableCell className="text-center">
                {d.source === '-' ? '手写' : d.source}
              </TableCell>
              <TableCell className="max-w-64 truncate">
                {d.projectId === undefined ? (
                  '—'
                ) : (
                  <Link
                    to={`/projects/${d.projectId}`}
                    className="text-foreground-intense underline"
                  >
                    {projectName.get(d.projectId) ?? `#${d.projectId}`}
                  </Link>
                )}
              </TableCell>
            </TableRow>
          ))}
          {documents !== null && filtered.length === 0 && (
            <TableRow>
              <TableCell colSpan={4}>
                {documents.length === 0
                  ? '暂无文档，到项目详情页新建或从飞书同步'
                  : '无匹配的文档'}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
