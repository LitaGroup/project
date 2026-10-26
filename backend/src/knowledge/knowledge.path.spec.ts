import {
  encodeKnowledgePath,
  isKnowledgePathWithin,
  joinKnowledgePath,
  normalizeKnowledgePath,
  projectDocumentPath,
} from './knowledge.path';

describe('knowledge path', () => {
  it('规范化首尾斜杠和层级', () => {
    expect(normalizeKnowledgePath('/a/b/c/')).toEqual({
      path: '/a/b/c',
      segments: ['a', 'b', 'c'],
      parentPath: '/a/b',
      name: 'c',
    });
    expect(normalizeKnowledgePath('a/b').path).toBe('/a/b');
    expect(normalizeKnowledgePath('/')).toMatchObject({
      path: '/',
      segments: [],
      parentPath: '/',
    });
  });

  it('拒绝越级、连续斜杠、反斜杠和编码斜杠', () => {
    expect(() => normalizeKnowledgePath('/a/../b')).toThrow('..');
    expect(() => normalizeKnowledgePath('/a//b')).toThrow('连续斜杠');
    expect(() => normalizeKnowledgePath('/a\\b')).toThrow('反斜杠');
    expect(() => normalizeKnowledgePath('/a%2Fb')).toThrow('编码后的斜杠');
    expect(() => normalizeKnowledgePath('/ a')).toThrow('首尾不能有空白');
  });

  it('拼接、包含判断与项目文档固定路径', () => {
    expect(joinKnowledgePath('/', 'guides')).toBe('/guides');
    expect(joinKnowledgePath('/guides', 'deploy')).toBe('/guides/deploy');
    expect(isKnowledgePathWithin('/guides/deploy', '/guides')).toBe(true);
    expect(isKnowledgePathWithin('/guides2', '/guides')).toBe(false);
    expect(isKnowledgePathWithin('/anything', '/')).toBe(true);
    expect(projectDocumentPath(123, 456)).toBe('/project/123/document/456');
  });

  it('逐段 URL 编码，保留目录层级', () => {
    expect(encodeKnowledgePath('/中文/部署 v2')).toBe(
      '%E4%B8%AD%E6%96%87/%E9%83%A8%E7%BD%B2%20v2',
    );
    expect(encodeKnowledgePath('/')).toBe('/');
  });
});
