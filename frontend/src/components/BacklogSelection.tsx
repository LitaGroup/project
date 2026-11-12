import { useMemo, useState } from 'react'
import { Input } from '@appica/ui-react/input'
import { Checkbox } from '@appica/ui-react/checkbox'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@appica/ui-react/table'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@appica/ui-react/select'
import type { Project, Worker } from '../lib/api'
import { matchesPinyinSearch } from '../lib/pinyin-search'

/**
 * 需求选择器（W1 创建 / 向已有迭代追加需求共用）：
 * - 勾选需求后必须指定负责人机器人（AI 或真人）；
 * - 需求为空时默认展示前若干条，搜索命中最多展示 100 条，已选项始终保留。
 */
export function BacklogSelection({
  projects,
  workers,
  drafts,
  onChange,
}: {
  projects: Project[]
  workers: Worker[]
  /** projectId -> ownerWorkerId（null 表示已选但未指定负责人） */
  drafts: Map<number, number | null>
  onChange: (next: Map<number, number | null>) => void
}) {
  const [keyword, setKeyword] = useState('')

  const workerItems = useMemo(
    () => Object.fromEntries(workers.map((w) => [String(w.id), w.name])),
    [workers],
  )

  const visible = useMemo(() => {
    const q = keyword.trim()
    const matched = projects.filter(
      (project) => !q || matchesPinyinSearch(q, [project.name]),
    )
    const selected = matched.filter((project) => drafts.has(project.id))
    const rest = matched
      .filter((project) => !drafts.has(project.id))
      .slice(0, q ? 100 : 40)
    const seen = new Set<number>()
    return [...selected, ...rest].filter((project) => {
      if (seen.has(project.id)) return false
      seen.add(project.id)
      return true
    })
  }, [projects, keyword, drafts])

  const toggle = (projectId: number, checked: boolean) => {
    const next = new Map(drafts)
    if (checked) next.set(projectId, next.get(projectId) ?? null)
    else next.delete(projectId)
    onChange(next)
  }

  const setOwner = (projectId: number, ownerWorkerId: number) => {
    const next = new Map(drafts)
    next.set(projectId, ownerWorkerId)
    onChange(next)
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <Input
          className="w-80"
          placeholder="搜索需求名称（支持拼音）…"
          clearable
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onClear={() => setKeyword('')}
        />
        <span className="text-sm text-foreground-muted">
          已选 {drafts.size} 条
        </span>
      </div>
      <Table hoverableRows>
        <TableHeader>
          <TableRow>
            <TableHead className="w-14 text-center">选择</TableHead>
            <TableHead className="w-16">ID</TableHead>
            <TableHead>需求</TableHead>
            <TableHead className="text-center">状态</TableHead>
            <TableHead className="w-52 text-center">负责人</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visible.map((project) => {
            const checked = drafts.has(project.id)
            const owner = drafts.get(project.id)
            return (
              <TableRow key={project.id}>
                <TableCell className="text-center">
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(value) =>
                      toggle(project.id, value === true)
                    }
                  />
                </TableCell>
                <TableCell>{project.id}</TableCell>
                <TableCell className="max-w-md truncate" title={project.name}>
                  {project.name}
                </TableCell>
                <TableCell className="text-center text-sm text-foreground-muted">
                  {project.status}
                </TableCell>
                <TableCell className="text-center">
                  <Select
                    value={owner ? String(owner) : undefined}
                    onValueChange={(v) => setOwner(project.id, Number(v))}
                    items={workerItems}
                    disabled={!checked}
                  >
                    <SelectTrigger aria-label="选择负责人机器人">
                      <SelectValue placeholder={checked ? '指定负责人' : '先勾选'} />
                    </SelectTrigger>
                    <SelectContent>
                      {workers.map((worker) => (
                        <SelectItem key={worker.id} value={String(worker.id)}>
                          {worker.name}
                          {worker.runtime === 'human' ? '（真人）' : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
              </TableRow>
            )
          })}
          {visible.length === 0 && (
            <TableRow>
              <TableCell colSpan={5}>没有匹配的需求</TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}