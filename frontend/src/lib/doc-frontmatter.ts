/** YAML 风格键值行（key: value） */
const YAML_KV_RE = /^[A-Za-z0-9_-]+\s*:/

export interface FrontmatterEntry {
  key: string
  value: string
}

export interface FrontmatterSplit {
  /** 文档开头 YAML frontmatter 的键值（无 frontmatter 时为空数组） */
  entries: FrontmatterEntry[]
  /** 去掉 frontmatter 后的正文 */
  body: string
}

/**
 * 拆分文档开头的 YAML frontmatter（`---` 包裹的键值行）。
 * 仅当开头 `---` 之后全部是 `key: value` 行、且以 `---` 闭合时认定，避免吞掉正文里
 * 以分隔线开头的普通内容。所见即所得编辑器不识别 frontmatter，页面单独以表格展示，
 * 保存时再由 {@link composeFrontmatter} 拼回正文前。
 */
export function splitFrontmatter(markdown: string): FrontmatterSplit {
  const lines = markdown.split('\n')
  if (lines[0]?.trim() !== '---') return { entries: [], body: markdown }
  const end = lines.findIndex((line, i) => i > 0 && line.trim() === '---')
  if (end < 0) return { entries: [], body: markdown }
  const inner = lines
    .slice(1, end)
    .map((line) => line.trim())
    .filter(Boolean)
  if (inner.length === 0 || !inner.every((line) => YAML_KV_RE.test(line))) {
    return { entries: [], body: markdown }
  }
  const entries = inner.map((line) => {
    const i = line.indexOf(':')
    return {
      key: line.slice(0, i).trim(),
      // 值去掉 YAML 对称包裹引号（仅一层），展示更干净
      value: line
        .slice(i + 1)
        .trim()
        .replace(/^"(.*)"$/, '$1')
        .replace(/^'(.*)'$/, '$1'),
    }
  })
  return {
    entries,
    body: lines
      .slice(end + 1)
      .join('\n')
      .replace(/^\n+/, ''),
  }
}

/** 把 frontmatter 键值与正文拼回完整 Markdown（无键值时原样返回正文） */
export function composeFrontmatter(
  entries: FrontmatterEntry[],
  body: string,
): string {
  if (entries.length === 0) return body
  const head = entries.map((entry) => `${entry.key}: ${entry.value}`).join('\n')
  return `---\n${head}\n---\n\n${body.replace(/^\n+/, '')}`
}
