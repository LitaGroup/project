import {
  UNSCHEDULED_CYCLE,
  groupProjectsByIteration,
  isIterationCurrent,
  parseIterationCycle,
} from './projects.service';
import type { Project } from './project.entity';

/** 列表轻列最小构造，只填分组用到的字段 */
function project(
  id: number,
  iterationCycle: string | null,
  status: Project['status'] = '开发中',
): Project {
  return { id, iterationCycle, status } as Project;
}

describe('parseIterationCycle（迭代周期解析）', () => {
  it('解析归一化格式 w{n}: MM/DD-MM/DD', () => {
    expect(parseIterationCycle('w281: 08/19-08/25')).toEqual({
      week: 281,
      start: [8, 19],
      end: [8, 25],
    });
  });

  it("'-' / 空 / 无日期区间的值无法解析", () => {
    expect(parseIterationCycle(UNSCHEDULED_CYCLE)).toBeNull();
    expect(parseIterationCycle('')).toBeNull();
    expect(parseIterationCycle(null)).toBeNull();
    expect(parseIterationCycle(undefined)).toBeNull();
    expect(parseIterationCycle('w155')).toBeNull();
    expect(parseIterationCycle('需求池')).toBeNull();
  });
});

describe('isIterationCurrent（北京时间今天是否在周期内）', () => {
  it('普通区间按起止闭区间判定', () => {
    const range: [number, number][] = [
      [8, 19],
      [8, 25],
    ];
    expect(
      isIterationCurrent(
        range[0],
        range[1],
        new Date('2026-08-20T12:00:00+08:00'),
      ),
    ).toBe(true);
    expect(
      isIterationCurrent(
        range[0],
        range[1],
        new Date('2026-08-19T00:30:00+08:00'),
      ),
    ).toBe(true);
    expect(
      isIterationCurrent(
        range[0],
        range[1],
        new Date('2026-08-25T23:30:00+08:00'),
      ),
    ).toBe(true);
    expect(
      isIterationCurrent(
        range[0],
        range[1],
        new Date('2026-08-26T00:30:00+08:00'),
      ),
    ).toBe(false);
    expect(
      isIterationCurrent(
        range[0],
        range[1],
        new Date('2026-08-18T23:30:00+08:00'),
      ),
    ).toBe(false);
  });

  it('跨年区间（12/28-01/03）两端之外才为否', () => {
    const start: [number, number] = [12, 28];
    const end: [number, number] = [1, 3];
    expect(
      isIterationCurrent(start, end, new Date('2026-12-30T12:00:00+08:00')),
    ).toBe(true);
    expect(
      isIterationCurrent(start, end, new Date('2026-01-02T12:00:00+08:00')),
    ).toBe(true);
    expect(
      isIterationCurrent(start, end, new Date('2026-06-01T12:00:00+08:00')),
    ).toBe(false);
  });
});

describe('groupProjectsByIteration（需求按迭代分组）', () => {
  it('可解析周期按周编号倒序，未排期最后且合并 -/空/NULL', () => {
    const groups = groupProjectsByIteration(
      [
        project(1, 'w281: 08/19-08/25', '开发中'),
        project(2, 'w282: 08/26-09/01', '已发布'),
        project(3, UNSCHEDULED_CYCLE, '待分配'),
        project(4, null, '待分配'),
        project(5, '', '暂停中'),
        project(6, 'Archive', '待分配'),
      ],
      new Date('2026-08-27T12:00:00+08:00'),
    );
    expect(groups.map((g) => g.cycle)).toEqual([
      'w282: 08/26-09/01',
      'w281: 08/19-08/25',
      'Archive',
      UNSCHEDULED_CYCLE,
    ]);
    expect(groups[0].current).toBe(true);
    expect(groups[1].current).toBe(false);
    expect(groups[3].total).toBe(3);
    expect(groups[3].statusCounts).toEqual({ 待分配: 2, 暂停中: 1 });
    expect(groups[0].items.map((p) => p.id)).toEqual([2]);
  });

  it('组内保持传入顺序（列表已按创建时间倒序）', () => {
    const groups = groupProjectsByIteration([
      project(10, 'w281: 08/19-08/25'),
      project(11, 'w281: 08/19-08/25'),
    ]);
    expect(groups[0].items.map((p) => p.id)).toEqual([10, 11]);
  });
});
