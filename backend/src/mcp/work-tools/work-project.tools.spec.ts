import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { MilestoneAchieved } from '../../common/enums';
import { WorkProjectTools } from './work-project.tools';

/** 收集 registerTool 注册的 handler，供用例直接调用 */
type Handler = (args: Record<string, unknown>) => Promise<unknown>;

function fakeServer(): { server: McpServer; tools: Map<string, Handler> } {
  const tools = new Map<string, Handler>();
  const server = {
    registerTool: (name: string, _meta: unknown, handler: Handler) => {
      tools.set(name, handler);
    },
  } as unknown as McpServer;
  return { server, tools };
}

function buildTools(): {
  tools: Map<string, Handler>;
  projects: {
    searchMarkdown: jest.Mock;
    findOneMarkdown: jest.Mock;
    updateMarkdown: jest.Mock;
  };
  milestones: { create: jest.Mock; update: jest.Mock; remove: jest.Mock };
} {
  const projects = {
    searchMarkdown: jest.fn().mockResolvedValue('# 搜索结果'),
    findOneMarkdown: jest.fn().mockResolvedValue('# 项目详情'),
    updateMarkdown: jest.fn().mockResolvedValue('# 已更新'),
  };
  const documents = {
    findOneMarkdown: jest.fn().mockResolvedValue('# 文档'),
    upsertMarkdown: jest.fn().mockResolvedValue('# 已写入'),
    syncFromApipost: jest.fn().mockResolvedValue({ id: 1 }),
  };
  const resources = {
    findByProject: jest.fn().mockResolvedValue([]),
    findOneMarkdown: jest.fn().mockResolvedValue('# 资源'),
    sync: jest.fn().mockResolvedValue({ id: 2 }),
  };
  const milestones = {
    findByProject: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue({ id: 3 }),
    update: jest.fn().mockResolvedValue({ id: 3 }),
    remove: jest.fn().mockResolvedValue(undefined),
  };
  const registrar = new WorkProjectTools(
    projects as never,
    documents as never,
    resources as never,
    milestones as never,
  );
  const { server, tools } = fakeServer();
  registrar.register(server, { user: { id: 1, name: '张三' } as never });
  return { tools, projects, milestones };
}

describe('WorkProjectTools', () => {
  it('注册项目/文档/资源/节点工具', () => {
    const { tools } = buildTools();
    expect([...tools.keys()]).toEqual(
      expect.arrayContaining([
        'search_projects',
        'get_project',
        'update_project',
        'read_document',
        'upsert_document',
        'sync_apipost_document',
        'list_resources',
        'read_resource',
        'sync_resource',
        'list_milestones',
        'create_milestone',
        'update_milestone',
        'delete_milestone',
      ]),
    );
  });

  it('search_projects 返回 service 的 Markdown 正文', async () => {
    const { tools, projects } = buildTools();
    const result = (await tools.get('search_projects')!({ query: 'pk' })) as {
      content: { text: string }[];
      isError?: boolean;
    };
    expect(projects.searchMarkdown).toHaveBeenCalledWith('pk');
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toBe('# 搜索结果');
  });

  it('update_milestone 透传达成标记与字段', async () => {
    const { tools, milestones } = buildTools();
    await tools.get('update_milestone')!({
      milestoneId: 3,
      achieved: MilestoneAchieved.YES,
      remark: '已验收',
    });
    expect(milestones.update).toHaveBeenCalledWith(3, {
      date: undefined,
      content: undefined,
      remark: '已验收',
      deliverer: undefined,
      acceptor: undefined,
      achieved: MilestoneAchieved.YES,
    });
  });

  it('工具失败返回 isError 与原始错误信息', async () => {
    const { tools, projects } = buildTools();
    projects.searchMarkdown.mockRejectedValueOnce(new Error('数据库不可用'));
    const result = (await tools.get('search_projects')!({ query: 'pk' })) as {
      content: { text: string }[];
      isError?: boolean;
    };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('数据库不可用');
  });
});
