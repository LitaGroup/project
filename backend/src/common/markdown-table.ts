/** Markdown 表格单元格：空值占位、竖线转义、换行折叠为空格 */
export function markdownCell(
  value: string | number | null | undefined,
  empty = '-',
): string {
  const text =
    value === null || value === undefined ? '' : String(value).trim();
  if (!text) return empty;
  return text.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
}

/** Markdown 正文单行摘要：折叠换行并可按长度截断 */
export function markdownLabel(
  value: string | null | undefined,
  maxLength = 80,
  empty = '-',
): string {
  const text = (value ?? '').replace(/\s*\n\s*/g, ' ').trim();
  if (!text) return empty;
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}
