import type { Ref } from 'react'
import {
  MarkdownEditor,
  type MarkdownEditorHandle,
} from './MarkdownEditor'

/**
 * 表单里的 Markdown 字段：标签 + 固定高度可滚动的所见即所得编辑区。
 * 编辑器为非受控组件，外部内容变化（如选择任务包回填）请变更 `editorKey` 重新挂载。
 */
export function MarkdownField({
  label,
  value,
  onChange,
  handleRef,
  editorKey,
  heightClassName = 'h-48',
}: {
  label: string
  value: string
  onChange: (markdown: string) => void
  handleRef?: Ref<MarkdownEditorHandle>
  editorKey?: string
  heightClassName?: string
}) {
  return (
    <div className="flex flex-col gap-1 text-sm">
      <span>{label}</span>
      <div
        className={`${heightClassName} overflow-auto rounded-[var(--radius-md)] bg-background-muted`}
      >
        <MarkdownEditor
          key={editorKey}
          ref={handleRef}
          value={value}
          compact
          appica
          onChange={onChange}
        />
      </div>
    </div>
  )
}
