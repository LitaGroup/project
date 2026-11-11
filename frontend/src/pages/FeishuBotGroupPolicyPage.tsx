import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
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
import { Button } from '@appica/ui-react/button'
import { Badge } from '@appica/ui-react/badge'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@appica/ui-react/select'
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverTitle,
  PopoverDescription,
} from '@appica/ui-react/popover'
import { ArrowLeft, ChevronLeft, ChevronRight } from '@appica/icons-react'
import {
  api,
  FEISHU_BOT_GROUP_POLICIES,
  FEISHU_BOT_GROUP_POLICY_LABELS,
  type FeishuBotConfigView,
  type FeishuBotGroupPolicy,
  type FeishuBotGroupRecordView,
  type FeishuBotGroupView,
  type Worker,
} from '../lib/api'
import { RobotAvatar } from '../components/task-detail/WorkerAvatar'

/** 成功反馈停留时长 */
const SUCCESS_STAY_MS = 2_000
/** 失败反馈停留时长 */
const FAILURE_STAY_MS = 5_000
/** 单群策略选择中「跟随默认」的哨兵值 */
const INHERIT_VALUE = 'inherit'
/** 记录筛选「全部」的哨兵值 */
const ALL_KINDS = 'all'
/** 记录分页大小 */
const RECORD_PAGE_SIZE = 20

type Feedback = { id: string; kind: 'success' | 'failure'; message: string }

/** 策略选择项（含跟随默认） */
const POLICY_ITEMS: Record<string, string> = {
  [INHERIT_VALUE]: '跟随默认',
  ...Object.fromEntries(
    FEISHU_BOT_GROUP_POLICIES.map((policy) => [
      policy,
      FEISHU_BOT_GROUP_POLICY_LABELS[policy],
    ]),
  ),
}

/** 默认策略选择项 */
const DEFAULT_POLICY_ITEMS: Record<string, string> = Object.fromEntries(
  FEISHU_BOT_GROUP_POLICIES.map((policy) => [
    policy,
    FEISHU_BOT_GROUP_POLICY_LABELS[policy],
  ]),
)

/** 记录类型筛选 */
const RECORD_KIND_ITEMS: Record<string, string> = {
  [ALL_KINDS]: '全部类型',
  message: '消息',
  reply: '回复',
  bot_added: '被拉入群',
  bot_removed: '被移出群',
}

const RECORD_KIND_LABELS: Record<FeishuBotGroupRecordView['kind'], string> = {
  message: '消息',
  reply: '回复',
  bot_added: '被拉入群',
  bot_removed: '被移出群',
}

const DECISION_LABELS: Record<
  NonNullable<FeishuBotGroupRecordView['decision']>,
  string
> = {
  replied: '已回复',
  silent: 'AI 静默',
  not_mentioned: '未@机器人',
  record_only: '仅记录',
  busy: '处理中跳过',
  error: '失败',
}

/** 处理结果 Badge 颜色 */
function decisionBadge(record: FeishuBotGroupRecordView) {
  if (record.kind !== 'message') return <span>-</span>
  const decision = record.decision
  if (!decision) return <span className="text-foreground-muted">-</span>
  const label = DECISION_LABELS[decision]
  switch (decision) {
    case 'replied':
      return <Badge variant="success">{label}</Badge>
    case 'error':
      return <Badge variant="warning">{label}</Badge>
    case 'busy':
      return <Badge variant="info">{label}</Badge>
    default:
      return <Badge variant="soft">{label}</Badge>
  }
}

/** 时间格式化（本地时区） */
function formatTime(value: string | null): string {
  if (!value) return '-'
  return new Date(value).toLocaleString()
}

/**
 * 机器人外部群策略与记录（管理区）：
 * - 机器人绑定的飞书应用被拉进外部群后，可按群配置答复策略；
 * - 平台自建的任务群/项目沟通群不在策略范围内；
 * - 记录机器人进出群与群会话（消息/回复），默认保留 30 天。
 */
