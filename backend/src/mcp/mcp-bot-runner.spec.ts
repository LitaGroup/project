import type { WorkerDebugMessage, WorkerDebugSnapshot } from '../workers/worker-debug.types';
import {
  diffRunProgress,
  initialRunState,
  interruptedResultFrom,
  lastAssistantOf,
  pendingQuestionsOf,
  settleRunResult,
} from './mcp-bot-runner';

/** 构造调试会话快照 */
function snap(
  partial: Partial<WorkerDebugSnapshot> & { status: 'running' | 'idle' },
): WorkerDebugSnapshot {
  return {
    worker: {
      id: 1,
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

function message(
  partial: Partial<WorkerDebugMessage> & {
    id: string;
    role: 'user' | 'assistant';
  },
): WorkerDebugMessage {
  return {
    content: '',
    status: 'complete',
    createdAt: new Date().toISOString(),
    ...partial,
  };
}

describe('lastAssistantOf', () => {
  it('返回最后一条非提问的 assistant 消息', () => {
    const messages = [
      message({ id: 'u1', role: 'user', content: 'hi' }),
      message({ id: 'q1', role: 'assistant', content: '', kind: 'question' }),
      message({ id: 'a1', role: 'assistant', content: '第一段' }),
      message({ id: 'a2', role: 'assistant', content: '最终', status: 'running' }),
    ];
    expect(lastAssistantOf(messages)?.id).toBe('a2');
  });

  it('没有 assistant 时返回 null', () => {
    expect(lastAssistantOf([])).toBeNull();
  });
});

describe('pendingQuestionsOf', () => {
  it('仅提取待回答的提问并映射为视图', () => {
    const messages = [
      message({
        id: 'q1',
        role: 'assistant',
        kind: 'question',
        content: '',
        question: {
          id: 'req-1',
          sessionId: 'oc-1',
          state: 'pending',
          askedAt: new Date().toISOString(),
          questions: [
            {
              question: '选择环境？',
              header: '环境',
              options: [
                { label: '测试', description: 'test' },
                { label: '生产' },
              ],
              multiple: true,
            },
          ],
        },
      }),
      message({
        id: 'q2',
        role: 'assistant',
        kind: 'question',
        content: '',
        question: {
          id: 'req-2',
          sessionId: 'oc-1',
          state: 'answered',
          answers: [['测试']],
          askedAt: new Date().toISOString(),
          questions: [{ question: '已回答', header: 'x' }],
        },
      }),
    ];
    const groups = pendingQuestionsOf(messages);
    expect(groups).toHaveLength(1);
    expect(groups[0].id).toBe('req-1');
    expect(groups[0].questions[0].multiple).toBe(true);
    expect(groups[0].questions[0].custom).toBe(true);
    expect(groups[0].questions[0].options?.[1]).toEqual({ label: '生产' });
  });
});

describe('diffRunProgress', () => {
  it('提取新增文本并更新状态', () => {
    const state = initialRunState();
    const first = diffRunProgress(
      state,
      snap({ status: 'running', messages: [message({ id: 'a1', role: 'assistant', content: '你好', status: 'running' })] }),
    );
    expect(first?.text).toBe('你好');
    const second = diffRunProgress(
      state,
      snap({ status: 'running', messages: [message({ id: 'a1', role: 'assistant', content: '你好世界', status: 'running' })] }),
    );
    expect(second?.text).toBe('世界');
    expect(diffRunProgress(state, snap({ status: 'running' }))).toBeNull();
  });

  it('文本变短时按全新文本处理（会话重置）', () => {
    const state = initialRunState();
    diffRunProgress(
      state,
      snap({ status: 'running', messages: [message({ id: 'a1', role: 'assistant', content: '长文本内容', status: 'running' })] }),
    );
    const next = diffRunProgress(
      state,
      snap({ status: 'running', messages: [message({ id: 'a1', role: 'assistant', content: '新', status: 'running' })] }),
    );
    expect(next?.text).toBe('新');
  });

  it('工具签名变化时输出新增工具事件', () => {
    const state = initialRunState();
    const tools = [
      { id: 't1', name: 'bash', status: 'running' as const, argsText: 'git status' },
    ];
    const first = diffRunProgress(
      state,
      snap({ status: 'running', messages: [message({ id: 'a1', role: 'assistant', tools })] }),
    );
    expect(first?.toolEvents).toEqual(['[running] bash：git status']);
    const done = diffRunProgress(
      state,
      snap({
        status: 'running',
        messages: [
          message({
            id: 'a1',
            role: 'assistant',
            tools: [{ ...tools[0], status: 'success' as const }],
          }),
        ],
      }),
    );
    expect(done?.toolEvents).toEqual(['[success] bash：git status']);
    // 状态不变不再重复推送
    const again = diffRunProgress(
      state,
      snap({
        status: 'running',
        messages: [
          message({
            id: 'a1',
            role: 'assistant',
            tools: [{ ...tools[0], status: 'success' as const }],
          }),
        ],
      }),
    );
    expect(again?.toolEvents).toBeUndefined();
  });
});

describe('settleRunResult', () => {
  it('运行中返回 null', () => {
    expect(
      settleRunResult(
        snap({
          status: 'running',
          messages: [message({ id: 'a1', role: 'assistant', content: 'x', status: 'running' })],
        }),
      ),
    ).toBeNull();
  });

  it('idle + complete 返回终态文本', () => {
    const result = settleRunResult(
      snap({
        status: 'idle',
        messages: [message({ id: 'a1', role: 'assistant', content: '完成' })],
      }),
    );
    expect(result).toEqual({ status: 'complete', content: '完成' });
  });

  it('idle + error 返回错误信息', () => {
    const result = settleRunResult(
      snap({
        status: 'idle',
        error: '执行失败',
        messages: [message({ id: 'a1', role: 'assistant', content: '', status: 'error' })],
      }),
    );
    expect(result?.status).toBe('error');
    expect(result?.error).toBe('执行失败');
  });

  it('存在待回答提问时优先返回 question（即使会话仍 running）', () => {
    const result = settleRunResult(
      snap({
        status: 'running',
        messages: [
          message({ id: 'a1', role: 'assistant', content: '部分文本', status: 'running' }),
          message({
            id: 'q1',
            role: 'assistant',
            kind: 'question',
            content: '',
            question: {
              id: 'req-1',
              sessionId: 'oc-1',
              state: 'pending',
              askedAt: new Date().toISOString(),
              questions: [{ question: '继续吗？', header: '确认' }],
            },
          }),
        ],
      }),
    );
    expect(result?.status).toBe('question');
    expect(result?.content).toBe('部分文本');
  });

  it('idle 且 assistant 未 complete（瞬态）返回 null 等下一帧', () => {
    expect(
      settleRunResult(
        snap({
          status: 'idle',
          messages: [message({ id: 'a1', role: 'assistant', content: 'x', status: 'running' })],
        }),
      ),
    ).toBeNull();
  });
});

describe('interruptedResultFrom', () => {
  it('剥掉中断提示保留已完成文本', () => {
    const result = interruptedResultFrom(
      snap({
        status: 'idle',
        messages: [
          message({
            id: 'a1',
            role: 'assistant',
            status: 'error',
            content: '第一部分已完成。本轮回复已中断。你可以继续发送消息，仍使用当前会话。',
          }),
        ],
      }),
    );
    expect(result.content).toBe('第一部分已完成。');
    expect(result.tools).toEqual([]);
    expect(result.todos).toEqual([]);
  });
});
