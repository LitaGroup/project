import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { WorkerDebugSnapshot } from '../workers/worker-debug.types';
import { McpService } from './mcp.service';

/** 构造调试会话快照 */
function snap(
  partial: Partial<WorkerDebugSnapshot> & { status: 'running' | 'idle' },
): WorkerDebugSnapshot {
  return {
    worker: {
      id: 7,
      name: '测试机器人',
      intro: null,
      avatarUrl: null,
      executorName: 'local',
      providerId: 'openai',
      modelId: 'gpt-test',
      variant: null,
    },
    model: { providerId: 'openai', modelId: 'gpt-test', variant: null },
    sessionId: 'oc-1',
    status: partial.status,
    messages: partial.messages ?? [],
    todos: partial.todos ?? [],
    error: partial.error ?? null,
    updatedAt: new Date().toISOString(),
  };
}

/** 构造快照流推送器：捕获 handlers 供用例逐步推帧 */
type SnapshotHandlers = { next: (event: { data: unknown }) => void };
let streamHandlers: SnapshotHandlers | null = null;

function bindStream(debug: Record<string, jest.Mock>): void {
  debug.stream.mockImplementation(() => ({
    subscribe: (handlers: SnapshotHandlers) => {
      streamHandlers = handlers;
      return { unsubscribe: () => {} };
    },
  }));
}

function pushSnapshot(snapshot: WorkerDebugSnapshot): void {
  streamHandlers!.next({ data: { type: 'snapshot', snapshot } });
}

const user = { id: 3, name: '张三' } as never;

/** 等待 send/resolveWorker 微任务链跑完（waitForRun 订阅建立） */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** 构造被测服务（debug / chats / logs 全部 mock） */
function buildService(overrides?: {
  debug?: Record<string, unknown>;
}): {
  service: McpService;
  debug: Record<string, jest.Mock>;
  chats: Record<string, jest.Mock>;
  logs: Record<string, jest.Mock>;
} {
  const debug: Record<string, jest.Mock> = {
    send: jest.fn().mockResolvedValue(undefined),
    stream: jest.fn(),
    snapshot: jest.fn().mockResolvedValue(snap({ status: 'idle' })),
    replyQuestion: jest.fn().mockResolvedValue(undefined),
    interrupt: jest.fn().mockResolvedValue(snap({ status: 'idle' })),
    reset: jest.fn().mockResolvedValue(undefined),
    ...(overrides?.debug ?? {}),
  };
  const chats: Record<string, jest.Mock> = {
    listWorkers: jest.fn().mockResolvedValue([
      {
        id: 7,
        name: '测试机器人',
        intro: '测试',
        avatarUrl: null,
        executorName: 'local',
        providerId: 'openai',
        modelId: 'gpt-test',
        variant: null,
      },
    ]),
  };
  const logs: Record<string, jest.Mock> = {
    record: jest.fn().mockResolvedValue(undefined),
  };
  const service = new McpService(
    debug as never,
    chats as never,
    logs as never,
  );
  return { service, debug, chats, logs };
}

