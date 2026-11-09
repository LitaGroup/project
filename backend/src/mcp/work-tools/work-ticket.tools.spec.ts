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
  };
  const ticketDocuments = {
    listMarkdown: jest.fn().mockResolvedValue('# 文档清单'),
    readMarkdown: jest.fn().mockResolvedValue('# 文档正文'),
    createMarkdown: jest.fn().mockResolvedValue('# 已交付'),
    updateMarkdown: jest.fn().mockResolvedValue('# 已更新'),
    deleteMarkdown: jest.fn().mockResolvedValue('# 已删除'),
  };
  const tools = new Map<string, Handler>();
  const server = {
    registerTool: (name: string, _meta: unknown, handler: Handler) => {
      tools.set(name, handler);
    },
  } as unknown as McpServer;
  new WorkTicketTools(tickets as never, ticketDocuments as never).register(
    server,
    principal === 'worker'
      ? { worker: { id: 1001, name: '执行机器人' } as never }
      : { user: { id: 1, name: '张三' } as never },
  );
  return { tools, tickets, ticketDocuments };
}

describe('WorkTicketTools', () => {
  it('注册工单与工单文档工具', () => {
    const { tools } = buildTools();
    expect([...tools.keys()]).toEqual(
      expect.arrayContaining([
        'get_task_ticket',
        'route_task_ticket',
        'get_ticket',
        'reject_ticket_node',
        'list_ticket_documents',
        'read_ticket_document',
        'deliver_ticket_document',
        'update_ticket_document',
        'delete_ticket_document',
      ]),
    );
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

  it('用户令牌交付工单文档时返回 isError', async () => {
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
