type Mermaid = (typeof import('mermaid'))['default']

/** 动态 import 单独分包（mermaid 体积大），首个图渲染时才加载 */
let mermaidPromise: Promise<Mermaid> | null = null
let renderSeq = 0
/** mermaid.initialize 修改全局配置，串行执行避免多个图表并发渲染时主题互相覆盖 */
let renderChain: Promise<void> = Promise.resolve()

function loadMermaid(): Promise<Mermaid> {
  mermaidPromise ??= import('mermaid').then(
    (module) => module.default,
    (reason: unknown) => {
      // 网络抖动等导致的加载失败允许下次重试，而不是永久缓存 rejected Promise
      mermaidPromise = null
      throw reason
    },
  )
  return mermaidPromise
}

/** 当前平台是否处于暗色主题（ThemeProvider 在 <html> 上增删 dark class） */
export function isDarkTheme(): boolean {
  return document.documentElement.classList.contains('dark')
}

/**
 * 把 ```mermaid 围栏代码块渲染为 SVG。
 * 解析失败时会清理 mermaid 残留的临时 DOM，并抛出原始错误供调用方回退展示源码。
 */
export function renderMermaidSvg(
  code: string,
  dark = isDarkTheme(),
): Promise<string> {
  const run = renderChain.then(async () => {
    const mermaid = await loadMermaid()
    const id = `mermaid-svg-${Date.now().toString(36)}-${++renderSeq}`
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      suppressErrorRendering: true,
      theme: dark ? 'dark' : 'neutral',
      fontFamily: 'inherit',
    })
    try {
      const result = await mermaid.render(id, code)
      return result.svg
    } catch (reason) {
      // mermaid 渲染失败时可能在 body 残留占位元素，手动清理
      document.getElementById(id)?.remove()
      document.getElementById(`d${id}`)?.remove()
      throw reason
    }
  })
  renderChain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}
