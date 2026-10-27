import { OpencodeClient, isFreshOutcome } from './opencode-client';

describe('OpencodeClient.lastAssistantText', () => {
  it('按时间倒序的列表取最新 assistant 文本', async () => {
    const client = new OpencodeClient({ ip: '127.0.0.1', port: 4096 });
    const details = new Map<string, unknown>([
      [
        'old',
        {
          content: [{ type: 'text', text: '我将先检查当前的工作环境。' }],
        },
      ],
      [
        'new',
        {
          content: [{ type: 'text', text: 'DONE' }],
        },
      ],
    ]);
    jest
      .spyOn(client as unknown as { request: unknown }, 'request')
      .mockImplementation((path: string) => {
        if (path === '/api/session/ses/message') {
          return [
            { id: 'new', type: 'assistant', time: { created: 20 } },
            { id: 'old', type: 'assistant', time: { created: 10 } },
          ];
        }
        if (path.startsWith('/api/session/ses/message/')) {
          const id = path.split('/').pop();
          return details.get(id!);
        }
        throw new Error(`unexpected path: ${path}`);
      });
    await expect(client.lastAssistantText('ses')).resolves.toBe('DONE');
  });

  it('按时间正序的列表也取最新 assistant 文本', async () => {
    const client = new OpencodeClient({ ip: '127.0.0.1', port: 4096 });
    const details = new Map<string, unknown>([
      ['first', { content: [{ type: 'text', text: '开始' }] }],
      ['second', { content: [{ type: 'text', text: 'DONE' }] }],
    ]);
    jest
      .spyOn(client as unknown as { request: unknown }, 'request')
      .mockImplementation((path: string) => {
        if (path === '/api/session/ses/message') {
          return {
            data: [
              { id: 'first', type: 'assistant', time: { created: 1 } },
              { id: 'second', type: 'assistant', time: { created: 2 } },
            ],
          };
        }
        if (path.startsWith('/api/session/ses/message/')) {
          const id = path.split('/').pop();
          return { data: details.get(id!) };
        }
        throw new Error(`unexpected path: ${path}`);
      });
    await expect(client.lastAssistantText('ses')).resolves.toBe('DONE');
  });

  it('afterCreatedMs 过滤掉本轮基准之前的旧 assistant 消息', async () => {
    const client = new OpencodeClient({ ip: '127.0.0.1', port: 4096 });
    const details = new Map<string, unknown>([
      [
        'old',
        {
          content: [{ type: 'text', text: '上一轮的回复' }],
        },
      ],
      ['fresh', { content: [{ type: 'text', text: '本轮回复' }] }],
    ]);
    jest
      .spyOn(client as unknown as { request: unknown }, 'request')
      .mockImplementation((path: string) => {
        if (path === '/api/session/ses/message') {
          return {
            data: [
              { id: 'fresh', type: 'assistant', time: { created: 30 } },
              { id: 'old', type: 'assistant', time: { created: 10 } },
            ],
          };
        }
        if (path.startsWith('/api/session/ses/message/')) {
          const id = path.split('/').pop();
          return details.get(id!);
        }
        throw new Error(`unexpected path: ${path}`);
      });
    await expect(client.lastAssistantText('ses', 20)).resolves.toBe('本轮回复');
  });

  it('afterCreatedMs 过滤后无新消息时返回 null（等待消息落库后重试）', async () => {
    const client = new OpencodeClient({ ip: '127.0.0.1', port: 4096 });
    jest
      .spyOn(client as unknown as { request: unknown }, 'request')
      .mockImplementation((path: string) => {
        if (path === '/api/session/ses/message') {
          return {
            data: [{ id: 'old', type: 'assistant', time: { created: 10 } }],
          };
        }
        if (path === '/api/session/ses/message/old') {
          return { content: [{ type: 'text', text: '上一轮的回复' }] };
        }
        throw new Error(`unexpected path: ${path}`);
      });
    await expect(client.lastAssistantText('ses', 20)).resolves.toBeNull();
  });
});

