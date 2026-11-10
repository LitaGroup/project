import { BadRequestException } from '@nestjs/common';
import { McpAuthMode, McpServerType } from '../common/enums';
import { McpServer } from './mcp-server.entity';
import {
  buildOpencodeServerConfig,
  McpServersService,
} from './mcp-servers.service';

/** 内存版 MCP 配置仓库：支撑列表/详情/保存/删除的最小查询面 */
function makeServerRepo(initial: McpServer[] = []) {
  const store = [...initial];
  let nextId = 10;
  const repo = {
    createQueryBuilder: jest.fn(() => {
      let rows = [...store];
      const builder: Record<string, unknown> = {
        addSelect: () => builder,
        orderBy: () => builder,
        where: (_condition: string, params: { id: number }) => {
          rows = rows.filter((row) => row.id === Number(params.id));
          return builder;
        },
        getMany: () => Promise.resolve(rows),
        getOne: () => Promise.resolve(rows[0] ?? null),
      };
      return builder;
    }),
    find: jest.fn(
      (options?: {
        where?: { id?: { value?: number[] } };
        select?: Record<string, boolean>;
      }) => {
        const ids = options?.where?.id?.value;
        const rows = ids ? store.filter((row) => ids.includes(row.id)) : store;
        return Promise.resolve(rows);
      },
    ),
    findOne: jest.fn((options: { where: { name?: string } }) => {
      const name = options?.where?.name;
      return Promise.resolve(
        name ? (store.find((row) => row.name === name) ?? null) : null,
      );
    }),
    save: jest.fn((row: McpServer) => {
      if (!row.id) {
        row.id = nextId++;
        store.push(row);
      }
      return Promise.resolve(row);
    }),
    remove: jest.fn((row: McpServer) => {
      const index = store.indexOf(row);
      if (index >= 0) store.splice(index, 1);
      return Promise.resolve(row);
    }),
  };
  return { repo, store };
}

function makeWorkerRepo(initial: Worker[] = []) {
  const store = [...initial];
  const repo = {
    find: jest.fn(() => Promise.resolve(store)),
    save: jest.fn((worker: Worker) => Promise.resolve(worker)),
  };
  return { repo, store };
}

/** 仅测试用到的 Worker 字段 */
interface Worker {
  id: number;
  mcps: number[] | null;
}

function server(overrides: Partial<McpServer>): McpServer {
  return Object.assign(new McpServer(), {
    id: 1,
    name: 'demo',
    type: McpServerType.REMOTE,
    url: 'https://mcp.example.com/mcp',
    command: null,
    authMode: McpAuthMode.NONE,
    authHeader: 'Authorization',
    authPrefix: null,
    authSecret: null,
    enabled: true,
    remark: null,
    ...overrides,
  });
}

describe('buildOpencodeServerConfig', () => {
  it('remote 无鉴权：只保留地址并关闭 OAuth', () => {
    expect(
      buildOpencodeServerConfig(
        server({ type: McpServerType.REMOTE }),
        'worker-token',
      ),
    ).toEqual({
      type: 'remote',
      url: 'https://mcp.example.com/mcp',
      oauth: false,
    });
  });

  it('remote 固定令牌：写入请求头并拼接前缀', () => {
    expect(
      buildOpencodeServerConfig(
        server({
          authMode: McpAuthMode.FIXED,
          authPrefix: 'Bearer',
          authSecret: 'secret-1',
        }),
        'worker-token',
      ),
    ).toEqual({
      type: 'remote',
      url: 'https://mcp.example.com/mcp',
      oauth: false,
      headers: { Authorization: 'Bearer secret-1' },
    });
  });

  it('remote 环境变量：生成 {env:NAME} 占位符，凭据不落盘', () => {
    expect(
      buildOpencodeServerConfig(
        server({
          authMode: McpAuthMode.ENV,
          authSecret: 'MY_MCP_TOKEN',
        }),
        'worker-token',
      ),
    ).toEqual({
      type: 'remote',
      url: 'https://mcp.example.com/mcp',
      oauth: false,
      headers: { Authorization: '{env:MY_MCP_TOKEN}' },
    });
  });

  it('remote LITA_WORK_TOKEN：注入当前机器人令牌', () => {
    expect(
      buildOpencodeServerConfig(
        server({
          authMode: McpAuthMode.WORK_TOKEN,
          authPrefix: 'Bearer',
        }),
        'worker-token',
      ),
    ).toEqual({
      type: 'remote',
      url: 'https://mcp.example.com/mcp',
      oauth: false,
      headers: { Authorization: 'Bearer worker-token' },
    });
  });

  it('local：命令与环境变量鉴权', () => {
    expect(
      buildOpencodeServerConfig(
        server({
          type: McpServerType.LOCAL,
          url: null,
          command: ['npx', '-y', 'mcp-remote', 'https://example.com/sse'],
          authMode: McpAuthMode.ENV,
          authHeader: 'MCP_API_KEY',
          authSecret: 'MCP_API_KEY',
        }),
        'worker-token',
      ),
    ).toEqual({
      type: 'local',
      command: ['npx', '-y', 'mcp-remote', 'https://example.com/sse'],
      environment: { MCP_API_KEY: '{env:MCP_API_KEY}' },
    });
  });
});

