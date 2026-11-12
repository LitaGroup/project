import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WorkTicketTools } from './work-ticket.tools';

type Handler = (args: Record<string, unknown>) => Promise<unknown>;
type ToolResult = { content: { text: string }[]; isError?: boolean };

function buildTools(principal: 'user' | 'worker' = 'worker') {
  const tickets = {
    taskTicketMarkdown: jest.fn().mockResolvedValue('# 工单上下文'),
    routeMarkdown: jest.fn().mockResolvedValue('# 已转交'),
    ticketMarkdown: jest.fn().mockResolvedValue('# 工单详情'),
    rejectMarkdown: jest.fn().mockResolvedValue('# 节点已拒绝'),
    create: jest.fn().mockResolvedValue({ id: 12 }),
    acceptWorkflow: jest.fn().mockResolvedValue({ id: 12 }),
  };
  const ticketDocuments = {
    listMarkdown: jest.fn().mockResolvedValue('# 文档清单'),
    readMarkdown: jest.fn().mockResolvedValue('# 文档正文'),
    createMarkdown: jest.fn().mockResolvedValue('# 已交付'),
    updateMarkdown: jest.fn().mockResolvedValue('# 已更新'),
    deleteMarkdown: jest.fn().mockResolvedValue('# 已删除'),
  };
  const workflows = {
    findAll: jest.fn().mockResolvedValue([
      {
        id: 5,
        name: '发布申请',
        category: '发布',
        description: '版本发布审批',
        enabled: true,
        latestPublishedVersion: 2,
      },
      {
        id: 6,
        name: '未发布配置',
        category: '其它',
        description: null,
        enabled: true,
        latestPublishedVersion: 0,
      },
      {
        id: 7,
        name: '停用配置',
        category: '其它',
        description: null,
        enabled: false,
        latestPublishedVersion: 1,
      },
    ]),
    findOne: jest.fn().mockResolvedValue({
      id: 5,
      name: '发布申请',
      category: '发布',
      description: '版本发布审批',
      enabled: true,
      latestPublishedVersion: 2,
      published: {
        version: 2,
        definition: {
          startNode: 'start',
          nodes: [
            {
              key: 'start',
              name: '发起工单',
              kind: 'start',
              inputFields: [
                {
                  key: 'title',
                  label: '发布标题',
                  type: 'text',
                  required: true,
                },
                {
                  key: 'level',
                  label: '级别',
                  type: 'select',
                  required: false,
                  options: ['紧急', '普通'],
                },
              ],
            },
          ],
          edges: [],
        },
      },
    }),
  };
  const tools = new Map<string, Handler>();
  const server = {
    registerTool: (name: string, _meta: unknown, handler: Handler) => {
      tools.set(name, handler);
    },
  } as unknown as McpServer;
  new WorkTicketTools(
    tickets as never,
    ticketDocuments as never,
    workflows as never,
  ).register(
    server,
    principal === 'worker'
      ? { worker: { id: 1001, name: '执行机器人' } as never }
      : { user: { id: 1, name: '张三' } as never },
  );
  return { tools, tickets, ticketDocuments, workflows };
}

describe('WorkTicketTools', () => {
  it('注册工单与工单文档工具', () => {
    const { tools } = buildTools();
    expect([...tools.keys()]).toEqual(
      expect.arrayContaining([
        'list_ticket_defines',
        'create_ticket',
        'get_task_ticket',
        'route_task_ticket',
        'get_ticket',
        'accept_ticket',
        'reject_ticket_node',
        'list_ticket_documents',
        'read_ticket_document',
        'deliver_ticket_document',
        'update_ticket_document',
        'delete_ticket_document',
      ]),
    );
  });

  it('工单配置清单只列启用且已发布的配置并带输入字段', async () => {
    const { tools, workflows } = buildTools();
    const result = (await tools.get('list_ticket_defines')!({})) as ToolResult;
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain(
      '发布申请（workflowDefinitionId=5）',
    );
    expect(result.content[0].text).toContain(
      '| title | 发布标题 | text | 是 |',
    );
    expect(result.content[0].text).toContain('紧急 / 普通');
    expect(result.content[0].text).not.toContain('未发布配置');
    expect(result.content[0].text).not.toContain('停用配置');
    expect(workflows.findOne).toHaveBeenCalledTimes(1);
    expect(workflows.findOne).toHaveBeenCalledWith(5);
  });

  it('AI 机器人创建工单以自身身份发起', async () => {
    const { tools, tickets } = buildTools('worker');
    const result = (await tools.get('create_ticket')!({
      workflowDefinitionId: 5,
      title: '发布 v1.2.0',
      inputValues: { title: '发布 v1.2.0', level: '紧急' },
    })) as ToolResult;
    expect(tickets.create).toHaveBeenCalledWith(
      {
        workflowDefinitionId: 5,
        title: '发布 v1.2.0',
        inputValues: { title: '发布 v1.2.0', level: '紧急' },
      },
      { user: null, worker: { id: 1001, name: '执行机器人' } },
    );
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toBe('# 工单详情');
  });

  it('用户身份创建工单使用真人身份', async () => {
    const { tools, tickets } = buildTools('user');
    await tools.get('create_ticket')!({
      workflowDefinitionId: 5,
      inputValues: { title: '发布 v1.2.0' },
    });
    expect(tickets.create).toHaveBeenCalledWith(
      {
        workflowDefinitionId: 5,
        title: undefined,
        inputValues: { title: '发布 v1.2.0' },
      },
      { user: { id: 1, name: '张三' }, worker: null },
    );
  });

  it('创建失败转为 isError', async () => {
    const { tools, tickets } = buildTools('worker');
    tickets.create.mockRejectedValue(new Error('「发布标题」不能为空'));
    const result = (await tools.get('create_ticket')!({
      workflowDefinitionId: 5,
      inputValues: {},
    })) as ToolResult;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('不能为空');
  });

  it('验收工单使用当前身份并返回工单详情', async () => {
    const { tools, tickets } = buildTools('worker');
    const result = (await tools.get('accept_ticket')!({
      ticketId: 12,
      outcome: 'approved',
      remark: '验收通过',
    })) as ToolResult;
    expect(tickets.acceptWorkflow).toHaveBeenCalledWith(
      12,
      'approved',
      { worker: { id: 1001, name: '执行机器人' }, user: undefined },
      '验收通过',
    );
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toBe('# 工单详情');
  });

  it('交付工单文档使用当前机器人身份', async () => {
    const { tools, ticketDocuments } = buildTools('worker');
    const result = (await tools.get('deliver_ticket_document')!({
      taskId: 7,
      title: '接口文档',
      url: '/api/docs/detail/task/20261109/TK-0007/API.md',
    })) as ToolResult;
    expect(ticketDocuments.createMarkdown).toHaveBeenCalledWith(
      7,
      { id: 1001, name: '执行机器人' },
      {
        title: '接口文档',
        url: '/api/docs/detail/task/20261109/TK-0007/API.md',
      },
    );
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toBe('# 已交付');
  });

  it('公共 Agent 用户身份交付工单文档时返回 isError', async () => {
    const { tools, ticketDocuments } = buildTools('user');
    const result = (await tools.get('deliver_ticket_document')!({
      taskId: 7,
      title: '接口文档',
      content: '# API',
    })) as ToolResult;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('仅接受机器人身份');
    expect(ticketDocuments.createMarkdown).not.toHaveBeenCalled();
  });
});
