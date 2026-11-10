import { useCallback, useEffect, useState } from 'react'
import { Button } from '@appica/ui-react/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@appica/ui-react/dialog'
import { Ban, CircleCheck, Loader } from '@appica/icons-react'
import { api } from '../../lib/api'

export type ApprovalActionKind = 'approve' | 'reject'

interface ApprovalActionsProps {
  /** 审批类型任务 id */
  taskId: number
  /** 打开弹窗时默认选中的动作（飞书卡片链接 ?approval=approve|reject） */
  initialAction?: ApprovalActionKind | null
  /** 默认动作已打开弹窗后回调（页面用于清理查询参数） */
  onInitialActionHandled?: () => void
  /** 提交成功后刷新工单与任务数据 */
  onRefresh: () => Promise<unknown> | unknown
  disabled?: boolean
}

/**
 * 审批类型任务操作：通过 / 驳回。
 * 通过可填写可选审批意见；驳回必须填写反馈意见。
 * 权限由后端校验（工单发起人、当前审批处理人、管理员）。
 */
export function ApprovalActions({
  taskId,
  initialAction = null,
  onInitialActionHandled,
  onRefresh,
  disabled = false,
}: ApprovalActionsProps) {
  const [dialog, setDialog] = useState<ApprovalActionKind | null>(null)
  const [remark, setRemark] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!initialAction) return
    // oxlint-disable-next-line react/set-state-in-effect
    setDialog(initialAction)
    // oxlint-disable-next-line react/set-state-in-effect
    setRemark('')
    // oxlint-disable-next-line react/set-state-in-effect
    setError(null)
    onInitialActionHandled?.()
  }, [initialAction, onInitialActionHandled])

  const closeDialog = useCallback(() => {
    setDialog(null)
    setRemark('')
    setError(null)
  }, [])

  const submit = useCallback(async () => {
    if (!dialog || busy) return
    const text = remark.trim()
    if (dialog === 'reject' && !text) return
    setBusy(true)
    setError(null)
    try {
      if (dialog === 'approve') {
        await api.approveTaskApproval(taskId, text || undefined)
      } else {
        await api.rejectTaskApproval(taskId, text)
      }
      closeDialog()
      await onRefresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }, [dialog, busy, remark, taskId, closeDialog, onRefresh])

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="primary"
        disabled={disabled || busy}
        onClick={() => {
          setRemark('')
          setError(null)
          setDialog('approve')
        }}
      >
        {busy && dialog === 'approve' ? (
          <Loader className="size-3.5 animate-spin" />
        ) : (
          <CircleCheck className="size-3.5" />
        )}
        审批通过
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="text-error-foreground"
        disabled={disabled || busy}
        onClick={() => {
          setRemark('')
          setError(null)
          setDialog('reject')
        }}
      >
        {busy && dialog === 'reject' ? (
          <Loader className="size-3.5 animate-spin" />
        ) : (
          <Ban className="size-3.5" />
        )}
        驳回
      </Button>

      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) closeDialog()
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialog === 'approve' ? '审批通过' : '驳回'}
            </DialogTitle>
          </DialogHeader>
          <DialogBody>
            <label className="block space-y-1">
              <span className="text-xs text-foreground-muted">
                {dialog === 'approve'
                  ? '审批意见（可选）'
                  : '驳回意见（必填）'}
              </span>
              <textarea
                value={remark}
                rows={5}
                onChange={(event) => setRemark(event.target.value)}
                placeholder={
                  dialog === 'approve'
                    ? '可填写通过说明，留空表示无意见'
                    : '请说明驳回原因或需要修改的内容'
                }
                className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-border-strong"
              />
            </label>
          </DialogBody>
          {error && (
            <p role="alert" className="px-4 text-xs text-error-foreground">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={closeDialog}>
              取消
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={busy || (dialog === 'reject' && !remark.trim())}
              onClick={() => void submit()}
            >
              {busy ? (
                <Loader className="size-3.5 animate-spin" />
              ) : dialog === 'approve' ? (
                '确认通过'
              ) : (
                '确认驳回'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
