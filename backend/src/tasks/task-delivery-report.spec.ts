import {
  hasHandoffBody,
  parseWorkbenchHandoff,
  splitHandoffSummary,
} from './task-delivery-report';

const MARKDOWN = `## 交付内容

活动页已上线，代码 LitaGroup/activity 分支 test。

## 实现问题与解决

接口字段缺失，补齐后验证通过。

## 经验总结

先确认接口字段再联调。
`;

describe('hasHandoffBody', () => {
  it('只有空模板标题时没有正文', () => {
    expect(hasHandoffBody('## 交付内容\n\n## 经验总结\n')).toBe(false);
  });

  it('标题下有正文时视为有效', () => {
    expect(hasHandoffBody(MARKDOWN)).toBe(true);
  });

  it('无标题的自由文本视为有效', () => {
    expect(hasHandoffBody('已完成活动页开发与自测')).toBe(true);
  });
});

describe('parseWorkbenchHandoff', () => {
  it('单输入框 Markdown 按固定小节拆分，缺失小节明确占位', () => {
    const report = parseWorkbenchHandoff({ content: MARKDOWN });
    expect(report?.delivery).toContain('活动页已上线');
    expect(report?.problems).toContain('接口字段缺失');
    expect(report?.lessons).toContain('先确认接口字段');
    expect(report?.detours).toContain('未填写');
    expect(report?.followUps).toContain('未填写');
    expect(report?.other).toContain('未填写');
  });

  it('自由文本整段作为交付内容，不编造其它小节', () => {
    const report = parseWorkbenchHandoff({ content: '已完成活动页开发与自测' });
    expect(report?.delivery).toBe('已完成活动页开发与自测');
    expect(report?.problems).toContain('未填写');
  });

  it('空模板返回 null，由调用方拒绝提交', () => {
    expect(parseWorkbenchHandoff({ content: '## 交付内容\n\n' })).toBeNull();
    expect(parseWorkbenchHandoff({ content: '   ' })).toBeNull();
  });

  it('没有 content 时兼容旧的六字段', () => {
    const report = parseWorkbenchHandoff({
      delivery: '活动页已上线',
      lessons: '先确认接口字段',
    });
    expect(report?.delivery).toBe('活动页已上线');
    expect(report?.lessons).toBe('先确认接口字段');
  });
});

describe('splitHandoffSummary', () => {
  it('去掉整体代码围栏后仍能解析', () => {
    const report = splitHandoffSummary(`\`\`\`markdown\n${MARKDOWN}\n\`\`\``);
    expect(report.delivery).toContain('活动页已上线');
    expect(report.problems).toContain('接口字段缺失');
  });
});
