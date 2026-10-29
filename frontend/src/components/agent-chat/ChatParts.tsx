import {
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from 'react'
import {
  MessagePrimitive,
  groupPartByType,
  type ToolCallMessagePart,
  type ToolCallMessagePartComponent,
} from '@assistant-ui/react'
import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown'
import remarkGfm from 'remark-gfm'
import {
  Brain,
  Check,
  ChevronDown,
  Loader,
  Wrench,
  X,
} from '@appica/icons-react'
import { MermaidDiagram } from '../MermaidDiagram'

const MARKDOWN_PLUGINS = [remarkGfm]
const MARKDOWN_COMPONENTS_BY_LANGUAGE = {
  mermaid: { SyntaxHighlighter: MermaidDiagram },
}

/** 连续工具调用折叠成一组，避免 shell 等调用刷屏 */
const CHAT_GROUP_BY = groupPartByType({
  'tool-call': ['group-tool'],
})

/** 链接默认新窗口打开（外部页面不应覆盖聊天会话） */
function ChatMarkdownLink({
  node: _node,
  ...props
}: ComponentPropsWithoutRef<'a'> & { node?: unknown }) {
  return <a {...props} target="_blank" rel="noopener noreferrer" />
}

const MARKDOWN_COMPONENTS = { a: ChatMarkdownLink }

/** 机器人对话 Markdown（任务详情与机器人调试共用） */
export function ChatMarkdownText() {
  return (
    <MarkdownTextPrimitive
      className="task-chat-markdown"
      smooth={false}
      defer
      remarkPlugins={MARKDOWN_PLUGINS}
      components={MARKDOWN_COMPONENTS}
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

/** 思考过程：流式时默认展开并实时滚到底部，结束后折叠，可点击回看 */
export function ChatReasoning({
  text,
  status,
}: {
  text: string
  status?: { type?: string }
}) {
  const streaming = status?.type === 'running'
  const [userToggled, setUserToggled] = useState<boolean | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const open = userToggled ?? streaming

  // 思考增量持续追加时跟随最新内容；用户手动收起后不再强制滚动
  useEffect(() => {
    if (!open || !streaming) return
    const element = contentRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [text, open, streaming])

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
        <div
          ref={contentRef}
          className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words border-t border-border px-3 py-2 text-xs leading-relaxed text-foreground-muted"
        >
          {text}
        </div>
      )}
    </div>
  )
}

function toolText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string') return value.trim() || undefined
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

/** 从参数 JSON 提取一行摘要（shell 命令 / 文件路径 / 搜索词等） */
function toolSummary(argsText?: string): string | undefined {
  if (!argsText?.trim()) return undefined
  let args: Record<string, unknown>
  try {
    const parsed = JSON.parse(argsText) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return undefined
    }
    args = parsed as Record<string, unknown>
  } catch {
    return undefined
  }
  const keys = [
    'command',
    'cmd',
    'description',
    'filePath',
    'file_path',
    'path',
    'pattern',
    'query',
  ]
  for (const key of keys) {
    const value = args[key]
    const text = Array.isArray(value)
      ? value.filter((item) => typeof item === 'string').join(' ')
      : toolText(value)
    if (!text) continue
    const line = text.replace(/\s+/g, ' ').trim()
    if (line) return line.length > 100 ? `${line.slice(0, 100)}…` : line
  }
  return undefined
}

/** 任务对话与调试对话共用的后端工具记录结构 */
export interface ChatToolData {
  id: string
  name: string
  status: 'running' | 'success' | 'error'
  argsText?: string
  result?: string
  detail?: string
}

/** 后端工具记录 → assistant-ui tool-call 分片（未结束的工具不设置 result） */
// oxlint-disable-next-line react/only-export-components
export function toChatToolPart(tool: ChatToolData): ToolCallMessagePart {
  const argsText = tool.argsText ?? ''
  let args: ToolCallMessagePart['args'] = {}
  try {
    const parsed = JSON.parse(argsText) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      args = parsed as ToolCallMessagePart['args']
    }
  } catch {
    // 非 JSON 参数仍通过 argsText 展示
  }
  const result =
    tool.status === 'running'
      ? undefined
      : tool.result ?? tool.detail ?? ''
  return {
    type: 'tool-call',
    toolCallId: tool.id,
    toolName: tool.name,
    args,
    argsText,
    ...(result !== undefined ? { result } : {}),
    ...(tool.status === 'error' ? { isError: true } : {}),
  }
}

