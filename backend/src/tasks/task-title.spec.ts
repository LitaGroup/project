import { deriveTaskTitle } from './task-title';

describe('deriveTaskTitle', () => {
  it('推导标题时还原 URL 的冒号转义（不出现 http\\://）', () => {
    expect(
      deriveTaskTitle(
        'http\\://project.cinta.team/api/projects/131.md 后端部分开发',
      ),
    ).toBe('http://project.cinta.team/api/projects/131.md 后端部分开发');
  });

  it('第一个有效行作为标题，跳过空行与分割线', () => {
    expect(deriveTaskTitle('\n\n---\n## 修复登录问题\n详情…')).toBe(
      '修复登录问题',
    );
  });

  it('去掉链接语法保留文字', () => {
    expect(deriveTaskTitle('[需求文档](http\\://a.b/doc.md) 实现')).toBe(
      '需求文档 实现',
    );
  });

  it('全部为空时返回空串', () => {
    expect(deriveTaskTitle('\n\n---\n')).toBe('');
  });
});
