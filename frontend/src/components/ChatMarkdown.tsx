import {
  isValidElement,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { MermaidDiagram } from './MermaidDiagram'

const MARKDOWN_PLUGINS = [remarkGfm]

/** 链接默认新窗口打开（外部页面不应覆盖当前会话） */
function MarkdownLink({
  node: _node,
  ...props
}: ComponentPropsWithoutRef<'a'> & { node?: unknown }) {
  return <a {...props} target="_blank" rel="noopener noreferrer" />
}

/** mermaid 围栏代码块交给 MermaidDiagram 渲染为 SVG */
function MarkdownCode({
  node: _node,
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<'code'> & { node?: unknown }) {
  if (/language-mermaid/.test(className ?? '')) {
    return (
      <MermaidDiagram code={String(children).replace(/\n$/, '')} />
    )
  }
  return (
    <code className={className} {...props}>
      {children}
    </code>
  )
}

/** mermaid 代码块外层的 pre 不参与渲染，避免在 pre 内嵌 SVG 容器 */
function MarkdownPre({
  node: _node,
  children,
  ...props
}: ComponentPropsWithoutRef<'pre'> & { node?: unknown }) {
  const first = Array.isArray(children) ? children[0] : children
  if (
    isValidElement<{ className?: string }>(first) &&
    /language-mermaid/.test(first.props.className ?? '')
  ) {
    return <>{children as ReactNode}</>
  }
  return <pre {...props}>{children}</pre>
}

const MARKDOWN_COMPONENTS = {
  a: MarkdownLink,
  code: MarkdownCode,
  pre: MarkdownPre,
}

/** 聊天消息 Markdown 渲染（沿用任务详情页 `.task-chat-markdown` 排版） */
export function ChatMarkdown({ text }: { text: string }) {
  if (!text.trim()) return null
  return (
    <div className="task-chat-markdown">
      <ReactMarkdown
        remarkPlugins={MARKDOWN_PLUGINS}
        components={MARKDOWN_COMPONENTS}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
