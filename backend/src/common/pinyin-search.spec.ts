import { matchesPinyinSearch } from './pinyin-search';

describe('matchesPinyinSearch', () => {
  it('空关键词命中全部字段', () => {
    expect(matchesPinyinSearch('  ', ['活动开发机器人'])).toBe(true);
  });

  it('支持中文原文与忽略大小写的英文', () => {
    expect(matchesPinyinSearch('开发', ['活动开发机器人'])).toBe(true);
    expect(matchesPinyinSearch('agent', ['Data Agent'])).toBe(true);
    expect(matchesPinyinSearch('DATA', ['Data Agent'])).toBe(true);
  });

  it('支持全拼与拼音首字母', () => {
    expect(matchesPinyinSearch('huodongkaifa', ['活动开发机器人'])).toBe(true);
    expect(matchesPinyinSearch('hdkfjqr', ['活动开发机器人'])).toBe(true);
    expect(matchesPinyinSearch('hd kf jqr', ['活动开发机器人'])).toBe(true);
  });

  it('支持 nv 代替 nü，并能匹配数字与标点组合', () => {
    expect(matchesPinyinSearch('nvwushen', ['女武神'])).toBe(true);
    expect(matchesPinyinSearch('jqr1001', ['机器人 #1001'])).toBe(true);
  });

  it('无字段命中时返回 false，空字段安全跳过', () => {
    expect(matchesPinyinSearch('不存在', [null, undefined, '机器人'])).toBe(
      false,
    );
  });
});
