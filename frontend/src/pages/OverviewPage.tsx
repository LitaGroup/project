import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from '@appica/ui-react/card'
import { Badge } from '@appica/ui-react/badge'
import { api, type Project } from '../lib/api'
import { StatusBadge } from '../components/StatusBadge'

const aiUsageCards = [
  {
    title: 'AI 是一等参与者',
    description:
      '本平台为 agent 会话设计：所有能力都通过 HTTP API 暴露（/api/projects、/api/documents、/api/feishu/read），AI 可直接读写项目与文档，接口约定见根目录 AGENTS.md。',
  },
  {
    title: '飞书文档同步',
    description:
      'AI 或用户只需提供飞书链接（文档 / 表格 / 多维表格 / 知识库），即可单向同步入库，作为需求与设计文档的事实来源。',
  },
  {
    title: 'MCP Server（规划中）',
    description:
      '后续将把项目、文档、飞书同步等 API 封装为 MCP 工具，agent 无需手写 HTTP 调用即可操作平台。当前请先使用 REST API。',
  },
]

export function OverviewPage() {
  const [projects, setProjects] = useState<Project[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .listProjects()
      .then(setProjects)
      .catch((e: Error) => setError(e.message))
  }, [])

  const inProgress = projects.filter((p) => p.status === '进行中')

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h1 className="mb-4 text-2xl font-semibold">概览</h1>
        <div className="grid gap-4 md:grid-cols-3">
          {aiUsageCards.map((card) => (
            <Card key={card.title}>
              <CardHeader>
                <CardTitle>{card.title}</CardTitle>
                <CardDescription>{card.description}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-center gap-2">
          <h2 className="text-xl font-semibold">进行中的项目</h2>
          <Badge variant="primary">{inProgress.length}</Badge>
        </div>
        {error && <p className="text-sm">加载失败：{error}</p>}
        {!error && inProgress.length === 0 && (
          <p className="text-sm">暂无进行中的项目</p>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          {inProgress.map((p) => (
            <Card key={p.id}>
              <CardHeader>
                <CardTitle>
                  <Link to={`/projects/${p.id}`}>{p.name}</Link>
                </CardTitle>
                <CardDescription>
                  {p.type} · 预期发布 {p.expectedReleaseAt ?? '未定'}
                </CardDescription>
              </CardHeader>
              <CardFooter>
                <StatusBadge status={p.status} />
              </CardFooter>
            </Card>
          ))}
        </div>
      </section>
    </div>
  )
}
