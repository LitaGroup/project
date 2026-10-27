import {
  extractOpencodeTodos,
  extractOpencodeTodosFromMessage,
  isTodoToolEvent,
} from './opencode-todos';

describe('isTodoToolEvent', () => {
  it('识别 todowrite 工具的输入/结果事件', () => {
    expect(
      isTodoToolEvent('session.tool.input.started', { name: 'todowrite' }),
    ).toBe(true);
    expect(
      isTodoToolEvent('session.tool.success', { name: 'todo_write' }),
    ).toBe(true);
  });

  it('忽略其他工具与其他事件', () => {
    expect(
      isTodoToolEvent('session.tool.input.started', { name: 'bash' }),
    ).toBe(false);
    expect(isTodoToolEvent('session.text.delta', { name: 'todowrite' })).toBe(
      false,
    );
    expect(isTodoToolEvent('session.tool.input.started', {})).toBe(false);
  });
});

describe('extractOpencodeTodos', () => {
  it('从 data.input.todos 提取并规范化（缺省状态为 pending）', () => {
    const todos = extractOpencodeTodos({
      input: {
        todos: [
          { content: '实现页面', status: 'completed' },
          { content: '联调接口', status: 'in_progress', priority: 'high' },
          { content: '回归测试' },
        ],
      },
    });
    expect(todos).toEqual([
      { content: '实现页面', status: 'completed' },
      { content: '联调接口', status: 'in_progress', priority: 'high' },
      { content: '回归测试', status: 'pending' },
    ]);
  });

  it('兼容 data.args 与 data.state.input 形态', () => {
    expect(
      extractOpencodeTodos({ args: { todos: [{ content: 'a' }] } }),
    ).toEqual([{ content: 'a', status: 'pending' }]);
    expect(
      extractOpencodeTodos({ state: { input: { todos: [{ content: 'b' }] } } }),
    ).toEqual([{ content: 'b', status: 'pending' }]);
  });

  it('空数组视为合法（清空待办），未知状态归一为 pending', () => {
    expect(extractOpencodeTodos({ input: { todos: [] } })).toEqual([]);
    expect(
      extractOpencodeTodos({
        input: { todos: [{ content: 'a', status: 'unknown' }] },
      }),
    ).toEqual([{ content: 'a', status: 'pending' }]);
  });

  it('任一条目非法整体返回 null，避免半截流式输入渲染成假待办', () => {
    expect(
      extractOpencodeTodos({
        input: { todos: [{ content: 'a' }, { status: 'pending' }] },
      }),
    ).toBeNull();
    expect(
      extractOpencodeTodos({ input: { todos: [{ content: '  ' }] } }),
    ).toBeNull();
    expect(extractOpencodeTodos({ name: 'todowrite' })).toBeNull();
    expect(extractOpencodeTodos(null)).toBeNull();
  });
});

describe('extractOpencodeTodosFromMessage', () => {
  const todoInput = { todos: [{ content: '实现页面', status: 'completed' }] };

  it('解析 2.1.4 消息详情 content[].tool + state.input', () => {
    const message = {
      content: [
        { type: 'text', text: '好的' },
        {
          type: 'tool',
          tool: 'todowrite',
          state: { status: 'completed', input: todoInput },
        },
      ],
    };
    expect(extractOpencodeTodosFromMessage(message)).toEqual([
      { content: '实现页面', status: 'completed' },
    ]);
  });

  it('兼容 parts[].name + input 直挂形态', () => {
    const message = {
      parts: [{ type: 'tool', name: 'todowrite', input: todoInput }],
    };
    expect(extractOpencodeTodosFromMessage(message)).toEqual([
      { content: '实现页面', status: 'completed' },
    ]);
  });

  it('忽略无 todowrite 的消息与空消息', () => {
    expect(
      extractOpencodeTodosFromMessage({
        content: [{ type: 'tool', tool: 'bash', state: { input: todoInput } }],
      }),
    ).toBeNull();
    expect(extractOpencodeTodosFromMessage({})).toBeNull();
    expect(extractOpencodeTodosFromMessage(null)).toBeNull();
  });
});
