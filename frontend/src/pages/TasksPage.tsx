import { useEffect, useState } from 'react'
import { api, type ProjectTask } from '../lib/api'
import {
  ResourceListPage,
  type ResourceRow,
} from '../components/ResourceListPage'

/** 任务全局列表：全部项目的定时任务（名称 + 所属项目） */
export function TasksPage() {
  const [tasks, setTasks] = useState<ProjectTask[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .listTasks()
      .then(setTasks)
      .catch((e: Error) => setError(e.message))
  }, [])

  const rows: ResourceRow[] | null =
    tasks?.map((t) => ({
      key: String(t.id),
      name: t.title,
      detail: `${t.cron}${t.enabled ? '' : '（已停用）'}`,
      projectIds: [t.projectId],
      to: `/projects/${t.projectId}/tasks/${t.id}`,
    })) ?? null

  return (
    <ResourceListPage
      title="任务"
      rows={rows}
      error={error}
      empty="暂无任务，到项目详情页新建定时任务"
    />
  )
}
