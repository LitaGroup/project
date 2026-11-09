import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  Toolbar,
  ToolbarButton,
  ToolbarGroup,
  ToolbarInput,
} from '@appica/ui-react/toolbar'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@appica/ui-react/select'
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
import { Loader } from '@appica/ui-react/loader'
import {
  api,
  MCP_AUTH_MODES,
  MCP_AUTH_MODE_LABELS,
  MCP_SERVER_TYPES,
  MCP_SERVER_TYPE_LABELS,
  type McpAuthMode,
  type McpServerConfig,
  type McpServerSaveInput,
  type McpServerTestResult,
  type McpServerType,
  type Worker,
} from '../lib/api'

/** 成功反馈停留时长 */
const SUCCESS_STAY_MS = 2_000
/** 失败反馈停留时长 */
const FAILURE_STAY_MS = 5_000

type Feedback =
  | { kind: 'success'; message: string }
  | { kind: 'failure'; message: string }
  | null

interface ConfigForm {
  name: string
  type: McpServerType
  url: string
  command: string
  authMode: McpAuthMode
  authHeader: string
  authPrefix: string
  authSecret: string
  enabled: boolean
  remark: string
}

const EMPTY_FORM: ConfigForm = {
  name: '',
  type: 'remote',
  url: '',
  command: '',
  authMode: 'none',
  authHeader: 'Authorization',
  authPrefix: '',
  authSecret: '',
  enabled: true,
  remark: '',
}

/** 类型筛选选项 */
const TYPE_FILTER_ITEMS: Record<string, string> = {
  all: '全部类型',
  ...MCP_SERVER_TYPE_LABELS,
}

/** 鉴权方式展示文案 */
function authLabel(config: McpServerConfig): string {
  if (config.authMode === 'none') return MCP_AUTH_MODE_LABELS.none
  if (config.authMode === 'fixed') {
    return config.hasSecret ? '固定令牌（已配置）' : '固定令牌（未配置）'
  }
  if (config.authMode === 'env') {
    return `环境变量 ${config.envName ?? ''}`.trim()
  }
  return MCP_AUTH_MODE_LABELS['work-token']
}

/** 地址/命令展示 */
function targetLabel(config: McpServerConfig): string {
  if (config.type === 'remote') return config.url ?? '—'
  return config.command?.length ? config.command.join(' ') : '—'
}

function testStatusBadge(result: McpServerTestResult) {
  if (result.status === 'connected') {
    return <Badge variant="success">连接成功</Badge>
  }
  if (result.status === 'auth-rejected') {
    return <Badge variant="warning">鉴权被拒绝</Badge>
  }
  return <Badge variant="error">连接失败</Badge>
}

/**
 * 管理区「MCP 配置」：维护机器人可连接的外部 MCP 服务。
 * 一条配置对应一个 MCP server；机器人在配置页多选后，初始化/派发时写入工位
 * `.opencode/opencode.json`（与平台 lita-work 并列）。固定令牌只写不回显。
 */
