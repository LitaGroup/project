import type { Repository } from 'typeorm';
import { Task } from './task.entity';
import { TaskChatService } from './task-chat.service';
import type { TaskChatQuestionInfo } from './task-chat.types';

describe('TaskChatService 提问卡片', () => {
  const question: TaskChatQuestionInfo = {
    question: '选哪个环境？',
    header: '环境',
    options: [{ label: '测试' }, { label: '生产', description: '真实用户' }],
    custom: true,
  };

  let tasks: { findOne: jest.Mock };
  let messagesRepo: {
    findOne: jest.Mock;
    upsert: jest.Mock;
    find: jest.Mock;
  };
  let service: TaskChatService;

  beforeEach(() => {
    tasks = {
      findOne: jest.fn().mockResolvedValue({
        id: 7,
        rootId: null,
        agentId: null,
        schedulerId: null,
      }),
    };
    messagesRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue(undefined),
      find: jest.fn().mockResolvedValue([]),
    };
    service = new TaskChatService(
      tasks as unknown as Repository<Task>,
      {} as never,
      messagesRepo as never,
      { findOne: jest.fn() } as never,
      { findOne: jest.fn() } as never,
      {} as never,
    );
  });

  it('questionAsked 生成待回答卡片且幂等', async () => {
    const request = {
      id: 'q1',
      sessionID: 's1',
      questions: [question],
      tool: { callID: 'c1' },
    };
    await service.questionAsked(7, request);
    await service.questionAsked(7, request);

    expect(service.pendingQuestions(7)).toHaveLength(1);
    const found = service.findQuestion(7, 'q1');
    expect(found).toMatchObject({
      id: 'q1',
      sessionId: 's1',
      toolCallId: 'c1',
      state: 'pending',
    });
    expect(found?.questions[0].options).toHaveLength(2);
    expect(messagesRepo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 7,
        messageKey: 'chat:7:question:q1',
        kind: 'question',
      }),
      ['taskId', 'messageKey'],
    );
  });

  it('工具调用按调用 ID 更新参数与结果并随消息持久化', async () => {
    await service.toolStarted(7, {
      name: 'shell',
      toolCallId: 'call-1',
      argsText: '{"command":"ls"}',
    });
    service.toolUpdated(7, {
      toolCallId: 'call-1',
      argsText: '{"command":"ls -la"}',
    });
    service.toolFinished(7, true, {
      toolCallId: 'call-1',
      result: 'a.ts',
    });
    service.endText(7);

    expect(messagesRepo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 7,
        tools: [
          expect.objectContaining({
            id: 'call-1',
            name: 'shell',
            status: 'success',
            argsText: '{"command":"ls -la"}',
            result: 'a.ts',
          }),
        ],
      }),
      ['taskId', 'messageKey'],
    );
  });

  it('并行工具按调用 ID 结算，缺少 ID 时回退最近运行中的工具', async () => {
    await service.toolStarted(7, { name: 'read', toolCallId: 'call-1' });
    await service.toolStarted(7, { name: 'shell', toolCallId: 'call-2' });
    service.toolFinished(7, false, {
      toolCallId: 'call-1',
      result: 'missing',
    });
    service.toolFinished(7, true, { result: 'done' });
    service.endText(7);

    expect(messagesRepo.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        tools: [
          expect.objectContaining({
            id: 'call-1',
            status: 'error',
            result: 'missing',
          }),
          expect.objectContaining({
            id: 'call-2',
            status: 'success',
            result: 'done',
          }),
        ],
      }),
      ['taskId', 'messageKey'],
    );
  });

  it('平台生成的任务复盘按固定 messageId 写入并持久化', async () => {
    const posted = await service.postAssistantMessage(
      7,
      '## 任务复盘\n\n已完成。',
      {
        messageId: 'chat:7:review',
        meta: { review: { status: 'complete' } },
      },
    );

    expect(posted).toMatchObject({
      id: 'chat:7:review',
      taskId: 7,
      role: 'assistant',
      content: '## 任务复盘\n\n已完成。',
      status: 'complete',
      meta: { review: { status: 'complete' } },
    });
    expect(messagesRepo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 7,
        messageKey: 'chat:7:review',
        role: 'assistant',
        content: '## 任务复盘\n\n已完成。',
      }),
      ['taskId', 'messageKey'],
    );
  });

  it('服务重启后从持久化记录恢复待回答提问，可继续作答', async () => {
    messagesRepo.findOne.mockResolvedValue({
      taskId: 7,
      messageKey: 'chat:7:question:q1',
      role: 'assistant',
      sender: { id: 'worker:1', name: '机器人', kind: 'worker' },
      content: '',
      reasoning: null,
      status: 'running',
      kind: 'question',
      tools: null,
      question: {
        id: 'q1',
        sessionId: 's1',
        questions: [question],
        state: 'pending',
        askedAt: new Date().toISOString(),
      },
      meta: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const created = await service.questionAsked(7, {
      id: 'q1',
      sessionID: 's1',
      questions: [question],
    });

    expect(created).toBe(false);
    expect(service.findQuestion(7, 'q1')?.state).toBe('pending');
    expect(service.pendingQuestions(7)).toHaveLength(1);
  });

  it('提问消息可记录父机器人自动答复元数据并持久化', async () => {
    await service.questionAsked(7, {
      id: 'q1',
      sessionID: 's1',
      questions: [question],
    });

    service.setQuestionMeta(7, 'q1', {
      autoAnswer: {
        status: 'running',
        parentTaskId: 1,
        parentAgentName: '父机器人',
      },
    });

    expect(service.questionMeta(7, 'q1')).toEqual({
      autoAnswer: {
        status: 'running',
        parentTaskId: 1,
        parentAgentName: '父机器人',
      },
    });
    expect(messagesRepo.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        meta: {
          autoAnswer: {
            status: 'running',
            parentTaskId: 1,
            parentAgentName: '父机器人',
          },
        },
      }),
      ['taskId', 'messageKey'],
    );
  });

  it('questionSettled 记录答案并转为回执', async () => {
    await service.questionAsked(7, {
      id: 'q1',
      sessionID: 's1',
      questions: [question],
    });
    service.questionSettled(7, 'q1', 'answered', [['测试']]);

    const found = service.findQuestion(7, 'q1');
    expect(found?.state).toBe('answered');
    expect(found?.answers).toEqual([['测试']]);
    expect(service.pendingQuestions(7)).toHaveLength(0);
  });

  it('finishTask 将未收到终态事件的工具结算为完成', async () => {
    await service.toolStarted(7, {
      name: 'shell',
      toolCallId: 'call-1',
    });

    await service.finishTask(7);

    expect(messagesRepo.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        tools: [
          expect.objectContaining({
            id: 'call-1',
            status: 'success',
            detail: '会话已结束，未收到工具终态事件',
            finishedAt: expect.any(String) as string,
          }),
        ],
      }),
      ['taskId', 'messageKey'],
    );
  });

  it('failTask 将未收到终态事件的工具结算为失败', async () => {
    await service.toolStarted(7, {
      name: 'shell',
      toolCallId: 'call-1',
    });

    await service.failTask(7, '执行失败');

    expect(messagesRepo.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        tools: [
          expect.objectContaining({
            id: 'call-1',
            status: 'error',
            detail: '会话失败，未收到工具终态事件',
            finishedAt: expect.any(String) as string,
          }),
        ],
      }),
      ['taskId', 'messageKey'],
    );
  });

  it('finishTask 把未回答提问标记为已失效', async () => {
    await service.questionAsked(7, {
      id: 'q1',
      sessionID: 's1',
      questions: [question],
    });
    await service.finishTask(7);

    expect(service.findQuestion(7, 'q1')?.state).toBe('cancelled');
  });

  it('finishTask 可按需保留 project 待反馈提问', async () => {
    await service.questionAsked(7, {
      id: 'project-q1',
      sessionID: 's1',
      questions: [question],
    });
    await service.finishTask(7, { preserveProjectQuestions: true });

    expect(service.findQuestion(7, 'project-q1')?.state).toBe('pending');
    expect(service.isRunning(7)).toBe(false);
  });
});

