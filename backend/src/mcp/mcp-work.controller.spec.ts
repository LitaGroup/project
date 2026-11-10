import { UnauthorizedException } from '@nestjs/common';
import { McpWorkController } from './mcp-work.controller';

/** 构造被测 controller（mcp / auth / workers 全部 mock） */
function buildController(): {
  controller: McpWorkController;
  mcp: { handleRequest: jest.Mock };
  auth: {
    getPublicAgentByToken: jest.Mock;
    getUserById: jest.Mock;
  };
  workers: { findByAgentToken: jest.Mock };
} {
  const mcp = { handleRequest: jest.fn() };
  const auth = {
    getPublicAgentByToken: jest.fn(),
    getUserById: jest.fn(),
  };
  const workers = { findByAgentToken: jest.fn() };
  const controller = new McpWorkController(
    mcp as never,
    auth as never,
    workers as never,
  );
  return { controller, mcp, auth, workers };
}

/** 构造 express 风格请求（authenticate 只读 headers 与 originalUrl） */
function reqOf(options: {
  authorization?: string;
  agentToken?: string;
  workerToken?: string;
  url?: string;
}): never {
  const headers: Record<string, string> = {};
  if (options.authorization) headers.authorization = options.authorization;
  if (options.agentToken) headers['x-agent-token'] = options.agentToken;
  if (options.workerToken) headers['x-worker-token'] = options.workerToken;
  return { headers, originalUrl: options.url ?? '/api/mcp/work' } as never;
}

describe('McpWorkController.authenticate（经 handlePost 验证）', () => {
  const user = { id: 3, name: '张三' };
  const humanWorker = {
    id: 7,
    name: '张三',
    humanUserId: 3,
  };
  const aiWorker = {
    id: 8,
    name: '测试机器人',
    humanUserId: null,
  };

  function mockValid(
    auth: {
      getPublicAgentByToken: jest.Mock;
      getUserById: jest.Mock;
    },
    workers: { findByAgentToken: jest.Mock },
  ): void {
    auth.getPublicAgentByToken.mockReturnValue(null);
    auth.getUserById.mockResolvedValue(user);
    workers.findByAgentToken.mockImplementation((token: string) => {
      if (token === 'human-worker-token') return humanWorker;
      if (token === 'worker-token') return aiWorker;
      return null;
    });
  }

  async function post(
    controller: McpWorkController,
    req: never,
  ): Promise<void> {
    await controller.handlePost(req, { on: jest.fn() } as never, {});
  }

  function principalOf(mcp: { handleRequest: jest.Mock }): unknown {
    const calls = mcp.handleRequest.mock.calls as unknown[][];
    return calls[0]?.[0];
  }

  it('X-Worker-Token 真人机器人令牌同时挂载 worker 与 user', async () => {
    const { controller, mcp, auth, workers } = buildController();
    mockValid(auth, workers);
    await post(
      controller,
      reqOf({
        workerToken: 'human-worker-token',
        authorization: 'Bearer ignored',
      }),
    );
    expect(workers.findByAgentToken).toHaveBeenCalledWith('human-worker-token');
    expect(auth.getPublicAgentByToken).not.toHaveBeenCalled();
    expect(principalOf(mcp)).toEqual({ worker: humanWorker, user });
  });

  it('X-Worker-Token AI 机器人只挂载 worker', async () => {
    const { controller, mcp, auth, workers } = buildController();
    mockValid(auth, workers);
    await post(controller, reqOf({ workerToken: 'worker-token' }));
    expect(auth.getUserById).not.toHaveBeenCalled();
    expect(principalOf(mcp)).toEqual({ worker: aiWorker });
  });

  it('Authorization: Bearer 公共 Agent 令牌', async () => {
    const { controller, mcp, auth, workers } = buildController();
    const publicAgent = { id: 0, name: '公共 Agent' };
    auth.getPublicAgentByToken.mockReturnValue(publicAgent);
    workers.findByAgentToken.mockReturnValue(null);
    await post(controller, reqOf({ authorization: 'Bearer pmpub_token' }));
    expect(auth.getPublicAgentByToken).toHaveBeenCalledWith('pmpub_token');
    expect(principalOf(mcp)).toEqual({ user: publicAgent });
  });

  it('X-Agent-Token 命中机器人令牌时识别为机器人身份（工位 LITA_WORK_TOKEN 场景）', async () => {
    const { controller, mcp, auth, workers } = buildController();
    mockValid(auth, workers);
    await post(controller, reqOf({ agentToken: 'human-worker-token' }));
    expect(auth.getPublicAgentByToken).toHaveBeenCalledWith(
      'human-worker-token',
    );
    expect(workers.findByAgentToken).toHaveBeenCalledWith('human-worker-token');
    expect(principalOf(mcp)).toEqual({ worker: humanWorker, user });
  });

  it('?token= 参数兜底', async () => {
    const { controller, mcp, auth, workers } = buildController();
    mockValid(auth, workers);
    await post(
      controller,
      reqOf({ url: '/api/mcp/work?token=human-worker-token' }),
    );
    expect(workers.findByAgentToken).toHaveBeenCalledWith('human-worker-token');
    expect(principalOf(mcp)).toEqual({ worker: humanWorker, user });
  });

  it('无任何令牌时 401 且提示包含 X-Worker-Token', async () => {
    const { controller, auth, workers } = buildController();
    await expect(post(controller, reqOf({}))).rejects.toThrow(/X-Worker-Token/);
    expect(auth.getPublicAgentByToken).not.toHaveBeenCalled();
    expect(workers.findByAgentToken).not.toHaveBeenCalled();
  });

  it('令牌无效时 401', async () => {
    const { controller, auth, workers } = buildController();
    mockValid(auth, workers);
    await expect(
      post(controller, reqOf({ authorization: 'Bearer bad-token' })),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('X-Worker-Token 无效时直接 401，不回退其它令牌', async () => {
    const { controller, auth, workers } = buildController();
    mockValid(auth, workers);
    await expect(
      post(
        controller,
        reqOf({
          workerToken: 'bad-worker',
          authorization: 'Bearer human-worker-token',
        }),
      ),
    ).rejects.toThrow(UnauthorizedException);
    expect(auth.getPublicAgentByToken).not.toHaveBeenCalled();
  });
});