export function FeishuBotGroupPolicyPage() {
  const { configId: configIdParam } = useParams()
  const configId = Number(configIdParam)
  const navigate = useNavigate()

  const [config, setConfig] = useState<FeishuBotConfigView | null>(null)
  const [worker, setWorker] = useState<Worker | null>(null)
  const [defaultPolicy, setDefaultPolicy] =
    useState<FeishuBotGroupPolicy>('at')
  const [groups, setGroups] = useState<FeishuBotGroupView[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [selectedGroup, setSelectedGroup] = useState<FeishuBotGroupView | null>(
    null,
  )
  const [records, setRecords] = useState<FeishuBotGroupRecordView[]>([])
  const [recordTotal, setRecordTotal] = useState(0)
  const [recordPage, setRecordPage] = useState(1)
  const [recordKind, setRecordKind] = useState(ALL_KINDS)
  const [recordsLoading, setRecordsLoading] = useState(false)

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  useEffect(() => clearTimer, [])

  /** 展示反馈气泡，停留后自动关闭 */
  const showFeedback = (
    id: string,
    kind: Feedback['kind'],
    message: string,
  ) => {
    clearTimer()
    setFeedback({ id, kind, message })
    timerRef.current = setTimeout(
      () => {
        setFeedback(null)
      },
      kind === 'success' ? SUCCESS_STAY_MS : FAILURE_STAY_MS,
    )
  }

  const loadGroups = useCallback(async () => {
    if (!Number.isInteger(configId) || configId <= 0) return
    const data = await api.listFeishuBotGroups(configId)
    setDefaultPolicy(data.defaultPolicy)
    setGroups(data.groups)
    return data
  }, [configId])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const [list, workerList] = await Promise.all([
          api.listFeishuBotConfigs(),
          api.listWorkers({ includePersonal: true }),
        ])
        if (cancelled) return
        const found =
          list.workers.find((item) => item.id === configId) ?? null
        setConfig(found)
        setWorker(
          found?.workerId
            ? (workerList.find((item) => item.id === found.workerId) ?? null)
            : null,
        )
        if (found) await loadGroups()
      } catch (e) {
        if (!cancelled) setError((e as Error).message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [configId, loadGroups])

  /** 手动刷新群列表（新群懒创建后无需重新加载页面） */
  const refreshGroups = async () => {
    setRefreshing(true)
    setError(null)
    try {
      await loadGroups()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setRefreshing(false)
    }
  }

  const saveDefaultPolicy = async (value: string) => {
    if (!config) return
    const next = value as FeishuBotGroupPolicy
    const previous = defaultPolicy
    setDefaultPolicy(next)
    try {
      await api.saveFeishuBotGroupDefaultPolicy(config.id, next)
      await loadGroups()
      showFeedback('default', 'success', `已保存为「${POLICY_ITEMS[next]}」`)
    } catch (e) {
      setDefaultPolicy(previous)
      showFeedback('default', 'failure', (e as Error).message)
    }
  }

  const saveGroupPolicy = async (group: FeishuBotGroupView, value: string) => {
    if (!config) return
    const next =
      value === INHERIT_VALUE ? null : (value as FeishuBotGroupPolicy)
    const previous = groups
    setGroups((items) =>
      items.map((item) =>
        item.id === group.id
          ? {
              ...item,
              policy: next,
              effectivePolicy: next ?? defaultPolicy,
            }
          : item,
      ),
    )
    try {
      await api.saveFeishuBotGroupPolicy(config.id, group.id, next)
      showFeedback(
        `group-${group.id}`,
        'success',
        next ? `已保存为「${POLICY_ITEMS[next]}」` : '已改为跟随默认策略',
      )
    } catch (e) {
      setGroups(previous)
      showFeedback(`group-${group.id}`, 'failure', (e as Error).message)
    }
  }

  const loadRecords = useCallback(
    async (group: FeishuBotGroupView, page: number, kind: string) => {
      if (!config) return
      setRecordsLoading(true)
      setError(null)
      try {
        const data = await api.listFeishuBotGroupRecords(config.id, group.id, {
          page,
          pageSize: RECORD_PAGE_SIZE,
          ...(kind !== ALL_KINDS ? { kind } : {}),
        })
        setRecords(data.items)
        setRecordTotal(data.total)
      } catch (e) {
        setError((e as Error).message)
      } finally {
        setRecordsLoading(false)
      }
    },
    [config],
  )

  const openRecords = (group: FeishuBotGroupView) => {
    setSelectedGroup(group)
    setRecords([])
    setRecordTotal(0)
    setRecordPage(1)
    setRecordKind(ALL_KINDS)
    if (config) {
      setRecordsLoading(true)
      setError(null)
      void api
        .listFeishuBotGroupRecords(config.id, group.id, {
          page: 1,
          pageSize: RECORD_PAGE_SIZE,
        })
        .then((data) => {
          setRecords(data.items)
          setRecordTotal(data.total)
        })
        .catch((e: Error) => setError(e.message))
        .finally(() => setRecordsLoading(false))
    }
  }

  const changeRecordPage = (page: number) => {
    if (!selectedGroup) return
    setRecordPage(page)
    void loadRecords(selectedGroup, page, recordKind)
  }

  const changeRecordKind = (kind: string) => {
    setRecordKind(kind)
    setRecordPage(1)
    if (selectedGroup) void loadRecords(selectedGroup, 1, kind)
  }

  const pageCount = Math.max(1, Math.ceil(recordTotal / RECORD_PAGE_SIZE))

  const groupItems = useMemo(() => POLICY_ITEMS, [])

  if (loading) {
    return <p className="text-sm text-foreground-muted">加载中…</p>
  }

  if (!config) {
    return (
      <div>
        <Button variant="ghost" size="sm" onClick={() => navigate('/admin/feishu-config')}>
          <ArrowLeft className="size-4" /> 返回飞书配置
        </Button>
        <p className="mt-4 text-sm text-foreground-muted">
          未找到该飞书配置，可能已被删除。
        </p>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <Button
            variant="ghost"
            size="sm"
            className="mb-2 -ml-2"
            onClick={() => navigate('/admin/feishu-config')}
          >
            <ArrowLeft className="size-4" /> 返回飞书配置
          </Button>
          <h1 className="text-2xl font-semibold">
            {selectedGroup
              ? `群记录：${selectedGroup.name ?? selectedGroup.chatId}`
              : '群策略'}
          </h1>
          <p className="mt-1 text-sm text-foreground-muted">
            {selectedGroup
              ? '机器人进出群事件与群会话记录（消息/回复），默认保留 30 天。'
              : `机器人绑定的飞书应用被拉进外部群后按群生效；平台自建的任务群/项目沟通群不在策略范围内。`}
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
          <RobotAvatar
            name={worker?.name ?? config.name ?? '机器人'}
            avatarUrl={worker?.avatarUrl}
            size={30}
            feishu
          />
          <div className="text-sm">
            <p className="font-medium">{worker?.name ?? config.name ?? '机器人'}</p>
            <p className="text-xs text-foreground-muted">
              <code className="rounded-sm bg-background-muted px-1 py-0.5">
                {config.appId}
              </code>
            </p>
          </div>
          {!selectedGroup && (
            <Button
              variant="outline"
              size="sm"
              disabled={refreshing}
              onClick={() => void refreshGroups()}
            >
              {refreshing ? '刷新中…' : '刷新'}
            </Button>
          )}
        </div>
      </div>

      {error && <p className="mb-4 text-sm text-error-foreground">{error}</p>}

      {selectedGroup ? (
        <RecordsView
          group={selectedGroup}
          records={records}
          loading={recordsLoading}
          total={recordTotal}
          page={recordPage}
          pageCount={pageCount}
          kind={recordKind}
          onKindChange={changeRecordKind}
          onPageChange={changeRecordPage}
          onBack={() => setSelectedGroup(null)}
        />
      ) : (
        <>
          <Card className="mb-6">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>默认策略</CardTitle>
                <p className="mt-1 text-sm text-foreground-muted">
                  未单独配置策略的群按默认策略处理；建议先保持「仅被@反馈」，确认效果后再逐群放开。
                </p>
              </div>
              <Popover
                open={feedback?.id === 'default'}
                onOpenChange={(open) => {
                  if (!open && feedback?.kind === 'failure') {
                    clearTimer()
                    setFeedback(null)
                  }
                }}
              >
                <PopoverTrigger
                  render={
                    <span className="inline-flex">
                      <Select
                        value={defaultPolicy}
                        onValueChange={(value) =>
                          void saveDefaultPolicy(String(value))
                        }
                        items={DEFAULT_POLICY_ITEMS}
                      >
                        <SelectTrigger aria-label="默认策略">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {FEISHU_BOT_GROUP_POLICIES.map((policy) => (
                            <SelectItem key={policy} value={policy}>
                              {FEISHU_BOT_GROUP_POLICY_LABELS[policy]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </span>
                  }
                />
                <PopoverContent side="top" align="center">
                  <PopoverTitle>
                    {feedback?.kind === 'success' ? '成功' : '失败'}
                  </PopoverTitle>
                  <PopoverDescription>{feedback?.message}</PopoverDescription>
                </PopoverContent>
              </Popover>
            </CardHeader>
          </Card>

          <Table hoverableRows>
            <TableHeader>
              <TableRow>
                <TableHead>群名称</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="w-48">策略</TableHead>
                <TableHead>最近消息</TableHead>
                <TableHead className="w-20">消息数</TableHead>
                <TableHead className="w-28">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((group) => (
                <TableRow key={group.id}>
                  <TableCell>
                    <p className="font-medium" title={group.name ?? group.chatId}>
                      {group.name ?? '未命名群'}
                    </p>
                    <p className="text-xs text-foreground-muted">
                      {group.chatId}
                    </p>
                  </TableCell>
                  <TableCell>
                    {group.leftAt ? (
                      <Badge variant="soft">已移出</Badge>
                    ) : (
                      <Badge variant="success">在群内</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Popover
                      open={feedback?.id === `group-${group.id}`}
                      onOpenChange={(open) => {
                        if (!open && feedback?.kind === 'failure') {
                          clearTimer()
                          setFeedback(null)
                        }
                      }}
                    >
                      <PopoverTrigger
                        render={
                          <span className="inline-flex">
                            <Select
                              value={group.policy ?? INHERIT_VALUE}
                              onValueChange={(value) =>
                                void saveGroupPolicy(group, String(value))
                              }
                              items={groupItems}
                            >
                              <SelectTrigger aria-label={`${group.name ?? group.chatId} 策略`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={INHERIT_VALUE}>
                                  {POLICY_ITEMS[INHERIT_VALUE]}
                                </SelectItem>
                                {FEISHU_BOT_GROUP_POLICIES.map((policy) => (
                                  <SelectItem key={policy} value={policy}>
                                    {FEISHU_BOT_GROUP_POLICY_LABELS[policy]}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </span>
                        }
                      />
                      <PopoverContent side="top" align="center">
                        <PopoverTitle>
                          {feedback?.kind === 'success' ? '成功' : '失败'}
                        </PopoverTitle>
                        <PopoverDescription>
                          {feedback?.message}
                        </PopoverDescription>
                      </PopoverContent>
                    </Popover>
                    <p className="mt-1 text-xs text-foreground-muted">
                      当前生效：{FEISHU_BOT_GROUP_POLICY_LABELS[group.effectivePolicy]}
                    </p>
                  </TableCell>
                  <TableCell>{formatTime(group.lastMessageAt)}</TableCell>
                  <TableCell>{group.messageCount}</TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openRecords(group)}
                    >
                      查看记录
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {groups.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6}>
                    <p className="py-6 text-center text-sm text-foreground-muted">
                      还没有群记录：机器人被拉入外部群后会自动出现在这里。
                    </p>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          <p className="mt-4 text-xs text-foreground-muted">
            提示：需要在飞书开放平台为应用订阅「机器人进群」「机器人出群」事件（经长连接接收），
            才能在此看到完整的进出群记录；未订阅时仍可收到群消息并懒创建群记录。
            「智能反馈」按 5 秒窗口 / 10 条上限批量处理消息，支持按消息 ID 定向回复；
            话题消息会以回复形式落回原话题并按话题独立会话；「仅被 @」策略下机器人会补拉最近的话题/群聊消息作为上文，
            需要应用开通消息读取权限（im:message 或 im:message.group_msg）。
          </p>
        </>
      )}
    </div>
  )
}

/** 群时间线记录视图 */
function RecordsView({
  group,
  records,
  loading,
  total,
  page,
  pageCount,
  kind,
  onKindChange,
  onPageChange,
  onBack,
}: {
  group: FeishuBotGroupView
  records: FeishuBotGroupRecordView[]
  loading: boolean
  total: number
  page: number
  pageCount: number
  kind: string
  onKindChange: (kind: string) => void
  onPageChange: (page: number) => void
  onBack: () => void
}) {
  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-foreground-muted">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="size-4" /> 返回群列表
          </Button>
          <span>{group.chatId}</span>
          <span>共 {total} 条</span>
        </div>
        <Select
          value={kind}
          onValueChange={(value) => onKindChange(String(value))}
          items={RECORD_KIND_ITEMS}
        >
          <SelectTrigger aria-label="记录类型筛选">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(RECORD_KIND_ITEMS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Table hoverableRows>
        <TableHeader>
          <TableRow>
            <TableHead className="w-44">时间</TableHead>
            <TableHead className="w-24">类型</TableHead>
            <TableHead className="w-32">发送人</TableHead>
            <TableHead>内容</TableHead>
            <TableHead className="w-28">处理结果</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {records.map((record) => (
            <TableRow key={record.id}>
              <TableCell className="align-top text-xs text-foreground-muted">
                {formatTime(record.createdAt)}
              </TableCell>
              <TableCell className="align-top">
                <div className="flex flex-wrap items-center gap-1">
                  <Badge
                    variant={
                      record.kind === 'bot_added'
                        ? 'success'
                        : record.kind === 'bot_removed'
                          ? 'warning'
                          : 'soft'
                    }
                  >
                    {RECORD_KIND_LABELS[record.kind]}
                  </Badge>
                  {record.threadId && <Badge variant="soft">话题</Badge>}
                </div>
              </TableCell>
              <TableCell className="align-top">
                {record.senderName ?? record.senderOpenId ?? '-'}
              </TableCell>
              <TableCell className="align-top">
                <p className="max-w-xl whitespace-pre-wrap break-words text-sm">
                  {record.content ?? '-'}
                </p>
                {record.error && (
                  <p className="mt-1 text-xs text-error-foreground">
                    {record.error}
                  </p>
                )}
              </TableCell>
              <TableCell className="align-top">
                {decisionBadge(record)}
              </TableCell>
            </TableRow>
          ))}
          {!loading && records.length === 0 && (
            <TableRow>
              <TableCell colSpan={5}>
                <p className="py-6 text-center text-sm text-foreground-muted">
                  暂无记录
                </p>
              </TableCell>
            </TableRow>
          )}
          {loading && (
            <TableRow>
              <TableCell colSpan={5}>
                <p className="py-6 text-center text-sm text-foreground-muted">
                  加载中…
                </p>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <div className="mt-3 flex items-center justify-end gap-2 text-sm">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1 || loading}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft className="size-4" /> 上一页
        </Button>
        <span className="text-foreground-muted">
          {page} / {pageCount}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= pageCount || loading}
          onClick={() => onPageChange(page + 1)}
        >
          下一页 <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  )
}
