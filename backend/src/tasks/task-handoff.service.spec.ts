import { BadRequestException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { TaskStatus, TaskSubStatus } from '../common/enums';
import type { Executor } from '../executors/executor.entity';
import { runOpencodePrompt } from '../executors/opencode-run';
import type { KnowledgeService } from '../knowledge/knowledge.service';
import type { Worker } from '../workers/worker.entity';
import type { WorkersService } from '../workers/workers.service';
import { Task } from './task.entity';
import type { TaskMessage } from './task-message.entity';
import type { TaskEvent } from './task-event.entity';
import type { TaskChatService } from './task-chat.service';
import {
  splitHandoffSummary,
  TaskHandoffService,
} from './task-handoff.service';

jest.mock('../executors/opencode-run', () => ({
  runOpencodePrompt: jest.fn(),
}));

const runPrompt = runOpencodePrompt as jest.MockedFunction<
  typeof runOpencodePrompt
>;

const SUMMARY = `## 交付物与结论

已完成活动页，交付测试通过。

## 任务记录与过程复盘

中途补充过一次接口字段，未出现明确返工。

## 经验总结

先确认接口字段再开发页面。`;

function baseTask(over: Partial<Task> = {}): Task {
  return {
    id: 1,
    code: 'TK-0001',
    title: '活动页开发',
    type: '前端开发',
    templateId: null,
    templateName: null,
    parentId: null,
    rootId: 1,
    sortOrder: 0,
    description: '开发活动页\n\n补充：使用 v2 接口',
    input: '开发一个活动页',
    content: '开发活动页，使用 v2 接口，支持移动端',
    outputSpec: '可验收的活动页',
    status: TaskStatus.FINISHED,
    subStatus: TaskSubStatus.COMPLETED,
    workPlan: null,
    missingItems: null,
    remindCount: 0,
    firstRemindedAt: null,
    lastRemindedAt: null,
    agentId: 1001,
    schedulerId: 9,
    executorId: 3,
    opencodeSessionId: 's1',
    result: '活动页已上线测试环境，自测通过。',
    acceptedAt: new Date('2026-10-28T12:00:00+08:00'),
    acceptedBy: '验收人',
    deliveredAt: new Date('2026-10-28T12:00:00+08:00'),
    handoffCount: 0,
    archivedAt: null,
    canceledAt: null,
    createdById: 8,
    planRef: null,
    createdAt: new Date('2026-10-28T09:00:00+08:00'),
    updatedAt: new Date('2026-10-28T12:00:00+08:00'),
    ...over,
  };
}

function event(over: Partial<TaskEvent> = {}): TaskEvent {
  return {
    id: 1,
    taskId: 1,
    type: '操作',
    content: '创建任务',
    meta: { description: '开发一个活动页' },
    operator: '需求人',
    createdAt: new Date('2026-10-28T09:00:00+08:00'),
    ...over,
  };
}

function message(over: Partial<TaskMessage> = {}): TaskMessage {
  return {
    id: 1,
    taskId: 1,
    messageKey: 'm1',
    role: 'assistant',
    sender: { id: 'worker:1001', name: '前端机器人', kind: 'worker' },
    content: '页面已开发完成',
    reasoning: null,
    status: 'complete',
    kind: 'message',
    tools: null,
    question: null,
    meta: null,
    createdAt: new Date('2026-10-28T11:00:00+08:00'),
    updatedAt: new Date('2026-10-28T11:00:00+08:00'),
    ...over,
  };
}

describe('TaskHandoffService', () => {
  let tasks: { findOne: jest.Mock; update: jest.Mock };
  let events: { find: jest.Mock };
  let messages: { find: jest.Mock };
  let workers: { findOne: jest.Mock };
  let executors: { findOne: jest.Mock };
  let workersService: { workdirOf: jest.Mock };
  let knowledge: {
    isEnabled: boolean;
    disabledMessage: string;
    createArticleAtPath: jest.Mock;
  };
  let taskChat: { postAssistantMessage: jest.Mock };
  let service: TaskHandoffService;

  beforeEach(() => {
    tasks = {
      findOne: jest.fn().mockResolvedValue(baseTask()),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    events = {
      find: jest.fn().mockResolvedValue([
        event(),
        event({
          id: 2,
          type: '操作',
          content: '回答机器人提问',
          meta: { questionId: 'q1' },
          operator: '需求人',
        }),
        event({
          id: 3,
          type: '反馈',
          content: '补充：接口改为 v2',
          operator: '需求人',
        }),
        event({
          id: 4,
          type: '反馈',
          content: '再补充一个移动端要求',
          operator: '需求人',
        }),
      ]),
    };
    messages = { find: jest.fn().mockResolvedValue([message()]) };
    workers = {
      findOne: jest.fn().mockResolvedValue({
        id: 1001,
        name: '前端机器人',
        providerId: 'openai',
        modelId: 'gpt-test',
      }),
    };
    executors = {
      findOne: jest.fn().mockResolvedValue({
        id: 3,
        name: '本机执行器',
        online: true,
        defaultLocation: '/tmp/default',
        providersCache: null,
      }),
    };
    workersService = {
      workdirOf: jest.fn().mockReturnValue('/tmp/worker/1001'),
    };
    knowledge = {
      isEnabled: true,
      disabledMessage: '知识库不可用',
      createArticleAtPath: jest.fn().mockResolvedValue({ id: 'k1' }),
    };
    taskChat = {
      postAssistantMessage: jest
        .fn()
        .mockImplementation((_taskId: number, content: string) =>
          Promise.resolve({ content }),
        ),
    };
    runPrompt.mockReset();
    runPrompt.mockResolvedValue(SUMMARY);
    service = new TaskHandoffService(
      tasks as unknown as Repository<Task>,
      events as unknown as Repository<TaskEvent>,
      messages as unknown as Repository<TaskMessage>,
      workers as unknown as Repository<Worker>,
      executors as unknown as Repository<Executor>,
      workersService as unknown as WorkersService,
      knowledge as unknown as KnowledgeService,
      taskChat as unknown as TaskChatService,
    );
  });

  it('生成任务自身报告，统计确认/补充/时长并归档到版本 0', async () => {
    const result = await service.generateNow(1);

    expect(result.version).toBe(0);
    expect(result.path).toMatch(/^\/task\/handoff\/\d{8}\/TK-0001\/0\.md$/);
    expect(result.url).toContain('/docs/detail/task/handoff/');
    // 只读取当前任务自身记录，子任务由各自验收时独立总结
    expect(events.find).toHaveBeenCalledWith({
      where: { taskId: 1 },
      order: { id: 'ASC' },
    });
    expect(messages.find).toHaveBeenCalledWith({
      where: { taskId: 1 },
      order: { id: 'ASC' },
    });
    expect(knowledge.createArticleAtPath).toHaveBeenCalledWith(
      expect.objectContaining({
        path: result.path,
        title: 'TK-0001 活动页开发 · 任务总结 v0',
      }),
    );
    const created = knowledge.createArticleAtPath.mock.calls[0] as [
      { content: string },
    ];
    const content = created[0].content;
    expect(content).toContain('## 一、任务输入');
    expect(content).toContain('开发一个活动页');
    expect(content).toContain('支持移动端');
    expect(content).toContain('## 二、交付物与结论');
    expect(content).toContain('活动页已上线测试环境');
    expect(content).toContain('| 用户确认次数 | 1 次 |');
    expect(content).toContain('| 补充信息次数 | 2 次 |');
    expect(content).toContain('| 持续时长 | 3 小时 |');
    expect(content).toContain('## 四、任务记录与过程复盘');
    expect(content).toContain('中途补充过一次接口字段');
    expect(content).toContain('## 五、经验总结');
    expect(tasks.update).toHaveBeenCalledWith(1, { handoffCount: 1 });

    const posts = taskChat.postAssistantMessage.mock.calls as Array<
      [
        number,
        string,
        {
          messageId?: string;
          status?: string;
          meta?: {
            handoff?: { status?: string; version?: number; path?: string };
          };
        },
      ]
    >;
    expect(posts).toHaveLength(2);
    expect(posts[0][0]).toBe(1);
    expect(posts[0][1]).toContain('正在生成任务总结报告（v0）');
    expect(posts[0][2].messageId).toBe('chat:1:handoff:0');
    expect(posts[0][2].status).toBe('running');
    expect(posts[1][1]).toContain('已归档到知识库');
    expect(posts[1][2]).toMatchObject({
      messageId: 'chat:1:handoff:0',
      status: 'complete',
      meta: {
        handoff: {
          status: 'complete',
          version: 0,
          path: result.path,
        },
      },
    });
  });

  it('版本在任务内按已成功生成数量递增', async () => {
    tasks.findOne.mockResolvedValue(baseTask({ handoffCount: 3 }));

    const result = await service.generateNow(1);

    expect(result.version).toBe(3);
    expect(result.path).toMatch(/\/TK-0001\/3\.md$/);
    expect(tasks.update).toHaveBeenCalledWith(1, { handoffCount: 4 });
    const posts = taskChat.postAssistantMessage.mock.calls as Array<
      [
        number,
        string,
        { messageId?: string; meta?: { handoff?: { version?: number } } },
      ]
    >;
    const last = posts[posts.length - 1];
    expect(last[2].messageId).toBe('chat:1:handoff:3');
    expect(last[2].meta?.handoff?.version).toBe(3);
  });

  it('归档路径冲突时顺延版本，保证历史报告不被覆盖', async () => {
    knowledge.createArticleAtPath
      .mockRejectedValueOnce(new BadRequestException('路径 ... 已存在'))
      .mockResolvedValueOnce({ id: 'k2' });

    const result = await service.generateNow(1);

    expect(result.version).toBe(1);
    expect(result.path).toMatch(/\/TK-0001\/1\.md$/);
    expect(tasks.update).toHaveBeenCalledWith(1, { handoffCount: 2 });
  });

  it('未完成的任务不能生成总结', async () => {
    tasks.findOne.mockResolvedValue(
      baseTask({
        status: TaskStatus.WAITING,
        subStatus: TaskSubStatus.PENDING_ACCEPT,
      }),
    );
    await expect(service.generateNow(1)).rejects.toThrow('不可生成总结');
    expect(runPrompt).not.toHaveBeenCalled();
  });
});

describe('splitHandoffSummary', () => {
  it('按固定三节解析并去掉代码围栏', () => {
    const sections = splitHandoffSummary(`\`\`\`markdown\n${SUMMARY}\n\`\`\``);
    expect(sections.delivery).toContain('已完成活动页');
    expect(sections.process).toContain('补充过一次接口字段');
    expect(sections.lessons).toContain('先确认接口字段');
  });

  it('结构缺失时保留机器人原始输出且不编造', () => {
    const sections = splitHandoffSummary('机器人自由总结');
    expect(sections.delivery).toBe('机器人自由总结');
    expect(sections.process).toContain('未按约定结构');
    expect(sections.lessons).toContain('未按约定结构');
  });
});
