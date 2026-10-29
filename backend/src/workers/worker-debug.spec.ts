import {
  applyDebugStreamEvent,
  normalizeDebugAnswers,
  parseQuestionEvent,
  pendingDebugQuestions,
  questionEventRequestId,
  recoverDebugMessages,
  runningAssistantOf,
  settleDebugQuestion,
  settleDebugRunningTools,
  upsertDebugQuestion,
  WorkerDebugMessage,
} from './worker-debug.service';

describe('applyDebugStreamEvent', () => {
  const base = (): WorkerDebugMessage => ({
    id: 'assistant:1',
    role: 'assistant',
    content: '',
    status: 'running',
    createdAt: '',
  });

  it('文本增量追加到 content', () => {
    const message = base();
    expect(
      applyDebugStreamEvent(message, 'session.text.delta', { delta: '你好' }),
    ).toBe(true);
    expect(
      applyDebugStreamEvent(message, 'session.text.delta', { delta: '，世界' }),
    ).toBe(true);
    expect(message.content).toBe('你好，世界');
  });

  it('思考增量累积到 reasoning，与文本互不影响', () => {
    const message = base();
    applyDebugStreamEvent(message, 'session.reasoning.delta', {
      delta: '先分析',
    });
    applyDebugStreamEvent(message, 'session.reasoning.delta', {
      delta: '需求',
    });
    applyDebugStreamEvent(message, 'session.text.delta', { delta: '结论' });
    expect(message.reasoning).toBe('先分析需求');
    expect(message.content).toBe('结论');
  });

  it('ended 追加段落分隔符，空内容不追加', () => {
    const message = base();
    expect(applyDebugStreamEvent(message, 'session.text.ended', {})).toBe(
      false,
    );
    applyDebugStreamEvent(message, 'session.text.delta', { delta: '第一段' });
    expect(applyDebugStreamEvent(message, 'session.text.ended', {})).toBe(true);
    expect(message.content).toBe('第一段\n\n');
    applyDebugStreamEvent(message, 'session.reasoning.delta', {
      delta: '想法',
    });
    expect(applyDebugStreamEvent(message, 'session.reasoning.ended', {})).toBe(
      true,
    );
    expect(message.reasoning).toBe('想法\n\n');
  });

  it('工具事件累积参数并按调用 ID 结算结果', () => {
    const message = base();
    expect(
      applyDebugStreamEvent(message, 'session.tool.input.started', {
        name: 'shell',
        toolCallID: 'call-1',
        input: { command: 'ls' },
      }),
    ).toBe(true);
    expect(
      applyDebugStreamEvent(message, 'session.tool.input.updated', {
        name: 'shell',
        toolCallID: 'call-1',
        input: { command: 'ls -la' },
      }),
    ).toBe(true);
    expect(
      applyDebugStreamEvent(message, 'session.tool.success', {
        toolCallID: 'call-1',
        output: 'a.ts',
      }),
    ).toBe(true);
    expect(message.tools).toHaveLength(1);
    expect(message.tools?.[0]).toMatchObject({
      id: 'call-1',
      name: 'shell',
      status: 'success',
      result: 'a.ts',
    });
    expect(message.tools?.[0].argsText).toContain('ls -la');
    expect(typeof message.tools?.[0].startedAt).toBe('string');
    expect(typeof message.tools?.[0].finishedAt).toBe('string');
  });

  it('并行工具按调用 ID 匹配，缺少 ID 时回退最近运行中的工具', () => {
    const message = base();
    applyDebugStreamEvent(message, 'session.tool.input.started', {
      name: 'read',
      toolCallID: 'call-1',
    });
    applyDebugStreamEvent(message, 'session.tool.input.started', {
      name: 'shell',
      toolCallID: 'call-2',
    });
    applyDebugStreamEvent(message, 'session.tool.failed', {
      toolCallID: 'call-1',
      error: 'missing',
    });
    applyDebugStreamEvent(message, 'session.tool.success', { name: 'shell' });
    expect(message.tools).toMatchObject([
      { id: 'call-1', status: 'error', result: 'missing' },
      { id: 'call-2', status: 'success' },
    ]);
  });

  it('会话收尾把未收到终态事件的工具结算为完成', () => {
    const message = base();
    applyDebugStreamEvent(message, 'session.tool.input.started', {
      name: 'shell',
      toolCallID: 'call-1',
    });
    applyDebugStreamEvent(message, 'session.tool.success', {
      name: 'read',
      toolCallID: 'call-2',
      output: 'ok',
    });

    expect(
      settleDebugRunningTools(
        message,
        'success',
        '会话已结束，未收到工具终态事件',
      ),
    ).toBe(true);
    expect(message.tools).toMatchObject([
      {
        id: 'call-1',
        status: 'success',
        detail: '会话已结束，未收到工具终态事件',
      },
      { id: 'call-2', status: 'success', result: 'ok' },
    ]);
    expect(message.tools?.[0].finishedAt).toEqual(expect.any(String));
    expect(
      settleDebugRunningTools(message, 'error', '不应覆盖已结算工具'),
    ).toBe(false);
  });

  it('无关事件与非法 delta 不产生变更', () => {
    const message = base();
    expect(applyDebugStreamEvent(message, 'session.tool.success', {})).toBe(
      false,
    );
    expect(applyDebugStreamEvent(message, 'session.text.delta', {})).toBe(
      false,
    );
    expect(
      applyDebugStreamEvent(message, 'session.text.delta', {
        delta: 123,
      }),
    ).toBe(false);
    expect(message.content).toBe('');
  });
});

