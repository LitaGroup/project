/**
 * Markdown 视图统一前置 YAML frontmatter。
 * update 必含：最后更新时间，北京时间（UTC+8）精确到秒；
 * 其余字段（title/filename/description 等标识信息）非空才输出。
 */

/** 北京时间（UTC+8）格式化：YYYY-MM-DD HH:mm:ss */
export function beijingTime(d: Date | string = new Date()): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPart['type']): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

/** frontmatter 字段：update 缺省取当前北京时间，其余字段 null/空串不输出 */
export interface FrontmatterFields {
  update?: Date | string | null;
  [key: string]: unknown;
}

/** 值单行化并转义：引号包裹防 YAML 解析歧义，换行折叠为空格 */
function sanitize(value: unknown): string {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, ' ')
    .trim();
}

/** 生成 frontmatter 块（含末尾空行，可直接拼在正文前） */
export function mdFrontmatter(fields: FrontmatterFields): string {
  const { update, ...rest } = fields;
  const lines = [
    '---',
    `update: "${beijingTime(update === null || update === undefined ? undefined : update)}"`,
  ];
  for (const [key, value] of Object.entries(rest)) {
    if (value === null || value === undefined || value === '') continue;
    lines.push(`${key}: "${sanitize(value)}"`);
  }
  lines.push('---', '');
  return `${lines.join('\n')}\n`;
}
