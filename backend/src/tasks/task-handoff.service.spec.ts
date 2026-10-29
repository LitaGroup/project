import type { Repository } from 'typeorm';
import { TaskStatus, TaskSubStatus } from '../common/enums';
import type { Executor } from '../executors/executor.entity';
import { runOpencodePrompt } from '../executors/opencode-run';
import type { Worker } from '../workers/worker.entity';
import type { WorkersService } from '../workers/workers.service';
import { Task } from './task.entity';
import type { TaskMessage } from './task-message.entity';
import type { TaskEvent } from './task-event.entity';
import type { TaskChatService } from './task-chat.service';
import type { TaskDocumentService } from './task-document.service';
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

const SUMMARY = `## 交付内容

已完成活动页；代码仓库 LitaGroup/activity，分支 test；文档 /project/8/document/9，交付测试通过。

## 实现问题与解决

接口字段缺失；补充 v2 字段后回归通过。

## 走过的弯路

中途补充过一次接口字段，未出现明确返工。

## 经验总结

先确认接口字段再开发页面。

## 遗留建议与后续待办

补充埋点，由前端机器人跟进。

## 其它需要保留的信息

无。`;

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
  let taskDocuments: {
    reviewPath: jest.Mock;
    upsertReview: jest.Mock;
    taskDefinitionOf: jest.Mock;
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
    taskDocuments = {
      reviewPath: jest.fn().mockReturnValue('/task/20261028/TK-0001/REVIEW'),
      taskDefinitionOf: jest.fn().mockResolvedValue({
        name: '前端任务定义',
        description: '负责 H5 页面开发与自测',
      }),
      upsertReview: jest.fn().mockResolvedValue({
        path: '/task/20261028/TK-0001/REVIEW',
        url: '/docs/detail/task/20261028/TK-0001/REVIEW',
        title: 'TK-0001 活动页开发 · 任务复盘',
      }),
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
      taskDocuments as unknown as TaskDocumentService,
      taskChat as unknown as TaskChatService,
    );
  });

  it('生成任务复盘，统计确认/补充/时长并写入 REVIEW', async () => {
    const result = await service.generateNow(1);

    expect(result.path).toBe('/task/20261028/TK-0001/REVIEW');
    expect(result.url).toContain('/docs/detail/task/20261028/TK-0001/');
    // 只读取当前任务自身记录，子任务由各自验收时独立复盘
    expect(events.find).toHaveBeenCalledWith({
      where: { taskId: 1 },
      order: { id: 'ASC' },
    });
    expect(messages.find).toHaveBeenCalledWith({
      where: { taskId: 1 },
      order: { id: 'ASC' },
    });
    expect(taskDocuments.upsertReview).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'TK-0001 活动页开发 · 任务复盘',
      }),
    );
    const created = taskDocuments.upsertReview.mock.calls[0] as [
      { content: string },
    ];
    const content = created[0].content;
    expect(content).toContain('## 0、任务与责任');
    expect(content).toContain('| 任务定义 | 前端任务定义 |');
    expect(content).toContain('负责 H5 页面开发与自测');
    expect(content).toContain('| 需求方 | 需求人 |');
    expect(content).toContain('## 1、需求说明');
    expect(content).toContain('开发一个活动页');
    expect(content).toContain('支持移动端');
    expect(content).toContain('## 2、交付内容');
    expect(content).toContain('活动页已上线测试环境');
    expect(content).toContain('LitaGroup/activity，分支 test');
    expect(content).toContain('## 3、实现问题与解决');
    expect(content).toContain('接口字段缺失');
    expect(content).toContain('## 4、弯路与经验复盘');
    expect(content).toContain('中途补充过一次接口字段');
    expect(content).toContain('## 5、遗留建议与后续待办');
    expect(content).toContain('补充埋点');
    expect(content).toContain('## 6、其它需要保留的信息');
    expect(content).toContain('## 附录：任务统计');
    expect(content).toContain('| 用户确认次数 | 1 次 |');
    expect(content).toContain('| 补充信息次数 | 2 次 |');
    expect(content).toContain('| 持续时长 | 3 小时 |');
    expect(content).toContain('· 任务复盘');
    expect(content).not.toContain('报告版本');

    const posts = taskChat.postAssistantMessage.mock.calls as Array<
      [
        number,
        string,
        {
          messageId?: string;
          status?: string;
          meta?: {
            review?: { status?: string; path?: string };
          };
        },
      ]
    >;
    expect(posts).toHaveLength(2);
    expect(posts[0][0]).toBe(1);
    expect(posts[0][1]).toContain('正在生成任务复盘文档');
    expect(posts[0][2].messageId).toBe('chat:1:review');
    expect(posts[0][2].status).toBe('running');
    expect(posts[1][1]).toContain('已归档到知识库');
    expect(posts[1][2]).toMatchObject({
      messageId: 'chat:1:review',
      status: 'complete',
      meta: {
        review: {
          status: 'complete',
          path: result.path,
        },
      },
    });
    expect(tasks.update).not.toHaveBeenCalled();
  });

  it('REVIEW 复用申请验收时提交的交付说明与需求方快照', async () => {
    events.find.mockResolvedValue([
      event(),
      event({
        id: 9,
        type: '状态变更',
        content: '申请验收',
        operator: '前端机器人',
        meta: {
          deliveryApply: true,
          handoffRequester: '张三',
          handoffReport: {
            delivery:
              '代码 LitaGroup/activity 分支 test；文档 /project/8/document/9',
            problems: '接口字段缺失，补充后回归通过',
            detours: '先使用旧接口，切换 v2',
            lessons: '开发前确认接口版本',
            followUps: '补充埋点',
            other: '无',
          },
        },
      }),
    ]);

    await service.generateNow(1);

    expect(runPrompt).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        prompt: expect.stringContaining(
          'LitaGroup/activity 分支 test',
        ) as unknown,
      }),
    );
    const created = taskDocuments.upsertReview.mock.calls[0] as [
      { content: string },
    ];
    expect(created[0].content).toContain('| 需求方 | 张三 |');
    expect(created[0].content).toContain('LitaGroup/activity，分支 test');
    expect(created[0].content).toContain('中途补充过一次接口字段');
  });

  it('重新生成复盘覆盖同一路径和同一条聊天消息', async () => {
    await service.generateNow(1);
    await service.generateNow(1);

    expect(taskDocuments.reviewPath).toHaveBeenCalledTimes(2);
    expect(taskDocuments.upsertReview).toHaveBeenCalledTimes(2);
    const posts = taskChat.postAssistantMessage.mock.calls as Array<
      [number, string, { messageId?: string }]
    >;
    expect(posts.at(-1)?.[2].messageId).toBe('chat:1:review');
    expect(posts.some((post) => post[1].includes('v0'))).toBe(false);
  });

  it('未完成的任务不能生成复盘', async () => {
    tasks.findOne.mockResolvedValue(
      baseTask({
        status: TaskStatus.WAITING,
        subStatus: TaskSubStatus.PENDING_ACCEPT,
      }),
    );
    await expect(service.generateNow(1)).rejects.toThrow('不可生成复盘');
    expect(runPrompt).not.toHaveBeenCalled();
  });
});

describe('splitHandoffSummary', () => {
  it('按固定六节解析并去掉代码围栏', () => {
    const sections = splitHandoffSummary(`\`\`\`markdown\n${SUMMARY}\n\`\`\``);
    expect(sections.delivery).toContain('已完成活动页');
    expect(sections.problems).toContain('接口字段缺失');
    expect(sections.detours).toContain('补充过一次接口字段');
    expect(sections.lessons).toContain('先确认接口字段');
    expect(sections.followUps).toContain('补充埋点');
    expect(sections.other).toContain('无');
  });

  it('结构缺失时保留机器人原始输出且不编造其它小节', () => {
    const sections = splitHandoffSummary('机器人自由总结');
    expect(sections.delivery).toBe('机器人自由总结');
    expect(sections.problems).toContain('未按约定结构');
    expect(sections.detours).toContain('未按约定结构');
    expect(sections.lessons).toContain('未按约定结构');
    expect(sections.followUps).toContain('未按约定结构');
  });
});