/** 单次工具调用：assistant-ui tool-call 默认折叠，展开查看参数与结果 */
export const ChatToolFallback: ToolCallMessagePartComponent = ({
  toolName,
  argsText,
  result,
  status,
  isError,
}) => {
  const [open, setOpen] = useState(false)
  const running = status.type === 'running'
  const failed =
    isError ||
    status.type === 'incomplete' ||
    (status.type === 'requires-action' && status.reason !== 'tool-calls')
  const summary = toolSummary(argsText)
  const resultText = toolText(result)
  const statusError =
    status.type === 'incomplete' && 'error' in status
      ? toolText(status.error)
      : undefined
  const hasDetail = Boolean(argsText?.trim() || resultText || statusError)

  return (
    <div className="mb-1.5 overflow-hidden rounded-[var(--radius-md)] border border-border bg-background-muted">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-foreground-muted transition-colors hover:text-foreground-intense"
      >
        {running ? (
          <Loader className="size-3.5 shrink-0 animate-spin text-info-foreground" />
        ) : failed ? (
          <X className="size-3.5 shrink-0 text-error-foreground" />
        ) : (
          <Check className="size-3.5 shrink-0 text-success-foreground" />
        )}
        <Wrench className="size-3.5 shrink-0" />
        <span className="shrink-0 font-mono font-medium text-foreground-intense">
          {toolName}
        </span>
        {summary && (
          <span className="min-w-0 flex-1 truncate font-mono text-foreground-muted">
            {summary}
          </span>
        )}
        <span className="ml-auto shrink-0">
          {running ? '运行中' : failed ? '失败' : '完成'}
        </span>
        <ChevronDown
          className={`size-3.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && hasDetail && (
        <div className="flex flex-col gap-2 border-t border-border px-3 py-2">
          {argsText?.trim() && (
            <div>
              <p className="mb-1 text-[11px] font-medium text-foreground-muted">
                参数
              </p>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-[var(--radius-sm)] bg-background-subtle p-2 font-mono text-[11px] leading-relaxed text-foreground-muted">
                {argsText}
              </pre>
            </div>
          )}
          {(resultText || statusError) && (
            <div>
              <p className="mb-1 text-[11px] font-medium text-foreground-muted">
                {failed ? '错误 / 输出' : '结果'}
              </p>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-[var(--radius-sm)] bg-background-subtle p-2 font-mono text-[11px] leading-relaxed text-foreground-muted">
                {resultText || statusError}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** 连续工具调用组：默认折叠，标题展示调用次数与运行状态 */
function ChatToolGroup({
  count,
  running,
  children,
}: {
  count: number
  running: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  // 只有一次调用时直接展示原生 tool 卡片，多次调用才折叠成组
  if (count <= 1) return <>{children}</>
  return (
    <div className="mb-2 overflow-hidden rounded-[var(--radius-md)] border border-border bg-background-muted">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-foreground-muted transition-colors hover:text-foreground-intense"
      >
        {running ? (
          <Loader className="size-3.5 shrink-0 animate-spin text-info-foreground" />
        ) : (
          <Wrench className="size-3.5 shrink-0" />
        )}
        <span className="font-medium">
          {running ? `正在调用 ${count} 个工具…` : `${count} 次工具调用`}
        </span>
        <ChevronDown
          className={`ml-auto size-3.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="border-t border-border px-2 pt-2">{children}</div>
      )}
    </div>
  )
}

/** 助手消息分片：思考 + 工具调用组 + Markdown 正文，两个聊天页面共用 */
export function ChatAssistantParts() {
  return (
    <MessagePrimitive.GroupedParts
      groupBy={CHAT_GROUP_BY}
      indicator="never"
    >
      {({ part, children }) => {
        switch (part.type) {
          case 'group-tool':
            return (
              <ChatToolGroup
                count={part.indices.length}
                running={part.status.type === 'running'}
              >
                {children}
              </ChatToolGroup>
            )
          case 'tool-call':
            return <ChatToolFallback {...part} />
          case 'reasoning':
            return <ChatReasoning text={part.text} status={part.status} />
          case 'text':
            return <ChatMarkdownText />
          case 'indicator':
            return null
          default:
            return null
        }
      }}
    </MessagePrimitive.GroupedParts>
  )
}

// oxlint-disable-next-line react/only-export-components
export const CHAT_PLAIN_PARTS = {
  Text: ChatPlainText,
  Empty: () => null,
}
