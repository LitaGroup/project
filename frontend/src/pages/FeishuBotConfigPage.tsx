import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Card,
  CardHeader,
  CardTitle,
} from '@appica/ui-react/card'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@appica/ui-react/table'
import { Input } from '@appica/ui-react/input'
import { Button } from '@appica/ui-react/button'
import { Badge } from '@appica/ui-react/badge'
import { Switch } from '@appica/ui-react/switch'
import { Toolbar, ToolbarInput } from '@appica/ui-react/toolbar'
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
import { PlugConnected } from '@appica/icons-react'
import {
  api,
  type FeishuBotConfigView,
  type FeishuBotSaveInput,
  type Worker,
} from '../lib/api'
import { RobotAvatar } from '../components/task-detail/WorkerAvatar'

/** 弹窗目标：official = 平台官方机器人；数字 = 机器人 ID */
type DialogTarget = { kind: 'official' | 'worker'; workerId: number | null }

interface ConfigForm {
  appId: string
  appSecret: string
  verificationToken: string
  encryptKey: string
  enabled: boolean
}

const EMPTY_FORM: ConfigForm = {
  appId: '',
  appSecret: '',
  verificationToken: '',
  encryptKey: '',
  enabled: true,
}

/** 状态 Badge：已启用绿 / 已停用淡 / 缺 Secret 黄 */
function configBadge(config: FeishuBotConfigView) {
  if (!config.secretConfigured) {
    return <Badge variant="warning">未完成</Badge>
  }
  return config.enabled ? (
    <Badge variant="success">已启用</Badge>
  ) : (
    <Badge variant="soft">已停用</Badge>
  )
}

/**
 * 管理区飞书配置：
 * - 平台官方机器人（全平台唯一，负责任务群与官方私聊入口）；
 * - 机器人绑定：自定义机器人 / 个人 AGENT 绑定独立飞书应用（Secret 只写不回显）。
 * 绑定后的机器人在列表头像上带「已连接飞书」角标。
 */
