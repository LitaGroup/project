import { unescapeMarkdown, unescapeMarkdownUrlColons } from './markdown-escape';

describe('unescapeMarkdownUrlColons', () => {
  it('还原 AI 生成 Markdown 时写的 URL 冒号转义', () => {
    expect(
      unescapeMarkdownUrlColons(
        'http\\://project.cinta.team/api/projects/131.md 后端部分开发',
      ),
    ).toBe('http://project.cinta.team/api/projects/131.md 后端部分开发');
  });

  it('只处理 URL 协议形态的冒号转义', () => {
    expect(unescapeMarkdownUrlColons('a\\:b http\\://a.b/\\*x\\*')).toBe(
      'a\\:b http://a.b/\\*x\\*',
    );
  });

  it('没有转义时原样返回', () => {
    expect(unescapeMarkdownUrlColons('http://a.b')).toBe('http://a.b');
  });
});

describe('unescapeMarkdown', () => {
  it('还原全部 ASCII 标点转义', () => {
    expect(unescapeMarkdown('http\\://a.b/\\*x\\*')).toBe('http://a.b/*x*');
  });

  it('不处理非标点字符前的反斜杠', () => {
    expect(unescapeMarkdown('C:\\Windows')).toBe('C:\\Windows');
  });
});
