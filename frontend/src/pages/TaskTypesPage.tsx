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
import { Textarea } from '@appica/ui-react/textarea'
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
  AlertDialogFooter,
  AlertDialogClose,
} from '@appica/ui-react/alert-dialog'
import { api, type TaskTypeDef } from '../lib/api'

/** 系统任务类型（与后端常量一致，不可改名/删除） */
const DEFAULT_TASK_TYPE = '其它'
const UNKNOWN_TASK_TYPE = '未知任务'
const SYSTEM_TASK_TYPE_NAMES = new Set([DEFAULT_TASK_TYPE, UNKNOWN_TASK_TYPE])

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

  const reload = useCallback(() => {
    api
      .listTaskTypes()
      .then(setTypes)
      .catch((e: Error) => setError(e.message))
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

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
      {error && <p className="text-sm">操作失败:{error}</p>}

      <Table hoverableRows>
        <TableHeader>
          <TableRow>
            <TableHead className="w-48">类型名称</TableHead>
            <TableHead>类型描述</TableHead>
            <TableHead className="w-32 text-center">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(types ?? []).map((type) => (
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
                  <DeleteTypeButton
                    type={type}
                    onDeleted={reload}
                    onError={setError}
                  />
                </div>
              </TableCell>
            </TableRow>
          ))}
          {types !== null && types.length === 0 && (
            <TableRow>
              <TableCell colSpan={3}>
                暂无任务类型，点右上角「新建任务类型」创建
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
          <DialogClose>
            <Button variant="outline" size="sm">
              取消
            </Button>
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
  onError,
}: {
  type: TaskTypeDef
  onDeleted: () => void
  onError: (message: string) => void
}) {
  const isSystem = SYSTEM_TASK_TYPE_NAMES.has(type.name)
  return (
    <AlertDialog>
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
        <AlertDialogFooter>
          <AlertDialogClose>
            <Button variant="outline" size="sm">
              取消
            </Button>
          </AlertDialogClose>
          {!isSystem && (
            <AlertDialogClose>
              <Button
                variant="destructive"
                size="sm"
                onClick={() =>
                  api
                    .deleteTaskType(type.id)
                    .then(onDeleted)
                    .catch((e: Error) => onError(e.message))
                }
              >
                确认删除
              </Button>
            </AlertDialogClose>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
