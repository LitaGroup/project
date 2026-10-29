import {
  MAX_TOOL_TEXT,
  parseOpencodeToolEvent,
  stringifyToolValue,
} from './opencode-tools';

describe('parseOpencodeToolEvent', () => {
  it('解析工具开始时的名称、调用 ID 与参数', () => {
    expect(
      parseOpencodeToolEvent('session.tool.input.started', {
        name: 'shell',
        toolCallID: 'call-1',
        input: { command: 'ls -la' },
      }),
    ).toEqual({
      phase: 'started',
      name: 'shell',
      toolCallId: 'call-1',
      argsText: JSON.stringify({ command: 'ls -la' }, null, 2),
    });
  });

  it('兼容 tool.callID 与 state.input 形态', () => {
    const event = parseOpencodeToolEvent('session.tool.input.updated', {
      tool: { name: 'read', callID: 'call-2' },
      state: { input: { path: 'a.ts' } },
    });
    expect(event).toMatchObject({
      phase: 'updated',
      name: 'read',
      toolCallId: 'call-2',
    });
    expect(event?.argsText).toContain('a.ts');
  });

  it('解析 opencode 2.2 called 事件的完整参数', () => {
    const event = parseOpencodeToolEvent('session.tool.called', {
      id: 'call-3',
      input: { command: 'ls' },
    });
    expect(event).toMatchObject({ phase: 'updated', toolCallId: 'call-3' });
    expect(event?.argsText).toContain('ls');
  });

  it('成功/失败事件解析 content 与 error.message', () => {
    expect(
      parseOpencodeToolEvent('session.tool.success', {
        id: 'call-1',
        content: [{ type: 'text', text: 'done' }],
      }),
    ).toMatchObject({ phase: 'finished', ok: true, resultText: 'done' });
    expect(
      parseOpencodeToolEvent('session.tool.failed', {
        id: 'call-1',
        error: { message: 'boom' },
        content: 'partial',
      }),
    ).toMatchObject({ phase: 'finished', ok: false, resultText: 'boom' });
  });

  it('非工具事件、空数据与无法定位调用时返回 null', () => {
    expect(
      parseOpencodeToolEvent('session.text.delta', { delta: 'x' }),
    ).toBeNull();
    expect(parseOpencodeToolEvent('session.tool.success', null)).toBeNull();
    expect(parseOpencodeToolEvent('session.tool.success', {})).toBeNull();
  });
});

describe('stringifyToolValue', () => {
  it('保留字符串并美化对象，空值返回 undefined', () => {
    expect(stringifyToolValue('hello')).toBe('hello');
    expect(stringifyToolValue({ a: 1 })).toBe('{\n  "a": 1\n}');
    expect(stringifyToolValue(undefined)).toBeUndefined();
    expect(stringifyToolValue('   ')).toBeUndefined();
  });

  it('超长内容截断并标记', () => {
    const text = stringifyToolValue('x'.repeat(MAX_TOOL_TEXT + 20));
    expect(text).toContain('已截断');
    expect(text!.length).toBeLessThan(MAX_TOOL_TEXT + 30);
  });
});
