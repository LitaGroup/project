import { useState } from 'react'
import { Button } from '@appica/ui-react/button'
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
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@appica/ui-react/select'
import { Textarea } from '@appica/ui-react/textarea'
import { api, BACKLOG_STATUSES, type Backlog, type BacklogStatus } from '../lib/api'

const STATUS_ITEMS = Object.fromEntries(
  BACKLOG_STATUSES.map((status) => [status, status]),
)

interface BacklogStatusDialogProps {
  /** 迭代项 ID */
  backlogId: number
  /** 当前状态（目标状态选项会排除当前态） */
  currentStatus: BacklogStatus
  /** 终态（完成/取消）不可再推进 */
  terminal?: boolean
  /** 按钮文案；默认「推进」 */
  triggerLabel?: string
  /** 触发按钮是否使用 primary 变体（详情页主操作）；默认 outline */
  primary?: boolean
  /** 状态更新成功后回调（返回更新后的迭代项） */
  onDone: (row: Backlog) => void
}

/**
 * 迭代项状态推进弹窗（迭代详情表格与迭代项详情页共用）：
 * 选择目标状态 + 备注（可空），提交后写入迭代项事件流。
 */
export function BacklogStatusDialog({
  backlogId,
  currentStatus,
  terminal = false,
  triggerLabel = '推进',
  primary = false,
  onDone,
}: BacklogStatusDialogProps) {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<string | undefined>(undefined)
  const [remark, setRemark] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const changeOpen = (next: boolean) => {
    setOpen(next)
    if (next) {
      // 每次打开重置选择与备注
      setStatus(undefined)
      setRemark('')
      setError(null)
    }
  }

  const submit = () => {
    if (saving || !status || status === currentStatus) return
    setSaving(true)
    setError(null)
    api
      .updateBacklogStatus(backlogId, status as BacklogStatus, remark.trim() || undefined)
      .then((row) => {
        setOpen(false)
        onDone(row)
      })
      .catch((e: Error) => setError(e.message || '更新失败'))
      .finally(() => setSaving(false))
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger
        render={
          <Button
            variant={primary ? 'primary' : 'outline'}
            size="sm"
            disabled={terminal}
            title={terminal ? '已结束的迭代项不可再变更状态' : undefined}
          />
        }
      >
        {triggerLabel}
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>推进迭代项状态</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-sm">
              目标状态（当前：{currentStatus}）
              <Select value={status} onValueChange={(v) => setStatus(v as string)} items={STATUS_ITEMS}>
                <SelectTrigger aria-label="目标状态">
                  <SelectValue placeholder="选择状态" />
                </SelectTrigger>
                <SelectContent>
                  {BACKLOG_STATUSES.filter((s) => s !== currentStatus).map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              备注（可空，记录到迭代项事件）
              <Textarea
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
                placeholder="例如：已联调完成，进入测试…"
                rows={3}
                maxLength={500}
              />
            </label>
            {error && <p className="text-sm">更新失败:{error}</p>}
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose>
            <Button variant="outline" size="sm">取消</Button>
          </DialogClose>
          <Button size="sm" onClick={submit} disabled={!status || saving}>
            {saving ? '保存中…' : '确认'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
