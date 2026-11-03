import { useCallback, useEffect, useRef, useState } from 'react'
import { Badge } from '@appica/ui-react/badge'
import { Button } from '@appica/ui-react/button'
import { Wrench } from '@appica/icons-react'
import {
  api,
  workbenchAgentStreamUrl,
  type AgentPageContext,
  type WorkbenchAgentInfo,
  type WorkerDebugAttachment,
  type WorkerDebugModelCatalog,
  type WorkerDebugModelSelection,
  type WorkerDebugSnapshot,
} from '../../lib/api'
import { visibleEventSource } from '../../lib/event-source'
import { DebugChat } from '../agent-chat/DebugChat'

interface DetailAgentPanelProps {
  /** 任务详情使用任务上下文 */
  taskId?: number | null
  /** 文档/脚本等详情页上下文（会话按 type + id 隔离） */
  context?: AgentPageContext | null
  emptyTitle?: string
  emptyHint?: string
  placeholder?: string
  /** 一轮 AI 回复结束后触发（工作台用于刷新任务列表） */
  onRunFinished?: () => void
  /** 嵌入其他面板时去掉外层边框与圆角 */
  embedded?: boolean
}

/**
 * 详情页右侧「我的 AI」。
 * 复用工作台个人 AGENT 的会话、模型与提问能力；
 * 任务、文档、脚本等每个详情对象使用独立会话，切换页面不会串上下文。
 */
