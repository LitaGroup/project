import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { UserRole } from '../../common/enums';
import { WorkIdeaTools } from './work-idea.tools';

type Handler = (args: Record<string, unknown>) => Promise<unknown>;

function buildTools(): {
  tools: Map<string, Handler>;
  ideas: {
    create: jest.Mock;
    remove: jest.Mock;
  };
} {
  const ideas = {
    listMarkdown: jest.fn().mockResolvedValue('# 灵感列表'),
    findOneMarkdown: jest.fn().mockResolvedValue('# 灵感详情'),
    create: jest.fn().mockResolvedValue({ id: 12 }),
    update: jest.fn().mockResolvedValue({ id: 12 }),
    remove: jest.fn().mockResolvedValue(undefined),
    changeStatus: jest.fn().mockResolvedValue({ id: 12 }),
  };
  const tools = new Map<string, Handler>();
  const server = {
    registerTool: (name: string, _meta: unknown, handler: Handler) => {
      tools.set(name, handler);
    },
  } as unknown as McpServer;
  new WorkIdeaTools(ideas as never).register(server, {
    user: { id: 1, name: '张三', role: UserRole.MEMBER },
  } as never);
  return { tools, ideas };
}

describe('WorkIdeaTools', () => {
  it('create_idea 支持省略标题', async () => {
    const { tools, ideas } = buildTools();
    const result = (await tools.get('create_idea')!({
      content: '做一个灵感墙',
    })) as { content: { text: string }[] };
    expect(ideas.create).toHaveBeenCalledWith(
      { content: '做一个灵感墙' },
      expect.objectContaining({
        userId: 1,
        userName: '张三',
        isAdmin: false,
      }),
    );
    expect(result.content[0].text).toBe('# 灵感详情');
  });

  it('delete_idea 调用删除并返回 Markdown', async () => {
    const { tools, ideas } = buildTools();
    const result = (await tools.get('delete_idea')!({ ideaId: 12 })) as {
      content: { text: string }[];
    };
    expect(ideas.remove).toHaveBeenCalledWith(
      12,
      expect.objectContaining({
        userId: 1,
        userName: '张三',
        isAdmin: false,
      }),
    );
    expect(result.content[0].text).toContain('灵感已删除');
  });
});