describe('McpServersService', () => {
  it('listOptions 只返回公开字段并保留停用项', async () => {
    const { repo } = makeServerRepo([
      server({
        id: 2,
        name: 'proxy',
        remark: '资源网关',
        authMode: McpAuthMode.FIXED,
        authSecret: 'secret-1',
      }),
      server({ id: 3, name: 'off', enabled: false }),
    ]);
    const { repo: workers } = makeWorkerRepo();
    const service = new McpServersService(repo as never, workers as never);
    const options = await service.listOptions();
    expect(options).toEqual([
      {
        id: 2,
        name: 'proxy',
        type: McpServerType.REMOTE,
        enabled: true,
        remark: '资源网关',
      },
      {
        id: 3,
        name: 'off',
        type: McpServerType.REMOTE,
        enabled: false,
        remark: null,
      },
    ]);
    expect(JSON.stringify(options)).not.toContain('secret-1');
  });

  it('normalizeWorkerIds 去重并拒绝不存在的 id', async () => {
    const { repo } = makeServerRepo([server({ id: 3 })]);
    const { repo: workers } = makeWorkerRepo();
    const service = new McpServersService(repo as never, workers as never);
    await expect(service.normalizeWorkerIds([3, 3, '3'])).resolves.toEqual([3]);
    await expect(service.normalizeWorkerIds([3, 9])).rejects.toThrow(
      BadRequestException,
    );
  });

  it('固定令牌模式缺少令牌时拒绝保存', async () => {
    const { repo } = makeServerRepo();
    const { repo: workers } = makeWorkerRepo();
    const service = new McpServersService(repo as never, workers as never);
    await expect(
      service.create({
        name: 'demo',
        type: 'remote',
        url: 'https://mcp.example.com/mcp',
        authMode: 'fixed',
      }),
    ).rejects.toThrow('固定令牌模式必须填写令牌');
  });

  it('创建成功后视图不回显固定令牌原文', async () => {
    const { repo } = makeServerRepo();
    const { repo: workers } = makeWorkerRepo();
    const service = new McpServersService(repo as never, workers as never);
    const view = await service.create({
      name: 'demo',
      type: 'remote',
      url: 'https://mcp.example.com/mcp',
      authMode: 'fixed',
      authPrefix: 'Bearer',
      authSecret: 'secret-1',
    });
    expect(view.hasSecret).toBe(true);
    expect(view).not.toHaveProperty('authSecret');
    expect(JSON.stringify(view)).not.toContain('secret-1');
  });

  it('编辑时令牌留空保持原值；切换鉴权方式必须重新填写', async () => {
    const existing = server({
      id: 1,
      authMode: McpAuthMode.FIXED,
      authSecret: 'old-token',
    });
    const { repo } = makeServerRepo([existing]);
    const { repo: workers } = makeWorkerRepo();
    const service = new McpServersService(repo as never, workers as never);
    const view = await service.update(1, { authMode: 'fixed', authSecret: '' });
    expect(view.hasSecret).toBe(true);
    expect(existing.authSecret).toBe('old-token');

    await expect(service.update(1, { authMode: 'env' })).rejects.toThrow(
      '环境变量模式必须填写变量名',
    );
  });

  it('删除配置时清理机器人选择中的引用', async () => {
    const { repo } = makeServerRepo([server({ id: 3 })]);
    const workers = makeWorkerRepo([
      { id: 1001, mcps: [3, 5] },
      { id: 1002, mcps: null },
    ]);
    const service = new McpServersService(repo as never, workers.repo as never);
    await service.remove(3);
    expect(workers.repo.save).toHaveBeenCalledTimes(1);
    expect(workers.repo.save.mock.calls[0][0].mcps).toEqual([5]);
  });
});
