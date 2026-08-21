import { useEffect, useState } from 'react'
import { api, type ProjectTest } from '../lib/api'
import {
  ResourceListPage,
  type ResourceRow,
} from '../components/ResourceListPage'

/** 用例全局列表：全部项目的测试用例（名称 + 所属项目） */
export function TestsPage() {
  const [tests, setTests] = useState<ProjectTest[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .listTests()
      .then(setTests)
      .catch((e: Error) => setError(e.message))
  }, [])

  const rows: ResourceRow[] | null =
    tests?.map((t) => ({
      key: String(t.id),
      name: t.code,
      detail: t.description ?? t.scriptPath,
      projectIds: t.projectId === undefined ? [] : [t.projectId],
      to:
        t.projectId === undefined
          ? undefined
          : `/projects/${t.projectId}/tests/${t.id}`,
    })) ?? null

  return (
    <ResourceListPage
      title="用例"
      rows={rows}
      error={error}
      empty="暂无用例，到项目详情页登记或自动导入"
    />
  )
}
