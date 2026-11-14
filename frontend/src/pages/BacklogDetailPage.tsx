import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { Badge } from '@appica/ui-react/badge'
import { Button, buttonVariants } from '@appica/ui-react/button'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@appica/ui-react/card'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@appica/ui-react/table'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@appica/ui-react/select'
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
  DialogClose,
} from '@appica/ui-react/dialog'
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverTitle,
  PopoverDescription,
} from '@appica/ui-react/popover'
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@appica/ui-react/tabs'
import { Input } from '@appica/ui-react/input'
import { Textarea } from '@appica/ui-react/textarea'
import {
  api,
  BACKLOG_MEMBER_ROLES,
  documentSourceLabel,
  type BacklogDetail,
  type BacklogDocumentSummary,
  type BacklogEvent,
  type BacklogMemberRole,
  type BacklogTaskSummary,
  type IterationSummary,
  type PlatformUser,
  type ProjectDocument,
} from '../lib/api'
import { PageBreadcrumb } from '../components/PageBreadcrumb'
import { BacklogStatusDialog } from '../components/BacklogStatusDialog'
import { CreateDocumentDialog, ImportDocumentDialog } from '../components/DocumentDialogs'
import { BacklogStatusBadge } from '../components/StatusBadge'
import {
  TaskStatusBadge,
  TicketStatusBadge,
} from '../components/StatusBadge'
import { DetailPageLayout } from '../components/detail/DetailPageLayout'
import { DetailAgentPanel } from '../components/detail/DetailAgentPanel'
import { TopicPanel } from '../components/topics/TopicPanel'
import { useAuth } from '../context/AuthContext'

const SUCCESS_STAY_MS = 2_000
const FAILURE_STAY_MS = 5_000

type ActionFeedback =
  | { kind: 'success'; message: string }
  | { kind: 'failure'; message: string }
  | null

const ROLE_ITEMS = Object.fromEntries(
  BACKLOG_MEMBER_ROLES.map((role) => [role, role]),
)

const EVENT_LABELS: Record<string, string> = {
  created: '创建',
  status: '状态流转',
  moved: '移动迭代',
  'release-ticket': '发起提测',
}

function formatTime(value: string | null): string {
  return value ? new Date(value).toLocaleString() : '—'
}

/** 预期上线时间展示到小时（北京时间年月日时） */
function formatHour(value: string | null): string {
  if (!value) return '—'
  const d = new Date(value)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:00`
}

/** 转为 datetime-local 输入值（本地时区，精确到小时） */
function toLocalHourInput(value: string | null): string {
  if (!value) return ''
  const d = new Date(value)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`
}

function eventSummary(event: BacklogEvent): string {
  const payload = (event.payload ?? {}) as {
    from?: string
    to?: string
    remark?: string
    migratedDocuments?: number
    toIterationCode?: string
    ticketCode?: string
  }
  const parts: string[] = []
  if (event.type === 'status' && payload.from && payload.to) {
    parts.push(`${payload.from} → ${payload.to}`)
  }
  if (event.type === 'moved' && payload.toIterationCode) {
    parts.push(`移至 ${payload.toIterationCode}`)
  }
  if (event.type === 'release-ticket' && payload.ticketCode) {
    parts.push(`工单 ${payload.ticketCode}`)
  }
  if (event.type === 'created' && payload.migratedDocuments !== undefined) {
    parts.push(
      payload.migratedDocuments > 0
        ? `迁入需求文档 ${payload.migratedDocuments} 篇`
        : '需求无文档',
    )
  }
  if (payload.remark) parts.push(payload.remark)
  return parts.join(' · ')
}

/** 内容分区：信息 / 文档 / 任务 / 事件 / 成员 */
type BacklogDetailTab = 'info' | 'docs' | 'tasks' | 'topics' | 'events' | 'members'

/**
 * 迭代项详情：基本信息（预期上线时间）、阶段时间、文档（转入时自需求迁入）、
 * 任务与工单面板（交付任务树 + 关联工单）、事件流与成员；
 * 成员或管理员可推进状态（弹窗 + 备注）、发起提测（创建提测工单），管理员可编辑成员/移动迭代。
 */