describe('recoverDebugMessages', () => {
  const message = (
    overrides: Partial<WorkerDebugMessage>,
  ): WorkerDebugMessage => ({
    id: 'm1',
    role: 'assistant',
    content: '',
    status: 'complete',
    createdAt: '',
    ...overrides,
  });

  it('上一轮 running 的助手消息按中断收尾', () => {
    const [recovered] = recoverDebugMessages([
      message({ status: 'running', content: '半截输出' }),
    ]);
    expect(recovered.status).toBe('error');
    expect(recovered.content).toBe('半截输出');
  });

  it('空的 running 消息补中断提示，已完成消息原样保留', () => {
    const [running, done, user] = recoverDebugMessages([
      message({ status: 'running' }),
      message({ id: 'm2', status: 'complete', content: '完成' }),
      message({ id: 'm3', role: 'user', status: 'complete', content: '提问' }),
    ]);
    expect(running.status).toBe('error');
    expect(running.content).toContain('本轮回复已中断');
    expect(done).toMatchObject({ status: 'complete', content: '完成' });
    expect(user).toMatchObject({ role: 'user', content: '提问' });
  });

  it('恢复时待回答提问失效，已回执的提问原样保留', () => {
    const [pending, answered, plain] = recoverDebugMessages([
      message({
        id: 'q1',
        kind: 'question',
        status: 'running',
        content: '',
        question: {
          id: 'req-1',
          sessionId: 's1',
          questions: [{ question: '继续吗', header: '确认' }],
          state: 'pending',
          askedAt: '',
        },
      }),
      message({
        id: 'q2',
        kind: 'question',
        status: 'complete',
        content: '',
        question: {
          id: 'req-2',
          sessionId: 's1',
          questions: [{ question: '选哪个', header: '选择' }],
          state: 'answered',
          answers: [['A']],
          askedAt: '',
        },
      }),
      message({ id: 'm4', status: 'running', content: '输出中' }),
    ]);
    expect(pending.question?.state).toBe('cancelled');
    expect(pending.status).toBe('complete');
    expect(answered.question?.state).toBe('answered');
    expect(answered.question?.answers).toEqual([['A']]);
    expect(plain.status).toBe('error');
  });

  it('中断时仍在运行的工具标记失败并保留已有结果', () => {
    const [recovered] = recoverDebugMessages([
      message({
        status: 'running',
        tools: [
          { id: 't1', name: 'shell', status: 'running' },
          { id: 't2', name: 'read', status: 'success', result: 'ok' },
        ],
      }),
    ]);
    expect(recovered.tools).toEqual([
      expect.objectContaining({
        id: 't1',
        status: 'error',
        result: '工具执行已中断',
      }),
      { id: 't2', name: 'read', status: 'success', result: 'ok' },
    ]);
  });

  it('空值返回空数组，且不修改原数组元素', () => {
    expect(recoverDebugMessages(null)).toEqual([]);
    const origin = message({ status: 'running' });
    const [recovered] = recoverDebugMessages([origin]);
    expect(origin.status).toBe('running');
    expect(recovered).not.toBe(origin);
  });
});

