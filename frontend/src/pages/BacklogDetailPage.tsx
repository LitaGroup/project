import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
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
  api,
  BACKLOG_MEMBER_ROLES,
  BACKLOG_STATUSES,
  type Backlog,
  type BacklogMemberRole,
  type BacklogStatus,
  type IterationSummary,
  type PlatformUser,
} from '../lib/api'
import { PageBreadcrumb } from '../components/PageBreadcrumb'
import { BacklogStatusBadge } from '../components/StatusBadge'
import { useAuth } from '../context/AuthContext'

const SUCCESS_STAY_MS = 2_000
const FAILURE_STAY_MS = 5_000

type ActionFeedback =
  | { kind: 'success'; message: string }
  | { kind: 'failure'; message: string }
  | null

const STATUS_ITEMS = Object.fromEntries(
  BACKLOG_STATUSES.map((status) => [status, status]),
)
const ROLE_ITEMS = Object.fromEntries(
  BACKLOG_MEMBER_ROLES.map((role) => [role, role]),
)

function formatTime(value: string | null): string {
  return value ? new Date(value).toLocaleString() : '—'
}

/**
 * 迭代项详情：展示原始需求、负责人、成员、交付任务与阶段时间；
 * 成员或管理员可手动推进状态，管理员可编辑成员。
 */
export function BacklogDetailPage() {
  const { backlogId } = useParams<{ backlogId: string }>()
  const id = Number(backlogId)
  const { user } = useAuth()
  const isAdmin = user?.role === '管理员'

  const [backlog, setBacklog] = useState<Backlog | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<ActionFeedback>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [users, setUsers] = useState<PlatformUser[] | null>(null)
  const [memberDrafts, setMemberDrafts] = useState<
    Array<{ role: BacklogMemberRole; userId: number }>
  >([])
  const [memberOpen, setMemberOpen] = useState(false)
  const [addRole, setAddRole] = useState<BacklogMemberRole>('产品')
  const [addUserId, setAddUserId] = useState<string | undefined>(undefined)
  const [savingMembers, setSavingMembers] = useState(false)

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

  const load = () => {
    if (!Number.isInteger(id) || id <= 0) return
    api
      .getBacklog(id)
      .then((row) => {
        setBacklog(row)
        setError(null)
      })
      .catch((e: Error) => setError(e.message))
  }

  useEffect(load, [id])

  const userItems = useMemo(
    () => Object.fromEntries((users ?? []).map((u) => [String(u.id), u.name])),
    [users],
  )

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
      (backlog?.members ?? []).map((member) => ({
        role: member.role,
        userId: member.userId,
      })),
    )
    setMemberOpen(true)
  }

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

  const changeStatus = (status: BacklogStatus) => {
    if (busy || terminal || status === backlog.status) return
    setBusy(true)
    api
      .updateBacklogStatus(id, status)
      .then((row) => {
        setBacklog(row)
        setError(null)
        showFeedback({ kind: 'success', message: '状态已更新' }, SUCCESS_STAY_MS)
      })
      .catch((e: Error) =>
        showFeedback(
          { kind: 'failure', message: e.message || '更新失败' },
          FAILURE_STAY_MS,
        ),
      )
      .finally(() => setBusy(false))
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
        setBacklog(row)
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

  const userMap = new Map((users ?? []).map((u) => [u.id, u.name]))

  const iterationItems = Object.fromEntries(
    (iterations ?? [])
      .filter(
        (it) => it.id !== backlog.iterationId && it.status === '进行中',
      )
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
        setBacklog(row)
        setMoveOpen(false)
        showFeedback(
          { kind: 'success', message: '已移动到目标迭代' },
          SUCCESS_STAY_MS,
        )
      })
      .catch((e: Error) =>
        showFeedback(
          { kind: 'failure', message: e.message || '移动失败' },
          FAILURE_STAY_MS,
        ),
      )
      .finally(() => setMoving(false))
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
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
          <Select
            value={backlog.status}
            onValueChange={(v) => changeStatus(v as BacklogStatus)}
            items={STATUS_ITEMS}
            disabled={terminal || busy}
          >
            <SelectTrigger aria-label="推进迭代项状态" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BACKLOG_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {status}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {isAdmin && (
            <>
            <Dialog open={memberOpen} onOpenChange={(open) => (open ? openMembers() : setMemberOpen(false))}>
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
                    <Button
                      size="sm"
                      onClick={saveMove}
                      disabled={moving || !moveTarget}
                    >
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

      {error && <p className="mb-4 text-sm">操作失败:{error}</p>}

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
                #{backlog.projectId} {backlog.title}
              </Link>
            </InfoRow>
            <InfoRow label="负责人">{backlog.ownerName ?? '—'}</InfoRow>
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

      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            成员
            <Badge variant="soft">{backlog.members?.length ?? 0}</Badge>
          </CardTitle>
          <CardDescription>
            产品 / 业务 / 项目 / 技术（前端、后端、测试、客户端）；成员或管理员可推进状态
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

      <div className="mt-4 flex flex-wrap gap-2">
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
    </div>
  )
}

function InfoRow({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="flex gap-3">
      <span className="w-24 shrink-0 text-foreground-muted">{label}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  )
}