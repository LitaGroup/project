import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Request, Response } from 'express';

/**
 * 处理一次 MCP Streamable HTTP 请求（stateless 模式）：
 * 每个请求独立的 transport/server，响应为 SSE 流，tools/call 期间可持续发送 progress notification。
 * lita-bots（调用机器人）与 lita-work（平台工具）两个 MCP 服务共用。
 */
export async function handleStatelessMcpRequest(
  server: McpServer,
  req: Request,
  res: Response,
  body: unknown,
): Promise<void> {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    void server.close().catch(() => {});
    void transport.close().catch(() => {});
  };
  res.on('close', cleanup);
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}