describe('TaskChatService snapshot 最终产出去重', () => {
  const baseTask = {
    id: 34,
    rootId: null,
    agentId: null,
    schedulerId: null,
    createdById: null,
    result: null as string | null,
    description: '',
    title: '',
    createdAt: new Date('2026-10-27T10:00:00Z'),
  };

  const persistedRow = (
    messageKey: string,
    content: string,
    offsetMs: number,
  ) => ({
    taskId: 34,
    messageKey,
    role: 'assistant',
    sender: { id: 'worker:1', name: '机器人', kind: 'worker' },
    content,
    reasoning: null,
    status: 'complete',
    kind: 'message',
    tools: null,
    question: null,
    meta: null,
    createdAt: new Date(Date.parse('2026-10-27T10:05:00Z') + offsetMs),
    updatedAt: new Date('2026-10-27T10:05:00Z'),
  });

  let tasks: { findOne: jest.Mock; find: jest.Mock };
  let eventsRepo: { find: jest.Mock };
  let messagesRepo: {
    findOne: jest.Mock;
    upsert: jest.Mock;
    find: jest.Mock;
    update: jest.Mock;
  };
  let service: TaskChatService;

  beforeEach(() => {
    baseTask.result = null;
    tasks = {
      findOne: jest.fn().mockResolvedValue(baseTask),
      find: jest.fn().mockResolvedValue([baseTask]),
    };
    eventsRepo = { find: jest.fn().mockResolvedValue([]) };
    messagesRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue(undefined),
      find: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    service = new TaskChatService(
      tasks as unknown as Repository<Task>,
      eventsRepo as never,
      messagesRepo as never,
      { find: jest.fn().mockResolvedValue([]) } as never,
      { findOne: jest.fn() } as never,
      {} as never,
    );
  });

  it('快照保留历史验收申请标记，返工后仍为 true', async () => {
    eventsRepo.find.mockResolvedValue([
      {
        id: 1,
        taskId: 34,
        type: '状态变更',
        content: '执行机器人申请验收',
        meta: { deliveryApply: true },
        operator: '机器人',
        createdAt: new Date('2026-10-27T10:05:00Z'),
      },
    ]);

    const snapshot = await service.snapshot(34);

    expect(snapshot.hasAcceptanceApplication).toBe(true);
  });

  it('最终产出与已落库的单条回复完全相同时不再生成 result 消息', async () => {
    const reply = '第一段结论';
    baseTask.result = reply;
    messagesRepo.find.mockResolvedValue([persistedRow('chat:34:m1', reply, 0)]);

    const messages = (await service.snapshot(34)).messages;

    expect(messages.some((message) => message.id.startsWith('result:'))).toBe(
      false,
    );
    expect(messages.map((message) => message.id)).toEqual(['chat:34:m1']);
  });

  it('最终产出是多条回复按空行拼接时不再重复生成 result 消息', async () => {
    const first = '第一段结论';
    const second = '第二段补充';
    baseTask.result = `${first}\n\n${second}`;
    messagesRepo.find.mockResolvedValue([
      persistedRow('chat:34:m1', first, 0),
      persistedRow('chat:34:m2', second, 1000),
    ]);

    const messages = (await service.snapshot(34)).messages;

    expect(messages.some((message) => message.id.startsWith('result:'))).toBe(
      false,
    );
    expect(messages.map((message) => message.id)).toEqual([
      'chat:34:m1',
      'chat:34:m2',
    ]);
  });

  it('最终产出在已落库回复基础上追加了尾部内容时折叠为一条完整 result 消息', async () => {
    // 任务 #34 实际场景：尾部增量因事件乱序只进入 result，聊天消息缺尾
    const reply = '…需要我帮你把修复合并到';
    baseTask.result = `${reply} stable-api 走发布吗？`;
    messagesRepo.find.mockResolvedValue([persistedRow('chat:34:m1', reply, 0)]);

    const messages = (await service.snapshot(34)).messages;

    expect(
      messages.filter((message) => message.id.startsWith('result:')),
    ).toHaveLength(1);
    expect(messages.some((message) => message.id === 'chat:34:m1')).toBe(false);
    const resultMessage = messages.find((message) =>
      message.id.startsWith('result:'),
    );
    expect(resultMessage?.content).toBe(baseTask.result);
  });

  it('最终产出与已落库回复无关时正常追加 result 消息', async () => {
    baseTask.result = '完全不同的最终结论';
    messagesRepo.find.mockResolvedValue([
      persistedRow('chat:34:m1', '第一段结论', 0),
    ]);

    const messages = (await service.snapshot(34)).messages;

    expect(messages).toHaveLength(2);
    expect(messages[0].id).toBe('chat:34:m1');
    expect(messages[1].id.startsWith('result:')).toBe(true);
    expect(messages[1].content).toBe('完全不同的最终结论');
  });

  it('数据库遗留的 running 消息按完成展示并回写', async () => {
    const row = {
      ...persistedRow('chat:34:m1', '最终回复', 0),
      status: 'running',
      tools: [
        {
          id: 'call-1',
          name: 'shell',
          status: 'running',
          startedAt: new Date().toISOString(),
        },
      ],
    };
    messagesRepo.find.mockResolvedValue([row]);

    const messages = (await service.snapshot(34)).messages;
    const message = messages.find((item) => item.id === 'chat:34:m1');

    expect(message?.status).toBe('complete');
    expect(message?.tools?.[0].status).toBe('success');
    expect(messagesRepo.update).toHaveBeenCalledWith(
      { taskId: 34, messageKey: 'chat:34:m1' },
      expect.objectContaining({
        status: 'complete',
        tools: [expect.objectContaining({ status: 'success' })],
      }),
    );
  });
});