describe('lastUserMessageCreatedAt', () => {
  it('返回最新一条用户消息的创建时间', async () => {
    const client = new OpencodeClient({ ip: '127.0.0.1', port: 4096 });
    jest
      .spyOn(client as unknown as { request: unknown }, 'request')
      .mockImplementation((path: string) => {
        if (path === '/api/session/ses/message') {
          return {
            data: [
              { id: 'a', type: 'assistant', time: { created: 15 } },
              { id: 'b', type: 'user', time: { created: 20 } },
              { id: 'c', type: 'user', time: { created: 10 } },
            ],
          };
        }
        throw new Error(`unexpected path: ${path}`);
      });
    await expect(client.lastUserMessageCreatedAt('ses')).resolves.toBe(20);
  });

  it('没有用户消息时返回 0', async () => {
    const client = new OpencodeClient({ ip: '127.0.0.1', port: 4096 });
    jest
      .spyOn(client as unknown as { request: unknown }, 'request')
      .mockImplementation((path: string) => {
        if (path === '/api/session/ses/message') {
          return {
            data: [{ id: 'a', type: 'assistant', time: { created: 1 } }],
          };
        }
        throw new Error(`unexpected path: ${path}`);
      });
    await expect(client.lastUserMessageCreatedAt('ses')).resolves.toBe(0);
  });
});

describe('isFreshOutcome', () => {
  const stale = { outcome: 'succeeded', time: { idle: 100 } };

  it('time.idle 晚于基准时终态可信', () => {
    expect(isFreshOutcome(stale, 100)).toBe(true);
    expect(isFreshOutcome(stale, 50)).toBe(true);
    expect(isFreshOutcome({ ...stale, outcome: 'failed' }, 100)).toBe(true);
  });

  it('time.idle 早于基准时为上一轮残留，不可信', () => {
    expect(isFreshOutcome(stale, 101)).toBe(false);
    expect(isFreshOutcome({ ...stale, outcome: 'failed' }, 200)).toBe(false);
  });

  it('非终态一律不可信', () => {
    expect(isFreshOutcome({ outcome: null, time: { idle: 500 } }, 100)).toBe(
      false,
    );
    expect(isFreshOutcome({}, 100)).toBe(false);
  });

  it('缺 time.idle（旧版本）或基准未知时退回旧行为直接采信', () => {
    expect(isFreshOutcome({ outcome: 'succeeded' }, 100)).toBe(true);
    expect(isFreshOutcome(stale, 0)).toBe(true);
  });
});

describe('OpencodeClient.latestTodos', () => {
  it('从新到旧扫描消息详情，返回最近一次 todowrite 的 todos', async () => {
    const client = new OpencodeClient({ ip: '127.0.0.1', port: 4096 });
    const todos = [{ content: '实现页面', status: 'completed' }];
    const details = new Map<string, unknown>([
      ['new', { content: [{ type: 'text', text: '完成' }] }],
      [
        'old',
        {
          content: [
            {
              type: 'tool',
              tool: 'todowrite',
              state: { status: 'completed', input: { todos } },
            },
          ],
        },
      ],
    ]);
    jest
      .spyOn(client as unknown as { request: unknown }, 'request')
      .mockImplementation((path: string) => {
        if (path === '/api/session/ses/message') {
          return {
            data: [
              { id: 'new', type: 'assistant', time: { created: 20 } },
              { id: 'old', type: 'assistant', time: { created: 10 } },
            ],
          };
        }
        if (path.startsWith('/api/session/ses/message/')) {
          const id = path.split('/').pop();
          return details.get(id!);
        }
        throw new Error(`unexpected path: ${path}`);
      });
    await expect(client.latestTodos('ses')).resolves.toEqual([
      { content: '实现页面', status: 'completed' },
    ]);
  });

  it('没有 todowrite 工具调用时返回 null', async () => {
    const client = new OpencodeClient({ ip: '127.0.0.1', port: 4096 });
    jest
      .spyOn(client as unknown as { request: unknown }, 'request')
      .mockImplementation((path: string) => {
        if (path === '/api/session/ses/message') {
          return [{ id: 'only', type: 'assistant', time: { created: 1 } }];
        }
        if (path === '/api/session/ses/message/only') {
          return { content: [{ type: 'text', text: '没有待办' }] };
        }
        throw new Error(`unexpected path: ${path}`);
      });
    await expect(client.latestTodos('ses')).resolves.toBeNull();
  });
});
