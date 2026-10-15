import { docxBlocksToMarkdown } from './feishu-markdown';

type Block = Parameters<typeof docxBlocksToMarkdown>[0][number];

function text(id: string, content: string): Block {
  return {
    block_id: id,
    block_type: 2,
    text: { elements: [{ text_run: { content } }] },
  };
}

/** 单元格块（block_type=31），children 指向内容块 */
function cell(id: string, childIds: string[]): Block {
  return { block_id: id, block_type: 31, children: childIds };
}

/** 构造 2x2 表格 + 单元格 + 内容块，mergeInfo 自定义以覆盖合并场景 */
function table2x2(
  mergeInfo: { row_span: number; col_span: number }[],
  cellTexts: string[],
): Block[] {
  const cellIds = ['c1', 'c2', 'c3', 'c4'];
  const blocks: Block[] = [
    {
      block_id: 't1',
      block_type: 18,
      children: cellIds,
      table: {
        property: { row_size: 2, column_size: 2, merge_info: mergeInfo },
        cells: cellIds,
      },
    },
    ...cellIds.map((id) => cell(id, [`${id}-p`])),
    ...cellIds.map((id, i) => text(`${id}-p`, cellTexts[i])),
  ];
  return blocks;
}

describe('docxBlocksToMarkdown 表格块', () => {
  it('普通 2x2 表格 → Markdown 表格，首行作表头', () => {
    const md = docxBlocksToMarkdown(
      table2x2(
        [
          { row_span: 1, col_span: 1 },
          { row_span: 1, col_span: 1 },
          { row_span: 1, col_span: 1 },
          { row_span: 1, col_span: 1 },
        ],
        ['字段', '说明', 'id', '玩家ID'],
      ),
    );
    expect(md).toBe('| 字段 | 说明 |\n| --- | --- |\n| id | 玩家ID |');
  });

  it('单元格内容含 | 与换行时正确转义', () => {
    const md = docxBlocksToMarkdown(
      table2x2(
        [
          { row_span: 1, col_span: 1 },
          { row_span: 1, col_span: 1 },
          { row_span: 1, col_span: 1 },
          { row_span: 1, col_span: 1 },
        ],
        ['a|b', 'x', 'p\nq', 'y'],
      ),
    );
    expect(md).toBe('| a\\|b | x |\n| --- | --- |\n| p<br>q | y |');
  });

  it('合并单元格：被覆盖的位置降级填空', () => {
    const md = docxBlocksToMarkdown(
      table2x2(
        [
          { row_span: 2, col_span: 2 },
          { row_span: 0, col_span: 0 },
          { row_span: 0, col_span: 0 },
          { row_span: 0, col_span: 0 },
        ],
        ['合并区', '', '', ''],
      ),
    );
    expect(md).toBe('| 合并区 |  |\n| --- | --- |\n|  |  |');
  });

  it('单元格多段落以 <br> 连接，不破坏表格结构', () => {
    const blocks: Block[] = [
      {
        block_id: 't1',
        block_type: 18,
        children: ['c1'],
        table: {
          property: { row_size: 1, column_size: 1, merge_info: [] },
          cells: ['c1'],
        },
      },
      cell('c1', ['p1', 'p2']),
      text('p1', '第一段'),
      text('p2', '第二段'),
    ];
    expect(docxBlocksToMarkdown(blocks)).toBe('| 第一段<br>第二段 |\n| --- |');
  });

  it('单元格内容块不再散落泄漏到正文流', () => {
    const blocks: Block[] = [
      ...table2x2(
        [
          { row_span: 1, col_span: 1 },
          { row_span: 1, col_span: 1 },
          { row_span: 1, col_span: 1 },
          { row_span: 1, col_span: 1 },
        ],
        ['A', 'B', 'C', 'D'],
      ),
      text('after', '表格后的正文'),
    ];
    const md = docxBlocksToMarkdown(blocks);
    expect(md).toBe('| A | B |\n| --- | --- |\n| C | D |\n\n表格后的正文');
    expect(md.match(/A/g)).toHaveLength(1);
  });

  it('嵌套表格拍平塞进外层单元格', () => {
    const blocks: Block[] = [
      {
        block_id: 'outer',
        block_type: 18,
        children: ['oc1'],
        table: {
          property: { row_size: 1, column_size: 1, merge_info: [] },
          cells: ['oc1'],
        },
      },
      cell('oc1', ['inner']),
      {
        block_id: 'inner',
        block_type: 18,
        children: ['ic1'],
        table: {
          property: { row_size: 1, column_size: 1, merge_info: [] },
          cells: ['ic1'],
        },
      },
      cell('ic1', ['ip1']),
      text('ip1', '内'),
    ];
    const md = docxBlocksToMarkdown(blocks);
    expect(md).toContain('内');
    expect(md).toContain('<br>');
  });

  it('缺 row_size/column_size 时降级为按单元格顺序输出文本', () => {
    const blocks: Block[] = [
      {
        block_id: 't1',
        block_type: 18,
        children: ['c1', 'c2'],
        table: { property: {}, cells: ['c1', 'c2'] },
      },
      cell('c1', ['p1']),
      cell('c2', ['p2']),
      text('p1', '甲'),
      text('p2', '乙'),
    ];
    expect(docxBlocksToMarkdown(blocks)).toBe('甲\n\n乙');
  });

  it('新版表格（block_type 31/32）：被覆盖格子 merge_info 仍为 1x1，按起点跨度累积填空', () => {
    // 2 行 3 列，首格横跨 2 列（封面格子 merge_info 为 {1,1}）
    const blocks: Block[] = [
      {
        block_id: 't1',
        block_type: 31,
        children: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'],
        table: {
          property: {
            row_size: 2,
            column_size: 3,
            merge_info: [
              { row_span: 1, col_span: 2 },
              { row_span: 1, col_span: 1 },
              { row_span: 1, col_span: 1 },
              { row_span: 1, col_span: 1 },
              { row_span: 1, col_span: 1 },
              { row_span: 1, col_span: 1 },
            ],
          },
          cells: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'],
        },
      },
      ...['c1', 'c2', 'c3', 'c4', 'c5', 'c6'].map((id) =>
        cell(id, [`${id}-p`]),
      ),
      text('c1-p', '跨两列'),
      text('c2-p', '被覆盖'),
      text('c3-p', 'B'),
      text('c4-p', 'C'),
      text('c5-p', 'D'),
      text('c6-p', 'E'),
    ];
    expect(docxBlocksToMarkdown(blocks)).toBe(
      '| 跨两列 |  | B |\n| --- | --- | --- |\n| C | D | E |',
    );
  });

  it('纵向合并（row_span>1）：下方被覆盖行降级填空', () => {
    // 2 行 1 列，首格纵向跨 2 行
    const blocks: Block[] = [
      {
        block_id: 't1',
        block_type: 31,
        children: ['c1', 'c2'],
        table: {
          property: {
            row_size: 2,
            column_size: 1,
            merge_info: [
              { row_span: 2, col_span: 1 },
              { row_span: 1, col_span: 1 },
            ],
          },
          cells: ['c1', 'c2'],
        },
      },
      cell('c1', ['p1']),
      cell('c2', ['p2']),
      text('p1', '跨两行'),
      text('p2', '被覆盖'),
    ];
    expect(docxBlocksToMarkdown(blocks)).toBe('| 跨两行 |\n| --- |\n|  |');
  });
});

describe('docxBlocksToMarkdown 非表格回归', () => {
  it('标题/列表/图片/分割线行为不变', () => {
    const blocks: Block[] = [
      {
        block_id: 'h',
        block_type: 3,
        heading1: { elements: [{ text_run: { content: '标题' } }] },
      },
      {
        block_id: 'b',
        block_type: 12,
        bullet: { elements: [{ text_run: { content: '列表项' } }] },
      },
      { block_id: 'img', block_type: 27 },
      { block_id: 'div', block_type: 22 },
    ];
    expect(docxBlocksToMarkdown(blocks)).toBe(
      '# 标题\n\n- 列表项\n\n*[图片暂不导入]*\n\n---',
    );
  });
});
