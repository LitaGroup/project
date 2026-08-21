import { useEffect, useState } from 'react'
import { Badge } from '@appica/ui-react/badge'
import { api } from '../lib/api'
import {
  ResourceListPage,
  type ResourceRow,
} from '../components/ResourceListPage'

/**
 * 脚本全局列表：扫描脚本根目录下全部 .check.ts / .test.ts，
 * 所属项目取登记了该脚本的检查/用例（未登记显示 —）。
 */
export function ScriptsPage() {
  const [rows, setRows] = useState<ResourceRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      api.listCheckScripts(),
      api.listTestScripts(),
      api.listChecks(),
      api.listTests(),
    ])
      .then(([checkScripts, testScripts, checks, tests]) => {
        // scriptPath → 登记它的项目 id 集合
        const owners = new Map<string, Set<number>>()
        const register = (scriptPath: string, projectId?: number) => {
          if (projectId === undefined) return
          const set = owners.get(scriptPath) ?? new Set<number>()
          set.add(projectId)
          owners.set(scriptPath, set)
        }
        checks.forEach((c) => register(c.scriptPath, c.projectId))
        tests.forEach((t) => register(t.scriptPath, t.projectId))

        const toRow = (path: string, kind: '检查' | '用例'): ResourceRow => ({
          key: `${kind}:${path}`,
          name: path,
          badge: (
            <Badge variant="secondary" className="shrink-0">
              {kind}
            </Badge>
          ),
          projectIds: [...(owners.get(path) ?? [])],
        })
        setRows([
          ...checkScripts.map((p) => toRow(p, '检查')),
          ...testScripts.map((p) => toRow(p, '用例')),
        ])
      })
      .catch((e: Error) => setError(e.message))
  }, [])

  return (
    <ResourceListPage
      title="脚本"
      rows={rows}
      error={error}
      empty="脚本目录下暂无 .check.ts / .test.ts 脚本"
    />
  )
}