export function BacklogDetailPage() {
  const { backlogId } = useParams<{ backlogId: string }>()
  const id = Number(backlogId)
  const { user } = useAuth()
  const isAdmin = user?.role === '管理员'

  const [backlog, setBacklog] = useState<BacklogDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<ActionFeedback>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // AI 面板（右下角浮动入口 + ⌥A 快捷键 + 可收起）
  const [aiOpen, setAiOpen] = useState(false)
  const [aiUnread, setAiUnread] = useState(0)

  // 内容分区 tab
  const [tab, setTab] = useState<BacklogDetailTab>('info')

  // 属性编辑
  const [timeOpen, setTimeOpen] = useState(false)
  const [timeDraft, setTimeDraft] = useState('')
  const [savingTime, setSavingTime] = useState(false)

  // 文档
  const [docs, setDocs] = useState<BacklogDocumentSummary[] | null>(null)
  const [projectDocs, setProjectDocs] = useState<ProjectDocument[] | null>(null)
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkTarget, setLinkTarget] = useState<string | undefined>(undefined)
  const [linkSaving, setLinkSaving] = useState(false)

  // 事件流
  const [events, setEvents] = useState<BacklogEvent[] | null>(null)

  // 任务与工单
  const [related, setRelated] = useState<{
    tasks: BacklogTaskSummary[]
    tickets: Awaited<ReturnType<typeof api.listBacklogTasks>>['tickets']
  } | null>(null)

  // 提测
  const [releaseOpen, setReleaseOpen] = useState(false)
  const [releaseTitle, setReleaseTitle] = useState('')
  const [releaseSupplement, setReleaseSupplement] = useState('')
  const [releasing, setReleasing] = useState(false)

  // 成员编辑（管理员）
  const [users, setUsers] = useState<PlatformUser[] | null>(null)
  const [memberDrafts, setMemberDrafts] = useState<
    Array<{ role: BacklogMemberRole; userId: number }>
  >([])
  const [memberOpen, setMemberOpen] = useState(false)
  const [addRole, setAddRole] = useState<BacklogMemberRole>('产品')
  const [addUserId, setAddUserId] = useState<string | undefined>(undefined)
  const [savingMembers, setSavingMembers] = useState(false)

  // 移动迭代（管理员）
  const [iterations, setIterations] = useState<IterationSummary[] | null>(null)
  const [moveOpen, setMoveOpen] = useState(false)
  const [moveTarget, setMoveTarget] = useState<string | undefined>(undefined)
  const [moving, setMoving] = useState(false)

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }
  useEffect(() => clearTimer, [])

  const showFeedback = (
    next: NonNullable<ActionFeedback>,
    stayMs: number,
    after?: () => void,
  ) => {
    clearTimer()
    setFeedback(next)
    timerRef.current = setTimeout(() => {
      setFeedback(null)
      after?.()
    }, stayMs)
  }

  const loadSidepanels = useCallback((backlogId: number) => {
    api
      .listBacklogDocuments(backlogId)
      .then(setDocs)
      .catch(() => setDocs([]))
    api
      .listBacklogEvents(backlogId)
      .then(setEvents)
      .catch(() => setEvents([]))
    api
      .listBacklogTasks(backlogId)
      .then(setRelated)
      .catch(() => setRelated({ tasks: [], tickets: [] }))
  }, [])

  const load = useCallback(() => {
    if (!Number.isInteger(id) || id <= 0) return
    api
      .getBacklog(id)
      .then((row) => {
        setBacklog(row)
        setError(null)
        loadSidepanels(row.id)
      })
      .catch((e: Error) => setError(e.message))
  }, [id, loadSidepanels])

  useEffect(load, [load])

  // 任务树：按 parentId 计算缩进层级（放在早退分支前，保证 Hooks 顺序稳定）
  const taskDepthById = useMemo(() => {
    const depth = new Map<number, number>()
    const byId = new Map((related?.tasks ?? []).map((t) => [t.id, t]))
    const resolve = (task: BacklogTaskSummary, seen: Set<number>): number => {
      if (depth.has(task.id)) return depth.get(task.id)!
      if (!task.parentId || !byId.has(task.parentId) || seen.has(task.parentId)) {
        depth.set(task.id, 0)
        return 0
      }
      const parentDepth = resolve(byId.get(task.parentId)!, seen)
      depth.set(task.id, parentDepth + 1)
      return parentDepth + 1
    }
    for (const task of related?.tasks ?? []) resolve(task, new Set([task.id]))
    return depth
  }, [related])

  const userItems = useMemo(
    () => Object.fromEntries((users ?? []).map((u) => [String(u.id), u.name])),
    [users],
  )

  if (!Number.isInteger(id) || id <= 0) {
    return <Navigate to="/iterations" replace />
  }

  if (error && !backlog) {
    return (
      <div>
        <PageBreadcrumb items={[{ label: '迭代', to: '/iterations' }, { label: '迭代项' }]} />
        <p className="mt-4 text-sm">加载失败:{error}</p>
        <Link to="/iterations" className="mt-2 inline-block text-sm underline">
          返回迭代列表
        </Link>
      </div>
    )
  }

  if (!backlog) return <p className="text-sm text-foreground-muted">加载中…</p>

  const terminal = backlog.status === '完成' || backlog.status === '取消'
  const isMember = (backlog.members ?? []).some((m) => m.userId === user?.id)
  const canOperate = isAdmin || isMember
  const releaseWorkflowReady = backlog.releaseWorkflow?.enabled ?? false

  const userMap = new Map((users ?? []).map((u) => [u.id, u.name]))

  const loadUsers = () => {
    if (users) return
    api
      .listUsers()
      .then(setUsers)
      .catch((e: Error) => setError(e.message))
  }

  const openMembers = () => {
    loadUsers()
    setMemberDrafts(
      (backlog.members ?? []).map((member) => ({
        role: member.role,
        userId: member.userId,
      })),
    )
    setMemberOpen(true)
  }

  const addMember = () => {
    const userId = Number(addUserId)
    if (!Number.isInteger(userId) || userId <= 0) return
    if (memberDrafts.some((m) => m.role === addRole && m.userId === userId)) return
    setMemberDrafts([...memberDrafts, { role: addRole, userId }])
    setAddUserId(undefined)
  }

  const saveMembers = () => {
    if (savingMembers) return
    setSavingMembers(true)
    api
      .updateBacklogMembers(id, memberDrafts)
      .then((row) => {
        setBacklog({ ...backlog, ...row, releaseWorkflow: backlog.releaseWorkflow })
        setMemberOpen(false)
        showFeedback({ kind: 'success', message: '成员已保存' }, SUCCESS_STAY_MS)
      })
      .catch((e: Error) =>
        showFeedback(
          { kind: 'failure', message: e.message || '保存失败' },
          FAILURE_STAY_MS,
        ),
      )
      .finally(() => setSavingMembers(false))
  }

  const iterationItems = Object.fromEntries(
    (iterations ?? [])
      .filter((it) => it.id !== backlog.iterationId && it.status === '进行中')
      .map((it) => [String(it.id), `${it.code} ${it.name}`]),
  )

  const openMove = () => {
    if (!iterations) {
      api
        .listIterations()
        .then(setIterations)
        .catch((e: Error) => setError(e.message))
    }
    setMoveTarget(undefined)
    setMoveOpen(true)
  }

  const saveMove = () => {
    const target = Number(moveTarget)
    if (!Number.isInteger(target) || target <= 0) return
    setMoving(true)
    api
      .moveBacklog(id, target)
      .then((row) => {
        setBacklog({ ...backlog, ...row, releaseWorkflow: backlog.releaseWorkflow })
        setMoveOpen(false)
        showFeedback({ kind: 'success', message: '已移动到目标迭代' }, SUCCESS_STAY_MS)
      })
      .catch((e: Error) =>
        showFeedback(
          { kind: 'failure', message: e.message || '移动失败' },
          FAILURE_STAY_MS,
        ),
      )
      .finally(() => setMoving(false))
  }

  const openTimeEdit = () => {
    setTimeDraft(toLocalHourInput(backlog.expectedOnlineAt))
    setTimeOpen(true)
  }

  const saveTime = () => {
    if (savingTime) return
    setSavingTime(true)
    const value = timeDraft ? new Date(timeDraft).toISOString() : null
    if (timeDraft && value !== null && Number.isNaN(new Date(timeDraft).getTime())) {
      setSavingTime(false)
      showFeedback({ kind: 'failure', message: '预期上线时间格式不正确' }, FAILURE_STAY_MS)
      return
    }
    api
      .updateBacklog(id, { expectedOnlineAt: value })
      .then((row) => {
        setBacklog({ ...backlog, ...row, releaseWorkflow: backlog.releaseWorkflow })
        setTimeOpen(false)
        showFeedback({ kind: 'success', message: '预期上线时间已保存' }, SUCCESS_STAY_MS)
      })
      .catch((e: Error) =>
        showFeedback(
          { kind: 'failure', message: e.message || '保存失败' },
          FAILURE_STAY_MS,
        ),
      )
      .finally(() => setSavingTime(false))
  }

  const linkDocument = (documentId?: number) => {
    if (linkSaving) return
    const target = documentId ?? Number(linkTarget)
    if (!Number.isInteger(target) || target <= 0) {
      showFeedback({ kind: 'failure', message: '请选择要关联的文档' }, FAILURE_STAY_MS)
      return
    }
    setLinkSaving(true)
    api
      .addBacklogDocument(id, target)
      .then(() => {
        setLinkOpen(false)
        setLinkTarget(undefined)
        return api.listBacklogDocuments(id).then(setDocs)
      })
      .then(() =>
        showFeedback({ kind: 'success', message: '文档已关联' }, SUCCESS_STAY_MS),
      )
      .catch((e: Error) =>
        showFeedback(
          { kind: 'failure', message: e.message || '关联失败' },
          FAILURE_STAY_MS,
        ),
      )
      .finally(() => setLinkSaving(false))
  }

  const unlinkDocument = (documentId: number) => {
    api
      .removeBacklogDocument(id, documentId)
      .then(() => api.listBacklogDocuments(id).then(setDocs))
      .then(() =>
        showFeedback({ kind: 'success', message: '已取消关联（文档保留）' }, SUCCESS_STAY_MS),
      )
      .catch((e: Error) =>
        showFeedback(
          { kind: 'failure', message: e.message || '取消关联失败' },
          FAILURE_STAY_MS,
        ),
      )
  }

  const openLinkDialog = () => {
    if (!projectDocs) {
      api
        .listDocuments(backlog.projectId)
        .then(setProjectDocs)
        .catch((e: Error) =>
          showFeedback(
            { kind: 'failure', message: e.message || '加载需求文档失败' },
            FAILURE_STAY_MS,
          ),
        )
    }
    setLinkTarget(undefined)
    setLinkOpen(true)
  }

  const linkableItems = Object.fromEntries(
    (projectDocs ?? [])
      .filter((doc) => !(docs ?? []).some((linked) => linked.id === doc.id))
      .map((doc) => [String(doc.id), doc.title]),
  )

  const openRelease = () => {
    setReleaseTitle(`提测-${backlog.code} ${backlog.title}`.slice(0, 200))
    setReleaseSupplement('')
    setReleaseOpen(true)
  }

  const submitRelease = () => {
    if (releasing) return
    setReleasing(true)
    api
      .createBacklogReleaseTicket(id, {
        title: releaseTitle.trim() || undefined,
        supplement: releaseSupplement.trim() || undefined,
      })
      .then((ticket) => {
        setReleaseOpen(false)
        showFeedback(
          { kind: 'success', message: `已创建提测工单 ${ticket.ticketCode}` },
          SUCCESS_STAY_MS,
        )
        loadSidepanels(id)
      })
      .catch((e: Error) =>
        showFeedback(
          { kind: 'failure', message: e.message || '提测失败' },
          FAILURE_STAY_MS,
        ),
      )
      .finally(() => setReleasing(false))
  }

  return (
    <DetailPageLayout
      aiCollapsible
      aiOutsideContent
      aiLabel="AI 助理"
      aiOpen={aiOpen}
      onAiOpenChange={setAiOpen}
      aiUnreadCount={aiUnread}
      ai={
        <DetailAgentPanel
          title="AI 助理"
          visible={aiOpen}
          onUnreadChange={setAiUnread}
          onRunFinished={load}
          context={{
            type: 'backlog',
            id: `backlog:${backlog.id}`,
            title: backlog.title,
            summary: [
              `编号：${backlog.code}`,
              `状态：${backlog.status}`,
              `所属迭代：#${backlog.iterationId}`,
              `原始需求：#${backlog.projectId}`,
              backlog.expectedOnlineAt
                ? `预期上线：${formatHour(backlog.expectedOnlineAt)}`
                : '',
            ]
              .filter(Boolean)
              .join('；'),
            readUrl: `/api/backlogs/${backlog.id}.md`,
          }}
          emptyTitle={`「${backlog.title}」的独立 AI 会话`}
          emptyHint="让助理读取迭代项上下文、查文档、跟任务进展或发起操作"
          placeholder="聊聊这个迭代项，或让助理直接查询进展…"
        />
      }
    >
      <div className="flex h-full min-h-0 min-w-0 flex-col gap-4 overflow-y-auto pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <PageBreadcrumb
              items={[
                { label: '迭代', to: '/iterations' },
                { label: '迭代详情', to: `/iterations/${backlog.iterationId}` },
                { label: backlog.code },
              ]}
            />
            <h1 className="mt-2 flex items-center gap-3 text-2xl font-semibold">
              <span className="font-mono text-base text-foreground-muted">
                {backlog.code}
              </span>
              {backlog.title}
              <BacklogStatusBadge status={backlog.status} />
            </h1>
            <p className="mt-1 text-sm text-foreground-muted">
              原始需求{' '}
              <Link to={`/projects/${backlog.projectId}`} className="underline">
                #{backlog.projectId}
              </Link>
              {' · '}负责人 {backlog.ownerName ?? '未指定'}
              {' · '}预期上线 {formatHour(backlog.expectedOnlineAt)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={`/api/backlogs/${id}.md`}
              target="_blank"
              rel="noreferrer"
              className="text-sm underline"
              title="Markdown 视图"
            >
              MD
            </a>
            {canOperate && (
              <>
                <Button
                  size="sm"
                  onClick={openRelease}
                  disabled={!releaseWorkflowReady}
                  title={
                    releaseWorkflowReady
                      ? '创建提测工单'
                      : '「提测工单」工作流未发布，暂不能提测'
                  }
                >
                  提测
                </Button>
                <BacklogStatusDialog
                  backlogId={id}
                  currentStatus={backlog.status}
                  terminal={terminal}
                  triggerLabel="推进状态"
                  primary
                  onDone={(row) => {
                    setBacklog({ ...backlog, ...row, releaseWorkflow: backlog.releaseWorkflow })
                    showFeedback({ kind: 'success', message: '状态已更新' }, SUCCESS_STAY_MS)
                    loadSidepanels(id)
                  }}
                />
              </>
            )}
            {isAdmin && (
              <>
                <Dialog
                  open={memberOpen}
                  onOpenChange={(open) => (open ? openMembers() : setMemberOpen(false))}
                >
                  <DialogTrigger render={<Button variant="outline" size="sm" />}>
                    编辑成员
                  </DialogTrigger>
                  <DialogContent className="max-w-2xl">
                    <DialogHeader>
                      <DialogTitle>编辑成员</DialogTitle>
                    </DialogHeader>
                    <DialogBody>
                      <div className="flex flex-col gap-3">
                        <div className="flex flex-wrap gap-2">
                          {memberDrafts.length === 0 && (
                            <span className="text-sm text-foreground-muted">暂无成员</span>
                          )}
                          {memberDrafts.map((member, index) => (
                            <span
                              key={`${member.role}:${member.userId}`}
                              className="inline-flex items-center gap-2 rounded-md border border-border px-2 py-1 text-sm"
                            >
                              {member.role}：{userMap.get(member.userId) ?? `#${member.userId}`}
                              <button
                                type="button"
                                className="text-foreground-muted underline"
                                onClick={() =>
                                  setMemberDrafts(memberDrafts.filter((_, i) => i !== index))
                                }
                              >
                                移除
                              </button>
                            </span>
                          ))}
                        </div>
                        <div className="flex items-end gap-2">
                          <label className="flex flex-col gap-1 text-sm">
                            角色
                            <Select
                              value={addRole}
                              onValueChange={(v) => setAddRole(v as BacklogMemberRole)}
                              items={ROLE_ITEMS}
                            >
                              <SelectTrigger className="w-32">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {BACKLOG_MEMBER_ROLES.map((role) => (
                                  <SelectItem key={role} value={role}>
                                    {role}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </label>
                          <label className="flex flex-col gap-1 text-sm">
                            成员
                            <Select
                              value={addUserId}
                              onValueChange={(v) => setAddUserId(v as string)}
                              items={userItems}
                            >
                              <SelectTrigger className="w-48">
                                <SelectValue placeholder="选择用户" />
                              </SelectTrigger>
                              <SelectContent>
                                {(users ?? []).map((u) => (
                                  <SelectItem key={u.id} value={String(u.id)}>
                                    {u.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </label>
                          <Button variant="outline" size="sm" onClick={addMember}>
                            添加
                          </Button>
                        </div>
                      </div>
                    </DialogBody>
                    <DialogFooter>
                      <DialogClose>
                        <Button variant="outline" size="sm">取消</Button>
                      </DialogClose>
                      <Button size="sm" onClick={saveMembers} disabled={savingMembers}>
                        {savingMembers ? '保存中…' : '保存'}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
                {!terminal && (
                  <Dialog open={moveOpen} onOpenChange={(open) => (open ? openMove() : setMoveOpen(false))}>
                    <DialogTrigger render={<Button variant="outline" size="sm" />}>
                      移动迭代
                    </DialogTrigger>
                    <DialogContent className="max-w-md">
                      <DialogHeader>
                        <DialogTitle>移动迭代项</DialogTitle>
                      </DialogHeader>
                      <DialogBody>
                        <label className="flex flex-col gap-1 text-sm">
                          目标迭代
                          <Select
                            value={moveTarget}
                            onValueChange={(v) => setMoveTarget(v as string)}
                            items={iterationItems}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="选择目标迭代" />
                            </SelectTrigger>
                            <SelectContent>
                              {(iterations ?? [])
                                .filter(
                                  (it) =>
                                    it.id !== backlog.iterationId &&
                                    it.status === '进行中',
                                )
                                .map((it) => (
                                  <SelectItem key={it.id} value={String(it.id)}>
                                    {it.code} {it.name}
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                        </label>
                      </DialogBody>
                      <DialogFooter>
                        <DialogClose>
                          <Button variant="outline" size="sm">取消</Button>
                        </DialogClose>
                        <Button size="sm" onClick={saveMove} disabled={moving || !moveTarget}>
                          {moving ? '移动中…' : '确认移动'}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                )}
              </>
            )}
          </div>
        </div>

        <Popover
          open={feedback !== null}
          onOpenChange={(open) => {
            if (!open && feedback?.kind === 'failure') {
              clearTimer()
              setFeedback(null)
            }
          }}
        >
          <PopoverTrigger render={<span />} />
          <PopoverContent side="bottom" align="end">
            {feedback?.kind === 'success' && (
              <>
                <PopoverTitle>成功</PopoverTitle>
                <PopoverDescription>{feedback.message}</PopoverDescription>
              </>
            )}
            {feedback?.kind === 'failure' && (
              <>
                <PopoverTitle>失败</PopoverTitle>
                <PopoverDescription>{feedback.message}</PopoverDescription>
              </>
            )}
          </PopoverContent>
        </Popover>

        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value as BacklogDetailTab)}
          variant="line"
          className="flex min-h-0 flex-1 flex-col gap-0"
        >
          <TabsList className="shrink-0">
            <TabsTrigger value="info">信息</TabsTrigger>
            <TabsTrigger value="docs">文档 {docs?.length ?? 0}</TabsTrigger>
            <TabsTrigger value="tasks">任务 {(related?.tasks ?? []).length}</TabsTrigger>
            <TabsTrigger value="topics">话题</TabsTrigger>
            <TabsTrigger value="events">事件</TabsTrigger>
            <TabsTrigger value="members">成员 {backlog.members?.length ?? 0}</TabsTrigger>
          </TabsList>

          <TabsContent value="info" keepMounted className="flex flex-col gap-4 pt-4">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>基本信息</CardTitle>
                </CardHeader>
                <div className="flex flex-col gap-2 px-4 pb-4 text-sm">
                  <InfoRow label="所属迭代">
                    <Link to={`/iterations/${backlog.iterationId}`} className="underline">
                      #{backlog.iterationId}
                    </Link>
                  </InfoRow>
                  <InfoRow label="原始需求">
                    <Link to={`/projects/${backlog.projectId}`} className="underline">
                      #{backlog.projectId}
                    </Link>
                  </InfoRow>
                  <InfoRow label="负责人">{backlog.ownerName ?? '—'}</InfoRow>
                  <InfoRow label="预期上线">
                    <span className="inline-flex items-center gap-2">
                      {formatHour(backlog.expectedOnlineAt)}
                      {canOperate && (
                        <button
                          type="button"
                          className="text-foreground-muted underline"
                          onClick={openTimeEdit}
                        >
                          编辑
                        </button>
                      )}
                    </span>
                  </InfoRow>
                  <InfoRow label="交付任务">
                    {backlog.taskId ? (
                      <Link to={`/tasks/${backlog.taskId}`} className="underline">
                        #{backlog.taskId}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </InfoRow>
                  <InfoRow label="状态操作人">{backlog.statusBy ?? '—'}</InfoRow>
                </div>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>阶段时间</CardTitle>
                </CardHeader>
                <div className="flex flex-col gap-2 px-4 pb-4 text-sm">
                  <InfoRow label="开始执行">{formatTime(backlog.startedAt)}</InfoRow>
                  <InfoRow label="进入测试">{formatTime(backlog.testingAt)}</InfoRow>
                  <InfoRow label="进入发布">{formatTime(backlog.releasingAt)}</InfoRow>
                  <InfoRow label="完成">{formatTime(backlog.completedAt)}</InfoRow>
                  <InfoRow label="取消">{formatTime(backlog.canceledAt)}</InfoRow>
                </div>
              </Card>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                to={`/iterations/${backlog.iterationId}`}
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                返回迭代
              </Link>
              <Link
                to={`/projects/${backlog.projectId}`}
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                查看原始需求
              </Link>
              {backlog.taskId && (
                <Link
                  to={`/tasks/${backlog.taskId}`}
                  className={buttonVariants({ variant: 'outline', size: 'sm' })}
                >
                  查看交付任务
                </Link>
              )}
            </div>
          </TabsContent>

          <TabsContent value="docs" keepMounted className="pt-4">
            {/* 文档：转入时自需求迁入，可继续创建 / 导入 / 关联 */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  文档
                  <Badge variant="soft">{docs?.length ?? 0}</Badge>
                </CardTitle>
                <CardDescription>
                  转入迭代时已迁移原始需求的文档；可继续创建、导入或关联需求下的其他文档
                </CardDescription>
              </CardHeader>
              <div className="flex flex-wrap gap-2 px-4 pb-2">
                <CreateDocumentDialog
                  projectId={backlog.projectId}
                  onCreated={(documentId) => {
                    if (documentId) {
                      api
                        .addBacklogDocument(id, documentId)
                        .catch(() => undefined)
                        .finally(() => {
                          api.listBacklogDocuments(id).then(setDocs).catch(() => undefined)
                        })
                    } else {
                      api.listBacklogDocuments(id).then(setDocs).catch(() => undefined)
                    }
                    showFeedback({ kind: 'success', message: '文档已创建并关联' }, SUCCESS_STAY_MS)
                  }}
                />
                <ImportDocumentDialog
                  projectId={backlog.projectId}
                  onImported={(documentId) => {
                    if (documentId) {
                      api
                        .addBacklogDocument(id, documentId)
                        .catch(() => undefined)
                        .finally(() => {
                          api.listBacklogDocuments(id).then(setDocs).catch(() => undefined)
                        })
                    } else {
                      api.listBacklogDocuments(id).then(setDocs).catch(() => undefined)
                    }
                    showFeedback({ kind: 'success', message: '文档已导入并关联' }, SUCCESS_STAY_MS)
                  }}
                />
                {canOperate && (
                  <Dialog open={linkOpen} onOpenChange={(open) => (open ? openLinkDialog() : setLinkOpen(false))}>
                    <DialogTrigger render={<Button variant="outline" size="sm" />}>
                      关联已有文档
                    </DialogTrigger>
                    <DialogContent className="max-w-md">
                      <DialogHeader>
                        <DialogTitle>关联需求下的已有文档</DialogTitle>
                      </DialogHeader>
                      <DialogBody>
                        <label className="flex flex-col gap-1 text-sm">
                          文档（仅列出原始需求下尚未关联的文档）
                          <Select
                            value={linkTarget}
                            onValueChange={(v) => setLinkTarget(v as string)}
                            items={linkableItems}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="选择文档" />
                            </SelectTrigger>
                            <SelectContent>
                              {(projectDocs ?? [])
                                .filter((doc) => !(docs ?? []).some((linked) => linked.id === doc.id))
                                .map((doc) => (
                                  <SelectItem key={doc.id} value={String(doc.id)}>
                                    {doc.title}
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                        </label>
                      </DialogBody>
                      <DialogFooter>
                        <DialogClose>
                          <Button variant="outline" size="sm">取消</Button>
                        </DialogClose>
                        <Button size="sm" onClick={() => linkDocument()} disabled={linkSaving || !linkTarget}>
                          {linkSaving ? '关联中…' : '确认关联'}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                )}
              </div>
              <Table hoverableRows>
                <TableHeader>
                  <TableRow>
                    <TableHead>标题</TableHead>
                    <TableHead className="w-20 text-center">类型</TableHead>
                    <TableHead className="w-24 text-center">来源</TableHead>
                    <TableHead className="w-44 text-center">更新时间</TableHead>
                    <TableHead className="w-24 text-center">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(docs ?? []).map((doc) => (
                    <TableRow key={doc.id}>
                      <TableCell>
                        <Link to={`/documents/${doc.id}`} className="underline">
                          {doc.title}
                        </Link>
                      </TableCell>
                      <TableCell className="text-center">{doc.type}</TableCell>
                      <TableCell className="text-center">{documentSourceLabel(doc.source)}</TableCell>
                      <TableCell className="text-center">{formatTime(doc.updatedAt)}</TableCell>
                      <TableCell className="text-center">
                        {canOperate ? (
                          <button
                            type="button"
                            className="text-sm text-foreground-muted underline"
                            onClick={() => unlinkDocument(doc.id)}
                          >
                            取消关联
                          </button>
                        ) : (
                          <span className="text-foreground-muted">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {(docs ?? []).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5}>
                        {docs === null ? '加载中…' : '暂无文档；转入迭代时会自动迁入原始需求的文档'}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Card>
          </TabsContent>

          <TabsContent value="tasks" keepMounted className="pt-4">
            {/* 任务与工单：交付任务树 + 相关工单 */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  任务与工单
                  <Badge variant="soft">{(related?.tasks ?? []).length}</Badge>
                  <Badge variant="soft">{(related?.tickets ?? []).length} 工单</Badge>
                </CardTitle>
                <CardDescription>
                  交付任务及其全部子任务，以及直接关联（提测工单等）与任务关联的工单
                </CardDescription>
              </CardHeader>
              {(related?.tickets ?? []).length > 0 && (
                <Table hoverableRows>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-24">工单</TableHead>
                      <TableHead>标题</TableHead>
                      <TableHead className="w-28 text-center">状态</TableHead>
                      <TableHead className="w-36 text-center">当前节点</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(related?.tickets ?? []).map((ticket) => (
                      <TableRow key={ticket.id}>
                        <TableCell className="font-mono text-sm">
                          <Link to={`/tickets/${ticket.id}`} className="underline">
                            {ticket.code}
                          </Link>
                        </TableCell>
                        <TableCell className="max-w-md truncate" title={ticket.title}>
                          {ticket.title}
                        </TableCell>
                        <TableCell className="text-center">
                          <TicketStatusBadge status={ticket.workflowStatus ?? '处理中'} />
                        </TableCell>
                        <TableCell className="text-center">
                          {ticket.currentNodeName ?? '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              <Table hoverableRows>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-24">编号</TableHead>
                    <TableHead>标题</TableHead>
                    <TableHead className="w-32 text-center">状态</TableHead>
                    <TableHead className="w-36 text-center">任务定义</TableHead>
                    <TableHead className="w-44 text-center">更新时间</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(related?.tasks ?? []).map((task) => (
                    <TableRow key={task.id}>
                      <TableCell className="font-mono text-sm">
                        <Link to={`/tasks/${task.id}`} className="underline">
                          {task.code}
                        </Link>
                      </TableCell>
                      <TableCell className="max-w-md truncate" title={task.title}>
                        <span style={{ paddingLeft: (taskDepthById.get(task.id) ?? 0) * 16 }}>
                          {task.parentId && (
                            <span className="mr-1 text-foreground-muted">└</span>
                          )}
                          {task.title}
                        </span>
                      </TableCell>
                      <TableCell className="text-center">
                        <TaskStatusBadge status={task.status} subStatus={task.subStatus} />
                      </TableCell>
                      <TableCell className="text-center">{task.templateName ?? '—'}</TableCell>
                      <TableCell className="text-center">{formatTime(task.updatedAt)}</TableCell>
                    </TableRow>
                  ))}
                  {(related?.tasks ?? []).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5}>
                        {related === null ? '加载中…' : '暂无交付任务'}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Card>
          </TabsContent>

          <TabsContent value="events" keepMounted className="pt-4">
            {/* 事件流 */}
            <Card>
              <CardHeader>
                <CardTitle>事件</CardTitle>
                <CardDescription>创建、状态流转（含备注）、移动迭代、提测工单等完整记录</CardDescription>
              </CardHeader>
              <div className="flex flex-col gap-1.5 px-4 pb-4 text-sm">
                {(events ?? []).map((event) => (
                  <div key={event.id} className="flex flex-wrap items-baseline gap-2">
                    <span className="shrink-0 text-xs text-foreground-muted">
                      {formatTime(event.createdAt)}
                    </span>
                    <Badge variant="soft">{EVENT_LABELS[event.type] ?? event.type}</Badge>
                    <span>{event.operator ?? '系统'}</span>
                    {eventSummary(event) && (
                      <span className="text-foreground-muted">{eventSummary(event)}</span>
                    )}
                  </div>
                ))}
                {(events ?? []).length === 0 && (
                  <span className="text-foreground-muted">
                    {events === null ? '加载中…' : '暂无事件'}
                  </span>
                )}
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="members" keepMounted className="pt-4">
            {/* 成员 */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  成员
                  <Badge variant="soft">{backlog.members?.length ?? 0}</Badge>
                </CardTitle>
                <CardDescription>
                  产品 / 业务 / 项目 / 技术（前端、后端、测试、客户端）；成员或管理员可推进状态与提测
                </CardDescription>
              </CardHeader>
              <div className="flex flex-wrap gap-2 px-4 pb-4">
                {(backlog.members ?? []).length === 0 && (
                  <span className="text-sm text-foreground-muted">暂无成员</span>
                )}
                {(backlog.members ?? []).map((member) => (
                  <Badge key={`${member.role}:${member.userId}`} variant="soft">
                    {member.role}：{member.name}
                  </Badge>
                ))}
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="topics" keepMounted className="pt-4">
            <TopicPanel subjectType="backlog" subjectId={backlog.id} compact />
          </TabsContent>
        </Tabs>
      </div>

      {/* 预期上线时间编辑弹窗（到小时） */}
      <Dialog open={timeOpen} onOpenChange={setTimeOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>编辑预期上线时间</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <label className="flex flex-col gap-1 text-sm">
              预期上线（年月日时，北京时间）
              <Input
                type="datetime-local"
                value={timeDraft}
                step={3600}
                onChange={(e) => setTimeDraft(e.target.value)}
              />
            </label>
            <p className="mt-2 text-xs text-foreground-muted">清空后保存表示暂不设置</p>
          </DialogBody>
          <DialogFooter>
            <DialogClose>
              <Button variant="outline" size="sm">取消</Button>
            </DialogClose>
            <Button size="sm" onClick={saveTime} disabled={savingTime}>
              {savingTime ? '保存中…' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 提测弹窗：按迭代项自动填入，人工可补充 */}
      <Dialog open={releaseOpen} onOpenChange={setReleaseOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>发起提测</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <div className="flex flex-col gap-4">
              <p className="text-xs text-foreground-muted">
                将按「提测工单」工作流创建工单；迭代项上下文已自动填入工单描述（迭代、需求、负责人、预期上线、交付任务），可在此补充说明。
              </p>
              <label className="flex flex-col gap-1 text-sm">
                工单标题
                <Input
                  value={releaseTitle}
                  onChange={(e) => setReleaseTitle(e.target.value)}
                  placeholder="提测-BL-0001 …"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                补充说明（Markdown，可空）
                <Textarea
                  value={releaseSupplement}
                  onChange={(e) => setReleaseSupplement(e.target.value)}
                  placeholder="本轮提测范围、注意事项、回归重点…"
                  rows={5}
                />
              </label>
            </div>
          </DialogBody>
          <DialogFooter>
            <DialogClose>
              <Button variant="outline" size="sm">取消</Button>
            </DialogClose>
            <Button size="sm" onClick={submitRelease} disabled={releasing}>
              {releasing ? '创建中…' : '创建提测工单'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DetailPageLayout>
  )
}

function InfoRow({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex gap-3">
      <span className="w-24 shrink-0 text-foreground-muted">{label}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  )
}
