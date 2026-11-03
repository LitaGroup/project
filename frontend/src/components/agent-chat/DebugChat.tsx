import {
  useCallback,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useExternalStoreRuntime,
  type AppendMessage,
  type MessageState,
  type ThreadMessageLike,
} from '@assistant-ui/react'
import type {
  FileMessagePart,
  FileMessagePartProps,
  ReasoningMessagePart,
  TextMessagePart,
  ToolCallMessagePart,
} from '@assistant-ui/react'
import { Button } from '@appica/ui-react/button'
import {
  ArrowUp,
  MessageCircleQuestion,
  Paperclip,
  Plus,
} from '@appica/icons-react'
import type {
  WorkerDebugAttachment,
  WorkerDebugMessage,
  WorkerDebugMode,
  WorkerDebugModelCatalog,
  WorkerDebugModelSelection,
  WorkerDebugOption,
  WorkerDebugQuestion,
  WorkerDebugSnapshot,
} from '../../lib/api'
import { QuestionCard } from '../QuestionCard'
import { questionStatusLabel } from '../../lib/question'
import { RobotAvatar } from '../task-detail/WorkerAvatar'
import {
  ChatActionIcon,
  ChatAttachmentChips,
  ChatComposerDock,
  ChatComposerFrame,
} from './ChatComposer'
import {
  ChatAssistantParts,
  CHAT_MARKDOWN_PARTS_ON_PRIMARY,
  toChatToolPart,
} from './ChatParts'
import { ModelSettingsPicker } from './ModelSettingsPicker'

interface DebugChatProps {
  snapshot: WorkerDebugSnapshot
  running: boolean
  onSend: (
    content: string,
    files?: WorkerDebugAttachment[],
  ) => Promise<void>
  onReplyQuestion: (
    questionId: string,
    answers: string[][] | null,
  ) => Promise<void>
  emptyTitle?: string
  emptyHint?: string
  placeholder?: string
  /** 是否渲染外框（工作台内嵌时传 false，避免双层边框） */
  framed?: boolean
  /** 是否显示「+」文件上传（我的 AGENT） */
  enableAttachments?: boolean
  /** 上传文件并返回公开地址 */
  onUploadFile?: (file: File) => Promise<WorkerDebugAttachment>
  /** 可切换的模型/思考等级清单 */
  modelCatalog?: WorkerDebugModelCatalog | null
  /** 当前选择的模型/思考等级 */
  modelSelection?: WorkerDebugModelSelection | null
  /** 切换模型/思考等级 */
  onModelChange?: (input: WorkerDebugModelSelection) => Promise<void> | void
  /** 模型切换请求进行中 */
  modelBusy?: boolean
  /** 主 Agent 模式（我的 AGENT：build / plan） */
  mode?: WorkerDebugMode | null
  /** 切换主 Agent 模式 */
  onModeChange?: (mode: WorkerDebugMode) => Promise<void> | void
  /** 模式切换请求进行中 */
  modeBusy?: boolean
}

/**
 * 与机器人（个人 AGENT / 调试机器人）的对话主体：
 * assistant-ui 多轮消息 + 思考/工具链 + 提问卡片 + 输入框。
 * 数据由调用方通过快照与 SSE 驱动，本组件不负责拉取。
 */
