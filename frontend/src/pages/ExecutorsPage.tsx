import { useCallback, useEffect, useState } from 'react'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@appica/ui-react/table'
import { Button } from '@appica/ui-react/button'
import { Input } from '@appica/ui-react/input'
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
  EXECUTOR_TYPES,
  type Executor,
  type ExecutorType,
} from '../lib/api'
import { ExecutorOnlineBadge } from '../components/StatusBadge'

/** 执行器管理：opencode server 登记 + 健康检查 + 供应商缓存同步 */
export function ExecutorsPage() {
  const [executors, setExecutors] = useState<Executor[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

  const reload = useCallback(() => {
    api
      .listExecutors()
      .then(setExecutors)
      .catch((e: Error) => setError(e.message))
  }, [])

  useEffect(reload, [reload])

  const run = (id: number, fn: (id: number) => Promise<unknown>) => {
    setBusyId(id)
    setError(null)
    fn(id)
      .then(reload)
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusyId(null))
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">执行器</h1>
          <p className="mt-1 text-sm text-foreground-muted">
            opencode server 实例（本机联调 127.0.0.1:4096；生产 10.251.6.12:49374）
          </p>
        </div>
        <ExecutorFormDialog onSaved={reload} />
      </div>
      {error && <p className="text-sm">操作失败:{error}</p>}

      <Table hoverableRows>
        <TableHeader>
          <TableRow>
            <TableHead>名称</TableHead>
            <TableHead className="w-24">状态</TableHead>
            <TableHead className="w-36">地址</TableHead>
            <TableHead className="w-24">版本</TableHead>
            <TableHead>默认工作目录</TableHead>
            <TableHead className="w-44">供应商缓存</TableHead>
            <TableHead className="w-72 text-center">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(executors ?? []).map((e) => (
            <TableRow key={e.id}>
              <TableCell>
                <p className="font-medium">{e.name}</p>
                {e.description && (
                  <p className="text-xs text-foreground-muted">{e.description}</p>
                )}
              </TableCell>
              <TableCell>
                <ExecutorOnlineBadge online={e.online} />
              </TableCell>
              <TableCell className="font-mono text-xs">
                {e.ip}:{e.port}
              </TableCell>
              <TableCell>{e.version ?? '—'}</TableCell>
              <TableCell
                className="max-w-64 truncate font-mono text-xs"
                title={e.defaultLocation ?? ''}
              >
                {e.defaultLocation ?? '—'}
              </TableCell>
              <TableCell className="text-xs">
                {e.providersCache
                  ? `${e.providersCache.length} 个供应商 / ${e.providersCache.reduce((n, p) => n + p.models.length, 0)} 个模型`
                  : '未同步'}
                {e.providersSyncedAt && (
                  <p className="text-foreground-muted">
                    {new Date(e.providersSyncedAt).toLocaleString()}
                  </p>
                )}
              </TableCell>
              <TableCell className="text-center">
                <div className="flex justify-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busyId === e.id}
                    onClick={() => run(e.id, api.checkExecutor)}
                  >
                    检查
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busyId === e.id}
                    onClick={() => run(e.id, api.syncExecutorProviders)}
                  >
                    同步供应商
                  </Button>
                  <ExecutorFormDialog executor={e} onSaved={reload} />
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={busyId === e.id}
                    onClick={() => run(e.id, api.deleteExecutor)}
                  >
                    删除
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
          {executors !== null && executors.length === 0 && (
            <TableRow>
              <TableCell colSpan={7}>
                暂无执行器，点右上角「登记执行器」
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}

/** 登记/编辑执行器 */
function ExecutorFormDialog({
  executor,
  onSaved,
}: {
  executor?: Executor
  onSaved: () => void
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [ip, setIp] = useState('')
  const [port, setPort] = useState('4096')
  const [type, setType] = useState<ExecutorType>('opencode')
  const [token, setToken] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) return
    setName(executor?.name ?? '')
    setIp(executor?.ip ?? '127.0.0.1')
    setPort(executor ? String(executor.port) : '4096')
    setType(executor?.type ?? 'opencode')
    setToken(executor?.token ?? '')
    setDescription(executor?.description ?? '')
    setError(null)
  }

  const submit = () => {
    setError(null)
    setSaving(true)
    const payload = {
      name,
      ip,
      port: Number(port),
      type,
      description: description.trim() || null,
      token: token.trim() || null,
    }
    const p = executor
      ? api.updateExecutor(executor.id, payload)
      : api.createExecutor(payload)
    p.then(() => {
      setOpen(false)
      onSaved()
    })
      .catch((e: Error) => setError(e.message))
      .finally(() => setSaving(false))
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        {executor ? '编辑' : '登记执行器'}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{executor ? '编辑执行器' : '登记执行器'}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-sm">
              名称
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="如：本机 opencode"
              />
            </label>
            <div className="flex gap-4">
              <label className="flex flex-1 flex-col gap-1 text-sm">
                IP
                <Input value={ip} onChange={(e) => setIp(e.target.value)} />
              </label>
              <label className="flex w-28 flex-col gap-1 text-sm">
                端口
                <Input
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  inputMode="numeric"
                />
              </label>
              <label className="flex flex-1 flex-col gap-1 text-sm">
                类型
                <Select
                  value={type}
                  onValueChange={(v) => setType(v as ExecutorType)}
                  items={Object.fromEntries(EXECUTOR_TYPES.map((t) => [t, t]))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EXECUTOR_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            </div>
            <label className="flex flex-col gap-1 text-sm">
              server password（opencode 启动时打印；无鉴权留空）
              <Input
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="OPENCODE_PASSWORD"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              描述
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="部署在哪台机器、用途"
              />
            </label>
            {error && <p className="text-sm">保存失败:{error}</p>}
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose>
            <Button variant="outline" size="sm">
              取消
            </Button>
          </DialogClose>
          <Button
            size="sm"
            onClick={submit}
            disabled={saving || !name.trim() || !ip.trim() || !port}
          >
            保存并检查
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
