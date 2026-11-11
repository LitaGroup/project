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
  IDEA_TYPES,
  type Idea,
  type IdeaType,
} from '../lib/api'
import { DefectImagesField } from './DefectImagesField'
import { MarkdownField } from './MarkdownField'
import type { MarkdownEditorHandle } from './MarkdownEditor'

/**
 * 灵感表单弹窗（新建 / 编辑复用）：标题 + 类型 + Markdown 正文 + 图片。
 * 新建：任何登录用户；编辑：构思期任何登录用户，采纳/废弃后仅管理员（后端最终校验）。
 */
export function IdeaFormDialog({
  idea,
  trigger,
  onSaved,
}: {
  idea?: Idea | null
  trigger?: React.ReactElement
  onSaved?: (idea: Idea) => void
}) {
  const isEdit = !!idea
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [type, setType] = useState<IdeaType>('想法')
  const [images, setImages] = useState<string[]>([])
  const [content, setContent] = useState('')
  const editorRef = useRef<MarkdownEditorHandle>(null)
  // 编辑器非受控：每次打开/切换灵感时变更 key 重挂载
  const [editorKey, setEditorKey] = useState('idea-new')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) {
      setTitle(idea?.title ?? '')
      setType(idea?.type ?? '想法')
      setImages(idea?.images ?? [])
      setContent(idea?.content ?? '')
      setEditorKey(`idea-${idea?.id ?? 'new'}-${Date.now()}`)
      setError(null)
    }
  }

  const submit = () => {
    setError(null)
    const body = editorRef.current?.getMarkdown() ?? content
    setSaving(true)
    const request = isEdit
      ? api.updateIdea(idea!.id, { title, content: body, type, images })
      : api.createIdea({ title, content: body, type, images })
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
              {isEdit ? '编辑' : '记录灵感'}
            </Button>
          )
        }
      />
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? '编辑灵感' : '记录灵感'}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-sm">
              标题
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="一句话描述这个想法"
                maxLength={200}
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              类型
              <Select
                value={type}
                onValueChange={(v) => setType(v as IdeaType)}
              >
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {IDEA_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <MarkdownField
              label="正文"
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
            {saving ? '保存中…' : isEdit ? '保存' : '记录'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
