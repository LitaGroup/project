import { toIterationCycle } from './project-sync.service';

describe('toIterationCycle（飞书 w 字段 → 迭代周期归一化）', () => {
  it('已是目标结构的保持不变', () => {
    expect(toIterationCycle('w241: 10/22-10/28')).toBe('w241: 10/22-10/28');
  });

  it('全角冒号 / 大写 W / 缺空格 / 横杠两侧空格等变体归一化', () => {
    expect(toIterationCycle('w281：08/19 - 08/25')).toBe('w281: 08/19-08/25');
    expect(toIterationCycle('W158:01/16-01/22')).toBe('w158: 01/16-01/22');
    expect(toIterationCycle('w129:06/27-07/03')).toBe('w129: 06/27-07/03');
    expect(toIterationCycle('w82: 07/12 - 07/18  ')).toBe('w82: 07/12-07/18');
  });

  it('单位数月/日补零', () => {
    expect(toIterationCycle('w247:12/3-12/9')).toBe('w247: 12/03-12/09');
  });

  it('日期区间后的后缀直接过滤', () => {
    expect(toIterationCycle('w155:01/03-01/08 (少一天)')).toBe(
      'w155: 01/03-01/08',
    );
    expect(toIterationCycle('w142: 09/26-09/28 & 10/06-10/09')).toBe(
      'w142: 09/26-09/28',
    );
    expect(toIterationCycle('w94: 09/27-10/08 (10/10提测 | 10/13发版)')).toBe(
      'w94: 09/27-10/08',
    );
  });

  it('需求池/待排期/Archive/纯 w 编号/空值一律归 -', () => {
    expect(toIterationCycle('📌 需求池')).toBe('-');
    expect(toIterationCycle('待排期')).toBe('-');
    expect(toIterationCycle('Archive')).toBe('-');
    expect(toIterationCycle('w72')).toBe('-');
    expect(toIterationCycle('')).toBe('-');
    expect(toIterationCycle(null)).toBe('-');
    expect(toIterationCycle(undefined)).toBe('-');
  });
});
