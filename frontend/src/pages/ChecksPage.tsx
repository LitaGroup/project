import { useEffect, useState } from 'react'
import { api, type ProjectCheck } from '../lib/api'
import {
  ResourceListPage,
  type ResourceRow,
} from '../components/ResourceListPage'

/** 检查全局列表：全部项目的检查（名称 + 所属项目） */
export function ChecksPage() {
  const [checks, setChecks] = useState<ProjectCheck[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .listChecks()
      .then(setChecks)
      .catch((e: Error) => setError(e.message))
  }, [])

  const rows: ResourceRow[] | null =
    checks?.map((c) => ({
      key: String(c.id),
      name: c.code,
      detail: c.description ?? c.scriptPath,
      projectIds: c.projectId === undefined ? [] : [c.projectId],
      to:
        c.projectId === undefined
          ? undefined
          : `/projects/${c.projectId}/checks/${c.id}`,
    })) ?? null

  return (
    <ResourceListPage
      title="检查"
      rows={rows}
      error={error}
      empty="暂无检查，到项目详情页登记或自动导入"
    />
  )
}
