import GithubSlugger from 'github-slugger'

export interface DocHeading {
  /** 标题层级 1-6 */
  level: number
  /** 行内链接/HTML 已剥离的标题文本（用于展示与生成 slug，与渲染后的 textContent 一致） */
  text: string
  /** GitHub 风格锚点 slug（同文档内唯一，重复标题自动加 -1/-2…） */
  slug: string
}

/** 剥离行内链接/图片/HTML 标签。注意加粗、行内代码、下划线等不在此处理——
    github-slugger 会按标点统一剥离，与渲染后 textContent 的 slug 结果一致（如 box_bless_refresh 保留下划线） */
function stripInline(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1') // 图片 → alt
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // 链接 → 文本
    .replace(/<[^>]+>/g, '') // HTML 标签
    .trim()
}

/** 对标题文本生成 slug（需传入同一 slugger 实例以保证重复标题去重序号一致） */
export function slugifyHeading(text: string, slugger: GithubSlugger): string {
  return slugger.slug(stripInline(text))
}

/** 解析 Markdown 中的 ATX 标题（跳过围栏代码块），顺序与渲染后的 h1-h6 一致 */
export function parseDocHeadings(markdown: string): DocHeading[] {
  const slugger = new GithubSlugger()
  const items: DocHeading[] = []
  // 当前所处围栏代码块的开始标记（``` 或 ~~~），用于跳过代码块内的 # 注释行
  let fence: string | null = null
  for (const line of markdown.split('\n')) {
    const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})/)
    if (fenceMatch) {
      const marker = fenceMatch[1]
      if (!fence) fence = marker
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null
      continue
    }
    if (fence) continue
    const headingMatch = line.match(/^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/)
    if (!headingMatch) continue
    const text = stripInline(headingMatch[2])
    if (!text) continue
    items.push({ level: headingMatch[1].length, text, slug: slugifyHeading(text, slugger) })
  }
  return items
}
