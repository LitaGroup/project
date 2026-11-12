import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@appica/ui-react/table'
import { Input } from '@appica/ui-react/input'
import { Textarea } from '@appica/ui-react/textarea'
import { Button } from '@appica/ui-react/button'
import { Badge } from '@appica/ui-react/badge'
import { Switch } from '@appica/ui-react/switch'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
  DialogClose,
} from '@appica/ui-react/dialog'
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogClose,
} from '@appica/ui-react/alert-dialog'
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverTitle,
  PopoverDescription,
} from '@appica/ui-react/popover'
import {
  api,
  type SsoClientConfig,
  type SsoClientSaveInput,
} from '../lib/api'

/** 成功反馈停留时长 */
const SUCCESS_STAY_MS = 2_000
/** 失败反馈停留时长 */
const FAILURE_STAY_MS = 5_000

type Feedback =
  | { kind: 'success'; message: string }
  | { kind: 'failure'; message: string }
  | null

interface ClientForm {
  name: string
  /** 每行一个回调地址 */
  redirectUris: string
  enabled: boolean
  remark: string
}

const EMPTY_FORM: ClientForm = {
  name: '',
  redirectUris: '',
  enabled: true,
  remark: '',
}

/** 一次性展示的密钥（新建返回 clientId + secret；重置仅返回新 secret） */
interface SecretReveal {
  title: string
  clientId?: string
  clientSecret: string
}

