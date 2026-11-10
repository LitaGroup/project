import { ModelThinkingLevel } from '../common/enums';
import {
  extractContent,
  LlmService,
  sanitizeTitle,
  thinkingExtras,
} from './llm.service';

/** fetch 调用参数（服务端固定 JSON 字符串 body） */
type FetchCall = [string, { body: string; headers?: Record<string, string> }];

/** 构造 Response 替身（非 async，避免 lint 的 require-await） */
function responseOf(payload: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: () => Promise.resolve(payload),
    text: () => Promise.resolve(typeof payload === 'string' ? payload : ''),
  };
}

describe('LlmService', () => {
  let resolve: jest.Mock;
  let service: LlmService;
  let fetchMock: jest.Mock;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    resolve = jest.fn();
    service = new LlmService({ resolve } as never);
    fetchMock = jest.fn();
    originalFetch = global.fetch;
    global.fetch = fetchMock;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const callBody = (index: number): Record<string, unknown> => {
    const calls = fetchMock.mock.calls as FetchCall[];
    return JSON.parse(calls[index][1].body) as Record<string, unknown>;
  };

  it('思考等级映射：off 关闭思考，其余映射推理强度', () => {
    expect(thinkingExtras(ModelThinkingLevel.OFF)).toEqual({
      thinking: { type: 'disabled' },
      reasoning_effort: 'minimal',
    });
    expect(thinkingExtras(ModelThinkingLevel.LOW)).toEqual({
      reasoning_effort: 'low',
    });
    expect(thinkingExtras(ModelThinkingLevel.MEDIUM)).toEqual({
      reasoning_effort: 'medium',
    });
    expect(thinkingExtras(ModelThinkingLevel.HIGH)).toEqual({
      reasoning_effort: 'high',
    });
  });

  it('清洗标题：取首行、去包裹引号与回显的 T-{id} 前缀', () => {
    expect(sanitizeTitle('「修复登录页崩溃」')).toBe('修复登录页崩溃');
    expect(sanitizeTitle('## 修复登录页崩溃\n\n说明')).toBe('修复登录页崩溃');
    expect(sanitizeTitle('「T-42」修复登录页崩溃')).toBe('修复登录页崩溃');
    expect(sanitizeTitle('T-42 修复登录页崩溃')).toBe('修复登录页崩溃');
    expect(sanitizeTitle('   ')).toBeNull();
    expect(sanitizeTitle('')).toBeNull();
  });

  it('解析响应文本：兼容字符串与分段数组', () => {
    expect(
      extractContent({ choices: [{ message: { content: ' 你好 ' } }] }),
    ).toBe('你好');
    expect(
      extractContent({
        choices: [
          { message: { content: [{ type: 'text', text: '你' }, '好'] } },
        ],
      }),
    ).toBe('你好');
    expect(extractContent({})).toBe('');
  });

  it('场景未配置时直接返回 null，不发请求', async () => {
    resolve.mockResolvedValue(null);
    await expect(
      service.ask('title-naming', { prompt: 'hi' }),
    ).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('按场景配置请求 Chat Completions，并带思考参数', async () => {
    resolve.mockResolvedValue({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-1',
      model: 'glm-4.6',
      thinking: ModelThinkingLevel.OFF,
    });
    fetchMock.mockResolvedValue(
      responseOf({ choices: [{ message: { content: '标题' } }] }),
    );

    const content = await service.ask('title-naming', {
      system: '系统',
      prompt: '生成标题',
      maxTokens: 64,
    });

    expect(content).toBe('标题');
    const calls = fetchMock.mock.calls as FetchCall[];
    expect(calls[0][0]).toBe('https://api.example.com/v1/chat/completions');
    expect(calls[0][1].headers?.Authorization).toBe('Bearer sk-1');
    expect(callBody(0)).toMatchObject({
      model: 'glm-4.6',
      max_tokens: 64,
      stream: false,
      thinking: { type: 'disabled' },
      reasoning_effort: 'minimal',
    });
    expect(callBody(0).messages).toEqual([
      { role: 'system', content: '系统' },
      { role: 'user', content: '生成标题' },
    ]);
  });

  it('400 时去掉思考参数重试一次', async () => {
    resolve.mockResolvedValue({
      baseUrl: 'https://api.example.com/v1',
      apiKey: null,
      model: 'gpt-5-mini',
      thinking: ModelThinkingLevel.OFF,
    });
    fetchMock
      .mockResolvedValueOnce(
        responseOf('Unrecognized request argument: thinking', false, 400),
      )
      .mockResolvedValueOnce(
        responseOf({ choices: [{ message: { content: 'ok' } }] }),
      );

    await expect(service.ask('title-naming', { prompt: 'hi' })).resolves.toBe(
      'ok',
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retryBody = callBody(1);
    expect(retryBody).not.toHaveProperty('thinking');
    expect(retryBody).not.toHaveProperty('reasoning_effort');
  });

  it('请求失败抛出可读错误', async () => {
    resolve.mockResolvedValue({
      baseUrl: 'https://api.example.com/v1',
      apiKey: null,
      model: 'glm-4.6',
      thinking: ModelThinkingLevel.LOW,
    });
    fetchMock.mockResolvedValue(responseOf('rate limited', false, 429));
    await expect(service.ask('title-naming', { prompt: 'hi' })).rejects.toThrow(
      'HTTP 429',
    );
  });

  it('generateTitle 使用 title-naming 场景并清洗输出', async () => {
    resolve.mockResolvedValue({
      baseUrl: 'https://api.example.com/v1',
      apiKey: null,
      model: 'glm-4.6',
      thinking: ModelThinkingLevel.LOW,
    });
    fetchMock.mockResolvedValue(
      responseOf({
        choices: [{ message: { content: '「T-7」优化登录流程' } }],
      }),
    );

    await expect(service.generateTitle('工单：登录问题')).resolves.toBe(
      '优化登录流程',
    );
    const calls = fetchMock.mock.calls as FetchCall[];
    expect(calls[0][0]).toBe('https://api.example.com/v1/chat/completions');
    expect(calls[0][1].body).toContain('工单：登录问题');
  });

  it('generateTitle 空素材直接返回 null', async () => {
    await expect(service.generateTitle('   ')).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
