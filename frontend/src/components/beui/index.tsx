// Adapted from beUI agent components; see frontend/THIRD_PARTY_NOTICES.md.
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, ChevronDown, ClipboardList } from '@appica/icons-react'
import type { TaskChatTool, WorkerDebugTodo } from '../../lib/api'
import { BorderGlow } from '../BorderGlow'
import './beui.css'

const todoLabels = { pending: '待处理', in_progress: '进行中', completed: '已完成', cancelled: '已取消' }

function TodoStatusIcon({ status }: { status: WorkerDebugTodo['status'] }) {
  return <motion.svg aria-hidden className="beui-todo-status-icon" data-status={status} viewBox="0 0 24 24" initial={false}>
    <motion.circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray={status === 'pending' ? '2 3' : undefined} animate={{ opacity: status === 'in_progress' ? 0.2 : 1 }} />
    <motion.circle className="beui-todo-spinner" cx="12" cy="12" r="9" pathLength="1" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="0.25 0.75" animate={{ opacity: status === 'in_progress' ? 1 : 0 }} transition={{ duration: 0.2 }} />
    <motion.path d="M7.5 12.25 10.5 15.25 16.75 8.75" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" animate={{ pathLength: status === 'completed' ? 1 : 0, opacity: status === 'completed' ? 1 : 0 }} transition={{ duration: 0.24 }} />
    <motion.path d="M8.5 8.5 15.5 15.5M15.5 8.5 8.5 15.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" animate={{ pathLength: status === 'cancelled' ? 1 : 0, opacity: status === 'cancelled' ? 1 : 0 }} transition={{ duration: 0.2 }} />
  </motion.svg>
}

export function AgentTodoList({ todos }: { todos: WorkerDebugTodo[] }) {
  const complete = todos.length > 0 && todos.every(todo => todo.status === 'completed')
  const [open, setOpen] = useState(!complete)
  const previousComplete = useRef(complete)
  const id = useId()
  useEffect(() => {
    if (previousComplete.current !== complete) setOpen(!complete)
    previousComplete.current = complete
  }, [complete])
  const occurrences = new Map<string, number>()
  return <section className="beui-todos beui-todo-list" aria-label="最近待办">
    <button className="beui-disclosure" type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
      {complete ? <Check className="size-4 beui-success" /> : <ClipboardList className="size-4" />}
      <span className="beui-disclosure-title">最近待办</span><span className="beui-count">{todos.filter(todo => todo.status === 'completed').length}/{todos.length}</span><ChevronDown className={`size-3.5 beui-chevron ${open ? 'is-open' : ''}`} />
    </button>
    <div id={id} className="beui-disclosure-grid" data-open={open} aria-hidden={!open} inert={!open}><div className="beui-disclosure-inner"><div className="beui-todo-viewport">{!todos.length && <p className="beui-empty">暂无待办</p>}<ol>{todos.map(todo => {
      const occurrence = occurrences.get(todo.content) ?? 0
      occurrences.set(todo.content, occurrence + 1)
      return <motion.li layout="position" key={`${todo.content}:${occurrence}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }} data-status={todo.status}>
        <TodoStatusIcon status={todo.status} /><span className="sr-only">{todoLabels[todo.status]}：</span><span className="beui-todo-text">{todo.content}</span>
      </motion.li>
    })}</ol></div></div></div>
  </section>
}

export function ReasoningActivity({ text, streaming }: { text: string; streaming: boolean }) {
  const [override, setOverride] = useState<boolean | null>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const followLatest = useRef(true)
  const autoScrollUntil = useRef(0)
  const open = override ?? streaming
  const id = useId()
  useLayoutEffect(() => {
    if (streaming && open && viewport.current && followLatest.current) {
      autoScrollUntil.current = performance.now() + 350
      viewport.current.scrollTo({ top: viewport.current.scrollHeight, behavior: 'smooth' })
    }
  }, [text, streaming, open])
  if (!text) return null
  return <section className="beui-activity beui-agent-activity" data-state={streaming ? 'working' : open ? 'open' : 'closed'}>
    <button className="beui-disclosure" type="button" aria-expanded={open} aria-controls={id} onClick={() => setOverride(!open)}><span className={streaming ? 'beui-thinking' : ''}>{streaming ? '思考中' : '思考过程'}</span><ChevronDown className={`size-3.5 beui-chevron ${open ? 'is-open' : ''}`} /></button>
    <div id={id} className="beui-disclosure-grid" data-open={open} aria-hidden={!open} inert={!open}><div className="beui-disclosure-inner"><div ref={viewport} className="beui-reasoning-text"
      onWheel={event => { autoScrollUntil.current = 0; if (event.deltaY < 0) followLatest.current = false }}
      onPointerDown={() => { autoScrollUntil.current = 0; followLatest.current = false }}
      onTouchMove={() => { autoScrollUntil.current = 0; followLatest.current = false }}
      onKeyDown={event => { autoScrollUntil.current = 0; if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) followLatest.current = false }}
      onScroll={() => { const node = viewport.current; if (node && performance.now() >= autoScrollUntil.current) followLatest.current = node.scrollHeight - node.scrollTop - node.clientHeight < 24 }}
      tabIndex={open ? 0 : -1}>{text}</div></div></div>
  </section>
}

export type ResponseSurfaceState = 'idle' | 'running' | 'attention' | 'complete' | 'error'
function stableSeed(value: string) { let hash = 0; for (let i = 0; i < value.length; i++) hash = (Math.imul(hash, 31) + value.charCodeAt(i)) >>> 0; return hash }
export function ResponseSurface({ state, seed, children, className = '' }: { state: ResponseSurfaceState; seed: string; children: ReactNode; className?: string }) {
  return <div className={`chat-response-surface ${className}`} data-state={state}>
    <BorderGlow animationSeed={stableSeed(seed)}><div className="beui-response-content">{children}</div></BorderGlow>
  </div>
}

function ToolRow({ tool }: { tool: TaskChatTool }) {
  return <details className="beui-tool" data-status={tool.status}><summary><span className="beui-tool-dot" aria-hidden /><span className="beui-tool-name">{tool.name}</span><span className="beui-tool-status">{tool.status === 'running' ? '执行中' : tool.status === 'success' ? '已完成' : '失败'}</span></summary>{tool.detail && <pre>{tool.detail}</pre>}</details>
}
export function ToolActivity({ tools }: { tools: TaskChatTool[] }) {
  if (!tools.length) return null
  const older = tools.slice(0, -3)
  return <section className="beui-tools" aria-label="工具活动">
    {older.length > 0 && <details className="beui-tool-history"><summary>此前工具记录 · {older.length}</summary>{older.map(tool => <ToolRow key={tool.id} tool={tool} />)}</details>}
    <AnimatePresence initial={false} mode="popLayout">{tools.slice(-3).map(tool => <motion.div layout="position" key={tool.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}><ToolRow tool={tool} /></motion.div>)}</AnimatePresence>
  </section>
}

export function StreamingResponse({ children, streaming = false }: { children: ReactNode; streaming?: boolean }) {
  return <div className="beui-streaming-response" data-state={streaming ? 'streaming' : 'complete'}>{children}</div>
}
