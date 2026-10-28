import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@appica/ui-react/dialog'
import { Input } from '@appica/ui-react/input'
import { Loader } from '@appica/ui-react/loader'
import { Search } from '@appica/icons-react'
import {
  api,
  knowledgeWebPath,
  type KnowledgeSearchResult,
} from '../lib/api'

interface KnowledgeSearchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const DEBOUNCE_MS = 300
const RESULT_LIMIT = 100
const EXCERPT_LENGTH = 220

/** 去掉正文中的连续空白，便于生成紧凑摘要 */
function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function searchTerms(query: string): string[] {
  const full = query.trim()
  const tokens = full.split(/\s+/).filter(Boolean)
  return [...new Set([full, ...tokens])]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
}

/** 截取首次命中位置附近的正文，纯向量命中没有字面关键词时取开头 */
function extractExcerpt(content: string, query: string): string {
  const text = normalizeText(content)
  if (text.length <= EXCERPT_LENGTH) return text

  const lower = text.toLocaleLowerCase()
  let hit = -1
  for (const term of searchTerms(query)) {
    const index = lower.indexOf(term.toLocaleLowerCase())
    if (index >= 0 && (hit < 0 || index < hit)) hit = index
  }

  let start = hit < 0 ? 0 : Math.max(0, hit - 70)
  if (start > 0) {
    const space = text.indexOf(' ', start)
    if (space >= 0 && space < start + 20) start = space + 1
  }

  let end = Math.min(text.length, start + EXCERPT_LENGTH)
  if (end < text.length) {
    const space = text.lastIndexOf(' ', end)
    if (space > start + EXCERPT_LENGTH * 0.6) end = space
  }

  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${
    end < text.length ? '…' : ''
  }`
}

/** 高亮摘要中的关键词；使用分段渲染，避免注入 HTML */
function HighlightedText({ text, query }: { text: string; query: string }) {
  const terms = searchTerms(query)
  if (terms.length === 0) return <>{text}</>

  const pattern = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi')
  const parts = text.split(pattern)
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <mark
            key={`${part}:${index}`}
            className="rounded-2xs bg-warning-soft px-0.5 text-foreground-intense"
          >
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  )
}

function ResultItem({
  result,
  query,
  onSelect,
}: {
  result: KnowledgeSearchResult
  query: string
  onSelect: (result: KnowledgeSearchResult) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(result)}
      className="flex w-full flex-col gap-1 rounded-[var(--radius-md)] px-3 py-2.5 text-left outline-none transition-colors hover:bg-background-muted focus-visible:bg-background-muted focus-visible:ring-2 focus-visible:ring-ring-primary"
    >
      <span className="truncate text-sm font-medium text-foreground-intense">
        {result.title}
      </span>
      <span className="line-clamp-2 text-xs leading-5 text-foreground-muted">
        <HighlightedText
          text={extractExcerpt(result.content, query)}
          query={query}
        />
      </span>
    </button>
  )
}

export function KnowledgeSearchDialog({
  open,
  onOpenChange,
}: KnowledgeSearchDialogProps) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<KnowledgeSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestIdRef = useRef(0)

  useEffect(() => {
    if (!open) return
    const keyword = query.trim()
    if (!keyword) return

    const requestId = ++requestIdRef.current
    const timer = window.setTimeout(() => {
      api
        .searchKnowledge({ q: keyword, page: 1, pageSize: RESULT_LIMIT })
        .then((data) => {
          if (requestId !== requestIdRef.current) return
          setResults(data.results)
          setSearched(true)
        })
        .catch((e: Error) => {
          if (requestId !== requestIdRef.current) return
          setResults([])
          setSearched(true)
          setError(e.message)
        })
        .finally(() => {
          if (requestId === requestIdRef.current) setLoading(false)
        })
    }, DEBOUNCE_MS)

    return () => window.clearTimeout(timer)
  }, [open, query])

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      requestIdRef.current += 1
      setQuery('')
      setResults([])
      setLoading(false)
      setSearched(false)
      setError(null)
    }
    onOpenChange(nextOpen)
  }

  const handleQueryChange = (value: string) => {
    requestIdRef.current += 1
    setQuery(value)
    setResults([])
    setLoading(Boolean(value.trim()))
    setSearched(false)
    setError(null)
  }

  const selectResult = (result: KnowledgeSearchResult) => {
    handleOpenChange(false)
    navigate(knowledgeWebPath(result.path, false))
  }

  const keyword = query.trim()
  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        closeButton={false}
        frame={false}
        className="w-full max-w-2xl gap-0 overflow-hidden p-4 [&_[data-slot=dialog-content]]:pt-0 [&_[data-slot=dialog-content]]:pb-0"
      >
        <DialogTitle className="sr-only">知识搜索</DialogTitle>

        {/* 第一栏：搜索输入 */}
        <div className="shrink-0 border-b border-border-strong pb-3">
          <Input
            autoFocus
            value={query}
            onChange={(event) => handleQueryChange(event.target.value)}
            placeholder="搜索知识文章…"
            aria-label="搜索知识文章"
            startSlot={
              <Search size={16} className="text-foreground-muted" />
            }
            endSlot={
              loading ? (
                <Loader
                  variant="dots"
                  currentColor
                  className="text-sm text-foreground-muted"
                  aria-label="搜索中"
                />
              ) : null
            }
          />
        </div>

        {/* 第二栏：搜索结果 */}
        <div className="min-h-24 max-h-[min(60vh,32rem)] overflow-y-auto py-2">
          {error ? (
            <p className="px-3 py-6 text-center text-sm text-error-foreground">
              搜索失败：{error}
            </p>
          ) : results.length > 0 ? (
            <div className="flex flex-col">
              {results.map((result, index) => (
                <ResultItem
                  key={`${result.nodeId}:${result.headingPath}:${index}`}
                  result={result}
                  query={keyword}
                  onSelect={selectResult}
                />
              ))}
            </div>
          ) : loading ? (
            <p className="px-3 py-6 text-center text-sm text-foreground-muted">
              正在搜索…
            </p>
          ) : searched && keyword ? (
            <p className="px-3 py-6 text-center text-sm text-foreground-muted">
              未找到与“{keyword}”相关的知识
            </p>
          ) : (
            <p className="px-3 py-6 text-center text-sm text-foreground-muted">
              输入关键词，搜索知识库文章
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
