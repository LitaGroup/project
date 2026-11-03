import { useEffect, useState, useSyncExternalStore } from 'react'
import { isDarkTheme, renderMermaidSvg } from '../lib/mermaid'

function subscribeTheme(notify: () => void): () => void {
  const observer = new MutationObserver(notify)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  })
  return () => observer.disconnect()
}

/** 订阅 <html> 根节点的 dark class（appica ThemeProvider 切换主题时增删） */
function useDarkMode(): boolean {
  return useSyncExternalStore(subscribeTheme, isDarkTheme)
}

interface MermaidRenderState {
  key: string
  svg: string | null
  error: string | null
}

/**
 * Mermaid 代码块 React 渲染器（兼容 assistant-ui SyntaxHighlighter 协议）：
 * 把 ```mermaid 围栏代码块（flowchart TD / sequenceDiagram / gantt…）渲染为 SVG。
 * 解析失败（语法错误等）时回退展示原始代码；mermaid 配置 securityLevel=strict 防注入。
 */
export function MermaidDiagram({ code }: { code: string }) {
  const dark = useDarkMode()
  const renderKey = `${dark ? 'dark' : 'light'}:${code}`
  const [result, setResult] = useState<MermaidRenderState | null>(null)

  useEffect(() => {
    let alive = true
    void renderMermaidSvg(code, dark)
      .then((svg) => {
        if (alive) setResult({ key: renderKey, svg, error: null })
      })
      .catch((reason: unknown) => {
        if (!alive) return
        setResult({
          key: renderKey,
          svg: null,
          error: reason instanceof Error ? reason.message : String(reason),
        })
      })
    return () => {
      alive = false
    }
  }, [code, dark, renderKey])

  // 代码或主题变化后旧结果立即失效，渲染完成前展示 loading
  const current = result?.key === renderKey ? result : null
  if (current?.svg) {
    return (
      <div
        className="mermaid-diagram"
        role="img"
        aria-label="Mermaid 图表"
        dangerouslySetInnerHTML={{ __html: current.svg }}
      />
    )
  }
  if (current?.error) {
    return (
      <div className="mermaid-preview-error">
        <pre>
          <code>{code}</code>
        </pre>
        <p>图表渲染失败：{current.error}</p>
      </div>
    )
  }
  return (
    <p className="mermaid-preview-loading">
      <span className="size-1.5 animate-pulse rounded-full bg-primary" />
      图表渲染中…
    </p>
  )
}
