import { useEffect, useState, useSyncExternalStore } from 'react'
import type { SyntaxHighlighterProps } from '@assistant-ui/react-markdown/code-fence'

type Mermaid = (typeof import('mermaid'))['default']

/** 动态 import 单独分包（mermaid 体积大），首个图渲染时才加载 */
let mermaidPromise: Promise<Mermaid> | null = null

function loadMermaid(): Promise<Mermaid> {
  mermaidPromise ??= import('mermaid').then((module) => module.default)
  return mermaidPromise
}

let renderSeq = 0

/** 订阅 <html> 根节点的 dark class（appica ThemeProvider 切换主题时增删） */
function useDarkMode(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const observer = new MutationObserver(notify)
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class'],
      })
      return () => observer.disconnect()
    },
    () => document.documentElement.classList.contains('dark'),
  )
}

/**
 * Mermaid 代码块渲染器（assistant-ui SyntaxHighlighter 协议）：
 * 把 ```mermaid 围栏代码块（flowchart TD / sequenceDiagram / gantt…）渲染为 SVG 图。
 * 解析失败（语法错误等）时回退展示原始代码；mermaid 配置 securityLevel=strict 防注入。
 */
export function MermaidDiagram({ code }: SyntaxHighlighterProps) {
  const dark = useDarkMode()
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const id = `mermaid-svg-${++renderSeq}`
    ;(async () => {
      try {
        const mermaid = await loadMermaid()
        if (!alive) return
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: dark ? 'dark' : 'neutral',
        })
        const result = await mermaid.render(id, code)
        if (!alive) return
        setSvg(result.svg)
        setError(null)
      } catch (reason) {
        // mermaid 渲染失败时会在 body 残留占位元素，手动清理
        document.getElementById(id)?.remove()
        document.getElementById(`d${id}`)?.remove()
        if (!alive) return
        setSvg(null)
        setError(reason instanceof Error ? reason.message : String(reason))
      }
    })()
    return () => {
      alive = false
    }
  }, [code, dark])

  if (svg !== null) {
    return (
      <div
        className="my-2 flex justify-center overflow-x-auto [&_svg]:h-auto [&_svg]:max-w-full"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    )
  }
  if (error !== null) {
    return (
      <div>
        <pre>
          <code>{code}</code>
        </pre>
        <p className="my-1 text-xs text-foreground-muted">
          流程图渲染失败：{error}
        </p>
      </div>
    )
  }
  return (
    <p className="my-2 flex items-center gap-2 text-xs text-foreground-muted">
      <span className="size-1.5 animate-pulse rounded-full bg-primary" />
      流程图渲染中…
    </p>
  )
}
