import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Badge } from '@appica/ui-react/badge'
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
import { FileSearch } from '@appica/icons-react'
import {
  api,
  knowledgeMdPath,
  knowledgeWebPath,
  type KnowledgeSearchResponse,
  type KnowledgeSearchResult,
} from '../lib/api'
import { PageBreadcrumb } from '../components/PageBreadcrumb'

function positiveInt(value: string | null, fallback: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function KnowledgeSearchPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const initialQuery = searchParams.get('q') ?? ''
  const [query, setQuery] = useState(initialQuery)
  const [path, setPath] = useState(searchParams.get('path') ?? '')
  const [page, setPage] = useState(positiveInt(searchParams.get('page'), 1))
  const [pageSize, setPageSize] = useState(
    Math.min(positiveInt(searchParams.get('pageSize'), 8), 100),
  )
  const [response, setResponse] = useState<KnowledgeSearchResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const search = useCallback(
    (
      q: string,
      scope: string,
      nextPage: number,
      nextPageSize: number,
    ) => {
      const keyword = q.trim()
      if (!keyword) {
        setResponse(null)
        setError(null)
        return
      }
      setLoading(true)
      setError(null)
      const params = new URLSearchParams({
        q: keyword,
        page: String(nextPage),
        pageSize: String(nextPageSize),
      })
      if (scope.trim() && scope.trim() !== '/') params.set('path', scope.trim())
      setSearchParams(params, { replace: true })
      api
        .searchKnowledge({
          q: keyword,
          path: scope.trim() || undefined,
          page: nextPage,
          pageSize: nextPageSize,
        })
        .then((data) => {
          setResponse(data)
          setPage(data.page)
          setPageSize(data.pageSize)
        })
        .catch((e: Error) => {
          setResponse(null)
          setError(e.message)
        })
        .finally(() => setLoading(false))
    },
    [setSearchParams],
  )

  useEffect(() => {
    if (initialQuery) {
      search(
        initialQuery,
        searchParams.get('path') ?? '',
        positiveInt(searchParams.get('page'), 1),
        Math.min(positiveInt(searchParams.get('pageSize'), 8), 100),
      )
    }
    // 仅首次按 URL 参数恢复搜索
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const hasMore = response?.project.hasMore ?? false
  const results = response?.results ?? []

  return (
    <div className="responsive-knowledge-search">
      <PageBreadcrumb
        items={[
          { label: '知识', to: '/docs/detail/' },
          { label: '搜索' },
        ]}
      />
      <div className="mt-3 mb-4">
        <h1 className="text-2xl font-semibold">知识搜索</h1>
        <p className="mt-1 text-sm text-foreground-muted">
          站内知识全文与 PGVector 向量混合检索，支持限定目录。
        </p>
      </div>

      <Toolbar aria-label="知识搜索" className="mb-4">
        <ToolbarInput
          className="knowledge-search-query w-80"
          render={
            <Input
              placeholder="输入关键词或问题…"
              clearable
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  search(query, path, 1, pageSize)
                }
              }}
              onClear={() => setQuery('')}
              aria-label="知识搜索关键词"
            />
          }
        />
        <ToolbarGroup>
          <Select
            value={String(pageSize)}
            onValueChange={(value) => {
              const next = Number(value)
              setPageSize(next)
              if (query.trim()) search(query, path, 1, next)
            }}
            items={{
              '8': '每页 8 条',
              '20': '每页 20 条',
              '50': '每页 50 条',
              '100': '每页 100 条',
            }}
          >
            <SelectTrigger className="w-32" aria-label="每页条数">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="8">每页 8 条</SelectItem>
              <SelectItem value="20">每页 20 条</SelectItem>
              <SelectItem value="50">每页 50 条</SelectItem>
              <SelectItem value="100">每页 100 条</SelectItem>
            </SelectContent>
          </Select>
          <ToolbarInput
            className="knowledge-search-path w-52"
            render={
              <Input
                placeholder="限定目录，如 /guides"
                clearable
                value={path}
                onChange={(e) => setPath(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    search(query, path, 1, pageSize)
                  }
                }}
                onClear={() => setPath('')}
                aria-label="限定知识目录"
              />
            }
          />
          <ToolbarButton
            render={
              <Button variant="ghost">
                <FileSearch size={16} />
                {loading ? '搜索中…' : '搜索'}
              </Button>
            }
            onClick={() => search(query, path, 1, pageSize)}
            disabled={loading || !query.trim()}
          />
        </ToolbarGroup>
      </Toolbar>

      {error && (
        <p className="mb-4 text-sm">
          {error.includes('未配置') || error.includes('初始化失败')
            ? '知识库尚未配置或暂不可用'
            : '搜索失败'}
          ：{error}
        </p>
      )}

      {response && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-foreground-muted">
            <span>第 {response.page} 页</span>
            <Badge variant={response.mode === 'hybrid' ? 'soft' : 'secondary'}>
              {response.mode === 'hybrid' ? '全文 + 向量' : '全文'}
            </Badge>
            <span>站内 {results.length} 条</span>
          </div>

          <section className="mb-6">
            <h2 className="mb-3 text-lg font-semibold">站内知识</h2>
            {results.length === 0 ? (
              <p className="rounded-md border border-border-strong bg-background p-5 text-sm text-foreground-muted">
                未检索到站内相关知识。可尝试更短的关键词、去掉目录限制，或确认知识已同步。
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {results.map((result) => (
                  <ProjectResultCard
                    key={`${result.nodeId}:${result.headingPath}:${result.score}`}
                    result={result}
                  />
                ))}
              </div>
            )}
          </section>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={loading || page <= 1}
              onClick={() => search(query, path, Math.max(1, page - 1), pageSize)}
            >
              上一页
            </Button>
            <span className="text-sm text-foreground-muted">第 {page} 页</span>
            <Button
              variant="outline"
              size="sm"
              disabled={loading || !hasMore}
              onClick={() => search(query, path, page + 1, pageSize)}
            >
              下一页
            </Button>
          </div>
        </>
      )}

      {!response && !error && (
        <div className="rounded-md border border-border-strong bg-background p-6 text-sm text-foreground-muted">
          <p className="font-medium text-foreground-intense">使用提示</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>站内知识按全文与 PGVector 混合排序，可限定目录。</li>
            <li>
              项目文档会自动同步到 <span className="font-mono">/project/**</span>，
              可在搜索结果中直接阅读镜像原文。
            </li>
            <li>
              Agent 可使用 <span className="font-mono">/api/docs/search.md</span>{' '}
              获取 Markdown 结果。
            </li>
          </ul>
        </div>
      )}
    </div>
  )
}

function ProjectResultCard({ result }: { result: KnowledgeSearchResult }) {
  return (
    <article className="rounded-md border border-border-strong bg-background p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            to={knowledgeWebPath(result.path, false)}
            className="truncate font-semibold text-foreground-intense underline"
          >
            {result.title}
          </Link>
          <span className="truncate font-mono text-xs text-foreground-muted">
            {result.path}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{result.matchedBy}</Badge>
          <span className="text-xs text-foreground-muted">{result.score}</span>
        </div>
      </div>
      {result.headingPath && (
        <p className="mt-1 text-xs text-foreground-muted">
          章节：{result.headingPath}
        </p>
      )}
      <p className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap break-words text-sm text-foreground-muted">
        {result.content}
      </p>
      <div className="mt-3 flex gap-3 text-xs">
        <Link
          to={knowledgeWebPath(result.path, false)}
          className="underline"
        >
          阅读全文
        </Link>
        <a
          href={knowledgeMdPath(result.path, false)}
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          原文 Markdown
        </a>
      </div>
    </article>
  )
}
