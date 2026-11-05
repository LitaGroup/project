import {
  normalizeQuestionOption,
  normalizeQuestionOptions,
} from './question-option';

describe('normalizeQuestionOption', () => {
  it('字符串选项转为 label，空白返回 null', () => {
    expect(normalizeQuestionOption('按日趋势')).toEqual({ label: '按日趋势' });
    expect(normalizeQuestionOption('  区间汇总  ')).toEqual({
      label: '区间汇总',
    });
    expect(normalizeQuestionOption('   ')).toBeNull();
  });

  it('对象选项取 label，缺失时回退 value/text', () => {
    expect(normalizeQuestionOption({ label: '方案 A' })).toEqual({
      label: '方案 A',
    });
    expect(normalizeQuestionOption({ value: '生产' })).toEqual({
      label: '生产',
    });
    expect(normalizeQuestionOption({ text: '自定义' })).toEqual({
      label: '自定义',
    });
    expect(
      normalizeQuestionOption({ label: '方案 A', description: '改动最小' }),
    ).toEqual({ label: '方案 A', description: '改动最小' });
    expect(
      normalizeQuestionOption({ label: '方案 A', description: '   ' }),
    ).toEqual({ label: '方案 A' });
    expect(normalizeQuestionOption({ foo: 'bar' })).toBeNull();
  });

  it('历史脏数据（字符串被展开成数字键对象）按序拼回原文', () => {
    expect(
      normalizeQuestionOption({ 0: '按', 1: '日', 2: '趋', 3: '势' }),
    ).toEqual({ label: '按日趋势' });
    expect(normalizeQuestionOption({ 0: '按', foo: 'x' })).toBeNull();
    expect(normalizeQuestionOption({})).toBeNull();
  });

  it('非字符串非对象返回 null', () => {
    expect(normalizeQuestionOption(null)).toBeNull();
    expect(normalizeQuestionOption(123)).toBeNull();
    expect(normalizeQuestionOption(['A'])).toBeNull();
  });
});

describe('normalizeQuestionOptions', () => {
  it('混合形态统一为 {label, description?} 并过滤无效项', () => {
    expect(
      normalizeQuestionOptions([
        '按日趋势',
        { value: '区间汇总', description: '整体统计' },
        '',
        null,
        { foo: 1 },
      ]),
    ).toEqual([
      { label: '按日趋势' },
      { label: '区间汇总', description: '整体统计' },
    ]);
  });

  it('输入不是数组或全部无效时返回 undefined', () => {
    expect(normalizeQuestionOptions(undefined)).toBeUndefined();
    expect(normalizeQuestionOptions('A')).toBeUndefined();
    expect(normalizeQuestionOptions([])).toBeUndefined();
    expect(normalizeQuestionOptions(['', '  '])).toBeUndefined();
  });
});
