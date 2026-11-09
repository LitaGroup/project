import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, buttonVariants } from '@appica/ui-react/button'
import { Input } from '@appica/ui-react/input'
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@appica/ui-react/tabs'
import {
  Toolbar,
  ToolbarGroup,
  ToolbarInput,
} from '@appica/ui-react/toolbar'
import { api, type TaskTemplate, type Worker } from '../lib/api'
import { matchesPinyinSearch } from '../lib/pinyin-search'
import { useAuth } from '../context/AuthContext'
import { TaskTemplateTable } from '../components/TaskTemplateTable'

type TabKey = 'mine' | 'all'

/** 关键词（名称/描述）筛选 */
function filterTemplates(
  list: TaskTemplate[],
  keyword: string,
): TaskTemplate[] {
  return list.filter((template) =>
    matchesPinyinSearch(keyword, [template.name, template.description]),
  )
}

/**
 * 个人中心 - 任务定义：
 * 我的任务定义 = 我创建的 + 我关注的（合并去重）；全局任务定义 = 平台全部任务定义。
 */
export function ProfileTaskDefinitionsPage() {
  const { user } = useAuth()
  const [tab, setTab] = useState<TabKey>('mine')
  const [templates, setTemplates] = useState<TaskTemplate[] | null>(null)
  const [workers, setWorkers] = useState<Worker[]>([])
  const [error, setError] = useState<string | null>(null)
  const [keyword, setKeyword] = useState('')

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
  }, [reload])

  const mine = useMemo(
    () =>
      (templates ?? []).filter(
        (template) =>
          template.followedByMe ||
          (user?.id != null && template.createdById === user.id),
      ),
    [templates, user],
  )

  const filteredMine = useMemo(
    () => filterTemplates(mine, keyword),
    [mine, keyword],
  )
  const filteredAll = useMemo(
    () => filterTemplates(templates ?? [], keyword),
    [templates, keyword],
  )

  const hasFilter = keyword.trim() !== ''
  const clearFilters = () => {
    setKeyword('')
  }

  return (
    <div className="flex min-h-full flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">任务定义</h1>
          <p className="mt-1 text-sm text-foreground-muted">
            查看我创建或关注的任务定义，也可浏览平台全部任务定义
          </p>
        </div>
        {user?.role === '管理员' && (
          <Link
            to="/admin/task-templates/new"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            新建任务定义
          </Link>
        )}
      </div>
      {error && <p className="text-sm">操作失败:{error}</p>}

      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as TabKey)}
        variant="line"
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <TabsList className="shrink-0">
          <TabsTrigger value="mine">
            我的任务定义
            {mine.length > 0 && (
              <span className="ml-1 text-xs text-foreground-muted">
                {mine.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="all">
            全局任务定义
            {templates && templates.length > 0 && (
              <span className="ml-1 text-xs text-foreground-muted">
                {templates.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="mine" keepMounted className="min-h-0 flex-1 pt-4">
          <div className="flex flex-col gap-4">
            <FilterToolbar
              keyword={keyword}
              hasFilter={hasFilter}
              onKeyword={setKeyword}
              onClear={clearFilters}
            />
            <TaskTemplateTable
              templates={filteredMine}
              workers={workers}
              mode="plain"
              currentUserId={user?.id}
              onChanged={reload}
              onError={setError}
              emptyText={
                hasFilter
                  ? '没有符合筛选条件的任务定义'
                  : '还没有创建或关注任务定义，可在「全局任务定义」中关注'
              }
            />
          </div>
        </TabsContent>

        <TabsContent value="all" keepMounted className="min-h-0 flex-1 pt-4">
          <div className="flex flex-col gap-4">
            <FilterToolbar
              keyword={keyword}
              hasFilter={hasFilter}
              onKeyword={setKeyword}
              onClear={clearFilters}
            />
            <TaskTemplateTable
              templates={filteredAll}
              workers={workers}
              mode="plain"
              currentUserId={user?.id}
              onChanged={reload}
              onError={setError}
              emptyText={
                hasFilter ? '没有符合筛选条件的任务定义' : '暂无任务定义'
              }
            />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function FilterToolbar({
  keyword,
  hasFilter,
  onKeyword,
  onClear,
}: {
  keyword: string
  hasFilter: boolean
  onKeyword: (value: string) => void
  onClear: () => void
}) {
  return (
    <Toolbar aria-label="任务定义筛选">
      <ToolbarInput
        className="w-64"
        render={
          <Input
            placeholder="搜索名称、描述或拼音…"
            clearable
            value={keyword}
            onChange={(e) => onKeyword(e.target.value)}
            onClear={() => onKeyword('')}
            aria-label="搜索任务定义名称或描述"
          />
        }
      />
      <ToolbarGroup aria-label="筛选">
        {hasFilter && (
          <Button variant="ghost" size="sm" onClick={onClear}>
            清空筛选
          </Button>
        )}
      </ToolbarGroup>
    </Toolbar>
  )
}
