import { UnauthorizedException } from '@nestjs/common';
import { McpController } from './mcp.controller';

/** 构造被测 controller（mcp / auth 全部 mock） */
function buildController(): {
  controller: McpController;
  auth: { getUserByAgentToken: jest.Mock };
} {
  const auth = { getUserByAgentToken: jest.fn() };
  const controller = new McpController(
    { handleRequest: jest.fn() } as never,
    auth as never,
  );
  return { controller, auth };
}

/** 构造 express 风格请求（authenticate 只读 headers 与 originalUrl） */
function reqOf(options: {
  authorization?: string;
  agentToken?: string;
  url?: string;
}): never {
  const headers: Record<string, string> = {};
  if (options.authorization) headers.authorization = options.authorization;
  if (options.agentToken) headers['x-agent-token'] = options.agentToken;
  return { headers, originalUrl: options.url ?? '/api/mcp/bots' } as never;
}

describe('McpController.authenticate（经 handlePost 验证）', () => {
  const user = { id: 3, name: '张三' };

  function mockAuthValid(auth: { getUserByAgentToken: jest.Mock }): void {
    auth.getUserByAgentToken.mockImplementation((token: string) =>
      token === 'valid-token' ? user : null,
    );
  }

  async function post(controller: McpController, req: never): Promise<void> {
    await controller.handlePost(req, { on: jest.fn() } as never, {});
  }

  it('Authorization: Bearer 优先', async () => {
    const { controller, auth } = buildController();
    mockAuthValid(auth);
    await post(
      controller,
      reqOf({
        authorization: 'Bearer valid-token',
        agentToken: 'other',
        url: '/api/mcp/bots?token=other2',
      }),
    );
    expect(auth.getUserByAgentToken).toHaveBeenCalledWith('valid-token');
  });

  it('X-Agent-Token 头其次（工位环境变量 LITA_WORK_TOKEN 场景）', async () => {
    const { controller, auth } = buildController();
    mockAuthValid(auth);
    await post(
      controller,
      reqOf({
        agentToken: 'valid-token',
        url: '/api/mcp/bots?token=other2',
      }),
    );
    expect(auth.getUserByAgentToken).toHaveBeenCalledWith('valid-token');
  });

  it('?token= 参数兜底（与 .md 端点一致）', async () => {
    const { controller, auth } = buildController();
    mockAuthValid(auth);
    await post(controller, reqOf({ url: '/api/mcp/bots?token=valid-token' }));
    expect(auth.getUserByAgentToken).toHaveBeenCalledWith('valid-token');
  });

  it('无任何令牌时 401 且提示包含环境变量名', async () => {
    const { controller, auth } = buildController();
    await expect(post(controller, reqOf({}))).rejects.toThrow(
      /LITA_WORK_TOKEN/,
    );
    expect(auth.getUserByAgentToken).not.toHaveBeenCalled();
  });

  it('令牌无效时 401（公共令牌/个人令牌统一走 getUserByAgentToken）', async () => {
    const { controller, auth } = buildController();
    mockAuthValid(auth);
    await expect(
      post(controller, reqOf({ authorization: 'Bearer bad-token' })),
    ).rejects.toThrow(UnauthorizedException);
    expect(auth.getUserByAgentToken).toHaveBeenCalledWith('bad-token');
  });
});