/** 文本域内容解析为回调地址数组（每行一个，去空行） */
function parseRedirectUris(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

/**
 * 管理区「SSO 应用」：登记可接入平台登录的网站（OAuth2 授权码模式）。
 * clientId 固定展示；clientSecret 只写不回显，仅创建/重置时一次性展示。
 */
export function SsoClientsPage() {
  const [items, setItems] = useState<SsoClientConfig[]>([])
  const [error, setError] = useState<string | null>(null)

  /** undefined = 关闭；null = 新建；对象 = 编辑 */
  const [editing, setEditing] = useState<SsoClientConfig | null | undefined>(
    undefined,
  )
  const [form, setForm] = useState<ClientForm>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<Feedback>(null)

  const [deleteTarget, setDeleteTarget] = useState<SsoClientConfig | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteFeedback, setDeleteFeedback] = useState<Feedback>(null)

  const [resetTarget, setResetTarget] = useState<SsoClientConfig | null>(null)
  const [resetting, setResetting] = useState(false)
  const [resetFeedback, setResetFeedback] = useState<Feedback>(null)

  const [secret, setSecret] = useState<SecretReveal | null>(null)
  const [copyFeedback, setCopyFeedback] = useState<Feedback>(null)

  /** 反馈计时器：成功 2 秒进入下一步，失败 5 秒自动关闭（可提前关闭） */
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const deleteFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  )
  const resetFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  )
  const copyFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimer = (ref: {
    current: ReturnType<typeof setTimeout> | null
  }) => {
    if (ref.current !== null) {
      clearTimeout(ref.current)
      ref.current = null
    }
  }

  useEffect(() => {
    return () => {
      clearTimer(feedbackTimerRef)
      clearTimer(deleteFeedbackTimerRef)
      clearTimer(resetFeedbackTimerRef)
      clearTimer(copyFeedbackTimerRef)
    }
  }, [])

  const showFeedback = (
    setter: (next: Feedback) => void,
    timerRef: {
      current: ReturnType<typeof setTimeout> | null
    },
    next: NonNullable<Feedback>,
    stayMs: number,
    after?: () => void,
  ) => {
    clearTimer(timerRef)
    setter(next)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      setter(null)
      after?.()
    }, stayMs)
  }

  const load = useCallback(async () => {
    setError(null)
    try {
      setItems(await api.listSsoClients())
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const openCreate = () => {
    setForm(EMPTY_FORM)
    setFeedback(null)
    setEditing(null)
  }

  const openEdit = (client: SsoClientConfig) => {
    setForm({
      name: client.name,
      redirectUris: client.redirectUris.join('\n'),
      enabled: client.enabled,
      remark: client.remark ?? '',
    })
    setFeedback(null)
    setEditing(client)
  }

  const submit = async () => {
    if (saving || feedback?.kind === 'success') return
    if (!form.name.trim()) {
      showFeedback(setFeedback, feedbackTimerRef, { kind: 'failure', message: '名称不能为空' }, FAILURE_STAY_MS)
      return
    }
    const redirectUris = parseRedirectUris(form.redirectUris)
    if (redirectUris.length === 0) {
      showFeedback(
        setFeedback,
        feedbackTimerRef,
        { kind: 'failure', message: '至少填写一个回调地址（每行一个）' },
        FAILURE_STAY_MS,
      )
      return
    }
    const payload: SsoClientSaveInput = {
      name: form.name.trim(),
      redirectUris,
      enabled: form.enabled,
      remark: form.remark.trim() || null,
    }
    setSaving(true)
    setFeedback(null)
    try {
      if (editing) {
        await api.updateSsoClient(editing.id, payload)
        showFeedback(
          setFeedback,
          feedbackTimerRef,
          { kind: 'success', message: '已保存' },
          SUCCESS_STAY_MS,
          () => {
            setEditing(undefined)
            void load()
          },
        )
      } else {
        const created = await api.createSsoClient(payload)
        setEditing(undefined)
        setSecret({
          title: `接入方「${created.name}」已创建`,
          clientId: created.clientId,
          clientSecret: created.clientSecret,
        })
        void load()
      }
    } catch (e) {
      showFeedback(
        setFeedback,
        feedbackTimerRef,
        {
          kind: 'failure',
          message: e instanceof Error ? e.message : '保存失败，请稍后重试',
        },
        FAILURE_STAY_MS,
      )
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget || deleting) return
    setDeleting(true)
    setDeleteFeedback(null)
    try {
      await api.deleteSsoClient(deleteTarget.id)
      showFeedback(
        setDeleteFeedback,
        deleteFeedbackTimerRef,
        { kind: 'success', message: '已删除' },
        SUCCESS_STAY_MS,
        () => {
          setDeleteTarget(null)
          void load()
        },
      )
    } catch (e) {
      showFeedback(
        setDeleteFeedback,
        deleteFeedbackTimerRef,
        {
          kind: 'failure',
          message: e instanceof Error ? e.message : '删除失败，请稍后重试',
        },
        FAILURE_STAY_MS,
      )
    } finally {
      setDeleting(false)
    }
  }

  const confirmReset = async () => {
    if (!resetTarget || resetting) return
    setResetting(true)
    setResetFeedback(null)
    try {
      const { clientSecret } = await api.resetSsoClientSecret(resetTarget.id)
      const name = resetTarget.name
      showFeedback(
        setResetFeedback,
        resetFeedbackTimerRef,
        { kind: 'success', message: '已重置' },
        SUCCESS_STAY_MS,
        () => {
          setResetTarget(null)
          setSecret({ title: `接入方「${name}」的新密钥`, clientSecret })
          void load()
        },
      )
    } catch (e) {
      showFeedback(
        setResetFeedback,
        resetFeedbackTimerRef,
        {
          kind: 'failure',
          message: e instanceof Error ? e.message : '重置失败，请稍后重试',
        },
        FAILURE_STAY_MS,
      )
    } finally {
      setResetting(false)
    }
  }

  const copySecret = async () => {
    if (!secret) return
    try {
      await navigator.clipboard.writeText(secret.clientSecret)
      showFeedback(
        setCopyFeedback,
        copyFeedbackTimerRef,
        { kind: 'success', message: '已复制到剪贴板' },
        SUCCESS_STAY_MS,
      )
    } catch {
      showFeedback(
        setCopyFeedback,
        copyFeedbackTimerRef,
        { kind: 'failure', message: '复制失败，请手动选择复制' },
        FAILURE_STAY_MS,
      )
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">SSO 应用</h1>
          <p className="mt-1 text-sm text-foreground-muted">
            登记可使用平台账号登录的网站（OAuth2 授权码模式）；用户在平台已登录即可免密跳转，
            未登录先走飞书登录再回跳。
          </p>
        </div>
        <Button size="sm" onClick={openCreate}>
          新建接入方
        </Button>
      </div>

      {error && <p className="mb-4 text-sm">加载失败：{error}</p>}

      <Table hoverableRows>
        <TableHeader>
          <TableRow>
            <TableHead className="w-44">名称</TableHead>
            <TableHead className="w-64">Client ID</TableHead>
            <TableHead>回调地址</TableHead>
            <TableHead className="w-20">启用</TableHead>
            <TableHead className="w-44">更新时间</TableHead>
            <TableHead className="w-56">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.id}>
              <TableCell>
                <span className="font-medium text-foreground-intense">
                  {item.name}
                </span>
                {item.remark && (
                  <span className="mt-0.5 block max-w-64 truncate text-xs text-foreground-muted">
                    {item.remark}
                  </span>
                )}
              </TableCell>
              <TableCell
                className="max-w-64 truncate font-mono text-xs text-foreground-muted"
                title={item.clientId}
              >
                {item.clientId}
              </TableCell>
              <TableCell className="max-w-96 text-xs text-foreground-muted">
                <span className="block truncate" title={item.redirectUris[0]}>
                  {item.redirectUris[0]}
                </span>
                {item.redirectUris.length > 1 && (
                  <span className="text-foreground-muted">
                    等 {item.redirectUris.length} 个地址
                  </span>
                )}
              </TableCell>
              <TableCell>
                <Badge variant={item.enabled ? 'success' : 'soft'}>
                  {item.enabled ? '启用' : '停用'}
                </Badge>
              </TableCell>
              <TableCell className="whitespace-nowrap text-foreground-muted">
                {new Date(item.updatedAt).toLocaleString()}
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={() => openEdit(item)}>
                    编辑
                  </Button>
                  <AlertDialog
                    open={resetTarget?.id === item.id}
                    onOpenChange={(open) => {
                      if (open) {
                        setResetTarget(item)
                        setResetFeedback(null)
                        return
                      }
                      clearTimer(resetFeedbackTimerRef)
                      setResetTarget(null)
                      setResetFeedback(null)
                    }}
                  >
                    <AlertDialogTrigger
                      render={<Button variant="ghost" size="sm" />}
                    >
                      重置密钥
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          重置「{item.name}」的客户端密钥？
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          旧密钥立即失效，使用旧密钥的接入方服务将无法换取令牌，需同步更新。
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogClose
                          render={<Button variant="ghost" size="sm" />}
                        >
                          取消
                        </AlertDialogClose>
                        <Popover
                          open={resetFeedback !== null}
                          onOpenChange={(open) => {
                            if (!open && resetFeedback?.kind === 'failure') {
                              clearTimer(resetFeedbackTimerRef)
                              setResetFeedback(null)
                            }
                          }}
                        >
                          <PopoverTrigger
                            render={
                              <Button
                                size="sm"
                                disabled={
                                  resetting || resetFeedback?.kind === 'success'
                                }
                                onClick={() => void confirmReset()}
                              >
                                {resetting ? '重置中…' : '确认重置'}
                              </Button>
                            }
                          />
                          <PopoverContent side="top" align="center">
                            {resetFeedback?.kind === 'success' && (
                              <>
                                <PopoverTitle>成功</PopoverTitle>
                                <PopoverDescription>
                                  {resetFeedback.message}
                                </PopoverDescription>
                              </>
                            )}
                            {resetFeedback?.kind === 'failure' && (
                              <>
                                <PopoverTitle>失败</PopoverTitle>
                                <PopoverDescription>
                                  {resetFeedback.message}
                                </PopoverDescription>
                              </>
                            )}
                          </PopoverContent>
                        </Popover>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                  <AlertDialog
                    open={deleteTarget?.id === item.id}
                    onOpenChange={(open) => {
                      if (open) {
                        setDeleteTarget(item)
                        setDeleteFeedback(null)
                        return
                      }
                      clearTimer(deleteFeedbackTimerRef)
                      setDeleteTarget(null)
                      setDeleteFeedback(null)
                    }}
                  >
                    <AlertDialogTrigger
                      render={<Button variant="ghost" size="sm" />}
                    >
                      删除
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          删除 SSO 接入方「{item.name}」？
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          删除后该网站将无法再通过平台登录，其未使用的授权码一并清除。
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogClose
                          render={<Button variant="ghost" size="sm" />}
                        >
                          取消
                        </AlertDialogClose>
                        <Popover
                          open={deleteFeedback !== null}
                          onOpenChange={(open) => {
                            if (!open && deleteFeedback?.kind === 'failure') {
                              clearTimer(deleteFeedbackTimerRef)
                              setDeleteFeedback(null)
                            }
                          }}
                        >
                          <PopoverTrigger
                            render={
                              <Button
                                size="sm"
                                disabled={
                                  deleting || deleteFeedback?.kind === 'success'
                                }
                                onClick={() => void confirmDelete()}
                              >
                                {deleting ? '删除中…' : '确认删除'}
                              </Button>
                            }
                          />
                          <PopoverContent side="top" align="center">
                            {deleteFeedback?.kind === 'success' && (
                              <>
                                <PopoverTitle>成功</PopoverTitle>
                                <PopoverDescription>
                                  {deleteFeedback.message}
                                </PopoverDescription>
                              </>
                            )}
                            {deleteFeedback?.kind === 'failure' && (
                              <>
                                <PopoverTitle>失败</PopoverTitle>
                                <PopoverDescription>
                                  {deleteFeedback.message}
                                </PopoverDescription>
                              </>
                            )}
                          </PopoverContent>
                        </Popover>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </TableCell>
            </TableRow>
          ))}
          {items.length === 0 && (
            <TableRow>
              <TableCell colSpan={6}>
                暂无 SSO 接入方，点击右上角「新建接入方」创建
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {/* 新建/编辑弹窗 */}
      <Dialog
        open={editing !== undefined}
        onOpenChange={(open) => {
          if (!open) {
            clearTimer(feedbackTimerRef)
            setEditing(undefined)
            setFeedback(null)
          }
        }}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {editing ? `编辑接入方：${editing.name}` : '新建 SSO 接入方'}
            </DialogTitle>
          </DialogHeader>
          <DialogBody>
            <div className="grid gap-4">
              {editing && (
                <label className="grid gap-1.5 text-sm">
                  <span>Client ID</span>
                  <Input readOnly value={editing.clientId} className="font-mono" />
                  <span className="text-xs text-foreground-muted">
                    接入方标识，创建后不可修改。
                  </span>
                </label>
              )}
              <label className="grid gap-1.5 text-sm">
                <span>名称</span>
                <Input
                  value={form.name}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, name: e.target.value }))
                  }
                  placeholder="如 运营后台"
                />
              </label>
              <label className="grid gap-1.5 text-sm">
                <span>回调地址（每行一个）</span>
                <Textarea
                  rows={4}
                  value={form.redirectUris}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, redirectUris: e.target.value }))
                  }
                  placeholder={'https://app.example.com/auth/callback\nhttps://app.example.com/login'}
                />
                <span className="text-xs text-foreground-muted">
                  仅支持 http/https；授权时按精确匹配校验，不在白名单的回调地址会被拒绝。
                </span>
              </label>
              <label className="grid gap-1.5 text-sm">
                <span>备注（可选）</span>
                <Textarea
                  rows={2}
                  value={form.remark}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, remark: e.target.value }))
                  }
                  placeholder="用途说明、负责人等"
                />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  size="sm"
                  checked={form.enabled}
                  onCheckedChange={(checked) =>
                    setForm((prev) => ({ ...prev, enabled: checked }))
                  }
                />
                {form.enabled ? '启用（可发起登录）' : '停用（保留配置但拒绝授权）'}
              </label>
            </div>
          </DialogBody>
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" size="sm" />}>
              取消
            </DialogClose>
            <Popover
              open={feedback !== null}
              onOpenChange={(open) => {
                if (!open && feedback?.kind === 'failure') {
                  clearTimer(feedbackTimerRef)
                  setFeedback(null)
                }
              }}
            >
              <PopoverTrigger
                render={
                  <Button
                    size="sm"
                    disabled={saving || feedback?.kind === 'success'}
                    onClick={() => void submit()}
                  >
                    {saving ? '保存中…' : '保存'}
                  </Button>
                }
              />
              <PopoverContent side="top" align="center">
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
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 密钥一次性展示弹窗（新建/重置后） */}
      <Dialog
        open={secret !== null}
        onOpenChange={(open) => {
          if (!open) {
            clearTimer(copyFeedbackTimerRef)
            setSecret(null)
            setCopyFeedback(null)
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{secret?.title ?? ''}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <div className="grid gap-4 text-sm">
              {secret?.clientId && (
                <div className="grid gap-1.5">
                  <span className="text-foreground-muted">Client ID</span>
                  <p className="break-all rounded-[var(--radius-md)] bg-background-muted px-3 py-2 font-mono">
                    {secret.clientId}
                  </p>
                </div>
              )}
              <div className="grid gap-1.5">
                <span className="text-foreground-muted">Client Secret</span>
                <p className="break-all rounded-[var(--radius-md)] bg-background-muted px-3 py-2 font-mono">
                  {secret?.clientSecret}
                </p>
              </div>
              <p className="text-xs text-foreground-muted">
                密钥仅本次展示，关闭后无法再次查看，请立即复制并保存到接入方服务端。
              </p>
            </div>
          </DialogBody>
          <DialogFooter>
            <Popover
              open={copyFeedback !== null}
              onOpenChange={(open) => {
                if (!open && copyFeedback?.kind === 'failure') {
                  clearTimer(copyFeedbackTimerRef)
                  setCopyFeedback(null)
                }
              }}
            >
              <PopoverTrigger
                render={
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={copyFeedback?.kind === 'success'}
                    onClick={() => void copySecret()}
                  >
                    复制密钥
                  </Button>
                }
              />
              <PopoverContent side="top" align="center">
                {copyFeedback?.kind === 'success' && (
                  <>
                    <PopoverTitle>成功</PopoverTitle>
                    <PopoverDescription>{copyFeedback.message}</PopoverDescription>
                  </>
                )}
                {copyFeedback?.kind === 'failure' && (
                  <>
                    <PopoverTitle>失败</PopoverTitle>
                    <PopoverDescription>{copyFeedback.message}</PopoverDescription>
                  </>
                )}
              </PopoverContent>
            </Popover>
            <DialogClose render={<Button size="sm" />}>
              我已保存，关闭
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
