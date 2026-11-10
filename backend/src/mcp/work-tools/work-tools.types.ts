import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { User } from '../../auth/user.entity';
import type { Worker } from '../../workers/worker.entity';

/**
 * lita-work MCP 调用方身份：
 * - 公共 Agent 令牌 → user；
 * - 机器人令牌 → worker；真人机器人额外挂载其绑定 user。
 * 真人用户没有独立令牌，个人 AGENT 使用其主人真人机器人的令牌。
 * 工具按 `.md` 端点的同等规则使用该身份（操作人记录、需求方/执行方校验等）。
 */
export interface McpWorkPrincipal {
  user?: User;
  worker?: Worker;
}

/** 单个工具域注册器（projects / runs / knowledge / defects / github / files） */
export interface WorkToolRegistrar {
  register(server: McpServer, principal: McpWorkPrincipal): void;
}

/** 工具结果（MCP CallToolResult） */
export type WorkToolResult = CallToolResult;

/** 操作人姓名：机器人令牌优先，其次用户；都没有时返回「公共 Agent」 */
export function actorNameOf(principal: McpWorkPrincipal): string {
  return principal.worker?.name || principal.user?.name || '公共 Agent';
}

/** 调用方身份展示（日志用） */
export function identityLabelOf(principal: McpWorkPrincipal): string {
  if (principal.worker)
    return `worker:${principal.worker.id}:${principal.worker.name}`;
  if (principal.user) return `user:${principal.user.id}:${principal.user.name}`;
  return 'anonymous';
}