export function McpServersPage() {
  const [items, setItems] = useState<McpServerConfig[]>([])
  const [error, setError] = useState<string | null>(null)
  const [keyword, setKeyword] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | McpServerType>('all')

  /** undefined = 关闭；null = 新建；对象 = 编辑 */
  const [editing, setEditing] = useState<McpServerConfig | null | undefined>(
    undefined,
  )
  const [form, setForm] = useState<ConfigForm>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<Feedback>(null)

  const [deleteTarget, setDeleteTarget] = useState<McpServerConfig | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteFeedback, setDeleteFeedback] = useState<Feedback>(null)

  const [testTarget, setTestTarget] = useState<McpServerConfig | null>(null)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<McpServerTestResult | null>(null)
  const [testError, setTestError] = useState<string | null>(null)
  const [testWorkerId, setTestWorkerId] = useState('')
  const [workers, setWorkers] = useState<Worker[]>([])

  /** 反馈计时器：成功 2 秒进入下一步，失败 5 秒自动关闭（可提前关闭） */
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const deleteFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  )

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
    }
  }, [])

  const showFeedback = (
    next: NonNullable<Feedback>,
    stayMs: number,
    after?: () => void,
  ) => {
    clearTimer(feedbackTimerRef)
    setFeedback(next)
    feedbackTimerRef.current = setTimeout(() => {
      feedbackTimerRef.current = null
      setFeedback(null)
      after?.()
    }, stayMs)
  }

  const showDeleteFeedback = (
    next: NonNullable<Feedback>,
    stayMs: number,
    after?: () => void,
  ) => {
    clearTimer(deleteFeedbackTimerRef)
    setDeleteFeedback(next)
    deleteFeedbackTimerRef.current = setTimeout(() => {
      deleteFeedbackTimerRef.current = null
      setDeleteFeedback(null)
      after?.()
    }, stayMs)
  }

  const load = useCallback(async () => {
    setError(null)
    try {
      setItems(await api.listMcpServers())
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // work-token 模式连接测试可借用机器人令牌，打开测试弹窗时按需加载机器人清单
  useEffect(() => {
    if (!testTarget || testTarget.authMode !== 'work-token') return
    let alive = true
    api
      .listWorkers({ includePersonal: false })
      .then((rows) => {
        if (alive) setWorkers(rows.filter((row) => row.runtime === 'opencode'))
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [testTarget])

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase()
    return items.filter((item) => {
      if (typeFilter !== 'all' && item.type !== typeFilter) return false
      if (!q) return true
      return (
        item.name.toLowerCase().includes(q) ||
        (item.url ?? '').toLowerCase().includes(q) ||
        (item.command ?? []).join(' ').toLowerCase().includes(q) ||
        (item.remark ?? '').toLowerCase().includes(q)
      )
    })
  }, [items, keyword, typeFilter])

  const openCreate = () => {
    setForm(EMPTY_FORM)
    setFeedback(null)
    setEditing(null)
  }

  const openEdit = (config: McpServerConfig) => {
    setForm({
      name: config.name,
      type: config.type,
      url: config.url ?? '',
      command: (config.command ?? []).join(' '),
      authMode: config.authMode,
      authHeader: config.authHeader,
      authPrefix: config.authPrefix ?? '',
      authSecret: config.authMode === 'env' ? (config.envName ?? '') : '',
      enabled: config.enabled,
      remark: config.remark ?? '',
    })
    setFeedback(null)
    setEditing(config)
  }

  const updateType = (type: McpServerType) => {
    setForm((prev) => {
      const current = prev.authHeader.trim()
      // 仅当仍是默认头名时随类型切换，用户自定义的保持不变
      const keepCustom = current !== '' && current !== 'Authorization' && current !== 'MCP_API_KEY'
      return {
        ...prev,
        type,
        authHeader: keepCustom
          ? prev.authHeader
          : type === 'local'
            ? 'MCP_API_KEY'
            : 'Authorization',
      }
    })
  }

  const submit = async () => {
    if (saving || feedback?.kind === 'success') return
    if (!form.name.trim()) {
      showFeedback({ kind: 'failure', message: '名称不能为空' }, FAILURE_STAY_MS)
      return
    }
    if (form.type === 'remote' && !form.url.trim()) {
      showFeedback({ kind: 'failure', message: '请填写服务地址' }, FAILURE_STAY_MS)
      return
    }
    if (form.type === 'local' && !form.command.trim()) {
      showFeedback({ kind: 'failure', message: '请填写本地命令' }, FAILURE_STAY_MS)
      return
    }
    if (
      form.authMode === 'fixed' &&
      !form.authSecret.trim() &&
      !editing?.hasSecret
    ) {
      showFeedback({ kind: 'failure', message: '请填写固定令牌' }, FAILURE_STAY_MS)
      return
    }
    if (form.authMode === 'env' && !form.authSecret.trim()) {
      showFeedback(
        { kind: 'failure', message: '请填写环境变量名' },
        FAILURE_STAY_MS,
      )
      return
    }
    const payload: McpServerSaveInput = {
      name: form.name.trim(),
      type: form.type,
      url: form.type === 'remote' ? form.url.trim() : null,
      command: form.type === 'local' ? form.command.trim() : null,
      authMode: form.authMode,
      authHeader:
        form.authMode === 'none'
          ? null
          : form.authHeader.trim() ||
            (form.type === 'local' ? 'MCP_API_KEY' : 'Authorization'),
      authPrefix:
        form.authMode === 'none' || form.type === 'local'
          ? null
          : form.authPrefix.trim() || null,
      // 固定令牌编辑时留空表示保持原值；env 模式为空会被后端拒绝
      authSecret:
        form.authMode === 'fixed' || form.authMode === 'env'
          ? form.authSecret.trim() || null
          : null,
      enabled: form.enabled,
      remark: form.remark.trim() || null,
    }
    setSaving(true)
    setFeedback(null)
    try {
      if (editing) {
        await api.updateMcpServer(editing.id, payload)
      } else {
        await api.createMcpServer(payload)
      }
      showFeedback({ kind: 'success', message: '已保存' }, SUCCESS_STAY_MS, () => {
        setEditing(undefined)
        void load()
      })
    } catch (e) {
      showFeedback(
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
      await api.deleteMcpServer(deleteTarget.id)
      showDeleteFeedback(
        { kind: 'success', message: '已删除' },
        SUCCESS_STAY_MS,
        () => {
          setDeleteTarget(null)
          void load()
        },
      )
    } catch (e) {
      showDeleteFeedback(
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

  const runTest = async () => {
    if (!testTarget || testing) return
    setTesting(true)
    setTestResult(null)
    setTestError(null)
    try {
      const result = await api.testMcpServer(
        testTarget.id,
        testWorkerId ? Number(testWorkerId) : null,
      )
      setTestResult(result)
    } catch (e) {
      setTestError(e instanceof Error ? e.message : '连接测试失败')
    } finally {
      setTesting(false)
    }
  }

  const workerItems = useMemo(
    () => ({
      none: '不借用机器人令牌（匿名测试）',
      ...Object.fromEntries(workers.map((worker) => [String(worker.id), worker.name])),
    }),
    [workers],
  )

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">MCP 配置</h1>
          <p className="mt-1 text-sm text-foreground-muted">
            机器人可连接的外部 MCP 服务；在机器人配置页多选后，初始化时写入工位
            opencode.json（与 lita-work 并列）。
          </p>
        </div>
        <Button size="sm" onClick={openCreate}>
          新建 MCP
        </Button>
      </div>

      <Toolbar aria-label="MCP 配置筛选" className="mb-4">
        <ToolbarInput
          className="w-72"
          render={
            <Input
              placeholder="搜索名称、地址、命令或备注…"
              clearable
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onClear={() => setKeyword('')}
              aria-label="搜索 MCP 配置"
            />
          }
        />
        <ToolbarGroup aria-label="筛选">
          <Select
            value={typeFilter}
            onValueChange={(value) =>
              setTypeFilter(value as 'all' | McpServerType)
            }
            items={TYPE_FILTER_ITEMS}
          >
            <ToolbarButton
              className="w-40"
              render={
                <SelectTrigger aria-label="按类型筛选">
                  <SelectValue placeholder="类型" />
                </SelectTrigger>
              }
            />
            <SelectContent>
              {Object.entries(TYPE_FILTER_ITEMS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </ToolbarGroup>
      </Toolbar>

      {error && <p className="mb-4 text-sm">加载失败：{error}</p>}

      <Table hoverableRows>
        <TableHeader>
          <TableRow>
            <TableHead className="w-40">名称</TableHead>
            <TableHead className="w-40">类型</TableHead>
            <TableHead>地址 / 命令</TableHead>
            <TableHead className="w-56">鉴权</TableHead>
            <TableHead className="w-20">启用</TableHead>
            <TableHead className="w-44">更新时间</TableHead>
            <TableHead className="w-56">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((item) => (
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
              <TableCell className="text-foreground-muted">
                {MCP_SERVER_TYPE_LABELS[item.type]}
              </TableCell>
              <TableCell
                className="max-w-96 truncate font-mono text-xs text-foreground-muted"
                title={targetLabel(item)}
              >
                {targetLabel(item)}
              </TableCell>
              <TableCell className="text-foreground-muted">
                {authLabel(item)}
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
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setTestTarget(item)
                      setTestWorkerId('')
                      setTestResult(null)
                      setTestError(null)
                    }}
                  >
                    测试
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => openEdit(item)}>
                    编辑
                  </Button>
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
                      render={
                        <Button variant="ghost" size="sm">
                          删除
                        </Button>
                      }
                    />
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          删除 MCP 配置「{item.name}」？
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          删除后会同时从所有机器人的 MCP 选择中移除；工位在下一次初始化或派发时更新。
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
                                  deleting ||
                                  deleteFeedback?.kind === 'success'
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
          {filtered.length === 0 && (
            <TableRow>
              <TableCell colSpan={7}>
                {items.length === 0
                  ? '暂无 MCP 配置，点击右上角「新建 MCP」创建'
                  : '没有匹配的 MCP 配置'}
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
            <DialogTitle>{editing ? `编辑 MCP：${editing.name}` : '新建 MCP'}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <div className="grid gap-4">
              <label className="grid gap-1.5 text-sm">
                <span>名称</span>
                <Input
                  value={form.name}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, name: e.target.value }))
                  }
                  placeholder="如 context7（同时作为 opencode 服务标识）"
                />
                <span className="text-xs text-foreground-muted">
                  仅支持字母、数字、- 和 _，不超过 64 个字符；工具名会带该前缀。
                </span>
              </label>
              <label className="grid gap-1.5 text-sm">
                <span>类型</span>
                <Select
                  value={form.type}
                  onValueChange={(value) => updateType(value as McpServerType)}
                  items={MCP_SERVER_TYPE_LABELS}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MCP_SERVER_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {MCP_SERVER_TYPE_LABELS[type]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-xs text-foreground-muted">
                  opencode V2 仅支持 Streamable HTTP（remote）与 stdio 本地命令（local）；
                  纯 SSE 端点可用 local 命令桥接，如
                  <code className="mx-1">npx -y mcp-remote https://example.com/sse</code>
                </span>
              </label>
              {form.type === 'remote' ? (
                <label className="grid gap-1.5 text-sm">
                  <span>地址</span>
                  <Input
                    value={form.url}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, url: e.target.value }))
                    }
                    placeholder="https://mcp.example.com/mcp"
                  />
                </label>
              ) : (
                <label className="grid gap-1.5 text-sm">
                  <span>本地命令</span>
                  <Input
                    value={form.command}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, command: e.target.value }))
                    }
                    placeholder="npx -y @modelcontextprotocol/server-xxx"
                  />
                  <span className="text-xs text-foreground-muted">
                    按空格拆分为可执行文件与参数；命令运行在执行器宿主上。
                  </span>
                </label>
              )}
              <label className="grid gap-1.5 text-sm">
                <span>鉴权方式</span>
                <Select
                  value={form.authMode}
                  onValueChange={(value) =>
                    setForm((prev) => ({
                      ...prev,
                      authMode: value as McpAuthMode,
                      authSecret: '',
                    }))
                  }
                  items={MCP_AUTH_MODE_LABELS}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MCP_AUTH_MODES.map((mode) => (
                      <SelectItem key={mode} value={mode}>
                        {MCP_AUTH_MODE_LABELS[mode]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-xs text-foreground-muted">
                  固定令牌明文写入工位（权限 600）；环境变量使用
                  {' {env:NAME} '}
                  占位，凭据不落盘；LITA_WORK_TOKEN 注入当前机器人自己的平台令牌。
                </span>
              </label>
              {form.authMode !== 'none' && (
                <>
                  <label className="grid gap-1.5 text-sm">
                    <span>
                      {form.type === 'local' ? '环境变量名（传给命令）' : '请求头名'}
                    </span>
                    <Input
                      value={form.authHeader}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          authHeader: e.target.value,
                        }))
                      }
                      placeholder={
                        form.type === 'local' ? 'MCP_API_KEY' : 'Authorization'
                      }
                    />
                  </label>
                  {form.type === 'remote' && (
                    <label className="grid gap-1.5 text-sm">
                      <span>值前缀（可选）</span>
                      <Input
                        value={form.authPrefix}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            authPrefix: e.target.value,
                          }))
                        }
                        placeholder="如 Bearer"
                      />
                    </label>
                  )}
                  {form.authMode === 'fixed' && (
                    <label className="grid gap-1.5 text-sm">
                      <span>
                        固定令牌
                        {editing?.hasSecret && (
                          <span className="ml-1 text-xs text-foreground-muted">
                            （已配置，留空保持不变）
                          </span>
                        )}
                      </span>
                      <Input
                        type="password"
                        value={form.authSecret}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            authSecret: e.target.value,
                          }))
                        }
                        placeholder={editing?.hasSecret ? '留空保持不变' : '填写令牌'}
                      />
                    </label>
                  )}
                  {form.authMode === 'env' && (
                    <label className="grid gap-1.5 text-sm">
                      <span>环境变量名</span>
                      <Input
                        value={form.authSecret}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            authSecret: e.target.value,
                          }))
                        }
                        placeholder="如 MCP_API_TOKEN"
                      />
                      <span className="text-xs text-foreground-muted">
                        变量值由执行器宿主的工位环境提供，平台不保存凭据原文。
                      </span>
                    </label>
                  )}
                </>
              )}
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
                {form.enabled ? '启用（可被机器人选择）' : '停用（保留配置但不注入）'}
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

      {/* 连接测试弹窗 */}
      <Dialog
        open={testTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setTestTarget(null)
            setTestResult(null)
            setTestError(null)
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>连接测试：{testTarget?.name ?? ''}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <div className="grid gap-4">
              {testTarget?.authMode === 'work-token' && (
                <label className="grid gap-1.5 text-sm">
                  <span>借用机器人令牌（可选）</span>
                  <Select
                    value={testWorkerId || 'none'}
                    onValueChange={(value) =>
                      setTestWorkerId(value === 'none' ? '' : (value as string))
                    }
                    items={workerItems}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="不借用" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">
                        不借用机器人令牌（匿名测试）
                      </SelectItem>
                      {workers.map((worker) => (
                        <SelectItem key={worker.id} value={String(worker.id)}>
                          {worker.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="text-xs text-foreground-muted">
                    需要机器人已初始化（已生成令牌）；不选择时按匿名请求测试可达性。
                  </span>
                </label>
              )}
              <Button size="sm" disabled={testing} onClick={() => void runTest()}>
                {testing ? '测试中…' : '开始测试'}
              </Button>
              {testing && (
                <p className="flex items-center gap-2 text-sm text-foreground-muted">
                  <Loader variant="dots" currentColor />
                  正在握手并读取工具清单，最多等待 10 秒…
                </p>
              )}
              {testError && (
                <p className="rounded-[var(--radius-md)] bg-background-muted px-3 py-2 text-sm">
                  测试失败：{testError}
                </p>
              )}
              {testResult && (
                <div className="flex flex-col gap-2 rounded-[var(--radius-md)] bg-background-muted px-3 py-3 text-sm">
                  <div className="flex items-center gap-2">
                    {testStatusBadge(testResult)}
                    <span className="text-foreground-muted">
                      {testResult.durationMs}ms
                    </span>
                  </div>
                  <p>{testResult.message}</p>
                  {testResult.serverName && (
                    <p className="text-foreground-muted">
                      服务：{testResult.serverName}
                      {testResult.serverVersion
                        ? ` ${testResult.serverVersion}`
                        : ''}
                    </p>
                  )}
                  {testResult.toolCount !== null && (
                    <div>
                      <p className="text-foreground-muted">
                        工具数：{testResult.toolCount}
                      </p>
                      {testResult.tools.length > 0 && (
                        <p className="mt-1 break-words text-xs text-foreground-muted">
                          {testResult.tools.join('、')}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </DialogBody>
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" size="sm" />}>
              关闭
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
