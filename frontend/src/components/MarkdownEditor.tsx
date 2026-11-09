import { useEffect, useImperativeHandle, useRef, type Ref } from 'react'
import type { Crepe } from '@milkdown/crepe'
// 主题样式随入口加载（体积小）；编辑器本体按需动态加载，避免把 Milkdown 打进首屏包
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame.css'
import { api } from '../lib/api'
import { isDarkTheme, renderMermaidSvg } from '../lib/mermaid'

/** 上传图片到平台图片目录，返回可写入 Markdown 的地址（/images/...） */
async function uploadImage(file: File): Promise<string> {
  const { url } = await api.uploadImage(file)
  return url
}

type ApplyCodePreview = (value: null | string | HTMLElement) => void

/** 代码块预览按提交顺序串行渲染，避免较慢的旧内容覆盖刚输入的新内容 */
let codePreviewQueue: Promise<void> = Promise.resolve()

function mermaidPreviewContent(svg: string): HTMLElement {
  const host = document.createElement('div')
  const diagram = document.createElement('div')
  diagram.className = 'mermaid-diagram'
  diagram.innerHTML = svg
  host.append(diagram)
  return host
}

function mermaidPreviewError(code: string, reason: unknown): HTMLElement {
  const message = reason instanceof Error ? reason.message : String(reason)
  const host = document.createElement('div')
  const error = document.createElement('div')
  error.className = 'mermaid-preview-error'
  const pre = document.createElement('pre')
  const source = document.createElement('code')
  source.textContent = code
  pre.append(source)
  const hint = document.createElement('p')
  hint.textContent = `图表渲染失败：${message}`
  error.append(pre, hint)
  host.append(error)
  return host
}

/**
 * Crepe 代码块预览支持异步 applyPreview，可直接复用统一 Mermaid 渲染器。
 * 旧请求仍会完成，但串行队列保证同一代码块最终展示最后一次提交的内容。
 */
function enqueueMermaidPreview(
  code: string,
  applyPreview: ApplyCodePreview,
): void {
  const dark = isDarkTheme()
  codePreviewQueue = codePreviewQueue
    .then(async () => {
      try {
        const svg = await renderMermaidSvg(code, dark)
        applyPreview(mermaidPreviewContent(svg))
      } catch (reason) {
        applyPreview(mermaidPreviewError(code, reason))
      }
    })
    .catch((reason: unknown) => {
      console.error('[MarkdownEditor] Mermaid 预览渲染失败', reason)
    })
}

/** 当前块的简短类型名：只占一个字位宽度，避免挤占正文 */
function blockTypeLabel(element: HTMLElement): string | null {
  const tag = element.tagName
  if (/^H[1-6]$/.test(tag)) return tag
  if (element.matches('.milkdown-table-block, table')) return '表格'
  if (element.matches('.milkdown-code-block, pre')) return '代码'
  if (element.matches('.milkdown-image-block')) return '图片'
  if (element.matches('.milkdown-latex-block, .math-block')) return '公式'
  if (tag === 'UL' || tag === 'OL') {
    if (element.querySelector('.label.checked, .label.unchecked')) return '待办'
    return tag === 'UL' ? '无序' : '有序'
  }
  if (tag === 'BLOCKQUOTE') return '引用'
  if (tag === 'HR') return '分割'
  if (tag === 'P') return '正文'
  return null
}

/**
 * 在编辑器左内边距里放一个独立的块类型标签（H1/H2/正文/代码等）。
 * 标签是 .milkdown 的兄弟浮层，不修改 ProseMirror 节点 DOM（否则会被
 * 编辑器同步逻辑移除，甚至触发反复重绘）；只跟随鼠标悬停块或光标所在块。
 */
function attachBlockTypeLabels(host: HTMLElement): () => void {
  let detach: () => void = () => undefined
  let waitObserver: MutationObserver | undefined
  let bound = false

  const bind = () => {
    if (bound) return true
    const proseMirror = host.querySelector<HTMLElement>('.ProseMirror')
    const container = proseMirror?.parentElement
    if (!proseMirror || !container) return false
    detach = bindEditorBlocks(proseMirror, container)
    bound = true
    return true
  }

  if (!bind()) {
    waitObserver = new MutationObserver(() => {
      if (bind()) waitObserver?.disconnect()
    })
    waitObserver.observe(host, { childList: true, subtree: true })
  }

  return () => {
    waitObserver?.disconnect()
    detach()
  }
}

