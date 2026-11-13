import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button } from '@appica/ui-react/button'
import { Badge } from '@appica/ui-react/badge'
import { Input } from '@appica/ui-react/input'
import { Loader, Refresh, Robot } from '@appica/icons-react'
import {
  api,
  workerChatStreamUrl,
  type WorkerChatSession,
  type WorkerDebugAttachment,
  type WorkerDebugOption,
  type WorkerDebugSnapshot,
} from '../lib/api'
import { visibleEventSource } from '../lib/event-source'
import { matchesPinyinSearch } from '../lib/pinyin-search'
import { RobotAvatar } from '../components/task-detail/WorkerAvatar'
import { DebugChat } from '../components/agent-chat/DebugChat'

/**
 * 顶部「机器人」：左侧会话 / 全部机器人，右侧统一聊天区。
 * 每个用户与每个机器人固定一个 chat 会话（与机器人调试、我的 AI 隔离），
 * 可重置；消息经 SSE 实时推送，支持附件上传与机器人提问。
 */
export function RobotChatPage() {
  const { workerId } = useParams<{ workerId?: string }>()
  const navigate = useNavigate()
  const selectedId = workerId ? Number(workerId) : null
  const valid = selectedId !== null && Number.isInteger(selectedId) && selectedId > 0

  const [workers, setWorkers] = useState<WorkerDebugOption[]>([])
  const [sessions, setSessions] = useState<WorkerChatSession[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const [snapshot, setSnapshot] = useState<WorkerDebugSnapshot | null>(null)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [resetting, setResetting] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const loadSeq = useRef(0)

  const loadOverview = useCallback(async () => {
    try {
      const [nextWorkers, nextSessions] = await Promise.all([
        api.listWorkerChatWorkers(),
        api.listWorkerChatSessions(),
      ])
      setWorkers(nextWorkers)
      setSessions(nextSessions)
      setListError(null)
      if (!workerId && nextSessions[0]) {
        navigate(`/robots/${nextSessions[0].worker.id}`, { replace: true })
      }
    } catch (error) {
      setListError((error as Error).message)
    } finally {
      setListLoading(false)
    }
  }, [navigate, workerId])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- 进入页面同步拉取会话与机器人清单
    void loadOverview()
  }, [loadOverview])

  useEffect(() => {
    if (!valid || selectedId === null) {
      // 切换/离开机器人时立即清空旧会话，避免展示串台；后续状态在异步回调中更新。
      // oxlint-disable-next-line react/set-state-in-effect
      setSnapshot(null)
      setSessionError(null)
      return
    }
    const seq = ++loadSeq.current
    // oxlint-disable-next-line react/set-state-in-effect
    setSnapshot(null)
    setSessionError(null)
    api
      .getWorkerChatSnapshot(selectedId)
      .then((data) => {
        if (seq === loadSeq.current) setSnapshot((current) => current ?? data)
      })
      .catch((error: Error) => {
        if (seq === loadSeq.current) setSessionError(error.message)
      })

    const source = visibleEventSource(workerChatStreamUrl(selectedId))
    source.onopen = () => {
      if (seq === loadSeq.current) {
        setSessionError((current) =>
          current === '实时连接断开，正在重连…' ? null : current,
        )
      }
    }
    source.onmessage = (event: MessageEvent<string>) => {
      if (seq !== loadSeq.current) return
      let payload: { type?: string; snapshot?: WorkerDebugSnapshot }
      try {
        payload = JSON.parse(event.data) as typeof payload
      } catch {
        return
      }
      if (payload.type === 'snapshot' && payload.snapshot) {
        setSessionError(null)
        setSnapshot(payload.snapshot)
      }
    }
    source.onerror = () => {
      if (seq === loadSeq.current) {
        setSessionError((current) => current ?? '实时连接断开，正在重连…')
      }
    }
    return () => {
      loadSeq.current += 1
      source.close()
    }
  }, [valid, selectedId, reloadKey])

  const selectedWorker = useMemo(() => {
    if (selectedId === null) return null
    return (
      workers.find((worker) => worker.id === selectedId) ??
      sessions.find((session) => session.worker.id === selectedId)?.worker ??
      snapshot?.worker ??
      null
    )
  }, [selectedId, sessions, snapshot?.worker, workers])

  const filteredWorkers = useMemo(
    () =>
      workers.filter((worker) =>
        matchesPinyinSearch(search, [worker.id, worker.name, worker.intro]),
      ),
    [search, workers],
  )

  const selectWorker = useCallback(
    (id: number) => {
      navigate(`/robots/${id}`)
    },
    [navigate],
  )

  const send = useCallback(
    async (content: string, files?: WorkerDebugAttachment[]) => {
      if (!valid || selectedId === null || snapshot?.status === 'running') return
      setSessionError(null)
      try {
        const next = await api.sendWorkerChatMessage(
          selectedId,
          content,
          files,
        )
        setSnapshot(next)
        // 首条消息后会话进入左侧列表；列表刷新不改变已选中的机器人
        void loadOverview()
      } catch (error) {
        setSessionError((error as Error).message)
        throw error
      }
    },
    [loadOverview, selectedId, snapshot?.status, valid],
  )

  const replyQuestion = useCallback(
    async (questionId: string, answers: string[][] | null) => {
      if (!valid || selectedId === null) return
      setSessionError(null)
      try {
        setSnapshot(
          await api.replyWorkerChatQuestion(selectedId, questionId, answers),
        )
      } catch (error) {
        setSessionError((error as Error).message)
        throw error
      }
    },
    [selectedId, valid],
  )

  const reset = useCallback(async () => {
    if (!valid || selectedId === null || snapshot?.status === 'running') return
    setResetting(true)
    setSessionError(null)
    try {
      setSnapshot(await api.resetWorkerChat(selectedId))
      void loadOverview()
    } catch (error) {
      setSessionError((error as Error).message)
    } finally {
      setResetting(false)
    }
  }, [loadOverview, selectedId, snapshot?.status, valid])

  /** 按钮与 ⌥R 快捷键共用的可用条件 */
  const canReset =
    !!snapshot &&
    snapshot.status !== 'running' &&
    snapshot.messages.length > 0 &&
    !resetting

  // ⌥/Alt+R：直接重置当前会话；用 code 兼容 macOS Option+R 的死键行为。
  useEffect(() => {
    if (!canReset) return
    const handleShortcut = (event: KeyboardEvent) => {
      if (
        event.repeat ||
        event.code !== 'KeyR' ||
        !event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      ) {
        return
      }
      event.preventDefault()
      void reset()
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [canReset, reset])

  return (
    <div className="flex h-full min-h-0">
      <aside className="w-[20%] shrink-0 overflow-y-auto bg-background p-3">
        <div className="flex items-center justify-between gap-2 px-1 py-2">
          <h1 className="text-lg font-semibold text-foreground-intense">机器人</h1>
          <Badge variant="soft" size="sm">
            {workers.length}
          </Badge>
        </div>

        {listError && (
          <p
            role="alert"
            className="mb-3 rounded-[var(--radius-md)] bg-error-soft px-2.5 py-2 text-xs text-error-foreground"
          >
            {listError}
          </p>
        )}

        <section className="mt-2">
          <div className="flex items-center justify-between px-1 py-1.5">
            <h2 className="text-sm font-medium text-foreground-intense">会话</h2>
            <span className="text-[11px] text-foreground-muted">
              {sessions.length}
            </span>
          </div>
          {listLoading && sessions.length === 0 ? (
            <p className="flex items-center gap-2 px-2 py-3 text-xs text-foreground-muted">
              <Loader className="size-3.5 animate-spin" />
              加载会话…
            </p>
          ) : sessions.length === 0 ? (
            <p className="px-2 py-3 text-xs leading-relaxed text-foreground-muted">
              暂无会话，从下方「所有」选择机器人开始对话
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {sessions.map((session) => (
                <li key={session.worker.id}>
                  <RobotChatItem
                    worker={session.worker}
                    selected={session.worker.id === selectedId}
                    meta={formatSessionTime(session.startedAt)}
                    onClick={() => selectWorker(session.worker.id)}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mt-5">
          <div className="flex items-center justify-between px-1 py-1.5">
            <h2 className="text-sm font-medium text-foreground-intense">所有</h2>
            <span className="text-[11px] text-foreground-muted">
              {filteredWorkers.length}
            </span>
          </div>
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onClear={() => setSearch('')}
            clearable
            placeholder="搜索名称、简介、ID 或拼音…"
            aria-label="搜索机器人"
          />
          {filteredWorkers.length === 0 ? (
            <p className="px-2 py-3 text-xs text-foreground-muted">
              {workers.length === 0 ? '暂无可对话的机器人' : '未找到匹配的机器人'}
            </p>
          ) : (
            <ul className="mt-1 flex flex-col gap-0.5">
              {filteredWorkers.map((worker) => (
                <li key={worker.id}>
                  <RobotChatItem
                    worker={worker}
                    selected={worker.id === selectedId}
                    meta={worker.executorName}
                    onClick={() => selectWorker(worker.id)}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>

      <main className="h-full min-w-0 flex-1 p-3">
        <div className="h-full min-h-0 rounded-[var(--radius-lg)] bg-background-muted p-3">
          {!valid ? (
            <EmptySelection />
          ) : (
            <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-[var(--radius-lg)] border border-border bg-background">
              <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-2.5">
                <div className="flex min-w-0 items-center gap-2.5">
                  {selectedWorker ? (
                    <RobotAvatar
                      name={selectedWorker.name}
                      avatarUrl={selectedWorker.avatarUrl}
                      size={30}
                    />
                  ) : (
                    <span className="flex size-[30px] items-center justify-center rounded-full bg-background-muted">
                      <Robot className="size-4" />
                    </span>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground-intense">
                      {selectedWorker?.name ?? '机器人'}
                    </p>
                    <p className="truncate text-xs text-foreground-muted">
                      {selectedWorker
                        ? `${selectedWorker.executorName} · ${selectedWorker.providerId}/${selectedWorker.modelId}${
                            snapshot?.sessionId
                              ? ` · 会话 ${snapshot.sessionId.slice(0, 8)}`
                              : ''
                          }`
                        : '正在加载会话…'}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {snapshot?.status === 'running' && (
                    <span className="text-xs text-foreground-muted">回复中…</span>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!canReset}
                    title="重置会话（⌥R）"
                    onClick={() => void reset()}
                  >
                    <Refresh className="size-3.5" />
                    {resetting ? '重置中…' : '重置会话'}
                    <kbd className="text-[10px] font-normal text-foreground-subtle">
                      ⌥R
                    </kbd>
                  </Button>
                </div>
              </header>

              {sessionError && (
                <p
                  role="alert"
                  className="shrink-0 border-b border-border px-4 py-1.5 text-xs text-error-foreground"
                >
                  {sessionError}
                </p>
              )}

              {snapshot ? (
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
                  emptyTitle={`和 ${snapshot.worker.name} 开始对话`}
                  emptyHint="发送第一条消息建立会话；之后可随时回来继续，也可以在右上角重置"
                  placeholder={
                    snapshot.status === 'running'
                      ? '机器人正在回复…'
                      : '输入消息，Enter 发送，Shift+Enter 换行…'
                  }
                />
              ) : sessionError ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
                  <p className="text-sm text-foreground-muted">
                    会话加载失败：{sessionError}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setReloadKey((value) => value + 1)}
                  >
                    重试
                  </Button>
                </div>
              ) : (
                <div className="flex flex-1 items-center justify-center gap-2 text-sm text-foreground-muted">
                  <Loader className="size-4 animate-spin" />
                  加载会话…
                </div>
              )}
            </section>
          )}
        </div>
      </main>
    </div>
  )
}

function RobotChatItem({
  worker,
  selected,
  meta,
  onClick,
}: {
  worker: WorkerDebugOption
  selected: boolean
  meta: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-current={selected ? 'page' : undefined}
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-[var(--radius-md)] px-2.5 py-2 text-left transition-colors ${
        selected
          ? 'bg-background-muted text-foreground-intense'
          : 'text-foreground-emphasis hover:bg-background-muted'
      }`}
    >
      <RobotAvatar name={worker.name} avatarUrl={worker.avatarUrl} size={28} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{worker.name}</span>
        <span className="mt-0.5 block truncate text-[11px] text-foreground-muted">
          {worker.intro || meta}
        </span>
      </span>
      <span className="shrink-0 text-[10px] text-foreground-subtle">{meta}</span>
    </button>
  )
}

function EmptySelection() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 rounded-[var(--radius-lg)] border border-border bg-background text-center">
      <span className="rounded-full bg-background-muted p-4">
        <Robot className="size-6 text-foreground-muted" />
      </span>
      <div>
        <p className="text-sm font-medium text-foreground-intense">
          选择机器人开始对话
        </p>
        <p className="mt-1 text-xs text-foreground-muted">
          左侧「会话」保留最近聊天，「所有」可搜索全部可对话机器人
        </p>
      </div>
    </div>
  )
}

/** 会话时间：当天只显示时分，跨天显示月日与时分 */
function formatSessionTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const now = new Date()
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  return date.toLocaleString('zh-CN', {
    ...(sameDay ? {} : { month: '2-digit', day: '2-digit' }),
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}
