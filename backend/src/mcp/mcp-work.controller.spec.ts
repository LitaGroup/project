import { UnauthorizedException } from '@nestjs/common';
import { McpWorkController } from './mcp-work.controller';

/** 构造被测 controller（mcp / auth / workers 全部 mock） */
function buildController(): {
  controller: McpWorkController;
  auth: { getUserByAgentToken: jest.Mock };
  workers: { findByAgentToken: jest.Mock };
} {
  const auth = { getUserByAgentToken: jest.fn() };
  const workers = { findByAgentToken: jest.fn() };
  const controller = new McpWorkController(
    { handleRequest: jest.fn() } as never,
    auth as never,
    workers as never,
  );
  return { controller, auth, workers };
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
  const worker = { id: 7, name: '测试机器人' };

  function mockValid(
    auth: { getUserByAgentToken: jest.Mock },
    workers: { findByAgentToken: jest.Mock },
  ): void {
    auth.getUserByAgentToken.mockImplementation((token: string) =>
      token === 'user-token' ? user : null,
    );
    workers.findByAgentToken.mockImplementation((token: string) =>
      token === 'worker-token' ? worker : null,
    );
  }

  async function post(
    controller: McpWorkController,
    req: never,
  ): Promise<void> {
    await controller.handlePost(req, { on: jest.fn() } as never, {});
  }

  it('X-Worker-Token 优先识别为机器人身份', async () => {
    const { controller, auth, workers } = buildController();
    mockValid(auth, workers);
    await post(
      controller,
      reqOf({
        workerToken: 'worker-token',
        authorization: 'Bearer user-token',
      }),
    );
    expect(workers.findByAgentToken).toHaveBeenCalledWith('worker-token');
    expect(auth.getUserByAgentToken).not.toHaveBeenCalled();
  });

  it('Authorization: Bearer 用户令牌', async () => {
    const { controller, auth, workers } = buildController();
    mockValid(auth, workers);
    await post(controller, reqOf({ authorization: 'Bearer user-token' }));
    expect(auth.getUserByAgentToken).toHaveBeenCalledWith('user-token');
  });

  it('X-Agent-Token 命中机器人令牌时识别为机器人身份（工位 LITA_WORK_TOKEN 场景）', async () => {
    const { controller, auth, workers } = buildController();
    mockValid(auth, workers);
    await post(controller, reqOf({ agentToken: 'worker-token' }));
    expect(auth.getUserByAgentToken).toHaveBeenCalledWith('worker-token');
    expect(workers.findByAgentToken).toHaveBeenCalledWith('worker-token');
  });

  it('?token= 参数兜底', async () => {
    const { controller, auth, workers } = buildController();
    mockValid(auth, workers);
    await post(controller, reqOf({ url: '/api/mcp/work?token=user-token' }));
    expect(auth.getUserByAgentToken).toHaveBeenCalledWith('user-token');
  });

  it('无任何令牌时 401 且提示包含 X-Worker-Token', async () => {
    const { controller, auth, workers } = buildController();
    await expect(post(controller, reqOf({}))).rejects.toThrow(/X-Worker-Token/);
    expect(auth.getUserByAgentToken).not.toHaveBeenCalled();
    expect(workers.findByAgentToken).not.toHaveBeenCalled();
  });

  it('令牌无效时 401', async () => {
    const { controller, auth, workers } = buildController();
    mockValid(auth, workers);
    await expect(
      post(controller, reqOf({ authorization: 'Bearer bad-token' })),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('X-Worker-Token 无效时直接 401，不回退用户令牌', async () => {
    const { controller, auth, workers } = buildController();
    mockValid(auth, workers);
    await expect(
      post(
        controller,
        reqOf({
          workerToken: 'bad-worker',
          authorization: 'Bearer user-token',
        }),
      ),
    ).rejects.toThrow(UnauthorizedException);
    expect(auth.getUserByAgentToken).not.toHaveBeenCalled();
  });
});
