import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Badge } from '@appica/ui-react/badge'
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@appica/ui-react/dialog'
import { Input } from '@appica/ui-react/input'
import { Loader } from '@appica/ui-react/loader'
import { Search } from '@appica/icons-react'
import { api, knowledgeWebPath, type ScriptLibraryScript } from '../lib/api'

interface KnowledgeSearchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const DEBOUNCE_MS = 300
const KNOWLEDGE_RESULT_LIMIT = 100
const SCRIPT_RESULT_LIMIT = 50
const EXCERPT_LENGTH = 220

type SearchCategory = '文档' | '脚本'

interface SearchResultItem {
  key: string
  category: SearchCategory
  title: string
  summary: string
  /** 统一相关度（0..1），用于文档与脚本整体排序 */
  relevance: number
  /** 点击后进入的前端地址 */
  to: string
}

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

function failureText(label: string, reason: unknown): string {
  const message = reason instanceof Error ? reason.message : String(reason)
  return `${label}搜索失败：${message}`
}

function scriptResult(script: ScriptLibraryScript): SearchResultItem {
  return {
    key: `script:${script.path}`,
    category: '脚本',
    title: script.path,
    summary: script.description ?? '暂无描述',
    relevance: script.relevance ?? 0,
    to: `/docs/scripts/detail?path=${encodeURIComponent(script.path)}`,
  }
}

function ResultItem({
  result,
  query,
  onSelect,
}: {
  result: SearchResultItem
  query: string
  onSelect: (result: SearchResultItem) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(result)}
      className="flex w-full flex-col gap-1 rounded-[var(--radius-md)] px-3 py-2.5 text-left outline-none transition-colors hover:bg-background-muted focus-visible:bg-background-muted focus-visible:ring-2 focus-visible:ring-ring-primary"
    >
      <span className="flex w-full min-w-0 items-center justify-between gap-3">
        <span className="truncate text-sm font-medium text-foreground-intense">
          {result.title}
        </span>
        <Badge variant="secondary" className="shrink-0">
          {result.category}
        </Badge>
      </span>
      <span className="line-clamp-2 text-xs leading-5 text-foreground-muted">
        <HighlightedText
          text={extractExcerpt(result.summary, query)}
          query={query}
        />
      </span>
    </button>
  )
}

/** 全局搜索：同时检索知识文档正文与脚本路径/描述，结果以类型区分 */
export function KnowledgeSearchDialog({
  open,
  onOpenChange,
}: KnowledgeSearchDialogProps) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResultItem[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const requestIdRef = useRef(0)

  useEffect(() => {
    if (!open) return
    const keyword = query.trim()
    if (!keyword) return

    const requestId = ++requestIdRef.current
    const timer = window.setTimeout(() => {
      Promise.allSettled([
        api.searchKnowledge({
          q: keyword,
          page: 1,
          pageSize: KNOWLEDGE_RESULT_LIMIT,
        }),
        api.listLibraryScripts({
          q: keyword,
          page: 1,
          pageSize: SCRIPT_RESULT_LIMIT,
        }),
      ])
        .then(([knowledgeOutcome, scriptOutcome]) => {
          if (requestId !== requestIdRef.current) return

          const documents: SearchResultItem[] =
            knowledgeOutcome.status === 'fulfilled'
              ? knowledgeOutcome.value.results.map((result, index) => ({
                  key: `document:${result.nodeId}:${result.headingPath}:${index}`,
                  category: '文档',
                  title: result.title,
                  summary: result.content,
                  relevance: result.relevance,
                  to: knowledgeWebPath(result.path, false),
                }))
              : []
          const scripts: SearchResultItem[] =
            scriptOutcome.status === 'fulfilled'
              ? scriptOutcome.value.items.map(scriptResult)
              : []

          setResults(
            [...documents, ...scripts].sort(
              (a, b) =>
                b.relevance - a.relevance ||
                a.title.localeCompare(b.title, 'zh-CN') ||
                a.key.localeCompare(b.key),
            ),
          )
          setSearched(true)

          const failures: string[] = []
          if (knowledgeOutcome.status === 'rejected') {
            failures.push(failureText('文档', knowledgeOutcome.reason))
          }
          if (scriptOutcome.status === 'rejected') {
            failures.push(failureText('脚本', scriptOutcome.reason))
          }
          setError(failures.length === 2 ? failures.join('；') : null)
          setWarning(failures.length === 1 ? failures[0] : null)
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
      setWarning(null)
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
    setWarning(null)
  }

  const selectResult = (result: SearchResultItem) => {
    handleOpenChange(false)
    navigate(result.to)
  }

  const keyword = query.trim()
  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        closeButton={false}
        className="w-full max-w-2xl gap-0 overflow-hidden [&_[data-slot=dialog-content]]:pt-0 [&_[data-slot=dialog-content]]:pb-0"
      >
        <DialogTitle className="sr-only">搜索文档和脚本</DialogTitle>

        {/* 第一栏：搜索输入 */}
        <div className="shrink-0 p-3">
          <Input
            autoFocus
            variant="soft"
            inputSize="lg"
            value={query}
            onChange={(event) => handleQueryChange(event.target.value)}
            placeholder="搜索文档或脚本…"
            aria-label="搜索文档或脚本"
            className="rounded-[var(--radius-lg)] border-transparent hover:border-transparent has-focus:border-transparent has-focus:bg-background-muted has-focus:ring-0"
            startSlot={
              <Search size={18} className="text-foreground-muted" />
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
        <div className="min-h-24 max-h-[min(60vh,32rem)] overflow-y-auto border-t border-border-muted px-2 py-2">
          {warning && (
            <p className="mx-1 mb-2 rounded-[var(--radius-sm)] bg-warning-soft px-3 py-2 text-xs text-foreground-intense">
              {warning}
            </p>
          )}
          {error ? (
            <p className="px-3 py-6 text-center text-sm text-error-foreground">
              搜索失败：{error}
            </p>
          ) : results.length > 0 ? (
            <div className="flex flex-col">
              {results.map((result) => (
                <ResultItem
                  key={result.key}
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
              未找到与“{keyword}”相关的文档或脚本
            </p>
          ) : (
            <p className="px-3 py-6 text-center text-sm text-foreground-muted">
              输入关键词，搜索文档内容或脚本描述
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
