import { Injectable, Logger } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { handleStatelessMcpRequest } from './mcp-http';
import { WorkDefectTools } from './work-tools/work-defect.tools';
import { WorkFileTools } from './work-tools/work-file.tools';
import { WorkGithubTools } from './work-tools/work-github.tools';
import { WorkKnowledgeTools } from './work-tools/work-knowledge.tools';
import { WorkProjectTools } from './work-tools/work-project.tools';
import { WorkRunTools } from './work-tools/work-run.tools';
import { WorkTaskTools } from './work-tools/work-task.tools';
import { WorkTicketTools } from './work-tools/work-ticket.tools';
import { WorkAgentTools } from './work-tools/work-agent.tools';
import type {
  McpWorkPrincipal,
  WorkToolRegistrar,
} from './work-tools/work-tools.types';

/**
 * lita-work MCP 开放：把原 lita-work / knowledge-search / file-upload 技能
 * （`.md` HTTP 端点）改造成带 schema 的 MCP 工具，内部直接复用平台 service 层，
 * 返回沿用面向 Agent 的 Markdown 正文。
 * - 鉴权与 `.md` 端点一致：用户 agent 访问令牌或机器人独立令牌；
 * - 运行类工具经 progress notification 实时推送脚本输出；
 * - 与 lita-bots（把机器人当子 Agent 调用）共用 stateless Streamable HTTP 传输。
 */
@Injectable()
export class McpWorkService {
  private readonly logger = new Logger(McpWorkService.name);

  private readonly registrars: WorkToolRegistrar[];

  constructor(
    projectTools: WorkProjectTools,
    runTools: WorkRunTools,
    knowledgeTools: WorkKnowledgeTools,
    defectTools: WorkDefectTools,
    githubTools: WorkGithubTools,
    fileTools: WorkFileTools,
    taskTools: WorkTaskTools,
    ticketTools: WorkTicketTools,
    agentTools: WorkAgentTools,
  ) {
    this.registrars = [
      projectTools,
      runTools,
      knowledgeTools,
      defectTools,
      githubTools,
      fileTools,
      taskTools,
      ticketTools,
      agentTools,
    ];
  }

  /** 处理一次 MCP HTTP 请求（stateless：每请求独立 server/transport） */
  async handleRequest(
    principal: McpWorkPrincipal,
    req: import('express').Request,
    res: import('express').Response,
    body: unknown,
  ): Promise<void> {
    const server = new McpServer(
      { name: 'lita-work', version: '1.0.0' },
      { capabilities: { tools: {} } },
    );
    for (const registrar of this.registrars) {
      registrar.register(server, principal);
    }
    this.logger.debug(
      `MCP lita-work 请求：${principal.worker ? `worker:${principal.worker.id}` : principal.user ? `user:${principal.user.id}` : 'anonymous'}`,
    );
    await handleStatelessMcpRequest(server, req, res, body);
  }
}