export function DetailAgentPanel({
  taskId,
  context,
  emptyTitle,
  emptyHint,
  placeholder,
  onRunFinished,
  embedded = false,
}: DetailAgentPanelProps) {
  const [info, setInfo] = useState<WorkbenchAgentInfo | null>(null)
  const [infoError, setInfoError] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<WorkerDebugSnapshot | null>(null)
  const [catalog, setCatalog] = useState<WorkerDebugModelCatalog | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [modelBusy, setModelBusy] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const wasRunning = useRef(false)
  const onRunFinishedRef = useRef(onRunFinished)

  useEffect(() => {
    onRunFinishedRef.current = onRunFinished
  }, [onRunFinished])

  useEffect(() => {
    const running = snapshot?.status === 'running'
    if (wasRunning.current && !running) onRunFinishedRef.current?.()
    wasRunning.current = running
  }, [snapshot?.status])

  const contextKey = context
    ? `${context.type}:${context.id}`
    : taskId
      ? `task:${taskId}`
      : 'global'

  const loadInfo = useCallback(() => {
    setInfoError(null)
    api
      .getWorkbenchAgent()
      .then(setInfo)
      .catch((e: Error) => setInfoError(e.message))
  }, [])

  useEffect(loadInfo, [loadInfo])

  useEffect(() => {
    if (!info?.available || !info.worker) return
    let closed = false
    setSnapshot(null)
    setError(null)
    api
      .getWorkbenchAgentSnapshot(taskId, context)
      .then((data) => {
        if (!closed) setSnapshot(data)
      })
      .catch((e: Error) => {
        if (!closed) setError(e.message)
      })
    const source = visibleEventSource(workbenchAgentStreamUrl(taskId, context))
    source.onopen = () => {
      if (!closed) setError(null)
    }
    source.onmessage = (event: MessageEvent<string>) => {
      if (closed) return
      let payload: { type?: string; snapshot?: WorkerDebugSnapshot }
      try {
        payload = JSON.parse(event.data) as typeof payload
      } catch {
        return
      }
      if (payload.type === 'snapshot' && payload.snapshot) {
        setError(null)
        setSnapshot(payload.snapshot)
      }
    }
    source.onerror = () => {
      if (!closed) setError((current) => current ?? 'AI 实时连接断开，正在重连…')
    }
    return () => {
      closed = true
      source.close()
    }
    // context 对象按稳定 key 比较，避免父页面每次渲染重建对象导致重连
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info?.available, info?.worker?.id, contextKey, taskId, reloadKey])

  useEffect(() => {
    if (!info?.available) return
    let closed = false
    api
      .getWorkbenchAgentModels(taskId, context)
      .then((data) => {
        if (!closed) setCatalog(data)
      })
      .catch(() => {
        // 模型清单失败不阻塞对话，选择器保留快照中的当前模型
      })
    return () => {
      closed = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info?.available, contextKey, taskId])

  const send = useCallback(
    async (content: string, files?: WorkerDebugAttachment[]) => {
      setError(null)
      try {
        const next = await api.sendWorkbenchAgentMessage(
          content,
          taskId,
          files,
          context,
        )
        setSnapshot(next)
      } catch (e) {
        setError((e as Error).message)
        throw e
      }
    },
    [context, taskId],
  )

  const changeModel = useCallback(
    async (input: WorkerDebugModelSelection) => {
      setModelBusy(true)
      setError(null)
      try {
        const next = await api.setWorkbenchAgentModel(input, taskId, context)
        setSnapshot(next)
        setCatalog((current) =>
          current ? { ...current, current: next.model } : current,
        )
      } catch (e) {
        setError((e as Error).message)
      } finally {
        setModelBusy(false)
      }
    },
    [context, taskId],
  )

  const replyQuestion = useCallback(
    async (questionId: string, answers: string[][] | null) => {
      setError(null)
      try {
        setSnapshot(
          await api.replyWorkbenchAgentQuestion(
            questionId,
            answers,
            taskId,
            context,
          ),
        )
      } catch (e) {
        setError((e as Error).message)
        throw e
      }
    },
    [context, taskId],
  )

  const resetConversation = useCallback(async () => {
    setResetting(true)
    setError(null)
    try {
      setSnapshot(await api.resetWorkbenchAgent(taskId, context))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setResetting(false)
    }
  }, [context, taskId])

  const label = context
    ? context.type === 'document'
      ? '文档'
      : '脚本'
    : taskId
      ? '任务'
      : null

  return (
    <section
      className={`flex h-full min-h-0 flex-col overflow-hidden bg-background ${
        embedded
          ? ''
          : 'rounded-[var(--radius-lg)] border border-border'
      }`}
    >
      {/* 独立展示时右侧留出抽屉关闭按钮的位置，避免与「重置」重叠 */}
      <header
        className={`flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2 ${
          embedded ? 'pr-3' : 'pr-12'
        }`}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-sm font-medium text-foreground-intense">
            我的 AI
          </span>
          {label && (
            <Badge variant="soft" size="sm">
              {label}
            </Badge>
          )}
          {snapshot?.status === 'running' && (
            <span className="text-[11px] text-info-foreground">回复中…</span>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!snapshot || snapshot.status === 'running' || resetting}
          onClick={() => void resetConversation()}
        >
          {resetting ? '重置中…' : '重置'}
        </Button>
      </header>

      {error && (
        <p
          role="alert"
          className="shrink-0 border-b border-border px-3 py-1.5 text-[11px] text-error-foreground"
        >
          {error}
        </p>
      )}

      <div className="flex min-h-0 flex-1 flex-col">
        {!info && !infoError ? (
          <p className="flex flex-1 items-center justify-center text-sm text-foreground-muted">
            正在加载 AI 会话…
          </p>
        ) : infoError || !info?.available || !info.worker ? (
          <AgentUnavailable
            reason={
              infoError ??
              info?.reason ??
              '个人 AI 暂不可用，请稍后重试。'
            }
            onRetry={loadInfo}
          />
        ) : snapshot ? (
          <DebugChat
            snapshot={snapshot}
            running={snapshot.status === 'running'}
            onSend={send}
            onReplyQuestion={replyQuestion}
            framed={false}
            enableAttachments
            onUploadFile={async (file) => {
              const uploaded = await api.uploadFile(file)
              return {
                name: uploaded.filename,
                url: uploaded.url,
                size: uploaded.size,
                mime: uploaded.mime,
              }
            }}
            modelCatalog={catalog}
            modelSelection={snapshot.model}
            onModelChange={changeModel}
            modelBusy={modelBusy}
            emptyTitle={emptyTitle ?? '和你的 AI 开始对话'}
            emptyHint={
              emptyHint ??
              '当前页面使用独立会话；让 AI 读取当前内容、查资料或执行操作'
            }
            placeholder={
              snapshot.status === 'running'
                ? 'AI 正在回复…'
                : placeholder ??
                  '输入指令，Enter 发送，Shift+Enter 换行…'
            }
          />
        ) : error ? (
          <AgentUnavailable
            reason={error}
            onRetry={() => setReloadKey((value) => value + 1)}
          />
        ) : (
          <p className="flex flex-1 items-center justify-center text-sm text-foreground-muted">
            正在加载 AI 会话…
          </p>
        )}
      </div>
    </section>
  )
}

function AgentUnavailable({
  reason,
  onRetry,
}: {
  reason: string
  onRetry: () => void
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-5 text-center text-sm text-foreground-muted">
      <span className="rounded-full bg-background-muted p-3">
        <Wrench className="size-5" />
      </span>
      <p>我的 AI 暂不可用</p>
      <p className="max-w-md text-xs leading-relaxed text-foreground-subtle">
        {reason}
      </p>
      <Button size="sm" variant="outline" onClick={onRetry}>
        重试
      </Button>
    </div>
  )
}
