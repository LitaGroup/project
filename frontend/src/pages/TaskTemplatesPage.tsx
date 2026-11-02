import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, buttonVariants } from '@appica/ui-react/button'
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
import { useAuth } from '../context/AuthContext'
import {
  SYSTEM_TASK_TEMPLATE_IDS,
  TaskTemplateTable,
} from '../components/TaskTemplateTable'

/** 任务定义列表：任务类型 + 可复用描述 + 多个默认处理机器人 */
export function TaskTemplatesPage() {
  const { user } = useAuth()
  const [templates, setTemplates] = useState<TaskTemplate[] | null>(null)
  const [workers, setWorkers] = useState<Worker[]>([])
  const [taskTypes, setTaskTypes] = useState<TaskTypeDef[]>([])
  const [error, setError] = useState<string | null>(null)

  const [keyword, setKeyword] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [workerFilter, setWorkerFilter] = useState('all')
  const [scopeFilter, setScopeFilter] = useState('all')

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
    const query = keyword.trim().toLowerCase()
    return (templates ?? []).filter((template) => {
      if (query) {
        const haystack = `${template.name} ${template.description ?? ''}`.toLowerCase()
        if (!haystack.includes(query)) return false
      }
      if (typeFilter !== 'all' && template.type !== typeFilter) return false
      if (workerFilter === 'none') {
        if ((template.agentIds ?? []).length > 0) return false
      } else if (workerFilter !== 'all') {
        if (!(template.agentIds ?? []).includes(Number(workerFilter))) return false
      }
      if (scopeFilter === 'system' && !SYSTEM_TASK_TEMPLATE_IDS.has(template.id)) {
        return false
      }
      if (scopeFilter === 'custom' && SYSTEM_TASK_TEMPLATE_IDS.has(template.id)) {
        return false
      }
      if (scopeFilter === 'mine' && template.createdById !== user?.id) {
        return false
      }
      return true
    })
  }, [templates, keyword, typeFilter, workerFilter, scopeFilter, user?.id])

  const hasFilter =
    keyword.trim() !== '' ||
    typeFilter !== 'all' ||
    workerFilter !== 'all' ||
    scopeFilter !== 'all'

  const clearFilters = () => {
    setKeyword('')
    setTypeFilter('all')
    setWorkerFilter('all')
    setScopeFilter('all')
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">任务定义</h1>
          <p className="mt-1 text-sm text-foreground-muted">
            沉淀一类任务的可复用定义：任务类型、统一描述、所需输入、交付方式与多个默认处理机器人
          </p>
        </div>
        <Link
          to="/admin/task-templates/new"
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          新建任务定义
        </Link>
      </div>
      {error && <p className="text-sm">操作失败:{error}</p>}

      <Toolbar aria-label="任务定义筛选">
        <ToolbarInput
          className="w-64"
          render={
            <Input
              placeholder="搜索名称、描述…"
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
          <Select
            value={scopeFilter}
            onValueChange={(value) => setScopeFilter(value as string)}
            items={{
              all: '全部分类',
              system: '系统定义',
              custom: '自定义定义',
              mine: '我创建的',
            }}
          >
            <ToolbarButton
              className="w-36"
              render={
                <SelectTrigger aria-label="按定义分类筛选">
                  <SelectValue placeholder="分类" />
                </SelectTrigger>
              }
            />
            <SelectContent>
              <SelectItem value="all">全部分类</SelectItem>
              <SelectItem value="system">系统定义</SelectItem>
              <SelectItem value="custom">自定义定义</SelectItem>
              <SelectItem value="mine">我创建的</SelectItem>
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
        mode="manage"
        currentUserId={user?.id}
        onChanged={reload}
        onError={setError}
        emptyText={
          hasFilter
            ? '没有符合筛选条件的任务定义'
            : '暂无任务定义，点右上角「新建任务定义」创建'
        }
      />
    </div>
  )
}
