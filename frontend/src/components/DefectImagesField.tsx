import { useRef, useState } from 'react'
import { Button } from '@appica/ui-react/button'
import { api } from '../lib/api'

/**
 * 缺陷图片字段（多张）：POST /api/images 上传，值为 /images/... 路径数组。
 * 受控组件：value 全量回传给 onChange（编辑时全量覆盖提交）。
 */
export function DefectImagesField({
  value,
  onChange,
  max = 9,
}: {
  value: string[]
  onChange: (images: string[]) => void
  max?: number
}) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const upload = (files: FileList) => {
    const room = max - value.length
    if (room <= 0) {
      setError(`最多 ${max} 张`)
      return
    }
    const list = Array.from(files).slice(0, room)
    setUploading(true)
    setError(null)
    Promise.all(list.map((f) => api.uploadImage(f)))
      .then((results) => onChange([...value, ...results.map((r) => r.url)]))
      .catch((e: Error) => setError(e.message))
      .finally(() => {
        setUploading(false)
        if (fileRef.current) fileRef.current.value = ''
      })
  }

  const remove = (url: string) => onChange(value.filter((v) => v !== url))

  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex items-center justify-between">
        <span>图片（最多 {max} 张）</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={uploading || value.length >= max}
          onClick={() => fileRef.current?.click()}
        >
          {uploading ? '上传中…' : '上传图片'}
        </Button>
      </div>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {value.map((url) => (
            <div key={url} className="group relative">
              <img
                src={url}
                alt="缺陷图片"
                className="h-20 rounded-[var(--radius-md)] border border-border-strong object-cover"
              />
              <button
                type="button"
                onClick={() => remove(url)}
                aria-label="移除图片"
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-border-strong bg-background text-xs text-foreground-intense"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/gif,image/webp"
        hidden
        onChange={(e) => {
          if (e.target.files?.length) upload(e.target.files)
        }}
      />
      {error && <p className="text-sm">上传失败:{error}</p>}
    </div>
  )
}
