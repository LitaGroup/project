import { useState } from 'react'
import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown'
import remarkGfm from 'remark-gfm'
import { Brain, ChevronDown } from '@appica/icons-react'
import { MermaidDiagram } from '../MermaidDiagram'

const MARKDOWN_PLUGINS = [remarkGfm]
const MARKDOWN_COMPONENTS_BY_LANGUAGE = {
  mermaid: { SyntaxHighlighter: MermaidDiagram },
}

/** 机器人对话 Markdown（任务详情与机器人调试共用） */
export function ChatMarkdownText() {
  return (
    <MarkdownTextPrimitive
      className="task-chat-markdown"
      smooth={false}
      defer
      remarkPlugins={MARKDOWN_PLUGINS}
      componentsByLanguage={MARKDOWN_COMPONENTS_BY_LANGUAGE}
    />
  )
}

/** 文本分片：用户消息等不需要 Markdown 渲染的场景 */
export function ChatPlainText({ text }: { text?: string }) {
  // wrap-anywhere（overflow-wrap: anywhere）：长 URL / 连续英文也能断行，
  // 且会参与 min-content 计算，避免把气泡撑出容器
  return <span className="wrap-anywhere whitespace-pre-wrap">{text}</span>
}

/** 思考过程：流式时默认展开，结束后折叠，可点击回看 */
export function ChatReasoning({
  text,
  status,
}: {
  text: string
  status?: { type?: string }
}) {
  const streaming = status?.type === 'running'
  const [userToggled, setUserToggled] = useState<boolean | null>(null)
  const open = userToggled ?? streaming
  if (!text.trim()) return null
  return (
    <div className="mb-3 overflow-hidden rounded-[var(--radius-md)] border border-border bg-background-muted">
      <button
        type="button"
        onClick={() => setUserToggled(!open)}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-xs text-foreground-muted transition-colors hover:text-foreground-intense"
      >
        {streaming ? (
          <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-primary" />
        ) : (
          <Brain className="size-3.5 shrink-0" />
        )}
        <span className="font-medium">
          {streaming ? '思考中…' : '思考过程'}
        </span>
        <ChevronDown
          className={`ml-auto size-3.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words border-t border-border px-3 py-2 text-xs leading-relaxed text-foreground-muted">
          {text}
        </div>
      )}
    </div>
  )
}

// oxlint-disable-next-line react/only-export-components
export const CHAT_MARKDOWN_PARTS = {
  Text: ChatMarkdownText,
  Reasoning: ChatReasoning,
  Empty: () => null,
}

// oxlint-disable-next-line react/only-export-components
export const CHAT_PLAIN_PARTS = {
  Text: ChatPlainText,
  Empty: () => null,
}
