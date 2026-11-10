import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WorkTaskTools } from './work-task.tools';

type Handler = (args: Record<string, unknown>) => Promise<unknown>;
type ToolResult = { content: { text: string }[]; isError?: boolean };

function buildTools(principal: 'user' | 'worker' = 'user') {
  const tasksAgent = {
    resolveScope: jest.fn().mockResolvedValue({
      label: '张三',
      userIds: [1],
      workerIds: [],
      responsibleWorkerIds: [],
      canReadVisibleTasks: true,
    }),
    listMarkdown: jest.fn().mockResolvedValue('# 我的任务'),
    detailMarkdown: jest.fn().mockResolvedValue('# 任务详情'),
    createMarkdown: jest.fn().mockResolvedValue('# 任务已创建'),
  };
  const tasks = {
    mustFind: jest.fn().mockResolvedValue({ id: 7, code: 'TK-0007' }),
  };
  const collaboration = {
    definesMarkdown: jest.fn().mockResolvedValue('# 任务定义'),
    createSubtask: jest.fn().mockResolvedValue({ id: 8 }),
    accept: jest.fn().mockResolvedValue({ id: 7 }),
    refuse: jest.fn().mockResolvedValue({ id: 7 }),
    ask: jest.fn().mockResolvedValue({ task: { id: 7 }, questionId: 'q-1' }),
    answer: jest.fn().mockResolvedValue({ id: 7 }),
    replyMessage: jest.fn().mockResolvedValue({ id: 7 }),
    acceptHandoff: jest.fn().mockResolvedValue({ id: 7 }),
    refuseHandoff: jest.fn().mockResolvedValue({ id: 7 }),
    fail: jest.fn().mockResolvedValue({ id: 7, failureReason: '不达标' }),
    actionMarkdown: jest.fn().mockReturnValue('# 操作完成'),
  };
  const delivery = {
    getHandoffMarkdown: jest.fn().mockResolvedValue('# 交付文档'),
    updateHandoffByWorker: jest.fn().mockResolvedValue(undefined),
    apply: jest.fn().mockResolvedValue('# 验收申请已提交'),
  };
  const taskDocuments = {
    listTaskDocuments: jest.fn().mockResolvedValue([]),
    taskDocumentsMarkdown: jest.fn().mockReturnValue('# 任务文档'),
    upsertTaskDocument: jest.fn().mockResolvedValue({
      name: 'API.md',
      path: '/task/x/API',
      markdownUrl: '/x/API.md',
    }),
    taskDirectory: jest.fn().mockReturnValue('/task/20261109/TK-0007'),
  };
  const taskActors = {
    resolveRequesterActor: jest
      .fn()
      .mockResolvedValue({ type: 'user', user: { id: 1, name: '张三' } }),
    resolveDocumentAuthor: jest.fn().mockResolvedValue('张三'),
  };
  const tools = new Map<string, Handler>();
  const server = {
    registerTool: (name: string, _meta: unknown, handler: Handler) => {
      tools.set(name, handler);
    },
  } as unknown as McpServer;
  new WorkTaskTools(
    tasksAgent as never,
    tasks as never,
    collaboration as never,
    delivery as never,
    taskDocuments as never,
    taskActors as never,
  ).register(
    server,
    principal === 'worker'
      ? { worker: { id: 1001, name: '执行机器人' } as never }
      : { user: { id: 1, name: '张三' } as never },
  );
  return {
    tools,
    tasksAgent,
    collaboration,
    delivery,
    taskDocuments,
    taskActors,
  };
}

describe('WorkTaskTools', () => {
  it('注册任务协同工具', () => {
    const { tools } = buildTools();
    expect([...tools.keys()]).toEqual(
      expect.arrayContaining([
        'list_my_tasks',
        'get_task',
        'create_task',
        'list_task_defines',
        'create_subtask',
        'accept_task',
        'refuse_task',
        'ask_task_question',
        'answer_task_question',
        'reply_task_message',
        'list_task_documents',
        'upsert_task_document',
        'read_task_handoff',
        'update_task_handoff',
        'apply_task_acceptance',
        'accept_task_handoff',
        'refuse_task_handoff',
        'fail_task',
      ]),
    );
  });

  it('公共 Agent 用户身份执行机器人动作时返回 isError', async () => {
    const { tools } = buildTools('user');
    const result = (await tools.get('accept_task')!({
      taskId: 7,
    })) as ToolResult;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('仅接受机器人身份');
  });

  it('机器人接受任务并返回动作 Markdown', async () => {
    const { tools, collaboration } = buildTools('worker');
    const result = (await tools.get('accept_task')!({
      taskId: 7,
    })) as ToolResult;
    expect(collaboration.accept).toHaveBeenCalledWith(7, {
      id: 1001,
      name: '执行机器人',
    });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toBe('# 操作完成');
  });

  it('答复提问使用需求方身份解析', async () => {
    const { tools, taskActors, collaboration } = buildTools('user');
    await tools.get('answer_task_question')!({
      taskId: 7,
      questionId: 'q-1',
      answers: [['A']],
    });
    const actorCall = taskActors.resolveRequesterActor.mock.calls[0] as [
      { user?: { id: number } },
      number,
    ];
    expect(actorCall[1]).toBe(7);
    expect(actorCall[0].user?.id).toBe(1);
    expect(collaboration.answer).toHaveBeenCalledWith(
      7,
      'q-1',
      expect.anything(),
      {
        answers: [['A']],
        reject: false,
      },
    );
  });

  it('任务文档写入校验作者并返回阅读地址', async () => {
    const { tools, taskActors, taskDocuments } = buildTools('worker');
    const result = (await tools.get('upsert_task_document')!({
      taskId: 7,
      name: 'API.md',
      content: '# API',
    })) as ToolResult;
    expect(taskActors.resolveDocumentAuthor).toHaveBeenCalled();
    expect(taskDocuments.upsertTaskDocument).toHaveBeenCalledWith(
      expect.objectContaining({ id: 7 }),
      expect.objectContaining({ name: 'API.md', updatedBy: '张三' }),
    );
    expect(result.content[0].text).toContain('/x/API.md');
  });
});