function bindEditorBlocks(
  pm: HTMLElement,
  container: HTMLElement,
): () => void {
  const badge = document.createElement('span')
  badge.className = 'md-block-type-badge'
  badge.setAttribute('aria-hidden', 'true')
  container.append(badge)

  let selected: HTMLElement | null = null
  let hovered: HTMLElement | null = null
  let frame = 0

  const topLevelBlock = (node: Node | null): HTMLElement | null => {
    if (!node || node === pm) return null
    let element = node instanceof HTMLElement ? node : node.parentElement
    if (!element || !pm.contains(element)) return null
    while (element.parentElement && element.parentElement !== pm) {
      element = element.parentElement
    }
    return element.parentElement === pm ? element : null
  }

  const blockFromSelection = (): HTMLElement | null => {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) return null
    const anchor = selection.anchorNode
    if (!anchor || !pm.contains(anchor)) return null
    if (anchor === pm) {
      const index = Math.min(selection.anchorOffset, pm.children.length - 1)
      const child = pm.children[index]
      return child instanceof HTMLElement ? child : null
    }
    return topLevelBlock(anchor)
  }

  const render = () => {
    const block =
      hovered && pm.contains(hovered)
        ? hovered
        : selected && pm.contains(selected)
          ? selected
          : null
    const label = block ? blockTypeLabel(block) : null
    if (!block || !label) {
      badge.classList.remove('md-show')
      return
    }

    badge.textContent = label
    badge.classList.add('md-show')
    const blockRect = block.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()
    badge.style.top = `${Math.round(blockRect.top - containerRect.top + 2)}px`
    badge.style.left = `${Math.max(
      2,
      Math.round(
        blockRect.left - containerRect.left - badge.offsetWidth - 6,
      ),
    )}px`
  }

  const scheduleRender = () => {
    if (frame) return
    frame = window.requestAnimationFrame(() => {
      frame = 0
      selected = blockFromSelection()
      render()
    })
  }

  const onPointerOver = (event: PointerEvent) => {
    const target = event.target
    if (!(target instanceof Node)) return
    const block = topLevelBlock(target)
    if (hovered === block) return
    hovered = block
    scheduleRender()
  }

  const onPointerLeave = () => {
    if (!hovered) return
    hovered = null
    scheduleRender()
  }

  const observer = new MutationObserver(scheduleRender)
  const resizeObserver = new ResizeObserver(scheduleRender)
  observer.observe(pm, { childList: true })
  resizeObserver.observe(pm)
  resizeObserver.observe(container)
  document.addEventListener('selectionchange', scheduleRender)
  pm.addEventListener('input', scheduleRender)
  pm.addEventListener('pointerover', onPointerOver)
  pm.addEventListener('pointerleave', onPointerLeave)
  scheduleRender()

  return () => {
    observer.disconnect()
    resizeObserver.disconnect()
    document.removeEventListener('selectionchange', scheduleRender)
    pm.removeEventListener('input', scheduleRender)
    pm.removeEventListener('pointerover', onPointerOver)
    pm.removeEventListener('pointerleave', onPointerLeave)
    if (frame) window.cancelAnimationFrame(frame)
    badge.remove()
  }
}

/**
 * Markdown 里的链接统一在新窗口打开（只读展示与编辑态一致）：
 * 编辑器渲染的 <a> 不带 target，浏览器点击会在当前页跳转并丢掉编辑/阅读位置，
 * 这里在 host 上代理 click，改用 window.open 新开页；preventDefault 不影响
 * mousedown 驱动的光标落点，编辑态仍可正常定位光标。
 */
