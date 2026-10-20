import {
  docxBlocksToMarkdown,
  feishuCommentsToMarkdown,
} from './feishu-markdown';

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

/** 有序列表块（block_type=13），可指定父块模拟列表嵌套 */
function ordered(id: string, content: string, parentId?: string): Block {
  return {
    block_id: id,
    parent_id: parentId,
    block_type: 13,
    ordered: { elements: [{ text_run: { content } }] },
  };
}

describe('docxBlocksToMarkdown 列表', () => {
  it('有序列表编号按父块分组递增，穿插兄弟内容不断号，标题后重新计数', () => {
    const blocks: Block[] = [
      ordered('a', '第一条'),
      ordered('b', '第二条'),
      ordered('c', '第三条'),
      text('t', '中间的段落'),
      ordered('d', '延续编号'),
      {
        block_id: 'h',
        block_type: 3,
        heading1: { elements: [{ text_run: { content: '下一节' } }] },
      },
      ordered('e', '新列表'),
    ];
    expect(docxBlocksToMarkdown(blocks)).toBe(
      '1. 第一条\n\n2. 第二条\n\n3. 第三条\n\n中间的段落\n\n4. 延续编号\n\n# 下一节\n\n1. 新列表',
    );
  });

  it('有序列表项的嵌套子项（无序/段落）不打断编号', () => {
    const blocks: Block[] = [
      ordered('a', '第一条'),
      {
        block_id: 'sub',
        parent_id: 'a',
        block_type: 12,
        bullet: { elements: [{ text_run: { content: '子项' } }] },
      },
      { ...text('cont', '补充说明'), parent_id: 'a' },
      ordered('b', '第二条'),
      text('t', '顶层段落'),
      ordered('c', '新列表'),
    ];
    expect(docxBlocksToMarkdown(blocks)).toBe(
      '1. 第一条\n\n  - 子项\n\n补充说明\n\n2. 第二条\n\n顶层段落\n\n3. 新列表',
    );
  });

  it('无序列表与待办列表保持原有格式', () => {
    const blocks: Block[] = [
      {
        block_id: 'b',
        block_type: 12,
        bullet: { elements: [{ text_run: { content: '无序项' } }] },
      },
      {
        block_id: 'd',
        block_type: 17,
        todo: {
          elements: [{ text_run: { content: '已完成' } }],
          style: { done: true },
        },
      },
      {
        block_id: 'e',
        block_type: 17,
        todo: {
          elements: [{ text_run: { content: '未完成' } }],
          style: { done: false },
        },
      },
    ];
    expect(docxBlocksToMarkdown(blocks)).toBe(
      '- 无序项\n\n- [x] 已完成\n\n- [ ] 未完成',
    );
  });

  it('多级列表按父链缩进，子有序列表独立编号', () => {
    const blocks: Block[] = [
      ordered('p1', '父项一'),
      ordered('c1', '子项一', 'p1'),
      ordered('c2', '子项二', 'p1'),
      ordered('p2', '父项二'),
      {
        block_id: 'sc1',
        parent_id: 'p2',
        block_type: 12,
        bullet: { elements: [{ text_run: { content: '子无序' } }] },
      },
    ];
    expect(docxBlocksToMarkdown(blocks)).toBe(
      '1. 父项一\n\n   1. 子项一\n\n   2. 子项二\n\n2. 父项二\n\n  - 子无序',
    );
  });

  it('表格单元格内有序列表独立递增编号', () => {
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
      cell('c1', ['i1', 'i2']),
      ordered('i1', '首页Banner'),
      ordered('i2', '语音房MINI Banner'),
    ];
    expect(docxBlocksToMarkdown(blocks)).toBe(
      '| 1. 首页Banner<br>2. 语音房MINI Banner |\n| --- |',
    );
  });
});

describe('docxBlocksToMarkdown 备注块与引用容器', () => {
  it('备注块（19 callout）子内容渲染为引用样式', () => {
    const blocks: Block[] = [
      {
        block_id: 'callout',
        block_type: 19,
        callout: { background_color: 2, emoji_id: 'dvd' },
        children: ['p1', 'p2'],
      },
      text('p1', '备注第一段'),
      text('p2', '备注第二段'),
    ];
    expect(docxBlocksToMarkdown(blocks)).toBe('> 备注第一段\n> 备注第二段');
  });

  it('引用容器（34）子内容渲染为引用样式，内部引用块不重复加前缀', () => {
    const blocks: Block[] = [
      {
        block_id: 'qc',
        block_type: 34,
        quote_container: {},
        children: ['p1', 'q1'],
      },
      text('p1', '容器内文本'),
      {
        block_id: 'q1',
        block_type: 15,
        quote: { elements: [{ text_run: { content: '已有引用' } }] },
      },
    ];
    expect(docxBlocksToMarkdown(blocks)).toBe('> 容器内文本\n> 已有引用');
  });

  it('引用容器内的有序列表正常编号', () => {
    const blocks: Block[] = [
      {
        block_id: 'qc',
        block_type: 34,
        quote_container: {},
        children: ['i1', 'i2'],
      },
      ordered('i1', '第一点'),
      ordered('i2', '第二点'),
    ];
    expect(docxBlocksToMarkdown(blocks)).toBe('> 1. 第一点\n> 2. 第二点');
  });
});

