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
    service = new TaskChatService(
      tasks as unknown as Repository<Task>,
      {} as never,
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
