/**
 * 飞书内容 → Markdown 转换器。
 * 约定：所有导入内容统一以 Markdown 存储；docx 图片块暂不导入（后续再支持）。
 */

// ---- 通用单元格/字段值格式化（表格、多维表格共用） ----

interface TextSegment {
  text?: string;
  name?: string;
  link?: string;
  type?: string;
}

/** 飞书各种字段值 → 纯文本 */
export function feishuValueToText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    // 日期字段是 ms 时间戳，按东八区取日期
    return String(value);
  }
  if (Array.isArray(value)) {
    return value
      .map((v) => {
        if (typeof v === 'object' && v !== null) {
          const seg = v as TextSegment & { name?: string };
          return seg.name ?? seg.text ?? feishuValueToText(v);
        }
        return feishuValueToText(v);
      })
      .join('');
  }
  if (typeof value === 'object') {
    const obj = value as { text?: string; link?: string; name?: string };
    return obj.text ?? obj.name ?? obj.link ?? '';
  }
  return '';
}

/** 日期时间戳（ms）→ YYYY-MM-DD（东八区） */
export function feishuDateToText(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms));
}

/** Markdown 表格单元格转义 */
function mdCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

/** 二维数组 → Markdown 表格（首行为表头） */
export function rowsToMarkdownTable(rows: string[][]): string {
  if (rows.length === 0) return '';
  const header = rows[0];
  const lines = [
    `| ${header.map(mdCell).join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.slice(1).map((row) => `| ${row.map(mdCell).join(' | ')} |`),
  ];
  return lines.join('\n');
}

// ---- 电子表格 ----

/** 单元格原始值 → 文本（日期/多段文本/链接等） */
function sheetCellToText(cell: unknown): string {
  if (cell === null || cell === undefined) return '';
  if (typeof cell === 'number') {
    // v2 values 接口日期单元格返回 ms 时间戳（较大数值视为日期）
    return cell > 100_000_000_000 ? feishuDateToText(cell) : String(cell);
  }
  return feishuValueToText(cell);
}

export function sheetValuesToMarkdown(values: unknown[][]): string {
  return rowsToMarkdownTable(
    values.map((row) => row.map((cell) => sheetCellToText(cell))),
  );
}

// ---- 多维表格 ----

export interface BitableFieldMeta {
  field_id: string;
  field_name: string;
  /** 5=日期 等，见飞书字段类型枚举 */
  type: number;
}

function bitableCellToText(value: unknown, fieldType: number): string {
  if (value === null || value === undefined) return '';
  if (fieldType === 5 && typeof value === 'number') {
    return feishuDateToText(value);
  }
  return feishuValueToText(value);
}

export function bitableRecordsToMarkdown(
  fields: BitableFieldMeta[],
  records: { fields: Record<string, unknown> }[],
): string {
  const header = fields.map((f) => f.field_name);
  const rows = records.map((r) =>
    fields.map((f) => bitableCellToText(r.fields[f.field_name], f.type)),
  );
  return rowsToMarkdownTable([header, ...rows]);
}

// ---- 新版文档（docx）----

interface DocxTextElement {
  text_run?: {
    content: string;
    text_element_style?: {
      bold?: boolean;
      italic?: boolean;
      strikethrough?: boolean;
      inline_code?: boolean;
      link?: { url: string };
    };
  };
  mention_doc?: { title: string; url: string };
  mention_user?: { user_id?: string };
  equation?: { content?: string };
}

interface DocxBlock {
  block_id: string;
  block_type: number;
  text?: { elements?: DocxTextElement[] };
  heading1?: { elements?: DocxTextElement[] };
  heading2?: { elements?: DocxTextElement[] };
  heading3?: { elements?: DocxTextElement[] };
  heading4?: { elements?: DocxTextElement[] };
  heading5?: { elements?: DocxTextElement[] };
  heading6?: { elements?: DocxTextElement[] };
  heading7?: { elements?: DocxTextElement[] };
  heading8?: { elements?: DocxTextElement[] };
  heading9?: { elements?: DocxTextElement[] };
  bullet?: { elements?: DocxTextElement[] };
  ordered?: { elements?: DocxTextElement[] };
  code?: { elements?: DocxTextElement[] };
  quote?: { elements?: DocxTextElement[] };
  todo?: { elements?: DocxTextElement[]; style?: { done?: boolean } };
}

function elementToMarkdown(el: DocxTextElement): string {
  if (el.mention_doc) {
    return `[${el.mention_doc.title}](${el.mention_doc.url})`;
  }
  if (el.mention_user) return '@用户';
  if (el.equation) return el.equation.content ?? '';
  const run = el.text_run;
  if (!run) return '';
  let text = run.content;
  const style = run.text_element_style ?? {};
  if (style.link?.url) {
    text = `[${text}](${decodeURIComponent(style.link.url)})`;
  }
  if (style.inline_code) text = `\`${text}\``;
  if (style.bold) text = `**${text}**`;
  if (style.strikethrough) text = `~~${text}~~`;
  if (style.italic) text = `*${text}*`;
  return text;
}

function elementsToMarkdown(elements?: DocxTextElement[]): string {
  return (elements ?? []).map(elementToMarkdown).join('');
}

/**
 * docx 块列表（接口按文档顺序返回）→ Markdown。
 * block_type 参考：1 页面, 2 文本, 3-11 标题1-9, 12 无序列表, 13 有序列表,
 * 14 代码块, 15 引用, 17 待办, 22 分割线, 27 图片(跳过)。
 */
export function docxBlocksToMarkdown(blocks: DocxBlock[]): string {
  const lines: string[] = [];
  for (const block of blocks) {
    const t = block.block_type;
    if (t === 1) continue; // 页面块，标题已在元信息里
    if (t === 27) {
      lines.push('*[图片暂不导入]*');
      continue;
    }
    if (t === 22) {
      lines.push('---');
      continue;
    }
    if (t >= 3 && t <= 11) {
      const body =
        block[
          `heading${t - 2}` as `heading${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`
        ];
      lines.push(`${'#'.repeat(t - 2)} ${elementsToMarkdown(body?.elements)}`);
      continue;
    }
    if (t === 12) {
      lines.push(`- ${elementsToMarkdown(block.bullet?.elements)}`);
      continue;
    }
    if (t === 13) {
      lines.push(`1. ${elementsToMarkdown(block.ordered?.elements)}`);
      continue;
    }
    if (t === 14) {
      lines.push('```', elementsToMarkdown(block.code?.elements), '```');
      continue;
    }
    if (t === 15) {
      lines.push(`> ${elementsToMarkdown(block.quote?.elements)}`);
      continue;
    }
    if (t === 17) {
      const mark = block.todo?.style?.done ? 'x' : ' ';
      lines.push(`- [${mark}] ${elementsToMarkdown(block.todo?.elements)}`);
      continue;
    }
    if (t === 2) {
      lines.push(elementsToMarkdown(block.text?.elements));
      continue;
    }
    // 其余类型（表格、视图、小组件等）暂不转换，其子文本块会按顺序自然输出
  }
  return lines.join('\n\n');
}
