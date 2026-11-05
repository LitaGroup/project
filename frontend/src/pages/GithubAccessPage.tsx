import { useCallback, useEffect, useMemo, useState } from 'react'
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
import { Toolbar, ToolbarInput } from '@appica/ui-react/toolbar'
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@appica/ui-react/tabs'
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
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@appica/ui-react/select'
import {
  api,
  WORKER_GITHUB_PERMISSION_LABELS,
  type GithubAccessCredential,
  type Worker,
  type WorkerGithubPermission,
} from '../lib/api'

type ConfigurablePermission = Exclude<WorkerGithubPermission, 'none'>

/** 「权限档位」Tab 的两条记录 */
const PERMISSION_ROWS: Array<{
  permission: ConfigurablePermission
  badge: 'info' | 'success'
  description: string
}> = [
  {
    permission: 'develop',
    badge: 'info',
    description: '拉取代码、push 普通分支、创建目标为 main/stable 的 PR（默认档位）。',
  },
  {
    permission: 'release',
    badge: 'success',
    description: '包含开发权限，并可直推 main/stable、审批与合并 PR。',
  },
]

/**
 * 管理区 GitHub 权限：
 * - 「权限档位」Tab：开发权限 / 发布权限 两条记录，每档配置一个 PAT；
 * - 「机器人」Tab：全部机器人（含真人机器人）逐行配置权限档位。
 */
