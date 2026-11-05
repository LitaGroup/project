interface MarkdownNode {
  type: string
  value?: string
  children?: MarkdownNode[]
}

const BR_TAG = /^<br\s*\/?>$/i

/**
 * Markdown 单换行与 `<br>` 都渲染为硬换行。
 * 只处理文本和独立 HTML 节点，不启用任意原始 HTML，避免引入 XSS 风险。
 */
export function remarkLineBreaks() {
  return (tree: unknown): void => {
    const walk = (node: MarkdownNode): void => {
      if (!node.children) return
      const next: MarkdownNode[] = []
      for (const child of node.children) {
        walk(child)
        if (child.type === 'text' && child.value?.includes('\n')) {
          const segments = child.value.split('\n')
          segments.forEach((segment, index) => {
            if (index > 0) next.push({ type: 'break' })
            if (segment) next.push({ type: 'text', value: segment })
          })
          continue
        }
        if (child.type === 'html' && child.value?.trim().match(BR_TAG)) {
          next.push({ type: 'break' })
          continue
        }
        next.push(child)
      }
      node.children = next
    }
    walk(tree as MarkdownNode)
  }
}
