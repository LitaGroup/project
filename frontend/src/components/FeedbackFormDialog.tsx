import { useRef, useState } from 'react'
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
import { Input } from '@appica/ui-react/input'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@appica/ui-react/select'
import {
  api,
  FEEDBACK_TYPES,
  type Feedback,
  type FeedbackType,
} from '../lib/api'
import { DefectImagesField } from './DefectImagesField'
import { MarkdownField } from './MarkdownField'
import type { MarkdownEditorHandle } from './MarkdownEditor'

/**
 * 反馈表单弹窗（新建 / 编辑复用）：标题 + 类型 + Markdown 正文 + 图片。
 * 新建：任何登录用户；编辑：管理员随时，提交人仅「待处理」（权限由后端最终校验）。
 */
export function FeedbackFormDialog({
  feedback,
  trigger,
  onSaved,
}: {
  feedback?: Feedback | null
  trigger?: React.ReactElement
  onSaved?: (feedback: Feedback) => void
}) {
  const isEdit = !!feedback
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [type, setType] = useState<FeedbackType>('BUG')
  const [images, setImages] = useState<string[]>([])
  const [content, setContent] = useState('')
  const editorRef = useRef<MarkdownEditorHandle>(null)
  // 编辑器非受控：每次打开/切换反馈时变更 key 重挂载
  const [editorKey, setEditorKey] = useState('feedback-new')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) {
      setTitle(feedback?.title ?? '')
      setType(feedback?.type ?? 'BUG')
      setImages(feedback?.images ?? [])
      setContent(feedback?.content ?? '')
      setEditorKey(`feedback-${feedback?.id ?? 'new'}-${Date.now()}`)
      setError(null)
    }
  }

  const submit = () => {
    setError(null)
    const body = editorRef.current?.getMarkdown() ?? content
    setSaving(true)
    const request = isEdit
      ? api.updateFeedback(feedback!.id, {
          title,
          content: body,
          type,
          images,
        })
      : api.createFeedback({ title, content: body, type, images })
    request
      .then((saved) => {
        setOpen(false)
        onSaved?.(saved)
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setSaving(false))
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          trigger ?? (
            <Button size={isEdit ? 'sm' : undefined}>
              {isEdit ? '编辑' : '提交反馈'}
            </Button>
          )
        }
      />
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? '编辑反馈' : '提交反馈'}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-sm">
              标题
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="一句话说明问题"
                maxLength={200}
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              类型
              <Select
                value={type}
                onValueChange={(v) => setType(v as FeedbackType)}
              >
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FEEDBACK_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <MarkdownField
              label="问题描述"
              value={content}
              onChange={setContent}
              handleRef={editorRef}
              editorKey={editorKey}
            />
            <DefectImagesField value={images} onChange={setImages} />
            {error && <p className="text-sm">保存失败:{error}</p>}
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose>
            <Button variant="outline" size="sm">取消</Button>
          </DialogClose>
          <Button
            size="sm"
            onClick={submit}
            disabled={saving || !title.trim()}
          >
            {saving ? '保存中…' : isEdit ? '保存' : '提交'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
