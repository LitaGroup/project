import { useCallback, useEffect, useState } from 'react'
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
import { Input } from '@appica/ui-react/input'
import {
  Card,
  CardHeader,
  CardTitle,
} from '@appica/ui-react/card'
import { Badge } from '@appica/ui-react/badge'
import { Button } from '@appica/ui-react/button'
import { api, type AgentAppPackage, type AgentSimulator } from '../lib/api'

/**
 * 从包文件名解析 APP 名与环境（约定 {app}.{env}.{...}.apk，如 lita.prod.2_285_1.apk）。
 * 无环境段时 env 为 null。
 */
function parseFileName(file: string): { app: string; env: string | null } {
  const stem = file.replace(/\.(apk|ipa|app)$/i, '')
  const segs = stem.split('.')
  if (segs.length < 2) return { app: stem, env: null }
  return { app: segs[0], env: segs[1] }
}

/** 环境标识 → 展示文案（未识别的原样展示） */
const ENV_LABELS: Record<string, string> = {
  prod: '生产',
  test: '测试',
  dev: '开发',
  staging: '预发',
}

/** 环境 Badge（prod 生产 / test 测试，未识别原样展示，null 显示 —） */
function EnvBadge({ env }: { env: string | null }) {
  if (!env) return <span>—</span>
  return (
    <Badge variant={env === 'prod' ? 'warning' : 'secondary'}>
      {ENV_LABELS[env] ?? env}
    </Badge>
  )
}

/** 右侧模拟器面板：受管模拟器的在线状态与已装环境/版本（实时查询） */
function SimulatorPanel({
  simulators,
}: {
  simulators: AgentSimulator[] | null
}) {
  if (!simulators || simulators.length === 0) return null
  return (
    <aside className="flex w-72 shrink-0 flex-col gap-4">
      {simulators.map((s) => (
        <Card key={s.name}>
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-2 text-base">
              <span className="truncate">{s.name}</span>
              <Badge variant={s.online ? 'success' : 'light'}>
                {s.online ? '在线' : '离线'}
              </Badge>
            </CardTitle>
          </CardHeader>
          <dl className="flex flex-col gap-2 px-6 pb-6 text-sm group-data-inset/card:px-4">
            <div className="flex items-center justify-between">
              <dt>环境</dt>
              <dd>{s.online ? <EnvBadge env={s.env} /> : '—'}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt>版本号</dt>
              <dd>
                {s.online ? (s.installedVersion ?? '未安装') : '—'}
              </dd>
            </div>
          </dl>
        </Card>
      ))}
    </aside>
  )
}

/** 环境筛选项（value 即文件名中的环境段） */
const ENV_FILTERS = ['prod', 'test'] as const
/** 平台筛选项 */
const PLATFORM_FILTERS = ['android', 'ios'] as const
/** 产品筛选项（文件名第一段） */
const PRODUCT_FILTERS = ['lita', 'lite'] as const