function openAnchorLinksInNewTab(host: HTMLElement): () => void {
  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0) return
    const target = event.target
    if (!(target instanceof Element)) return
    const anchor = target.closest('a[href]')
    if (!anchor || !host.contains(anchor)) return
    const href = anchor.getAttribute('href') ?? ''
    if (!href || href.startsWith('#')) return
    event.preventDefault()
    window.open(href, '_blank', 'noopener,noreferrer')
  }
  host.addEventListener('click', onClick)
  return () => host.removeEventListener('click', onClick)
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
  /** GitHub 风格：标题分隔线、代码块、引用和表格按 GitHub Markdown 习惯排版 */
  github?: boolean
  /**
   * 编辑态在块左侧显示当前块类型（H1/H2/正文/代码等），鼠标悬停或光标所在块时出现。
   * 默认开启，可显式关闭。
   */
  showBlockTypes?: boolean
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
  github = false,
  showBlockTypes,
  className,
  ref,
}: MarkdownEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const crepeRef = useRef<Crepe | null>(null)
  const initialValue = useRef(value)
  const initialReadOnly = useRef(readOnly)
  const latestMarkdown = useRef(value)
  const onChangeRef = useRef(onChange)
  const blockTypesEnabled = showBlockTypes ?? true
  const blockTypesEnabledRef = useRef(blockTypesEnabled)

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
    // 编辑器 DOM 由 Crepe 异步创建，这里先挂监听，等 .ProseMirror 出现后再绑定
    const detachBlockTypes = blockTypesEnabledRef.current
      ? attachBlockTypeLabels(host)
      : undefined
    const detachAnchorLinks = openAnchorLinksInNewTab(host)
    void (async () => {
      const [
        { Crepe },
        { LanguageDescription, LanguageSupport, StreamLanguage },
        { languages },
      ] = await Promise.all([
        import('@milkdown/crepe'),
        import('@codemirror/language'),
        import('@codemirror/language-data'),
      ])
      if (disposed) {
        root.remove()
        return
      }
      // 语言列表没有 Mermaid 语法高亮，补一个纯文本条目，便于在块菜单里选中并触发预览
      const plainTextLanguage = StreamLanguage.define({
        token(stream) {
          stream.skipToEnd()
          return null
        },
      })
      const mermaidLanguage = LanguageDescription.of({
        // 名称即写回 Markdown 的语言标识，保持小写以兼容各 Markdown 渲染器的语言匹配
        name: 'mermaid',
        alias: ['mermaid', 'mmd'],
        extensions: ['mmd'],
        support: new LanguageSupport(plainTextLanguage),
      })
      const crepe = new Crepe({
        root,
        defaultValue: initialValue.current,
        features: {
          // 不需要选中文字后弹出的浮动格式工具栏
          [Crepe.Feature.Toolbar]: false,
        },
        featureConfigs: {
          // 代码块：补充 Mermaid 语言与预览；非 Mermaid / LaTeX 代码仍由 Crepe 默认逻辑处理
          [Crepe.Feature.CodeMirror]: {
            languages: [mermaidLanguage, ...languages],
            searchPlaceholder: '搜索语言',
            noResultText: '无匹配语言',
            copyText: '复制',
            previewLabel: '预览',
            previewLoading:
              '<span class="mermaid-preview-loading">图表渲染中…</span>',
            previewToggleText: (previewOnlyMode: boolean) =>
              previewOnlyMode ? '编辑' : '隐藏',
            renderPreview: (
              language: string,
              content: string,
              applyPreview: ApplyCodePreview,
            ) => {
              if (language.trim().toLowerCase() !== 'mermaid') return null
              if (!content.trim()) return null
              enqueueMermaidPreview(content, applyPreview)
              // 返回 undefined 表示异步预览：Crepe 先展示 previewLoading，完成后调用 applyPreview
              return undefined
            },
          },
          // 内置 UI 的中文文案（斜杠菜单、占位符）
          [Crepe.Feature.Placeholder]: { text: '请输入内容…', mode: 'doc' },
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
    })().catch((error: unknown) => {
      console.error('[MarkdownEditor] 编辑器加载失败', error)
      if (disposed) return
      root.textContent = ''
      const tip = document.createElement('p')
      tip.className = 'px-4 py-3 text-sm text-foreground-muted'
      tip.textContent = '编辑器加载失败，请刷新页面重试'
      root.append(tip)
    })

    return () => {
      disposed = true
      detachBlockTypes?.()
      detachAnchorLinks()
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
        github ? 'md-editor-github' : '',
        blockTypesEnabled ? 'md-editor-block-types' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    />
  )
}
