/**
 * 飞书内容 → Markdown 转换器。
 * 约定：所有导入内容统一以 Markdown 存储；docx 表格块转 Markdown 表格（合并单元格降级填空），图片块暂不导入（后续再支持）。
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
  /** 子块 id 列表（如表格单元格内的内容块） */
  children?: string[];
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
  /** 表格块（block_type=18） */
  table?: {
    property?: {
      row_size?: number;
      column_size?: number;
      /** 合并信息，与 cells 按行优先一一对应；被合并覆盖的位置 row_span/col_span 为 0 */
      merge_info?: { row_span?: number; col_span?: number }[];
    };
    /** 单元格块 id，行优先，数量 = row_size * column_size */
    cells?: string[];
  };
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
 * 单个内容块 → 一行 Markdown；null 表示该块不产出内容。
 */
function blockToLine(block: DocxBlock): string | null {
  const t = block.block_type;
  if (t === 1) return null; // 页面块，标题已在元信息里
  if (t === 27) return '*[图片暂不导入]*';
  if (t === 22) return '---';
  if (t >= 3 && t <= 11) {
    const body =
      block[`heading${t - 2}` as `heading${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`];
    return `${'#'.repeat(t - 2)} ${elementsToMarkdown(body?.elements)}`;
  }
  if (t === 12) {
    return `- ${elementsToMarkdown(block.bullet?.elements)}`;
  }
  if (t === 13) {
    return `1. ${elementsToMarkdown(block.ordered?.elements)}`;
  }
  if (t === 14) {
    return '```\n\n' + elementsToMarkdown(block.code?.elements) + '\n\n```';
  }
  if (t === 15) {
    return `> ${elementsToMarkdown(block.quote?.elements)}`;
  }
  if (t === 17) {
    const mark = block.todo?.style?.done ? 'x' : ' ';
    return `- [${mark}] ${elementsToMarkdown(block.todo?.elements)}`;
  }
  if (t === 2) {
    return elementsToMarkdown(block.text?.elements);
  }
  // 其余类型（视图、小组件等）暂不转换
  return null;
}

/** 表格单元格内容：子块逐个转换，多段落以 <br> 连接（Markdown 单元格内不支持换行） */
function tableCellToText(
  cellBlock: DocxBlock | undefined,
  byId: Map<string, DocxBlock>,
): string {
  const parts: string[] = [];
  for (const childId of cellBlock?.children ?? []) {
    const child = byId.get(childId);
    if (!child) continue;
    if (child.block_type === 18) {
      // 嵌套表格：Markdown 不支持嵌套，拍平为一段文本塞进单元格
      const nested = tableToMarkdown(child, byId);
      if (nested) parts.push(nested.replace(/\n/g, '<br>'));
    } else {
      const line = blockToLine(child);
      if (line !== null && line !== '') parts.push(line);
    }
  }
  return parts.join('<br>');
}

/**
 * 表格块（block_type=18）→ Markdown 表格。
 * 首行作表头（与飞书 sheets/bitable 导入行为一致）；
 * 合并单元格：Markdown 不支持，被覆盖的位置降级填空。
 */
function tableToMarkdown(
  block: DocxBlock,
  byId: Map<string, DocxBlock>,
): string | null {
  const table = block.table;
  const cells = table?.cells ?? [];
  if (!table || cells.length === 0) return null;
  const rowSize = table.property?.row_size ?? 0;
  const colSize = table.property?.column_size ?? 0;
  if (rowSize <= 0 || colSize <= 0) {
    // 缺少网格元信息，无法重建行列，降级为按单元格顺序输出文本
    return cells
      .map((id) => tableCellToText(byId.get(id), byId))
      .filter((text) => text !== '')
      .join('\n\n');
  }
  const mergeInfo = table.property?.merge_info ?? [];
  const grid: string[][] = [];
  for (let r = 0; r < rowSize; r++) {
    const row: string[] = [];
    for (let c = 0; c < colSize; c++) {
      const idx = r * colSize + c;
      const merge = mergeInfo[idx];
      // 被合并覆盖的位置（span 为 0）填空
      if (merge && (merge.row_span === 0 || merge.col_span === 0)) {
        row.push('');
        continue;
      }
      const cell = idx < cells.length ? byId.get(cells[idx]) : undefined;
      row.push(tableCellToText(cell, byId));
    }
    grid.push(row);
  }
  return rowsToMarkdownTable(grid);
}

/**
 * 递归收集表格（含嵌套表格）名下的所有块 id：表格块本身 + 单元格块 + 单元格子块。
 * 这些块由 tableToMarkdown 统一渲染，主流程须跳过，避免单元格文本散落输出。
 */
function collectTableOwnedBlockIds(
  tables: DocxBlock[],
  byId: Map<string, DocxBlock>,
): Set<string> {
  const owned = new Set<string>();
  const walkCell = (cellId: string): void => {
    if (owned.has(cellId)) return;
    owned.add(cellId);
    const cell = byId.get(cellId);
    for (const childId of cell?.children ?? []) {
      const child = byId.get(childId);
      if (child?.block_type === 18) walkTable(child);
      else walkCell(childId);
    }
  };
  const walkTable = (table: DocxBlock): void => {
    if (owned.has(table.block_id)) return;
    owned.add(table.block_id);
    for (const cellId of table.table?.cells ?? []) walkCell(cellId);
  };
  for (const table of tables) walkTable(table);
  return owned;
}

/**
 * docx 块列表（接口按文档顺序返回）→ Markdown。
 * block_type 参考：1 页面, 2 文本, 3-11 标题1-9, 12 无序列表, 13 有序列表,
 * 14 代码块, 15 引用, 17 待办, 18 表格, 22 分割线, 27 图片(占位), 31 单元格(随表格渲染)。
 */
export function docxBlocksToMarkdown(blocks: DocxBlock[]): string {
  const byId = new Map(blocks.map((b) => [b.block_id, b]));
  const owned = collectTableOwnedBlockIds(
    blocks.filter((b) => b.block_type === 18),
    byId,
  );
  const lines: string[] = [];
  for (const block of blocks) {
    if (block.block_type === 18) {
      const table = tableToMarkdown(block, byId);
      if (table) lines.push(table);
      continue;
    }
    if (owned.has(block.block_id)) continue;
    const line = blockToLine(block);
    if (line !== null) lines.push(line);
  }
  return lines.join('\n\n');
}
