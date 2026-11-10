import { UnauthorizedException } from '@nestjs/common';
import { McpController } from './mcp.controller';

/** 构造被测 controller（mcp / auth / workers 全部 mock） */
function buildController(): {
  controller: McpController;
  mcp: { handleRequest: jest.Mock };
  auth: { getPublicAgentByToken: jest.Mock };
  workers: { findByAgentToken: jest.Mock };
} {
  const mcp = { handleRequest: jest.fn() };
  const auth = { getPublicAgentByToken: jest.fn() };
  const workers = { findByAgentToken: jest.fn() };
  const controller = new McpController(
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
  return { headers, originalUrl: options.url ?? '/api/mcp/bots' } as never;
}

describe('McpController.authenticate（经 handlePost 验证）', () => {
  const humanWorker = {
    id: 7,
    name: '前端工程师',
    humanUserId: 3,
    humanUserName: '张三',
    personalAgentUserId: null,
  };
  const aiWorker = {
    id: 8,
    name: '测试机器人',
    humanUserId: null,
    humanUserName: null,
    personalAgentUserId: null,
  };

  function mockValid(
    auth: { getPublicAgentByToken: jest.Mock },
    workers: { findByAgentToken: jest.Mock },
  ): void {
    auth.getPublicAgentByToken.mockReturnValue(null);
    workers.findByAgentToken.mockImplementation((token: string) => {
      if (token === 'human-worker-token') return humanWorker;
      if (token === 'ai-worker-token') return aiWorker;
      return null;
    });
  }

  async function post(controller: McpController, req: never): Promise<void> {
    await controller.handlePost(req, { on: jest.fn() } as never, {});
  }

  function callerOf(mcp: { handleRequest: jest.Mock }): unknown {
    const calls = mcp.handleRequest.mock.calls as unknown[][];
    return calls[0]?.[0];
  }

  it('X-Worker-Token 优先识别为机器人身份（绑定真人时记真人）', async () => {
    const { controller, mcp, auth, workers } = buildController();
    mockValid(auth, workers);
    await post(
      controller,
      reqOf({
        workerToken: 'human-worker-token',
        authorization: 'Bearer pmpub_token',
      }),
    );
    expect(workers.findByAgentToken).toHaveBeenCalledWith('human-worker-token');
    expect(auth.getPublicAgentByToken).not.toHaveBeenCalled();
    expect(callerOf(mcp)).toEqual({ id: 3, name: '张三' });
  });

  it('未绑定真人的 AI 机器人令牌用负 ID 隔离会话', async () => {
    const { controller, mcp, auth, workers } = buildController();
    mockValid(auth, workers);
    await post(controller, reqOf({ workerToken: 'ai-worker-token' }));
    expect(callerOf(mcp)).toEqual({ id: -8, name: '机器人：测试机器人' });
  });

  it('Authorization: Bearer 公共 Agent 令牌', async () => {
    const { controller, mcp, auth, workers } = buildController();
    auth.getPublicAgentByToken.mockReturnValue({ id: 0, name: '公共 Agent' });
    workers.findByAgentToken.mockReturnValue(null);
    await post(controller, reqOf({ authorization: 'Bearer pmpub_token' }));
    expect(auth.getPublicAgentByToken).toHaveBeenCalledWith('pmpub_token');
    expect(callerOf(mcp)).toEqual({ id: 0, name: '公共 Agent' });
  });

  it('X-Agent-Token 命中机器人令牌时识别为机器人身份（工位 LITA_WORK_TOKEN 场景）', async () => {
    const { controller, mcp, auth, workers } = buildController();
    mockValid(auth, workers);
    await post(controller, reqOf({ agentToken: 'ai-worker-token' }));
    expect(auth.getPublicAgentByToken).toHaveBeenCalledWith('ai-worker-token');
    expect(workers.findByAgentToken).toHaveBeenCalledWith('ai-worker-token');
    expect(callerOf(mcp)).toEqual({ id: -8, name: '机器人：测试机器人' });
  });

  it('?token= 参数兜底（与 .md 端点一致）', async () => {
    const { controller, mcp, auth, workers } = buildController();
    mockValid(auth, workers);
    await post(
      controller,
      reqOf({ url: '/api/mcp/bots?token=human-worker-token' }),
    );
    expect(workers.findByAgentToken).toHaveBeenCalledWith('human-worker-token');
    expect(callerOf(mcp)).toEqual({ id: 3, name: '张三' });
  });

  it('无任何令牌时 401 且提示包含机器人令牌用法', async () => {
    const { controller, auth, workers } = buildController();
    await expect(post(controller, reqOf({}))).rejects.toThrow(/X-Worker-Token/);
    expect(auth.getPublicAgentByToken).not.toHaveBeenCalled();
    expect(workers.findByAgentToken).not.toHaveBeenCalled();
  });

  it('X-Worker-Token 无效时直接 401，不回退其它令牌', async () => {
    const { controller, auth, workers } = buildController();
    mockValid(auth, workers);
    await expect(
      post(
        controller,
        reqOf({
          workerToken: 'bad-worker',
          authorization: 'Bearer pmpub_token',
        }),
      ),
    ).rejects.toThrow(UnauthorizedException);
    expect(auth.getPublicAgentByToken).not.toHaveBeenCalled();
  });

  it('令牌无效时 401（公共令牌与机器人令牌均未命中）', async () => {
    const { controller, auth, workers } = buildController();
    mockValid(auth, workers);
    await expect(
      post(controller, reqOf({ authorization: 'Bearer bad-token' })),
    ).rejects.toThrow(UnauthorizedException);
    expect(auth.getPublicAgentByToken).toHaveBeenCalledWith('bad-token');
    expect(workers.findByAgentToken).toHaveBeenCalledWith('bad-token');
  });
});
