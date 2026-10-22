import { Toc, TocList, TocItem, TocLink } from '@appica/ui-react/toc'
import type { MouseEvent } from 'react'
import type { DocHeading } from '../lib/doc-toc'

/** 文档右侧目录导航：基于组件库 Table of Content（自带 scroll-spy 高亮与活动指示条）。
    外层需用 key={锚点注入轮次} 控制（重）挂载——Toc 只在注册时 getElementById，
    而预览区标题 id 由 MutationObserver 异步注入，注入完成后挂载才能观察到目标 */
export function DocToc({
  items,
  onSelect,
}: {
  items: DocHeading[]
  onSelect: (slug: string) => void
}) {
  // 以文档中最小的标题层级为基准映射到组件的 depth（2-6），保证最浅层级顶格
  const minLevel = Math.min(...items.map((item) => item.level))
  // 点击拦截：编辑页签下预览隐藏、原生锚点无法滚动，统一走 scrollToHeading（内部会先切预览）
  const handleClick = (event: MouseEvent<HTMLElement>) => {
    const link = (event.target as HTMLElement | null)?.closest?.('a[href^="#"]')
    if (!link) return
    event.preventDefault()
    onSelect(decodeURIComponent(link.getAttribute('href')!.slice(1)))
  }
  return (
    <Toc
      aria-label="文档目录"
      onClick={handleClick}
      className="hidden w-56 shrink-0 overflow-auto py-1 lg:block"
    >
      <p className="px-2 pb-1 text-xs font-medium text-foreground-muted">目录</p>
      <TocList>
        {items.map((item) => (
          <TocItem key={item.slug}>
            <TocLink
              href={`#${item.slug}`}
              depth={Math.min(6, item.level - minLevel + 2)}
              className="truncate"
            >
              {item.text}
            </TocLink>
          </TocItem>
        ))}
      </TocList>
    </Toc>
  )
}
