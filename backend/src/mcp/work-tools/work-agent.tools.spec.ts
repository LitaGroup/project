import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WorkAgentTools } from './work-agent.tools';

type Handler = (args: Record<string, unknown>) => Promise<unknown>;
type ToolResult = { content: { text: string }[]; isError?: boolean };

function buildTools() {
  const workers = {
    listMarkdown: jest.fn().mockResolvedValue('# 机器人清单'),
    findOneMarkdown: jest.fn().mockResolvedValue('# 机器人详情'),
    createMarkdown: jest.fn().mockResolvedValue('# 机器人已创建'),
    updateMarkdown: jest.fn().mockResolvedValue('# 机器人已更新'),
    removeMarkdown: jest.fn().mockResolvedValue('# 机器人已删除'),
  };
  const skills = {
    search: jest.fn().mockResolvedValue([{ name: 'lita-api' }]),
  };
  const standards = { search: jest.fn().mockResolvedValue([]) };
  const templates = {
    listMarkdown: jest.fn().mockResolvedValue('# 任务定义清单'),
    findOneMarkdown: jest.fn().mockResolvedValue('# 任务定义详情'),
    createMarkdown: jest.fn().mockResolvedValue('# 任务定义已创建'),
    updateMarkdown: jest.fn().mockResolvedValue('# 任务定义已更新'),
    removeMarkdown: jest.fn().mockResolvedValue('# 任务定义已删除'),
  };
  const tools = new Map<string, Handler>();
  const server = {
    registerTool: (name: string, _meta: unknown, handler: Handler) => {
      tools.set(name, handler);
    },
  } as unknown as McpServer;
  new WorkAgentTools(
    workers as never,
    skills as never,
    standards as never,
    templates as never,
  ).register(server, { user: { id: 1, name: '张三' } as never });
  return { tools, workers, skills, standards, templates };
}

describe('WorkAgentTools', () => {
  it('注册机器人与任务定义工具', () => {
    const { tools } = buildTools();
    expect([...tools.keys()]).toEqual(
      expect.arrayContaining([
        'list_workers',
        'get_worker',
        'create_worker',
        'update_worker',
        'delete_worker',
        'list_worker_skill_catalog',
        'list_worker_standard_catalog',
        'list_task_templates',
        'get_task_template',
        'create_task_template',
        'update_task_template',
        'delete_task_template',
      ]),
    );
  });

  it('创建机器人透传配置并返回 Markdown', async () => {
    const { tools, workers } = buildTools();
    const result = (await tools.get('create_worker')!({
      name: '活动开发机器人',
      executorId: 1,
      providerId: 'openai',
      modelId: 'gpt-5',
      mcps: [3],
      enabled: true,
    })) as ToolResult;
    expect(workers.createMarkdown).toHaveBeenCalledWith(
      expect.objectContaining({
        name: '活动开发机器人',
        executorId: 1,
        providerId: 'openai',
        modelId: 'gpt-5',
        mcps: [3],
        enabled: true,
      }),
    );
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toBe('# 机器人已创建');
  });

  it('技能库目录返回 JSON', async () => {
    const { tools, skills } = buildTools();
    const result = (await tools.get('list_worker_skill_catalog')!({
      q: 'lita',
    })) as ToolResult;
    expect(skills.search).toHaveBeenCalledWith('lita');
    expect(JSON.parse(result.content[0].text)).toEqual([{ name: 'lita-api' }]);
  });

  it('创建任务定义记录用户身份', async () => {
    const { tools, templates } = buildTools();
    await tools.get('create_task_template')!({
      name: '活动前端开发',
      agentIds: [1001],
    });
    expect(templates.createMarkdown).toHaveBeenCalledWith(
      { name: '活动前端开发', agentIds: [1001] },
      { id: 1, name: '张三' },
    );
  });
});