describe('parseQuestionEvent', () => {
  const request = {
    id: 'q1',
    sessionID: 's1',
    questions: [{ question: '继续吗', header: '确认' }],
  };

  it('v1/v2 事件 data 直接是 request 结构', () => {
    expect(parseQuestionEvent(request)).toMatchObject({
      id: 'q1',
      sessionID: 's1',
    });
    expect(parseQuestionEvent(request)).toMatchObject({
      id: 'q1',
    });
  });

  it('兼容包在 request 字段里的 data', () => {
    expect(parseQuestionEvent({ request })).toMatchObject({
      id: 'q1',
    });
  });

  it('缺 id 或 questions 返回 null', () => {
    expect(parseQuestionEvent({})).toBeNull();
    expect(parseQuestionEvent({ id: 'q1' })).toBeNull();
    expect(parseQuestionEvent({ id: 'q1', questions: 'bad' })).toBeNull();
  });
});

describe('upsertDebugQuestion / settleDebugQuestion', () => {
  const request = {
    id: 'q1',
    sessionID: '',
    questions: [{ question: '继续吗', header: '确认' }],
    tool: { callID: 'call-1' },
  };
  const messages = (): WorkerDebugMessage[] => [
    {
      id: 'm1',
      role: 'user',
      content: '分析任务',
      status: 'complete',
      createdAt: '',
    },
    {
      id: 'assistant:1',
      role: 'assistant',
      content: '',
      status: 'running',
      createdAt: '',
    },
  ];

  it('插入独立提问卡片，sessionID 缺省回退会话', () => {
    const list = messages();
    expect(upsertDebugQuestion(list, request, 's1', 'T0')).toBe(true);
    const card = list.find((item) => item.id === 'question:q1');
    expect(card?.kind).toBe('question');
    expect(card?.question).toMatchObject({
      id: 'q1',
      sessionId: 's1',
      state: 'pending',
      toolCallId: 'call-1',
    });
    expect(card?.question?.questions[0]).toMatchObject({
      question: '继续吗',
      header: '确认',
    });
  });

  it('同一 request 幂等，不重复插入', () => {
    const list = messages();
    expect(upsertDebugQuestion(list, request, 's1', 'T0')).toBe(true);
    expect(upsertDebugQuestion(list, request, 's1', 'T1')).toBe(false);
    expect(list.filter((item) => item.id === 'question:q1')).toHaveLength(1);
  });

  it('结算为已回答并记录答案；重复结算与不存在的提问返回 false', () => {
    const list = messages();
    upsertDebugQuestion(list, request, 's1', 'T0');
    expect(settleDebugQuestion(list, 'q1', 'answered', [['继续']])).toBe(true);
    const card = list.find((item) => item.id === 'question:q1');
    expect(card?.question?.state).toBe('answered');
    expect(card?.question?.answers).toEqual([['继续']]);
    expect(card?.status).toBe('complete');
    expect(settleDebugQuestion(list, 'q1', 'rejected')).toBe(false);
    expect(settleDebugQuestion(list, 'missing', 'rejected')).toBe(false);
  });

  it('pendingDebugQuestions 只返回待回答的提问', () => {
    const list = messages();
    upsertDebugQuestion(list, request, 's1', 'T0');
    settleDebugQuestion(list, 'q1', 'rejected');
    upsertDebugQuestion(
      list,
      { id: 'q2', sessionID: 's1', questions: [] },
      's1',
      'T0',
    );
    expect(pendingDebugQuestions(list).map((item) => item.id)).toEqual(['q2']);
  });

  it('runningAssistantOf 跳过提问卡片，定位真正的助手消息', () => {
    const list = messages();
    upsertDebugQuestion(list, request, 's1', 'T0');
    const target = runningAssistantOf(list);
    expect(target?.id).toBe('assistant:1');
    expect(
      applyDebugStreamEvent(target!, 'session.text.delta', { delta: 'x' }),
    ).toBe(true);
  });
});

describe('normalizeDebugAnswers / questionEventRequestId', () => {
  it('答案规范化：仅保留非空字符串并去空白', () => {
    expect(normalizeDebugAnswers([[' A ', '', 1]])).toEqual([['A']]);
    expect(normalizeDebugAnswers('bad')).toBeNull();
    expect(normalizeDebugAnswers([null])).toBeNull();
  });

  it('requestID 取 data.requestID，兼容 request 嵌套', () => {
    expect(questionEventRequestId({ requestID: 'q1' })).toBe('q1');
    expect(questionEventRequestId({ request: { requestID: 'q2' } })).toBe('q2');
    expect(questionEventRequestId({})).toBeNull();
  });
});