describe('TaskChatService 发送队列', () => {
  const task = {
    id: 7,
    rootId: null,
    agentId: null,
    schedulerId: null,
    createdById: null,
    result: null,
    description: '任务需求',
    title: '任务标题',
    createdAt: new Date('2026-10-27T10:00:00Z'),
    updatedAt: new Date('2026-10-27T10:00:00Z'),
  } as Task;

  let service: TaskChatService;

  beforeEach(() => {
    service = new TaskChatService(
      {
        findOne: jest.fn().mockResolvedValue(task),
        find: jest.fn().mockResolvedValue([]),
      } as never,
      { find: jest.fn().mockResolvedValue([]) } as never,
      { find: jest.fn().mockResolvedValue([]) } as never,
      { findOne: jest.fn().mockResolvedValue(null) } as never,
      { findOne: jest.fn().mockResolvedValue(null) } as never,
      {} as never,
    );
  });

  it('按 FIFO 保存待发送消息，并支持发送中、失败恢复与移除', async () => {
    const first = await service.enqueueUserMessage(7, '第一条', '张三');
    const second = await service.enqueueUserMessage(7, '第二条', '张三');

    expect(service.queuedUserMessages(7).map((item) => item.content)).toEqual([
      '第一条',
      '第二条',
    ]);

    await service.markQueuedUserMessageSending(7, first.id);
    expect(service.queuedUserMessages(7)[0]).toMatchObject({
      id: first.id,
      status: 'sending',
    });

    await service.restoreQueuedUserMessage(7, first.id, '执行器离线');
    expect(service.queuedUserMessages(7)[0]).toMatchObject({
      id: first.id,
      status: 'queued',
      error: '执行器离线',
    });

    await service.removeQueuedUserMessage(7, first.id);
    expect(service.queuedUserMessages(7)).toEqual([
      expect.objectContaining({ id: second.id, content: '第二条' }),
    ]);

    await service.discardQueuedUserMessages(7);
    expect(service.queuedUserMessages(7)).toEqual([]);
  });

  it('队列消息单独保存模型 Prompt，原始内容仍用于展示', async () => {
    const message = await service.enqueueUserMessage(
      7,
      '请补充错误提示',
      '张三',
      '# 验收返工\n\n请补充错误提示\n\n必须重新申请验收',
    );

    expect(service.queuedUserMessages(7)[0].content).toBe('请补充错误提示');
    expect(service.queuedUserMessagePrompt(7, message.id)).toContain(
      '必须重新申请验收',
    );

    await service.discardQueuedUserMessages(7);
    expect(service.queuedUserMessagePrompt(7, message.id)).toBeNull();
  });

  it('聊天快照包含当前任务的待发送队列', async () => {
    await service.enqueueUserMessage(7, '刷新后仍要看到', '张三');

    const snapshot = await service.snapshot(7);

    expect(snapshot.queuedMessages).toEqual([
      expect.objectContaining({
        taskId: 7,
        content: '刷新后仍要看到',
        status: 'queued',
      }),
    ]);
  });
});
