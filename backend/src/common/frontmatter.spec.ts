import { beijingTime, mdFrontmatter } from './frontmatter';

describe('beijingTime', () => {
  it('按北京时间（UTC+8）格式化，精确到秒', () => {
    // UTC 2026-09-18T04:30:05Z → 北京 12:30:05
    expect(beijingTime(new Date('2026-09-18T04:30:05Z'))).toBe(
      '2026-09-18 12:30:05',
    );
  });

  it('跨日与零点正确（h23，无 24 点）', () => {
    // UTC 2026-09-18T16:00:00Z → 北京 2026-09-19 00:00:00
    expect(beijingTime(new Date('2026-09-18T16:00:00Z'))).toBe(
      '2026-09-19 00:00:00',
    );
    expect(beijingTime(new Date('2026-09-18T15:59:59Z'))).toBe(
      '2026-09-18 23:59:59',
    );
  });

  it('接受 ISO 字符串入参', () => {
    expect(beijingTime('2026-01-01T00:00:00Z')).toBe('2026-01-01 08:00:00');
  });

  it('缺省取当前时间（与当前北京时间误差 1s 内）', () => {
    const now = beijingTime();
    expect(now).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });
});

describe('mdFrontmatter', () => {
  it('输出 update 在首、空行结尾的 YAML 块', () => {
    const out = mdFrontmatter({
      update: new Date('2026-09-18T04:30:05Z'),
      title: '部署指南',
    });
    expect(out).toBe(
      '---\nupdate: "2026-09-18 12:30:05"\ntitle: "部署指南"\n---\n\n',
    );
  });

  it('update 缺省取当前北京时间', () => {
    const out = mdFrontmatter({});
    expect(out).toMatch(
      /^---\nupdate: "\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}"\n---\n\n$/,
    );
  });

  it('null/undefined/空串字段不输出', () => {
    const out = mdFrontmatter({
      update: new Date('2026-09-18T04:30:05Z'),
      title: null,
      filename: undefined,
      description: '',
    });
    expect(out).toBe('---\nupdate: "2026-09-18 12:30:05"\n---\n\n');
  });

  it('换行折叠为空格、引号与反斜杠转义', () => {
    const out = mdFrontmatter({
      update: new Date('2026-09-18T04:30:05Z'),
      title: '第一行\n第二行 "引号" \\x',
    });
    expect(out).toContain('title: "第一行 第二行 \\"引号\\" \\\\x"');
  });
});