export function GithubAccessPage() {
  const [workers, setWorkers] = useState<Worker[]>([])
  const [credentials, setCredentials] = useState<GithubAccessCredential[]>([])
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'tiers' | 'robots'>('tiers')
  const [keyword, setKeyword] = useState('')
  const [permissionSavingId, setPermissionSavingId] = useState<number | null>(null)

  /** null = 弹窗关闭；否则为当前配置的权限档位 */
  const [dialogPermission, setDialogPermission] = useState<ConfigurablePermission | null>(
    null,
  )
  const [pat, setPat] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [workerList, credentialList] = await Promise.all([
        api.listWorkers(),
        api.listGithubAccess(),
      ])
      setWorkers(workerList)
      setCredentials(credentialList)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const credentialByPermission = useMemo(() => {
    const map = new Map<WorkerGithubPermission, GithubAccessCredential>()
    for (const item of credentials) map.set(item.permission, item)
    return map
  }, [credentials])

  const patBadge = (permission: WorkerGithubPermission) => {
    const credential = credentialByPermission.get(permission)
    if (!credential?.configured) {
      return { variant: 'warning' as const, text: '未配置' }
    }
    return credential.enabled
      ? { variant: 'success' as const, text: '已配置' }
      : { variant: 'soft' as const, text: '已停用' }
  }

  const q = keyword.trim().toLowerCase()
  const robotRows = workers.filter((worker) => {
    if (!q) return true
    return (
      worker.name.toLowerCase().includes(q) ||
      String(worker.id).includes(q)
    )
  })

  const workerKind = (worker: Worker) =>
    worker.humanUserId ? '真人' : worker.system ? '系统' : 'AI'

  const openConfig = (permission: ConfigurablePermission) => {
    setPat('')
    setError(null)
    setDialogPermission(permission)
  }

  const submit = async () => {
    if (dialogPermission === null) return
    const patValue = pat.trim()
    if (!patValue) {
      setError('请填写 GitHub PAT')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await api.saveGithubAccess({ permission: dialogPermission, pat: patValue })
      setDialogPermission(null)
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  /** 「机器人」Tab 行内直接调整权限档位 */
  const changeWorkerPermission = async (
    worker: Worker,
    permission: WorkerGithubPermission,
  ) => {
    if (permission === worker.githubPermission) return
    setError(null)
    setPermissionSavingId(worker.id)
    try {
      await api.updateWorker(worker.id, { githubPermission: permission })
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setPermissionSavingId(null)
    }
  }

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-2xl font-semibold">GitHub 权限</h1>
        <p className="mt-1 text-sm text-foreground-muted">
          全平台只有「开发权限 / 发布权限」两档，每档对应一个
          PAT；机器人的档位归属在「机器人」Tab 配置（含真人机器人）。
        </p>
      </div>

      {error && <p className="mb-4 text-sm text-error-foreground">{error}</p>}

      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as 'tiers' | 'robots')}
        variant="line"
        className="flex flex-col gap-0"
      >
        <TabsList className="shrink-0">
          <TabsTrigger value="tiers">权限档位</TabsTrigger>
          <TabsTrigger value="robots">机器人</TabsTrigger>
        </TabsList>

        <TabsContent value="tiers" className="pt-4">
          <Table hoverableRows>
            <TableHeader>
              <TableRow>
                <TableHead className="w-36">权限</TableHead>
                <TableHead>能力说明</TableHead>
                <TableHead className="w-28">PAT 状态</TableHead>
                <TableHead className="w-52">更新时间</TableHead>
                <TableHead className="w-24 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {PERMISSION_ROWS.map(({ permission, badge, description }) => {
                const credential = credentialByPermission.get(permission)
                const patBadgeVariant = patBadge(permission)
                return (
                  <TableRow key={permission}>
                    <TableCell>
                      <Badge variant={badge}>
                        {WORKER_GITHUB_PERMISSION_LABELS[permission]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-foreground-muted">
                      {description}
                    </TableCell>
                    <TableCell>
                      <Badge variant={patBadgeVariant.variant}>
                        {patBadgeVariant.text}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {credential?.rotatedAt
                        ? new Date(credential.rotatedAt).toLocaleString()
                        : '—'}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openConfig(permission)}
                        >
                          配置
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>

          <p className="mt-4 text-xs text-foreground-muted">
            PAT 只写入不回显，使用 AES-256-GCM 加密保存；数据库单独泄露无法得到明文。
            机器人未配置所在档位的凭证（或凭证停用）时，OP Gateway 也会拒绝授权。
          </p>
        </TabsContent>

        <TabsContent value="robots" className="pt-4">
          <Toolbar aria-label="机器人筛选" className="mb-4">
            <ToolbarInput
              className="w-72"
              render={
                <Input
                  placeholder="搜索 机器人 / ID…"
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
                <TableHead className="w-24">类型</TableHead>
                <TableHead className="w-40">GitHub 权限</TableHead>
                <TableHead className="w-32">档位 PAT</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {robotRows.map((worker) => {
                const badge = patBadge(worker.githubPermission)
                return (
                  <TableRow key={worker.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{worker.name}</span>
                        <span className="text-xs text-foreground-muted">
                          #{worker.id}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-foreground-muted">
                      {workerKind(worker)}
                    </TableCell>
                    <TableCell>
                      <Select
                        value={worker.githubPermission}
                        onValueChange={(v) =>
                          void changeWorkerPermission(
                            worker,
                            v as WorkerGithubPermission,
                          )
                        }
                        items={WORKER_GITHUB_PERMISSION_LABELS}
                        disabled={permissionSavingId === worker.id}
                      >
                        <SelectTrigger className="w-32">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">
                            {WORKER_GITHUB_PERMISSION_LABELS.none}
                          </SelectItem>
                          {PERMISSION_ROWS.map(({ permission }) => (
                            <SelectItem key={permission} value={permission}>
                              {WORKER_GITHUB_PERMISSION_LABELS[permission]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      {worker.githubPermission === 'none' ? (
                        '—'
                      ) : (
                        <Badge variant={badge.variant}>{badge.text}</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
              {robotRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4}>
                    {workers.length === 0 ? '暂无机器人' : '无匹配的机器人'}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TabsContent>
      </Tabs>

      <Dialog
        open={dialogPermission !== null}
        onOpenChange={(next) => {
          if (!next) {
            setDialogPermission(null)
            setError(null)
          }
        }}
      >
        <DialogTrigger render={<span className="hidden" />} />
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              配置「
              {WORKER_GITHUB_PERMISSION_LABELS[dialogPermission ?? 'develop']}
              」的 GitHub PAT
            </DialogTitle>
          </DialogHeader>
          <DialogBody>
            <div className="flex flex-col gap-4">
              <label className="flex flex-col gap-1 text-sm">
                GitHub 细粒度 PAT
                <Input
                  type="password"
                  value={pat}
                  onChange={(e) => setPat(e.target.value)}
                  placeholder="粘贴 Fine-grained PAT"
                  autoComplete="new-password"
                />
                <span className="text-xs text-foreground-muted">
                  每个权限档位对应一个
                  PAT，重复配置即更换；保存后只保留密文，页面与接口均不会回显。
                </span>
              </label>
              {error && <p className="text-sm text-error-foreground">{error}</p>}
            </div>
          </DialogBody>
          <DialogFooter>
            <DialogClose>
              <Button variant="outline" size="sm">
                取消
              </Button>
            </DialogClose>
            <Button size="sm" disabled={saving} onClick={() => void submit()}>
              {saving ? '保存中…' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