describe('docxBlocksToMarkdown 图片块', () => {
  const imageBlock = (id: string, token: string): Block => ({
    block_id: id,
    block_type: 27,
    image: { token },
  });

  it('已下载的图片渲染为内链 Markdown 图片', () => {
    const blocks: Block[] = [
      text('t1', '图片前的文字'),
      imageBlock('img', 'boxcnABC'),
      text('t2', '图片后的文字'),
    ];
    const urls = new Map([
      ['boxcnABC', '/images/feishu/20261015/boxcnABC.png'],
    ]);
    expect(docxBlocksToMarkdown(blocks, urls)).toBe(
      '图片前的文字\n\n![图片](/images/feishu/20261015/boxcnABC.png)\n\n图片后的文字',
    );
  });

  it('未下载成功的图片保持占位文本', () => {
    const blocks: Block[] = [
      imageBlock('img1', 'boxcnXYZ'),
      imageBlock('img2', 'boxcnOTHER'),
    ];
    const urls = new Map([['boxcnOTHER', '/images/feishu/20261015/b.png']]);
    expect(docxBlocksToMarkdown(blocks, urls)).toBe(
      '*[图片暂不导入]*\n\n![图片](/images/feishu/20261015/b.png)',
    );
  });

  it('单元格内的图片同样支持内链', () => {
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
      cell('c1', ['img']),
      imageBlock('img', 'boxcnABC'),
    ];
    const urls = new Map([
      ['boxcnABC', '/images/feishu/20261015/boxcnABC.png'],
    ]);
    expect(docxBlocksToMarkdown(blocks, urls)).toBe(
      '| ![图片](/images/feishu/20261015/boxcnABC.png) |\n| --- |',
    );
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

describe('feishuCommentsToMarkdown 评论导入', () => {
  const now = new Date('2026-10-20T02:00:00Z');

  it('无评论返回空串', () => {
    expect(feishuCommentsToMarkdown([], new Map(), now)).toBe('');
  });

  it('评论追加为分割线 + 评论小节，含作者/时间/引用/回复', () => {
    const md = feishuCommentsToMarkdown(
      [
        {
          userId: 'ou_a',
          createTime: 1610281603,
          isSolved: true,
          isWhole: false,
          quote: '引用原文',
          replies: [
            {
              userId: 'ou_a',
              createTime: 1610281603,
              text: '第一条评论',
              imageCount: 0,
            },
            {
              userId: 'ou_b',
              createTime: 1610281900,
              text: '第二条回复',
              imageCount: 0,
            },
          ],
        },
      ],
      new Map([
        ['ou_a', '张三'],
        ['ou_b', '李四'],
      ]),
      now,
    );
    expect(md).toContain('---\n\n## 评论');
    expect(md).toContain(
      '### 评论 1 · 张三 · 2021-01-10 20:26 · 划词评论 · 已解决',
    );
    expect(md).toContain('> 引用：引用原文');
    expect(md).toContain('第一条评论');
    expect(md).toContain('- **李四 · 2021-01-10 20:31**：第二条回复');
    expect(md).toContain('导入时间 2026-10-20 10:00');
  });

  it('评论按创建时间正序，未解析到姓名时回退 open_id', () => {
    const md = feishuCommentsToMarkdown(
      [
        {
          userId: 'ou_late',
          createTime: 200,
          isSolved: false,
          isWhole: true,
          quote: '',
          replies: [
            {
              userId: 'ou_late',
              createTime: 200,
              text: 'later',
              imageCount: 0,
            },
          ],
        },
        {
          userId: 'ou_early',
          createTime: 100,
          isSolved: false,
          isWhole: true,
          quote: '',
          replies: [
            {
              userId: 'ou_early',
              createTime: 100,
              text: 'earlier',
              imageCount: 1,
            },
          ],
        },
      ],
      new Map(),
      now,
    );
    expect(md.indexOf('earlier')).toBeLessThan(md.indexOf('later'));
    expect(md).toContain('ou_early');
    expect(md).toContain('[图片 1 张');
  });
});
