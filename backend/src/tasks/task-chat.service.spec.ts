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

  it('finishTask 把未回答提问标记为已失效', async () => {
    await service.questionAsked(7, {
      id: 'q1',
      sessionID: 's1',
      questions: [question],
    });
    await service.finishTask(7);

    expect(service.findQuestion(7, 'q1')?.state).toBe('cancelled');
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
  let messagesRepo: {
    findOne: jest.Mock;
    upsert: jest.Mock;
    find: jest.Mock;
  };
  let service: TaskChatService;

  beforeEach(() => {
    baseTask.result = null;
    tasks = {
      findOne: jest.fn().mockResolvedValue(baseTask),
      find: jest.fn().mockResolvedValue([baseTask]),
    };
    messagesRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue(undefined),
      find: jest.fn().mockResolvedValue([]),
    };
    service = new TaskChatService(
      tasks as unknown as Repository<Task>,
      { find: jest.fn().mockResolvedValue([]) } as never,
      messagesRepo as never,
      { find: jest.fn().mockResolvedValue([]) } as never,
      { findOne: jest.fn() } as never,
      {} as never,
    );
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
});
