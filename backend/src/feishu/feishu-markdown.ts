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
  parent_id?: string;
  block_type: number;
  /** 子块 id 列表（如表格单元格、容器块内的内容块，列表子项） */
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
  /** 图片块（block_type=27），token 为素材文件 id */
  image?: { token?: string };
  /** 备注块（block_type=19，标注高亮块），内容在 children */
  callout?: unknown;
  /** 引用容器（block_type=34），内容在 children */
  quote_container?: unknown;
  /** 表格块（block_type=18 旧版 / 31 新版，均带 table body） */
  table?: {
    property?: {
      row_size?: number;
      column_size?: number;
      /**
       * 合并信息，与 cells 按行优先一一对应。
       * 合并起点为实际跨度；旧版被覆盖位置 span 为 0，新版仍为 1（按起点跨度累积推算覆盖区）
       */
      merge_info?: { row_span?: number; col_span?: number }[];
    };
    /** 单元格块 id，行优先，数量 = row_size * column_size */
    cells?: string[];
  };
}

/** 表格块：18 旧版表格 / 31 新版表格（新版同名的 31 单元格无 table body，据此区分） */
function isTableBlock(block: DocxBlock): boolean {
  return (
    (block.block_type === 18 || block.block_type === 31) &&
    !!block.table?.cells?.length
  );
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
 * 列表块（12/13/17）由 createBlockRenderer 处理（需要编号与缩进状态）。
 * imageUrls：已下载图片素材的 token → 链接映射，未命中时图片块降级为占位文本。
 */
function blockToLine(
  block: DocxBlock,
  imageUrls?: Map<string, string>,
): string | null {
  const t = block.block_type;
  if (t === 1) return null; // 页面块，标题已在元信息里
  if (t === 27) {
    const url = block.image?.token ? imageUrls?.get(block.image.token) : null;
    return url ? `![图片](${url})` : '*[图片暂不导入]*';
  }
  if (t === 22) return '---';
  if (t >= 3 && t <= 11) {
    const body =
      block[`heading${t - 2}` as `heading${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`];
    return `${'#'.repeat(t - 2)} ${elementsToMarkdown(body?.elements)}`;
  }
  if (t === 14) {
    return '```\n\n' + elementsToMarkdown(block.code?.elements) + '\n\n```';
  }
  if (t === 15) {
    return `> ${elementsToMarkdown(block.quote?.elements)}`;
  }
  if (t === 2) {
    return elementsToMarkdown(block.text?.elements);
  }
  // 其余类型（视图、小组件等）暂不转换
  return null;
}

function isListBlock(block?: DocxBlock): boolean {
  return (
    !!block &&
    (block.block_type === 12 ||
      block.block_type === 13 ||
      block.block_type === 17)
  );
}

/** 列表项层级：沿父链上溯连续的列表块（飞书用 children 表示列表嵌套） */
function listIndentLevel(
  block: DocxBlock,
  byId: Map<string, DocxBlock>,
): number {
  let level = 0;
  let parent = byId.get(block.parent_id ?? '');
  while (parent && isListBlock(parent)) {
    level += 1;
    parent = byId.get(parent.parent_id ?? '');
  }
  return level;
}

/**
 * 创建带列表状态的块渲染器：
 * - 有序列表（13）编号按父块分组递增（飞书每个列表项是独立块，编号隐含在顺序里）；
 *   同一父块下即使穿插兄弟段落/引用容器/无序子项也延续编号（对应标题折叠列表），
 *   标题/分割线后重新从 1 计数；
 * - 多级列表按父链推导缩进（无序/待办 2 空格、有序 3 空格每级）。
 * 每个独立上下文（正文流、容器、表格单元格）各建一个实例，编号互不串扰。
 */
function createBlockRenderer(
  byId: Map<string, DocxBlock>,
  imageUrls?: Map<string, string>,
): (block: DocxBlock) => string | null {
  const countersByParent = new Map<string, number[]>();
  return (block: DocxBlock): string | null => {
    const t = block.block_type;
    if (t === 12) {
      const pad = '  '.repeat(listIndentLevel(block, byId));
      return `${pad}- ${elementsToMarkdown(block.bullet?.elements)}`;
    }
    if (t === 13) {
      const level = listIndentLevel(block, byId);
      const key = block.parent_id ?? '';
      let counters = countersByParent.get(key);
      if (!counters) {
        counters = [];
        countersByParent.set(key, counters);
      }
      while (counters.length <= level) counters.push(0);
      counters.length = level + 1; // 回到浅层时清掉深层计数
      counters[level] += 1;
      const pad = '   '.repeat(level);
      return `${pad}${counters[level]}. ${elementsToMarkdown(block.ordered?.elements)}`;
    }
    if (t === 17) {
      const pad = '  '.repeat(listIndentLevel(block, byId));
      const mark = block.todo?.style?.done ? 'x' : ' ';
      return `${pad}- [${mark}] ${elementsToMarkdown(block.todo?.elements)}`;
    }
    const line = blockToLine(block, imageUrls);
    // 标题/分割线代表列表上下文边界
    if (line !== null && ((t >= 3 && t <= 11) || t === 22)) {
      countersByParent.clear();
    }
    return line;
  };
}

/** 容器块：19 备注（标注高亮块）/ 34 引用容器，子块由容器统一渲染为引用样式 */
function isContainerBlock(block: DocxBlock): boolean {
  return (
    (block.block_type === 19 || block.block_type === 34) &&
    !!block.children?.length
  );
}

/** 容器块 → Markdown 引用（> 前缀）；子块中的表格/嵌套容器递归渲染后统一加前缀 */
function containerToMarkdown(
  block: DocxBlock,
  byId: Map<string, DocxBlock>,
  imageUrls?: Map<string, string>,
): string | null {
  const render = createBlockRenderer(byId, imageUrls);
  const lines: string[] = [];
  for (const childId of block.children ?? []) {
    const child = byId.get(childId);
    if (!child) continue;
    if (isTableBlock(child)) {
      const table = tableToMarkdown(child, byId, imageUrls);
      if (table) lines.push(table.replace(/^/gm, '> '));
    } else if (isContainerBlock(child)) {
      const inner = containerToMarkdown(child, byId, imageUrls);
      if (inner) lines.push(inner);
    } else {
      const line = render(child);
      if (line !== null && line !== '') lines.push(line);
    }
  }
  if (lines.length === 0) return null;
  return lines
    .map((line) => (line === '>' || line.startsWith('> ') ? line : `> ${line}`))
    .join('\n');
}

/** 表格单元格内容：子块逐个转换（独立编号上下文），多段落以 <br> 连接 */
function tableCellToText(
  cellBlock: DocxBlock | undefined,
  byId: Map<string, DocxBlock>,
  imageUrls?: Map<string, string>,
): string {
  const render = createBlockRenderer(byId, imageUrls);
  const parts: string[] = [];
  for (const childId of cellBlock?.children ?? []) {
    const child = byId.get(childId);
    if (!child) continue;
    if (isTableBlock(child)) {
      // 嵌套表格：Markdown 不支持嵌套，拍平为一段文本塞进单元格
      const nested = tableToMarkdown(child, byId, imageUrls);
      if (nested) parts.push(nested.replace(/\n/g, '<br>'));
    } else if (isContainerBlock(child)) {
      const inner = containerToMarkdown(child, byId, imageUrls);
      if (inner) parts.push(inner.replace(/\n/g, '<br>'));
    } else {
      const line = render(child);
      if (line !== null && line !== '') parts.push(line);
    }
  }
  return parts.join('<br>');
}

/**
 * 表格块（block_type=18 旧版 / 31 新版）→ Markdown 表格。
 * 首行作表头（与飞书 sheets/bitable 导入行为一致）；
 * 合并单元格：Markdown 不支持，被覆盖的位置降级填空。
 */
function tableToMarkdown(
  block: DocxBlock,
  byId: Map<string, DocxBlock>,
  imageUrls?: Map<string, string>,
): string | null {
  const table = block.table;
  const cells = table?.cells ?? [];
  if (!table || cells.length === 0) return null;
  const rowSize = table.property?.row_size ?? 0;
  const colSize = table.property?.column_size ?? 0;
  if (rowSize <= 0 || colSize <= 0) {
    // 缺少网格元信息，无法重建行列，降级为按单元格顺序输出文本
    return cells
      .map((id) => tableCellToText(byId.get(id), byId, imageUrls))
      .filter((text) => text !== '')
      .join('\n\n');
  }
  const mergeInfo = table.property?.merge_info ?? [];
  const grid: string[][] = [];
  const covered = new Set<number>();
  for (let r = 0; r < rowSize; r++) {
    const row: string[] = [];
    for (let c = 0; c < colSize; c++) {
      const idx = r * colSize + c;
      const merge = mergeInfo[idx];
      // 被合并覆盖的位置（旧版 span 为 0；新版由起点跨度累积标记）降级填空
      if (
        covered.has(idx) ||
        (merge && (merge.row_span === 0 || merge.col_span === 0))
      ) {
        row.push('');
        continue;
      }
      const rowSpan = Math.max(1, merge?.row_span ?? 1);
      const colSpan = Math.max(1, merge?.col_span ?? 1);
      for (let dr = 0; dr < rowSpan; dr++) {
        for (let dc = 0; dc < colSpan; dc++) {
          if (dr === 0 && dc === 0) continue;
          const rr = r + dr;
          const cc = c + dc;
          if (rr < rowSize && cc < colSize) covered.add(rr * colSize + cc);
        }
      }
      const cell = idx < cells.length ? byId.get(cells[idx]) : undefined;
      row.push(tableCellToText(cell, byId, imageUrls));
    }
    grid.push(row);
  }
  return rowsToMarkdownTable(grid);
}

/** 表格单元格块：31 旧版（非表格形态）/ 32 新版 */
function isTableCellBlock(block: DocxBlock): boolean {
  return (
    block.block_type === 32 || (block.block_type === 31 && !isTableBlock(block))
  );
}

/**
 * 递归收集表格（含嵌套表格）与容器块名下的所有块 id：单元格块 + 单元格子块 + 容器子块。
 * 这些块由 tableToMarkdown / containerToMarkdown 统一渲染，
 * 主流程须跳过（表格、容器块本身不在集合内，由主流程渲染）。
 */
function collectNestedBlockIds(
  owners: DocxBlock[],
  byId: Map<string, DocxBlock>,
): Set<string> {
  const nested = new Set<string>();
  const addNested = (id: string): void => {
    if (nested.has(id)) return;
    nested.add(id);
    const block = byId.get(id);
    if (!block) return;
    if (isTableBlock(block)) {
      for (const cellId of block.table?.cells ?? []) addNested(cellId);
    } else if (isContainerBlock(block) || isTableCellBlock(block)) {
      for (const childId of block.children ?? []) addNested(childId);
    }
  };
  for (const owner of owners) {
    if (isTableBlock(owner)) {
      for (const cellId of owner.table?.cells ?? []) addNested(cellId);
    } else if (isContainerBlock(owner)) {
      for (const childId of owner.children ?? []) addNested(childId);
    }
  }
  return nested;
}

/**
 * docx 块列表（接口按文档顺序返回）→ Markdown。
 * block_type 参考：1 页面, 2 文本, 3-11 标题1-9, 12 无序列表, 13 有序列表,
 * 14 代码块, 15 引用, 17 待办, 18/31 表格, 19 备注(标注), 22 分割线, 27 图片,
 * 31(旧)/32(新) 表格单元格（随表格渲染）, 34 引用容器。
 * imageUrls：已下载图片素材的 token → 链接映射，未命中的图片块降级为占位文本。
 */
export function docxBlocksToMarkdown(
  blocks: DocxBlock[],
  imageUrls?: Map<string, string>,
): string {
  const byId = new Map(blocks.map((b) => [b.block_id, b]));
  const nested = collectNestedBlockIds(
    blocks.filter((b) => isTableBlock(b) || isContainerBlock(b)),
    byId,
  );
  const render = createBlockRenderer(byId, imageUrls);
  const lines: string[] = [];
  for (const block of blocks) {
    if (nested.has(block.block_id)) continue;
    if (isTableBlock(block)) {
      const table = tableToMarkdown(block, byId, imageUrls);
      if (table) lines.push(table);
      continue;
    }
    if (isContainerBlock(block)) {
      const quote = containerToMarkdown(block, byId, imageUrls);
      if (quote) lines.push(quote);
      continue;
    }
    const line = render(block);
    if (line !== null) lines.push(line);
  }
  return lines.join('\n\n');
}
