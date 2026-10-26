import { useEffect, useImperativeHandle, useRef, type Ref } from 'react'
import type { Crepe } from '@milkdown/crepe'
// 主题样式随入口加载（体积小）；编辑器本体按需动态加载，避免把 Milkdown 打进首屏包
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame.css'
import { api } from '../lib/api'

/** 上传图片到平台图片目录，返回可写入 Markdown 的地址（/images/...） */
async function uploadImage(file: File): Promise<string> {
  const { url } = await api.uploadImage(file)
  return url
}

export interface MarkdownEditorHandle {
  /** 取编辑器当前 Markdown（含尚未触发 onChange 的输入，保存时使用） */
  getMarkdown: () => string
}

export interface MarkdownEditorProps {
  /** 初始内容：组件为非受控，挂载后不再响应 value 变化（外部内容变化请换 key 重新挂载） */
  value: string
  onChange?: (markdown: string) => void
  readOnly?: boolean
  /** 紧凑模式：收紧正文内边距，适合嵌在小面板里编辑 */
  compact?: boolean
  /** Appica 风格：标题/链接/代码/引用按平台排版（中性色 + 角色 token），默认使用 Crepe 原生样式 */
  appica?: boolean
  className?: string
  ref?: Ref<MarkdownEditorHandle>
}

/**
 * Markdown 编辑器（Milkdown Crepe）：所见即所得，支持斜杠菜单、选区工具栏、表格、图片上传。
 * 只读模式下隐藏块操作/工具栏等交互元素，仅保留内容展示。
 */
export function MarkdownEditor({
  value,
  onChange,
  readOnly = false,
  compact = false,
  appica = false,
  className,
  ref,
}: MarkdownEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const crepeRef = useRef<Crepe | null>(null)
  const initialValue = useRef(value)
  const initialReadOnly = useRef(readOnly)
  const latestMarkdown = useRef(value)
  const onChangeRef = useRef(onChange)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useImperativeHandle(
    ref,
    () => ({
      getMarkdown: () =>
        crepeRef.current?.getMarkdown() ?? latestMarkdown.current,
    }),
    [],
  )

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    // 每个实例挂在自己的子节点上：StrictMode 双挂载时新旧实例互不干扰
    const root = document.createElement('div')
    host.append(root)

    let disposed = false
    void (async () => {
      const { Crepe } = await import('@milkdown/crepe')
      if (disposed) {
        root.remove()
        return
      }
      const crepe = new Crepe({
        root,
        defaultValue: initialValue.current,
        featureConfigs: {
          // 内置 UI 的中文文案（斜杠菜单、选区工具栏、占位符）
          [Crepe.Feature.Placeholder]: { text: '请输入内容…', mode: 'doc' },
          [Crepe.Feature.Toolbar]: {
            boldLabel: '加粗',
            italicLabel: '斜体',
            strikethroughLabel: '删除线',
            codeLabel: '行内代码',
            linkLabel: '链接',
            latexLabel: '公式',
            aiLabel: 'AI',
          },
          [Crepe.Feature.BlockEdit]: {
            textGroup: {
              label: '文本',
              text: { label: '正文' },
              h1: { label: '一级标题' },
              h2: { label: '二级标题' },
              h3: { label: '三级标题' },
              h4: { label: '四级标题' },
              h5: { label: '五级标题' },
              h6: { label: '六级标题' },
              quote: { label: '引用' },
              divider: { label: '分割线' },
            },
            listGroup: {
              label: '列表',
              bulletList: { label: '无序列表' },
              orderedList: { label: '有序列表' },
              taskList: { label: '待办列表' },
            },
            advancedGroup: {
              label: '高级',
              image: { label: '图片' },
              codeBlock: { label: '代码块' },
              table: { label: '表格' },
              math: { label: '公式' },
            },
          },
          [Crepe.Feature.ImageBlock]: {
            onUpload: uploadImage,
            inlineOnUpload: uploadImage,
            blockOnUpload: uploadImage,
            blockCaptionPlaceholderText: '图片说明（可选）',
            blockUploadPlaceholderText: '点击或拖拽上传图片',
            inlineUploadPlaceholderText: '粘贴图片地址',
          },
        },
      })
      crepe.setReadonly(initialReadOnly.current)
      crepe.on((listener) => {
        listener.markdownUpdated((_ctx, markdown) => {
          latestMarkdown.current = markdown
          onChangeRef.current?.(markdown)
        })
      })
      crepeRef.current = crepe
      void crepe.create().catch((e: unknown) => {
        console.error('[MarkdownEditor] 编辑器初始化失败', e)
      })
    })()

    return () => {
      disposed = true
      const crepe = crepeRef.current
      crepeRef.current = null
      if (crepe) {
        void crepe
          .destroy()
          .catch(() => undefined)
          .finally(() => root.remove())
      } else {
        root.remove()
      }
    }
  }, [])

  useEffect(() => {
    crepeRef.current?.setReadonly(readOnly)
  }, [readOnly])

  return (
    <div
      ref={hostRef}
      className={[
        'md-editor h-full',
        readOnly ? 'md-readonly' : '',
        compact ? 'md-editor-compact' : '',
        appica ? 'md-editor-appica' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    />
  )
}
