import type { TocItem } from '../lib/doc-toc'

/** 文档右侧目录导航：按标题层级缩进，滚动跟随高亮，点击滚动到对应标题 */
export function DocToc({
  items,
  activeSlug,
  onSelect,
}: {
  items: TocItem[]
  activeSlug: string | null
  onSelect: (slug: string) => void
}) {
  if (items.length === 0) return null
  // 以文档中最小的标题层级为基准缩进，避免 h2 开头的文档整体缩进一格
  const minLevel = Math.min(...items.map((item) => item.level))
  return (
    <nav aria-label="文档目录" className="hidden w-60 shrink-0 overflow-auto py-1 lg:block">
      <p className="px-2 pb-1 text-xs font-medium text-foreground-muted">目录</p>
      <ul className="flex flex-col gap-0.5">
        {items.map((item) => {
          const active = item.slug === activeSlug
          return (
            <li key={item.slug}>
              <button
                type="button"
                title={item.text}
                onClick={() => onSelect(item.slug)}
                className={`block w-full truncate rounded py-1 pr-2 text-left text-xs leading-5 hover:text-foreground-intense ${
                  active
                    ? 'bg-background-muted font-medium text-foreground-intense'
                    : 'text-foreground-muted'
                }`}
                style={{ paddingLeft: 8 + (item.level - minLevel) * 12 }}
              >
                {item.text}
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
