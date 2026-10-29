import { unescapeMarkdown } from '../common/markdown-escape';

/**
 * 无标题新建任务时，从任务描述首个有效行推导临时标题：
 * 先还原 Markdown 转义（`http\://` → `http://`），再去掉常见 Markdown 标记，最长 200 字。
 */
export function deriveTaskTitle(description: string): string {
  for (const raw of description.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^[-*_=]{3,}$/.test(line)) continue;
    const plain = unescapeMarkdown(line)
      .replace(/^#{1,6}\s*/, '')
      .replace(/^>\s*/, '')
      .replace(/^[-*+]\s+/, '')
      .replace(/^\d+[.)]\s+/, '')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[*_`~]/g, '')
      .trim();
    if (plain && !/^[-*_=]+$/.test(plain)) return plain.slice(0, 200);
  }
  return '';
}