export function FeishuBotConfigPage() {
  const navigate = useNavigate()
  const [official, setOfficial] = useState<FeishuBotConfigView | null>(null)
  const [configs, setConfigs] = useState<FeishuBotConfigView[]>([])
  const [workers, setWorkers] = useState<Worker[]>([])
  const [error, setError] = useState<string | null>(null)
  const [keyword, setKeyword] = useState('')

  const [target, setTarget] = useState<DialogTarget | null>(null)
  const [form, setForm] = useState<ConfigForm>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [testingId, setTestingId] = useState<number | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [list, workerList] = await Promise.all([
        api.listFeishuBotConfigs(),
        api.listWorkers({ includePersonal: true }),
      ])
      setOfficial(list.official)
      setConfigs(list.workers)
      setWorkers(workerList)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const configByWorkerId = useMemo(() => {
    const map = new Map<number, FeishuBotConfigView>()
    for (const item of configs) {
      if (item.workerId !== null) map.set(item.workerId, item)
    }
    return map
  }, [configs])

  /** 可绑定的机器人：AI 运行时 + 自定义 ID 段（含个人 AGENT）；系统机器人仅「系统-反馈处理」例外 */
  const bindableWorkers = useMemo(
    () =>
      workers.filter(
        (worker) =>
          worker.runtime === 'opencode' &&
          (worker.id >= 1000 || worker.systemKey === 'feedback-handler'),
      ),
    [workers],
  )

  const q = keyword.trim().toLowerCase()
  const workerRows = useMemo(
    () =>
      bindableWorkers.filter((worker) => {
        if (!q) return true
        return (
          worker.name.toLowerCase().includes(q) ||
          String(worker.id).includes(q) ||
          (worker.intro ?? '').toLowerCase().includes(q)
        )
      }),
    [bindableWorkers, q],
  )

  const openOfficial = () => {
    setError(null)
    setForm({
      appId: official?.appId ?? '',
      appSecret: '',
      verificationToken: '',
      encryptKey: '',
      enabled: official?.enabled ?? true,
    })
    setTarget({ kind: 'official', workerId: null })
  }

  const openWorker = (worker: Worker) => {
    setError(null)
    const config = configByWorkerId.get(worker.id)
    setForm({
      appId: config?.appId ?? '',
      appSecret: '',
      verificationToken: '',
      encryptKey: '',
      enabled: config?.enabled ?? true,
    })
    setTarget({ kind: 'worker', workerId: worker.id })
  }

  const activeConfig: FeishuBotConfigView | null =
    target === null
      ? null
      : target.kind === 'official'
        ? official
        : (target.workerId !== null
          ? (configByWorkerId.get(target.workerId) ?? null)
          : null)

  const submit = async () => {
    if (target === null) return
    const appId = form.appId.trim()
    if (!appId) {
      setError('请填写 APP ID')
      return
    }
    if (!activeConfig && !form.appSecret.trim()) {
      setError('首次配置必须填写 APP Secret')
      return
    }
    const input: FeishuBotSaveInput = {
      appId,
      enabled: form.enabled,
      ...(form.appSecret.trim() ? { appSecret: form.appSecret.trim() } : {}),
      ...(form.verificationToken.trim()
        ? { verificationToken: form.verificationToken.trim() }
        : {}),
      ...(form.encryptKey.trim() ? { encryptKey: form.encryptKey.trim() } : {}),
    }
    setSaving(true)
    setError(null)
    try {
      if (target.kind === 'official') {
        await api.saveFeishuBotOfficial(input)
      } else if (target.workerId !== null) {
        await api.saveFeishuBotWorker(target.workerId, input)
      }
      setTarget(null)
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const testConfig = async (config: FeishuBotConfigView) => {
    setError(null)
    setTestingId(config.id)
    try {
      await api.testFeishuBot(config.id)
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setTestingId(null)
    }
  }

  const removeConfig = async (config: FeishuBotConfigView) => {
    setError(null)
    try {
      await api.deleteFeishuBot(config.id)
      await load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-2xl font-semibold">飞书配置</h1>
        <p className="mt-1 text-sm text-foreground-muted">
          为机器人和平台官方机器人配置独立飞书应用（APP ID / APP
          Secret）。事件通过飞书 WebSocket 长连接接收（平台主动连接飞书，无需公网回调）；
          Secret 加密存储、只写不回显；绑定后机器人头像带「已连接飞书」角标。
        </p>
      </div>

      {error && <p className="mb-4 text-sm text-error-foreground">{error}</p>}

      {/* 平台官方机器人 */}
      <Card className="mb-6">
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <PlugConnected className="size-5 text-foreground-intense" />
            <CardTitle>平台官方机器人</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            {official ? (
              <>
                {configBadge(official)}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={testingId === official.id}
                  onClick={() => void testConfig(official)}
                >
                  {testingId === official.id ? '验证中…' : '验证连接'}
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger
                    render={<Button variant="ghost" size="sm" />}
                  >
                    删除
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>删除平台官方机器人配置？</AlertDialogTitle>
                      <AlertDialogDescription>
                        删除后任务群与官方机器人私聊将不可用，用户身份映射一并清除。
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogClose>
                        <Button variant="outline" size="sm">
                          取消
                        </Button>
                      </AlertDialogClose>
                      <AlertDialogClose>
                        <Button
                          variant="destructive"
                          onClick={() => void removeConfig(official)}
                        >
                          删除
                        </Button>
                      </AlertDialogClose>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
                <Button size="sm" onClick={openOfficial}>
                  编辑
                </Button>
              </>
            ) : (
              <Button size="sm" onClick={openOfficial}>
                配置
              </Button>
            )}
          </div>
        </CardHeader>
        <div className="px-6 pb-5">
          {official ? (
            <div className="grid gap-2 text-sm">
              <p>
                <span className="text-foreground-muted">APP ID：</span>
                <code className="rounded-sm bg-background-muted px-1.5 py-0.5">
                  {official.appId}
                </code>
              </p>
              <p>
                <span className="text-foreground-muted">连接方式：</span>
                <Badge variant="info">WebSocket 长连接</Badge>
                <span className="ml-2 text-foreground-muted">
                  飞书开放平台事件订阅选择「使用长连接接收事件」即可，无需公网回调地址
                </span>
              </p>
              <p className="text-foreground-muted">
                最近连接：
                {official.lastVerifiedAt
                  ? new Date(official.lastVerifiedAt).toLocaleString()
                  : '未连接'}
                {official.lastError ? (
                  <span className="ml-2 text-error-foreground">
                    {official.lastError}
                  </span>
                ) : null}
              </p>
              <p className="text-xs text-foreground-muted">
                飞书开放平台需为应用开启机器人能力，并开通消息收发、素材、群管理相关权限；
                订阅「读取用户发给机器人的单聊消息」事件后即可在飞书私聊机器人。
              </p>
            </div>
          ) : (
            <p className="text-sm text-foreground-muted">
              未配置。平台官方机器人负责任务群（任务 = 群）与官方私聊入口（私聊即当前用户的个人
              AGENT）。
            </p>
          )}
        </div>
      </Card>

      {/* 机器人绑定 */}
      <Toolbar aria-label="机器人筛选" className="mb-4">
        <ToolbarInput
          className="w-72"
          render={
            <Input
              placeholder="搜索机器人名称、ID 或简介…"
              clearable
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onClear={() => setKeyword('')}
              aria-label="搜索机器人"
            />
          }
        />
      </Toolbar>
      <Table hoverableRows>
        <TableHeader>
          <TableRow>
            <TableHead>机器人</TableHead>
            <TableHead>类型</TableHead>
            <TableHead>APP ID</TableHead>
            <TableHead>状态</TableHead>
            <TableHead className="w-56">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {workerRows.map((worker) => {
            const config = configByWorkerId.get(worker.id)
            return (
              <TableRow key={worker.id}>
                <TableCell>
                  <p
                    className="flex items-center gap-2 font-medium"
                    title={worker.name}
                  >
                    <RobotAvatar
                      name={worker.name}
                      avatarUrl={worker.avatarUrl}
                      size={26}
                      feishu={Boolean(config)}
                    />
                    <span className="truncate">{worker.name}</span>
                    <span className="text-xs font-normal text-foreground-muted">
                      #{worker.id}
                    </span>
                  </p>
                </TableCell>
                <TableCell>
                  {worker.personalAgentUserId ? (
                    <Badge variant="info">个人 AGENT</Badge>
                  ) : (
                    <Badge variant="soft">AI 机器人</Badge>
                  )}
                </TableCell>
                <TableCell>
                  {config ? (
                    <code className="rounded-sm bg-background-muted px-1.5 py-0.5">
                      {config.appId}
                    </code>
                  ) : (
                    <span className="text-foreground-muted">未绑定</span>
                  )}
                </TableCell>
                <TableCell>
                  {config ? (
                    configBadge(config)
                  ) : (
                    <Badge variant="soft">未绑定</Badge>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openWorker(worker)}
                    >
                      {config ? '编辑' : '绑定'}
                    </Button>
                    {config && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            navigate(
                              `/admin/feishu-config/policy/${config.id}`,
                            )
                          }
                        >
                          策略
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={testingId === config.id}
                          onClick={() => void testConfig(config)}
                        >
                          {testingId === config.id ? '验证中…' : '验证'}
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger
                            render={<Button variant="ghost" size="sm" />}
                          >
                            删除
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>
                                解除「{worker.name}」的飞书绑定？
                              </AlertDialogTitle>
                              <AlertDialogDescription>
                                删除后该机器人不再接收飞书消息，头像角标随之消失。
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogClose>
                                <Button variant="outline" size="sm">
                                  取消
                                </Button>
                              </AlertDialogClose>
                              <AlertDialogClose>
                                <Button
                                  variant="destructive"
                                  onClick={() => void removeConfig(config)}
                                >
                                  删除
                                </Button>
                              </AlertDialogClose>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            )
          })}
          {workerRows.length === 0 && (
            <TableRow>
              <TableCell colSpan={5}>
                <p className="py-6 text-center text-sm text-foreground-muted">
                  没有可绑定的机器人
                </p>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {/* 配置弹窗 */}
      <Dialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open) setTarget(null)
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {target?.kind === 'official'
                ? '配置平台官方机器人'
                : `绑定飞书应用：${workers.find((w) => w.id === target?.workerId)?.name ?? ''}`}
            </DialogTitle>
          </DialogHeader>
          <DialogBody>
            <div className="grid gap-4">
              <label className="grid gap-1.5 text-sm">
                <span>APP ID</span>
                <Input
                  value={form.appId}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, appId: e.target.value }))
                  }
                  placeholder="cli_xxxxxxxx"
                />
              </label>
              <label className="grid gap-1.5 text-sm">
                <span>
                  APP Secret
                  {activeConfig?.secretConfigured && (
                    <span className="ml-1 text-xs text-foreground-muted">
                      （已配置，留空保持不变）
                    </span>
                  )}
                </span>
                <Input
                  type="password"
                  value={form.appSecret}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, appSecret: e.target.value }))
                  }
                  placeholder={activeConfig?.secretConfigured ? '留空保持不变' : ''}
                />
              </label>
              <label className="grid gap-1.5 text-sm">
                <span>
                  事件 Verification Token
                  {activeConfig?.verificationTokenConfigured && (
                    <span className="ml-1 text-xs text-foreground-muted">
                      （已配置，留空保持不变）
                    </span>
                  )}
                </span>
                <Input
                  value={form.verificationToken}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      verificationToken: e.target.value,
                    }))
                  }
                  placeholder="选填，建议配置以校验事件来源"
                />
              </label>
              <label className="grid gap-1.5 text-sm">
                <span>
                  事件 Encrypt Key
                  {activeConfig?.encryptKeyConfigured && (
                    <span className="ml-1 text-xs text-foreground-muted">
                      （已配置，留空保持不变）
                    </span>
                  )}
                </span>
                <Input
                  value={form.encryptKey}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, encryptKey: e.target.value }))
                  }
                  placeholder="选填，配置后事件加密传输"
                />
              </label>
              {activeConfig && (
                <p className="text-xs text-foreground-muted">
                  连接方式：WebSocket 长连接（无需回调地址）
                </p>
              )}
              <span className="flex items-center gap-2 text-sm">
                <Switch
                  size="sm"
                  checked={form.enabled}
                  onCheckedChange={(checked) =>
                    setForm((prev) => ({ ...prev, enabled: checked }))
                  }
                />
                {form.enabled ? '启用（接收事件、参与任务群）' : '停用'}
              </span>
            </div>
          </DialogBody>
          <DialogFooter>
            <p className="mr-auto text-xs text-foreground-muted">
              保存时会先调用飞书接口校验 APP ID / APP Secret，无效不会保存。
            </p>
            <DialogClose render={<Button variant="ghost" />}>取消</DialogClose>
            <Button disabled={saving} onClick={() => void submit()}>
              {saving ? '校验并保存中…' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