export function DebugChat({
  snapshot,
  running,
  onSend,
  onReplyQuestion,
  emptyTitle = '发送第一条消息开始对话',
  emptyHint = '首条消息沿用工作目录中的 AGENTS.md 与技能，后续消息使用当前会话',
  placeholder,
  framed = true,
  enableAttachments = false,
  onUploadFile,
  modelCatalog = null,
  modelSelection = null,
  onModelChange,
  modelBusy = false,
  mode = null,
  onModeChange,
  modeBusy = false,
}: DebugChatProps) {
  const [attachments, setAttachments] = useState<WorkerDebugAttachment[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const attachmentsRef = useRef<WorkerDebugAttachment[]>([])

  const updateAttachments = useCallback(
    (next: WorkerDebugAttachment[]) => {
      attachmentsRef.current = next
      setAttachments(next)
    },
    [],
  )

  const onNew = useCallback(
    async (message: AppendMessage) => {
      const text = message.content
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('\n')
        .trim()
      const files = attachmentsRef.current
      if (!text && files.length === 0) return
      await onSend(text, files.length > 0 ? files : undefined)
      updateAttachments([])
    },
    [onSend, updateAttachments],
  )
  const runtime = useExternalStoreRuntime<WorkerDebugMessage>({
    messages: snapshot.messages,
    convertMessage: toThreadMessage,
    onNew,
    isSendDisabled: running,
  })

  const handleFiles = async (list: FileList | null) => {
    if (!list?.length || !onUploadFile) return
    setUploading(true)
    setUploadError(null)
    try {
      const uploaded = await Promise.all(
        Array.from(list)
          .slice(0, 10)
          .map((file) => onUploadFile(file)),
      )
      updateAttachments([...attachmentsRef.current, ...uploaded].slice(0, 10))
    } catch (error) {
      setUploadError((error as Error).message)
    } finally {
      setUploading(false)
    }
  }

  const currentModel = modelSelection ?? modelCatalog?.current ?? null

  // Tab 在输入框内切换 Build / Plan（仅配置了模式的「我的 AI」生效）
  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key !== 'Tab') return
      if (
        event.shiftKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.nativeEvent.isComposing
      ) {
        return
      }
      if (!mode || !onModeChange || running || modeBusy) return
      event.preventDefault()
      void onModeChange(mode === 'build' ? 'plan' : 'build')
    },
    [mode, modeBusy, onModeChange, running],
  )

  return (
    <section
      className={
        framed
          ? 'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[var(--radius-lg)] border border-border bg-background'
          : 'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background'
      }
    >
      <AssistantRuntimeProvider runtime={runtime}>
        <ThreadPrimitive.Root className="flex min-h-0 flex-1 flex-col">
          <ThreadPrimitive.Viewport className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-5">
            {snapshot.messages.length === 0 && (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-sm text-foreground-muted">
                <RobotAvatar
                  name={snapshot.worker.name}
                  avatarUrl={snapshot.worker.avatarUrl}
                  size={48}
                />
                <p>{emptyTitle}</p>
                <p className="text-xs">{emptyHint}</p>
              </div>
            )}
            <ThreadPrimitive.Messages>
              {({ message }) => {
                const question = customOf(message).question
                if (question) {
                  return (
                    <DebugQuestionBubble
                      question={question}
                      worker={snapshot.worker}
                      onReply={onReplyQuestion}
                    />
                  )
                }
                return message.role === 'user' ? (
                  <UserMessage />
                ) : (
                  <AssistantMessage
                    running={message.status?.type === 'running'}
                    worker={snapshot.worker}
                  />
                )
              }}
            </ThreadPrimitive.Messages>
          </ThreadPrimitive.Viewport>
          <ChatComposerDock>
            {/* assistant-ui 的 Enter 发送依赖最近的 form，缺少 Root 时只能点击发送 */}
            <ComposerPrimitive.Root>
              <ChatComposerFrame
                singleLine
                top={
                  <ChatAttachmentChips
                    files={attachments}
                    onRemove={(index) =>
                      updateAttachments(
                        attachmentsRef.current.filter((_, item) => item !== index),
                      )
                    }
                  />
                }
                left={
                  enableAttachments && onUploadFile ? (
                    <>
                      <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        className="hidden"
                        onChange={(event) => {
                          void handleFiles(event.target.files)
                          event.target.value = ''
                        }}
                      />
                      <ChatActionIcon
                        label={uploading ? '正在上传文件' : '上传文件'}
                        icon={Plus}
                        busy={uploading}
                        disabled={running}
                        onClick={() => fileInputRef.current?.click()}
                      />
                    </>
                  ) : null
                }
                right={
                  <>
                    {mode && onModeChange && (
                      <div
                        className="flex shrink-0 items-center rounded-[var(--radius-md)] border border-border p-0.5 text-[11px]"
                        role="group"
                        aria-label="主 Agent 模式"
                      >
                        {(
                          [
                            ['build', 'Build', '可读取、修改文件并执行命令'],
                            ['plan', 'Plan', '只分析与规划，不修改文件'],
                          ] as Array<[WorkerDebugMode, string, string]>
                        ).map(([value, label, hint]) => (
                          <button
                            key={value}
                            type="button"
                            title={`${hint}（Tab 切换）`}
                            aria-pressed={mode === value}
                            disabled={running || modeBusy}
                            onClick={() => {
                              if (mode !== value) void onModeChange(value)
                            }}
                            className={`rounded-[var(--radius-sm)] px-2 py-0.5 transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                              mode === value
                                ? 'bg-background-muted font-medium text-foreground-intense'
                                : 'text-foreground-muted hover:text-foreground-intense'
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    )}
                    {currentModel && onModelChange && (
                      <ModelSettingsPicker
                        catalog={modelCatalog}
                        current={currentModel}
                        onChange={onModelChange}
                        busy={modelBusy}
                        disabled={running}
                        // 面板窄时优先压缩模型名（截断展示），保证整行按钮不换行
                        triggerClassName="min-w-0 max-w-[240px] flex-[0_1_auto] overflow-hidden"
                      />
                    )}
                    <ComposerPrimitive.Send asChild>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="primary"
                        className="shrink-0 rounded-full"
                        aria-label="发送消息"
                        disabled={running}
                      >
                        <ArrowUp className="size-4" />
                      </Button>
                    </ComposerPrimitive.Send>
                  </>
                }
              >
                <ComposerPrimitive.Input
                  rows={2}
                  submitMode="enter"
                  onKeyDown={handleKeyDown}
                  placeholder={
                    placeholder ??
                    (running
                      ? 'AGENT 正在回复…'
                      : '输入消息，Enter 发送，Shift+Enter 换行…')
                  }
                  className="max-h-40 min-h-10 w-full flex-1 resize-none bg-transparent px-3 py-2 text-sm outline-none placeholder:text-foreground-muted"
                />
              </ChatComposerFrame>
              {uploadError && (
                <p className="mt-2 text-[11px] text-error-foreground">
                  附件上传失败：{uploadError}
                </p>
              )}
            </ComposerPrimitive.Root>
          </ChatComposerDock>
        </ThreadPrimitive.Root>
      </AssistantRuntimeProvider>
    </section>
  )
}

/** 对话消息 metadata.custom：提问卡片 */
interface ChatCustom {
  question?: WorkerDebugQuestion
}

function customOf(message: MessageState): ChatCustom {
  return (message.metadata.custom ?? {}) as ChatCustom
}

function toThreadMessage(message: WorkerDebugMessage): ThreadMessageLike {
  const status =
    message.role === 'assistant'
      ? message.status === 'running'
        ? ({ type: 'running' } as const)
        : message.status === 'error'
          ? ({ type: 'incomplete', reason: 'error' } as const)
          : ({ type: 'complete', reason: 'stop' } as const)
      : undefined
  const parts: Array<
    | ReasoningMessagePart
    | TextMessagePart
    | ToolCallMessagePart
    | FileMessagePart
  > = []
  for (const file of message.files ?? []) {
    parts.push({
      type: 'file',
      data: file.url,
      filename: file.name,
      mimeType: file.mime || 'application/octet-stream',
      sourceType: 'url',
    })
  }
  if (message.reasoning?.trim()) {
    parts.push({
      type: 'reasoning',
      text: message.reasoning,
      ...(message.status === 'running'
        ? { status: { type: 'running' } as const }
        : {}),
    })
  }
  for (const tool of message.tools ?? []) {
    if (tool.name === 'question') continue
    parts.push(toChatToolPart(tool))
  }
  if (message.content) {
    parts.push({ type: 'text', text: message.content })
  }
  return {
    id: message.id,
    role: message.role,
    content: parts,
    createdAt: new Date(message.createdAt),
    status,
    metadata: {
      custom: {
        question: message.question,
      } satisfies ChatCustom,
    },
  }
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="flex justify-end px-1">
      <div className="min-w-0 max-w-[85%] rounded-[var(--radius-lg)] rounded-tr-sm bg-primary px-4 py-2.5 text-sm leading-relaxed text-primary-foreground shadow-sm">
        <MessagePrimitive.Parts components={USER_CHAT_PARTS} />
      </div>
    </MessagePrimitive.Root>
  )
}

/** 用户气泡内的附件链接（文件上传后随消息展示） */
function UserFilePart({ data, filename }: FileMessagePartProps) {
  return (
    <a
      href={data}
      target="_blank"
      rel="noreferrer"
      className="mr-1.5 mb-1.5 inline-flex max-w-full items-center gap-1 rounded-[var(--radius-sm)] bg-primary-foreground/15 px-2 py-1 text-[11px] text-primary-foreground no-underline hover:bg-primary-foreground/25"
    >
      <Paperclip className="size-3 shrink-0" />
      <span className="truncate">{filename || '附件'}</span>
    </a>
  )
}

const USER_CHAT_PARTS = {
  ...CHAT_MARKDOWN_PARTS_ON_PRIMARY,
  File: UserFilePart,
}

function AssistantMessage({
  running,
  worker,
}: {
  running: boolean
  worker: WorkerDebugOption
}) {
  return (
    <MessagePrimitive.Root className="flex gap-3 px-1">
      <RobotAvatar
        name={worker.name}
        avatarUrl={worker.avatarUrl}
        size={32}
        className="mt-1"
      />
      <div className="min-w-0 max-w-[88%] pt-1 text-sm leading-relaxed">
        <ChatAssistantParts />
        {running && (
          <span className="ml-1 inline-block h-3.5 w-1 animate-pulse rounded-full bg-foreground-muted align-middle" />
        )}
      </div>
    </MessagePrimitive.Root>
  )
}

/** 机器人提问卡片：多问题 + 选项 + 自由输入，提交后变成回执（本轮结束后不可再答） */
function DebugQuestionBubble({
  question,
  worker,
  onReply,
}: {
  question: WorkerDebugQuestion
  worker: WorkerDebugOption
  onReply: (questionId: string, answers: string[][] | null) => Promise<void>
}) {
  return (
    <MessagePrimitive.Root className="flex gap-3 px-1">
      <RobotAvatar
        name={worker.name}
        avatarUrl={worker.avatarUrl}
        size={32}
        className="mt-0.5"
      />
      <div className="min-w-0 max-w-[88%] pt-1 text-sm leading-relaxed">
        <div className="mb-1.5 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-foreground-muted">
            {worker.name}
          </span>
          <span className="inline-flex items-center gap-1 text-[11px] text-info-foreground">
            <MessageCircleQuestion className="size-3.5" />
            {questionStatusLabel(question, '等待回答')}
          </span>
        </div>
        <QuestionCard question={question} onReply={onReply} />
      </div>
    </MessagePrimitive.Root>
  )
}
