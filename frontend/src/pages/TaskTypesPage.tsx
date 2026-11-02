import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { Textarea } from '@appica/ui-react/textarea'
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
  DialogTrigger,
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
  AlertDialogBody,
  AlertDialogFooter,
  AlertDialogClose,
} from '@appica/ui-react/alert-dialog'
import { api, type TaskTypeDef } from '../lib/api'

/** 系统任务类型（与后端常量一致，不可改名/删除） */
const DEFAULT_TASK_TYPE = '其它'
const UNKNOWN_TASK_TYPE = '未知任务'
const TICKET_TASK_TYPE = '工单'
const SYSTEM_TASK_TYPE_NAMES = new Set([
  DEFAULT_TASK_TYPE,
  UNKNOWN_TASK_TYPE,
  TICKET_TASK_TYPE,
])

/** 名称规则：2-8 个中文字符，或 1-64 个英文字符 */
const CHINESE_NAME = /^[\u4e00-\u9fff]{2,8}$/
const ENGLISH_NAME = /^[A-Za-z]{1,64}$/

/** 类型名称校验，返回错误文案（合法时返回 null） */
function validateName(value: string): string | null {
  const name = value.trim()
  if (!name) return '类型名称不能为空'
  if (!CHINESE_NAME.test(name) && !ENGLISH_NAME.test(name)) {
    return '类型名称须为 2-8 个中文字符，或不超过 64 个英文字符'
  }
  return null
}

