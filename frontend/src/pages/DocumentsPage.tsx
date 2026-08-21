import { useEffect, useState } from 'react'
import { api, type ProjectDocument } from '../lib/api'
import {
  ResourceListPage,
  type ResourceRow,
} from '../components/ResourceListPage'

/** 文档全局列表：全部项目的文档（名称 + 所属项目） */
export function DocumentsPage() {
  const [documents, setDocuments] = useState<ProjectDocument[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .listDocuments()
      .then(setDocuments)
      .catch((e: Error) => setError(e.message))
  }, [])

  const rows: ResourceRow[] | null =
    documents?.map((d) => ({
      key: String(d.id),
      name: d.title,
      detail: `${d.type} · ${d.source}`,
      projectIds: d.projectId === undefined ? [] : [d.projectId],
      to: `/documents/${d.id}`,
    })) ?? null

  return (
    <ResourceListPage
      title="文档"
      rows={rows}
      error={error}
      empty="暂无文档，到项目详情页新建或从飞书同步"
    />
  )
}