/** 通用筛选下拉：value 与展示文案不一致（all → 不限X），须传 items 映射 */
function FilterSelect({
  value,
  onChange,
  options,
  allLabel,
  className,
}: {
  value: string
  onChange: (v: string) => void
  options: readonly string[]
  allLabel: string
  className?: string
}) {
  const items: Record<string, string> = {
    all: allLabel,
    ...Object.fromEntries(options.map((o) => [o, o])),
  }
  return (
    <Select value={value} onValueChange={(v) => onChange(v as string)} items={items}>
      <SelectTrigger className={className ?? 'w-36'}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{allLabel}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o} value={o}>
            {o}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/**
 * APP 全局列表：appium-agent 包目录（AGENT_APPS_DIR）下的安装包，
 * 产品/环境从文件名解析（约定 {产品}.{环境}.{...}.apk），版本取包体自身版本，
 * 操作远程安装/卸载到模拟器。按文件名字典序倒序排列。
 */
export function AppsPage() {
  const [packages, setPackages] = useState<AgentAppPackage[] | null>(null)
  const [simulators, setSimulators] = useState<AgentSimulator[] | null>(null)
  const [agentOnline, setAgentOnline] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyFile, setBusyFile] = useState<string | null>(null)
  const [envFilter, setEnvFilter] = useState('all')
  const [platformFilter, setPlatformFilter] = useState('all')
  const [productFilter, setProductFilter] = useState('all')
  const [versionQuery, setVersionQuery] = useState('')

  const load = useCallback(() => {
    api
      .getSettings()
      .then((s) => {
        setAgentOnline(s.agent.online)
        if (!s.agent.online) {
          setPackages([])
          setSimulators(null)
          setLoading(false)
          return
        }
        return Promise.all([
          api.listAgentApps().then(setPackages),
          api.listAgentSimulators().then(setSimulators),
        ])
          .catch((e: Error) => setError(e.message))
          .finally(() => setLoading(false))
      })
      .catch((e: Error) => {
        setError(e.message)
        setLoading(false)
      })
  }, [])

  useEffect(load, [load])

  /** 手动刷新（按钮置灰反馈） */
  const refresh = () => {
    setLoading(true)
    setError(null)
    load()
  }

  /** 安装/卸载后刷新列表 */
  const runOp = (file: string, op: () => Promise<unknown>) => {
    setBusyFile(file)
    setError(null)
    op()
      .then(load)
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusyFile(null))
  }

  /** 筛选 + 按文件名字典序倒序 */
  const vq = versionQuery.trim().toLowerCase()
  const filtered = (packages ?? [])
    .filter((p) => {
      const { app, env } = parseFileName(p.file)
      if (envFilter !== 'all' && env !== envFilter) return false
      if (platformFilter !== 'all' && p.platform !== platformFilter) return false
      if (productFilter !== 'all' && app !== productFilter) return false
      if (vq && !(p.version ?? '').toLowerCase().includes(vq)) return false
      return true
    })
    .sort((a, b) => b.file.localeCompare(a.file))

  return (
    <div className="flex gap-6">
      {/* 左侧：包列表 */}
      <div className="min-w-0 flex-1">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-2xl font-semibold">APP</h1>
          <Button variant="secondary" onClick={refresh} disabled={loading}>
            {loading ? '刷新中…' : '刷新'}
          </Button>
        </div>

      <div className="mb-4 flex gap-2">
        <FilterSelect
          value={productFilter}
          onChange={setProductFilter}
          options={PRODUCT_FILTERS}
          allLabel="不限产品"
        />
        <FilterSelect
          value={envFilter}
          onChange={setEnvFilter}
          options={ENV_FILTERS}
          allLabel="不限环境"
        />
        <FilterSelect
          value={platformFilter}
          onChange={setPlatformFilter}
          options={PLATFORM_FILTERS}
          allLabel="不限平台"
        />
        <Input
          className="w-56"
          placeholder="搜索版本号…"
          clearable
          value={versionQuery}
          onChange={(e) => setVersionQuery(e.target.value)}
          onClear={() => setVersionQuery('')}
        />
      </div>

      {error && <p className="mb-4 text-sm">操作失败：{error}</p>}

      {agentOnline === false ? (
        <p className="text-sm">执行机（appium-agent）离线，APP 包管理不可用</p>
      ) : (
        <Table hoverableRows>
          <TableHeader>
            <TableRow>
              <TableHead>APP</TableHead>
              <TableHead className="w-24">环境</TableHead>
              <TableHead className="w-24">平台</TableHead>
              <TableHead className="w-32">版本</TableHead>
              <TableHead>文件</TableHead>
              <TableHead className="w-44">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((p) => {
              const { app, env } = parseFileName(p.file)
              return (
                <TableRow key={p.file}>
                  <TableCell>{app}</TableCell>
                  <TableCell>
                    {env ? (
                      <Badge variant={env === 'prod' ? 'warning' : 'secondary'}>
                        {ENV_LABELS[env] ?? env}
                      </Badge>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell>{p.platform}</TableCell>
                  <TableCell>
                    {p.version ?? '—'}
                    {p.installedVersion && (
                      <span
                        className="ml-2 text-xs text-foreground-muted"
                        title="模拟器内当前已装版本"
                      >
                        (已装 {p.installedVersion})
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="max-w-md truncate" title={p.file}>
                    {p.file}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={busyFile !== null}
                        onClick={() =>
                          runOp(p.file, () => api.installAgentApp(p.file))
                        }
                      >
                        {busyFile === p.file ? '处理中…' : '安装'}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={
                          busyFile !== null ||
                          !p.packageId ||
                          !p.installedVersion
                        }
                        title={
                          !p.packageId
                            ? '无法解析包名，不能卸载'
                            : !p.installedVersion
                              ? '模拟器内未安装'
                              : ''
                        }
                        onClick={() =>
                          p.packageId &&
                          runOp(p.file, () =>
                            api.uninstallAgentApp(p.packageId!, p.platform),
                          )
                        }
                      >
                        卸载
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
            {packages !== null && filtered.length === 0 && agentOnline && (
              <TableRow>
                <TableCell colSpan={6}>
                  {packages.length === 0
                    ? '包目录下暂无安装包（.apk/.ipa）'
                    : '无匹配的安装包'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}
      </div>

      {/* 右侧：受管模拟器实时状态 */}
      <SimulatorPanel simulators={simulators} />
    </div>
  )
}
