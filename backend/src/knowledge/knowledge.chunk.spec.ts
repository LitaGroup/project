import {
  chunkKnowledgeMarkdown,
  embeddingText,
  stripKnowledgeFrontmatter,
} from './knowledge.chunk';

describe('knowledge chunk', () => {
  it('去掉 YAML frontmatter 后按标题组织切片', () => {
    const chunks = chunkKnowledgeMarkdown(`---
title: 部署
---

# 部署

总览内容。

## 环境

先安装 Node。

### 变量

配置数据库。

## 回滚

恢复上一版本。`);
    expect(chunks.map((c) => c.headingPath)).toEqual([
      '部署',
      '部署 / 环境',
      '部署 / 环境 / 变量',
      '部署 / 回滚',
    ]);
    expect(chunks[2].content).toContain('配置数据库');
  });

  it('无标题文章也产生切片', () => {
    const chunks = chunkKnowledgeMarkdown('只有一段正文。');
    expect(chunks).toEqual([
      { index: 0, headingPath: '', content: '只有一段正文。' },
    ]);
  });

  it('超长正文按长度切分并保留重叠', () => {
    const text = Array.from({ length: 500 }, (_, i) => `第${i}行内容`).join(
      '\n',
    );
    const chunks = chunkKnowledgeMarkdown(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.content.length <= 1600)).toBe(true);
  });

  it('frontmatter 仅在索引阶段剥离', () => {
    const markdown = '---\ntitle: x\n---\n\n# 正文';
    expect(stripKnowledgeFrontmatter(markdown)).toBe('\n# 正文');
  });

  it('Embedding 输入包含标题、路径和章节', () => {
    expect(
      embeddingText({
        title: '部署',
        path: '/guides/deploy',
        headingPath: '环境',
        content: '安装 Node',
      }),
    ).toContain('路径：/guides/deploy');
  });
});