/** 任务类型：平台内维护的分类字典，供任务匹配与筛选使用 */
export function TaskTypesPage() {
  const [types, setTypes] = useState<TaskTypeDef[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [keyword, setKeyword] = useState('')
  const [scopeFilter, setScopeFilter] = useState('all')
  /** 列表请求序号：只采用最后一次请求的结果，避免旧响应把已删除的行写回列表 */
  const reloadSeq = useRef(0)

  /** 拉取服务端列表；失败或响应已过期时返回 null，由调用方决定是否保留本地数据 */
  const reload = useCallback(async (): Promise<TaskTypeDef[] | null> => {
    const seq = ++reloadSeq.current
    try {
      const list = await api.listTaskTypes()
      if (seq !== reloadSeq.current) return null
      setTypes(list)
      setError(null)
      return list
    } catch (e) {
      if (seq !== reloadSeq.current) return null
      setError((e as Error).message)
      return null
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  /**
   * 删除成功后先本地移除，再以服务端列表回查：
   * 只有回查结果确认该类型不存在才提示删除成功；回查失败或仍有该类型时提示错误，避免假成功。
   */
  const handleDeleted = useCallback(
    async (deleted: TaskTypeDef) => {
      setError(null)
      setNotice(null)
      setTypes((prev) =>
        prev ? prev.filter((type) => type.id !== deleted.id) : prev,
      )
      const list = await reload()
      if (!list) return
      if (list.some((type) => type.id === deleted.id)) {
        setError(
          `删除「${deleted.name}」后服务端仍返回该类型，请刷新页面重试`,
        )
        return
      }
      setNotice(`已删除任务类型「${deleted.name}」`)
    },
    [reload],
  )

  const filtered = useMemo(() => {
    const query = keyword.trim().toLowerCase()
    return (types ?? []).filter((type) => {
      if (query) {
        const haystack = `${type.name} ${type.description ?? ''}`.toLowerCase()
        if (!haystack.includes(query)) return false
      }
      const system = SYSTEM_TASK_TYPE_NAMES.has(type.name)
      if (scopeFilter === 'system' && !system) return false
      if (scopeFilter === 'custom' && system) return false
      return true
    })
  }, [types, keyword, scopeFilter])

  const hasFilter = keyword.trim() !== '' || scopeFilter !== 'all'
  const clearFilters = () => {
    setKeyword('')
    setScopeFilter('all')
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">任务类型</h1>
          <p className="mt-1 text-sm text-foreground-muted">
            维护任务分类字典：平台直接按任务定义和类型分配处理机器人，无法匹配时归入「未知任务」
          </p>
        </div>
        <TypeFormDialog onSaved={reload} />
      </div>
      {error && (
        <p role="alert" className="text-sm text-error-foreground">
          操作失败:{error}
        </p>
      )}
      {notice && !error && (
        <p
          role="status"
          aria-live="polite"
          className="text-sm text-success-foreground"
        >
          {notice}
        </p>
      )}

      <Toolbar aria-label="任务类型筛选">
        <ToolbarInput
          className="w-64"
          render={
            <Input
              placeholder="搜索类型名称、描述…"
              clearable
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onClear={() => setKeyword('')}
              aria-label="搜索任务类型名称或描述"
            />
          }
        />
        <ToolbarGroup aria-label="筛选">
          <Select
            value={scopeFilter}
            onValueChange={(value) => setScopeFilter(value as string)}
            items={{
              all: '全部分类',
              system: '系统类型',
              custom: '自定义类型',
            }}
          >
            <ToolbarButton
              className="w-36"
              render={
                <SelectTrigger aria-label="按类型分类筛选">
                  <SelectValue placeholder="分类" />
                </SelectTrigger>
              }
            />
            <SelectContent>
              <SelectItem value="all">全部分类</SelectItem>
              <SelectItem value="system">系统类型</SelectItem>
              <SelectItem value="custom">自定义类型</SelectItem>
            </SelectContent>
          </Select>
          {hasFilter && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              清空筛选
            </Button>
          )}
        </ToolbarGroup>
      </Toolbar>

      <Table hoverableRows>
        <TableHeader>
          <TableRow>
            <TableHead className="w-48">类型名称</TableHead>
            <TableHead>类型描述</TableHead>
            <TableHead className="w-32 text-center">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((type) => (
            <TableRow key={type.id}>
              <TableCell className="max-w-48 truncate font-medium">
                {type.name}
              </TableCell>
              <TableCell
                className="max-w-lg truncate text-xs text-foreground-muted"
                title={type.description || ''}
              >
                {type.description || '—'}
              </TableCell>
              <TableCell className="text-center">
                <div className="flex justify-center gap-2">
                  <TypeFormDialog initial={type} onSaved={reload} />
                  <DeleteTypeButton type={type} onDeleted={handleDeleted} />
                </div>
              </TableCell>
            </TableRow>
          ))}
          {types !== null && filtered.length === 0 && (
            <TableRow>
              <TableCell colSpan={3}>
                {hasFilter
                  ? '没有符合筛选条件的任务类型'
                  : '暂无任务类型，点右上角「新建任务类型」创建'}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}

/** 新建 / 编辑任务类型弹窗（编辑时传入 initial） */
function TypeFormDialog({
  initial,
  onSaved,
}: {
  initial?: TaskTypeDef
  onSaved: () => void
}) {
  const isEdit = Boolean(initial)
  const isSystem = Boolean(
    initial && SYSTEM_TASK_TYPE_NAMES.has(initial.name),
  )
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) {
      setName(initial?.name ?? '')
      setDescription(initial?.description ?? '')
      setError(null)
    }
  }

  const submit = () => {
    setError(null)
    const invalid = isSystem ? null : validateName(name)
    if (invalid) {
      setError(invalid)
      return
    }
    setSaving(true)
    const payload = {
      ...(isSystem ? {} : { name: name.trim() }),
      description: description.trim(),
    }
    const save = initial
      ? api.updateTaskType(initial.id, payload)
      : api.createTaskType(payload as { name: string; description: string })
    save
      .then(() => {
        setOpen(false)
        onSaved()
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setSaving(false))
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button variant={isEdit ? 'outline' : undefined} size="sm" />
        }
      >
        {isEdit ? '编辑' : '新建任务类型'}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? '编辑任务类型' : '新建任务类型'}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-sm">
              类型名称
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="2-8 个中文，或不超过 64 个英文"
                disabled={isSystem}
              />
              {isSystem && (
                <span className="text-xs text-foreground-muted">
                  「{initial?.name}」为系统任务类型，不允许改名
                </span>
              )}
            </label>
            <label className="flex flex-col gap-1 text-sm">
              类型描述
              <Textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="描述该类型适用的任务，帮助人工理解分类"
              />
            </label>
            {error && <p className="text-sm">保存失败:{error}</p>}
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" size="sm" />}>
            取消
          </DialogClose>
          <Button
            size="sm"
            onClick={submit}
            disabled={saving || (!isSystem && !name.trim())}
          >
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** 删除任务类型（默认类型与使用中的类型由后端拦截并提示） */
function DeleteTypeButton({
  type,
  onDeleted,
}: {
  type: TaskTypeDef
  onDeleted: (type: TaskTypeDef) => void
}) {
  const isSystem = SYSTEM_TASK_TYPE_NAMES.has(type.name)
  const [open, setOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleOpenChange = (next: boolean) => {
    // 删除请求进行中不允许关闭，避免请求未完成就误以为已成功
    if (deleting) return
    setOpen(next)
    if (!next) setError(null)
  }

  const confirm = () => {
    setError(null)
    setDeleting(true)
    api
      .deleteTaskType(type.id)
      .then(() => {
        // 成功后再关闭弹窗并移除行，避免请求失败但看起来已删除
        setOpen(false)
        onDeleted(type)
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setDeleting(false))
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogTrigger render={<Button variant="outline" size="sm" />}>
        删除
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除任务类型</AlertDialogTitle>
          <AlertDialogDescription>
            {isSystem
              ? `「${type.name}」为系统任务类型，不可删除。`
              : `确定删除「${type.name}」吗？已被任务、任务定义或机器人任务定义使用的类型无法删除。`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <AlertDialogBody>
            <p role="alert" className="text-sm text-error-foreground">
              删除失败：{error}
            </p>
          </AlertDialogBody>
        )}
        <AlertDialogFooter>
          <AlertDialogClose
            disabled={deleting}
            render={<Button variant="outline" size="sm" />}
          >
            取消
          </AlertDialogClose>
          {!isSystem && (
            <Button
              variant="destructive"
              size="sm"
              disabled={deleting}
              onClick={confirm}
            >
              {deleting ? '删除中…' : '确认删除'}
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