describe('McpService', () => {
  beforeEach(() => {
    streamHandlers = null;
  });

  it('list_bots 返回可见机器人清单（模型含思考等级）', async () => {
    const { service, chats } = buildService();
    chats.listWorkers.mockResolvedValue([
      {
        id: 7,
        name: '活动开发机器人',
        intro: '负责活动',
        avatarUrl: null,
        executorName: 'local',
        providerId: 'openai',
        modelId: 'gpt-test',
        variant: 'high',
      },
    ]);
    const result = await (service as unknown as {
      listBots: (userId: number) => Promise<{ bots: { model: string }[] }>;
    }).listBots(3);
    expect(result.bots).toHaveLength(1);
    expect(result.bots[0].model).toBe('openai/gpt-test/high');
    expect(chats.listWorkers).toHaveBeenCalledWith(3);
  });

  it('callBot 未找到机器人时抛 NotFound', async () => {
    const { service } = buildService();
    await expect(
      service.callBot(user, { bot: '不存在', message: 'x' }, null, undefined),
    ).rejects.toThrow(NotFoundException);
  });

  it('callBot 会话冲突时审计记 conflict 并抛出', async () => {
    const { service, debug, logs } = buildService({
      debug: {
        send: jest
          .fn()
          .mockRejectedValue(
            new ConflictException('机器人正在回复，请等待完成或先中断'),
          ),
      },
    });
    await expect(
      service.callBot(user, { bot: '测试机器人', message: 'x' }, null, undefined),
    ).rejects.toThrow(ConflictException);
    expect(logs.record).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'conflict', tool: 'bot_call' }),
    );
    expect(debug.send).toHaveBeenCalledWith(
      3,
      7,
      'x',
      expect.objectContaining({ scope: expect.stringMatching(/^mcp:s/) }),
    );
  });

  it('callBot 完整执行：complete 终态返回文本、工具与 session_id', async () => {
    const { service, debug, logs } = buildService();
    bindStream(debug);
    const promise = service.callBot(
      user,
      { bot: '测试机器人', message: '跑个任务' },
      null,
      undefined,
    );
    await flush();
    pushSnapshot(
      snap({
        status: 'running',
        messages: [
          {
            id: 'a1',
            role: 'assistant',
            content: '正在处理',
            status: 'running',
            createdAt: new Date().toISOString(),
            tools: [
              { id: 't1', name: 'bash', status: 'running', argsText: 'ls' },
            ],
          },
        ],
      }),
    );
    pushSnapshot(
      snap({
        status: 'idle',
        messages: [
          {
            id: 'a1',
            role: 'assistant',
            content: '任务完成，结果如下',
            status: 'complete',
            createdAt: new Date().toISOString(),
            tools: [
              { id: 't1', name: 'bash', status: 'success', argsText: 'ls' },
            ],
          },
        ],
      }),
    );
    const result = await promise;
    expect(result.status).toBe('complete');
    expect(result.content).toBe('任务完成，结果如下');
    expect(result.tools).toEqual([
      { id: 't1', name: 'bash', status: 'success', detail: 'ls' },
    ]);
    expect(result.session_id).toMatch(/^s/);
    expect(logs.record).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'complete', tool: 'bot_call' }),
    );
  });

  it('callBot 提问时返回 question 与答复提示', async () => {
    const { service, debug } = buildService();
    bindStream(debug);
    const promise = service.callBot(
      user,
      { bot: '测试机器人', message: 'x' },
      null,
      undefined,
    );
    await flush();
    pushSnapshot(
      snap({
        status: 'running',
        messages: [
          {
            id: 'q1',
            role: 'assistant',
            kind: 'question',
            content: '',
            status: 'complete',
            createdAt: new Date().toISOString(),
            question: {
              id: 'req-9',
              sessionId: 'oc-1',
              state: 'pending',
              askedAt: new Date().toISOString(),
              questions: [{ question: '要继续吗？', header: '确认' }],
            },
          },
        ],
      }),
    );
    const result = await promise;
    expect(result.status).toBe('question');
    expect(result.questions?.[0].id).toBe('req-9');
    expect(result.answers_hint).toContain('bot_answer');
  });

  it('callBot auto_skip_questions 时自动 reject 并继续等待', async () => {
    const { service, debug } = buildService();
    bindStream(debug);
    const promise = service.callBot(
      user,
      { bot: '测试机器人', message: 'x', auto_skip_questions: true },
      null,
      undefined,
    );
    await flush();
    pushSnapshot(
      snap({
        status: 'running',
        messages: [
          {
            id: 'q1',
            role: 'assistant',
            kind: 'question',
            content: '',
            status: 'complete',
            createdAt: new Date().toISOString(),
            question: {
              id: 'req-9',
              sessionId: 'oc-1',
              state: 'pending',
              askedAt: new Date().toISOString(),
              questions: [{ question: '要继续吗？', header: '确认' }],
            },
          },
        ],
      }),
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(debug.replyQuestion).toHaveBeenCalledWith(
      3,
      7,
      'req-9',
      { reject: true },
      expect.stringMatching(/^mcp:s/),
    );
    pushSnapshot(
      snap({
        status: 'idle',
        messages: [
          {
            id: 'a1',
            role: 'assistant',
            content: '跳过提问后完成',
            status: 'complete',
            createdAt: new Date().toISOString(),
          },
        ],
      }),
    );
    const result = await promise;
    expect(result.status).toBe('complete');
    expect(result.content).toBe('跳过提问后完成');
  });

  it('answerBot 无待回答提问时 400', async () => {
    const { service } = buildService();
    await expect(
      service.answerBot(
        user,
        { bot: '测试机器人', session_id: 's12345678', answers: [['选项']] },
        null,
        undefined,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('session_id 非法时 400', async () => {
    const { service } = buildService();
    await expect(
      service.callBot(
        user,
        { bot: '测试机器人', message: 'x', session_id: '非法 id!!' },
        null,
        undefined,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('get_session 返回消息摘要', async () => {
    const { service, debug } = buildService();
    debug.snapshot.mockResolvedValue(
      snap({
        status: 'idle',
        messages: [
          {
            id: 'u1',
            role: 'user',
            content: '你好',
            status: 'complete',
            createdAt: new Date().toISOString(),
          },
          {
            id: 'a1',
            role: 'assistant',
            content: '完成',
            status: 'complete',
            createdAt: new Date().toISOString(),
            tools: [{ id: 't1', name: 'bash', status: 'success' }],
          },
        ],
      }),
    );
    const result = await service.getSession(user, {
      bot: '测试机器人',
      session_id: 's12345678',
    });
    expect(result.idle).toBe(true);
    expect(result.messages).toHaveLength(2);
    expect(result.messages[1].tools).toEqual([
      { id: 't1', name: 'bash', status: 'success' },
    ]);
    expect(debug.snapshot).toHaveBeenCalledWith(3, 7, 'mcp:s12345678');
  });
});
