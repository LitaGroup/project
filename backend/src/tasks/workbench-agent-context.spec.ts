import { normalizeAgentPageContext } from './workbench.service';

describe('normalizeAgentPageContext', () => {
  it('未提供页面类型时沿用任务/通用会话', () => {
    expect(normalizeAgentPageContext()).toBeNull();
    expect(normalizeAgentPageContext({})).toBeNull();
  });

  it('规范化文档上下文并仅保留站内读取接口', () => {
    expect(
      normalizeAgentPageContext({
        type: 'document',
        id: 'document:12',
        title: '  技术设计  ',
        summary: '  类型：技术  ',
        readUrl: '/api/documents/12.md',
      }),
    ).toEqual({
      type: 'document',
      id: 'document:12',
      title: '技术设计',
      summary: '类型：技术',
      readUrl: '/api/documents/12.md',
    });

    expect(
      normalizeAgentPageContext({
        type: 'script',
        id: 'script:path',
        readUrl: 'https://example.com/secret',
      }),
    ).toEqual({
      type: 'script',
      id: 'script:path',
      title: undefined,
      summary: undefined,
    });
  });

  it('拒绝不支持的类型或缺少 ID', () => {
    expect(() =>
      normalizeAgentPageContext({ type: 'project', id: '1' }),
    ).toThrow('不支持的 AI 页面上下文类型');
    expect(() => normalizeAgentPageContext({ type: 'document' })).toThrow(
      '缺少 AI 页面上下文 ID',
    );
  });

  it('标题和摘要做长度保护', () => {
    const context = normalizeAgentPageContext({
      type: 'document',
      id: 'document:1',
      title: 'x'.repeat(300),
      summary: 'y'.repeat(3000),
    });
    expect(context?.title).toHaveLength(200);
    expect(context?.summary).toHaveLength(2000);
  });
});
