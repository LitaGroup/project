import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@appica/ui-react/button'
import { Input } from '@appica/ui-react/input'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@appica/ui-react/select'
import {
  Toolbar,
  ToolbarButton,
  ToolbarGroup,
  ToolbarInput,
} from '@appica/ui-react/toolbar'
import { api, type TaskTemplate, type TaskTypeDef, type Worker } from '../lib/api'
import { matchesPinyinSearch } from '../lib/pinyin-search'
import { TaskTemplateTable } from '../components/TaskTemplateTable'

/** 任务栏目 - 定义：平台全部任务定义的只读列表（新建/编辑在管理区进行） */
export function TaskDefinitionsPage() {
  const [templates, setTemplates] = useState<TaskTemplate[] | null>(null)
  const [workers, setWorkers] = useState<Worker[]>([])
  const [taskTypes, setTaskTypes] = useState<TaskTypeDef[]>([])
  const [error, setError] = useState<string | null>(null)

  const [keyword, setKeyword] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [workerFilter, setWorkerFilter] = useState('all')

  const reload = useCallback(() => {
    api
      .listTaskTemplates()
      .then(setTemplates)
      .catch((e: Error) => setError(e.message))
  }, [])

  useEffect(() => {
    reload()
    api
      .listWorkers({ role: '工作者' })
      .then(setWorkers)
      .catch(() => undefined)
    api.listTaskTypes().then(setTaskTypes).catch(() => undefined)
  }, [reload])

  const typeItems = useMemo<Record<string, string>>(
    () => ({
      all: '不限类型',
      ...Object.fromEntries(taskTypes.map((type) => [type.name, type.name])),
    }),
    [taskTypes],
  )
  const workerItems = useMemo<Record<string, string>>(
    () => ({
      all: '不限机器人',
      none: '未配置机器人',
      ...Object.fromEntries(workers.map((worker) => [String(worker.id), worker.name])),
    }),
    [workers],
  )

  const filtered = useMemo(() => {
    return (templates ?? []).filter((template) => {
      if (
        !matchesPinyinSearch(keyword, [template.name, template.description])
      ) {
        return false
      }
      if (typeFilter !== 'all' && template.type !== typeFilter) return false
      if (workerFilter === 'none') {
        if ((template.agentIds ?? []).length > 0) return false
      } else if (workerFilter !== 'all') {
        if (!(template.agentIds ?? []).includes(Number(workerFilter))) return false
      }
      return true
    })
  }, [templates, keyword, typeFilter, workerFilter])

  const hasFilter =
    keyword.trim() !== '' || typeFilter !== 'all' || workerFilter !== 'all'

  const clearFilters = () => {
    setKeyword('')
    setTypeFilter('all')
    setWorkerFilter('all')
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">定义</h1>
        <p className="mt-1 text-sm text-foreground-muted">
          平台全部任务定义的只读视图；定义的新建与维护在管理区「任务定义」进行
        </p>
      </div>
      {error && <p className="text-sm">加载失败:{error}</p>}

      <Toolbar aria-label="任务定义筛选">
        <ToolbarInput
          className="w-64"
          render={
            <Input
              placeholder="搜索名称、描述或拼音…"
              clearable
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onClear={() => setKeyword('')}
              aria-label="搜索任务定义名称或描述"
            />
          }
        />
        <ToolbarGroup aria-label="筛选">
          <Select
            value={typeFilter}
            onValueChange={(value) => setTypeFilter(value as string)}
            items={typeItems}
          >
            <ToolbarButton
              className="w-36"
              render={
                <SelectTrigger aria-label="按任务类型筛选">
                  <SelectValue placeholder="类型" />
                </SelectTrigger>
              }
            />
            <SelectContent>
              {Object.entries(typeItems).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={workerFilter}
            onValueChange={(value) => setWorkerFilter(value as string)}
            items={workerItems}
          >
            <ToolbarButton
              className="w-40"
              render={
                <SelectTrigger aria-label="按处理机器人筛选">
                  <SelectValue placeholder="处理机器人" />
                </SelectTrigger>
              }
            />
            <SelectContent>
              {Object.entries(workerItems).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {hasFilter && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              清空筛选
            </Button>
          )}
        </ToolbarGroup>
      </Toolbar>

      <TaskTemplateTable
        templates={filtered}
        workers={workers}
        mode="readonly"
        emptyText={
          hasFilter ? '没有符合筛选条件的任务定义' : '暂无任务定义'
        }
      />
    </div>
  )
}
