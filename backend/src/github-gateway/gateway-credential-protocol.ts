import { WorkerGithubPermission } from '../common/enums';

/** 第一期支持的凭证类型；其它类型按通用协议返回 CREDENTIAL_TYPE_UNSUPPORTED */
export const GATEWAY_CREDENTIAL_TYPES = ['github.pat'] as const;
export type GatewayCredentialType = (typeof GATEWAY_CREDENTIAL_TYPES)[number];

/** Gateway 请求的固定操作集合 */
export const GATEWAY_GITHUB_ACTIONS = [
  'git.read',
  'git.write',
  'gh.pr.create',
  'gh.pr.approve',
  'gh.pr.merge',
] as const;
export type GatewayGithubAction = (typeof GATEWAY_GITHUB_ACTIONS)[number];

/** 凭证获取请求（通用协议第一期仅实现 github.pat） */
export interface AcquireCredentialInput {
  credentialType?: string;
  resource?: string;
  action?: string;
}

/** 通用凭证响应负载；不同类型由 Provider 决定 data 结构 */
export interface GatewayCredentialLease {
  leaseId: string;
  workerId: number;
  credential: {
    type: GatewayCredentialType;
    data: Record<string, string | number | boolean>;
  };
  issuedAt: string;
  expiresAt: string;
}

/** 权限 → 可执行操作 */
export function allowedGithubActions(
  permission: WorkerGithubPermission,
): GatewayGithubAction[] {
  if (permission === WorkerGithubPermission.RELEASE) {
    return [...GATEWAY_GITHUB_ACTIONS];
  }
  if (permission === WorkerGithubPermission.DEVELOP) {
    return ['git.read', 'git.write', 'gh.pr.create'];
  }
  return [];
}

/** GitHub 资源归一：owner/name（去除 .git 后缀，拒绝路径穿越与多余路径段） */
export function normalizeGithubResource(value: string | undefined): string {
  const resource = value?.trim() ?? '';
  if (!resource)
    throw new GatewayCredentialError('INVALID_REQUEST', 'resource 不能为空');
  const normalized = resource.replace(/\.git$/i, '');
  if (
    !/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(normalized)
  ) {
    throw new GatewayCredentialError(
      'INVALID_REQUEST',
      'resource 必须是 owner/name 格式的 GitHub 仓库',
    );
  }
  return normalized;
}

/** 带稳定错误码的接口异常（HTTP 状态由 controller 映射） */
export class GatewayCredentialError extends Error {
  constructor(
    readonly code:
      | 'INVALID_REQUEST'
      | 'CREDENTIAL_TYPE_UNSUPPORTED'
      | 'GATEWAY_UNAUTHORIZED'
      | 'WORKER_UNAUTHORIZED'
      | 'PERMISSION_NONE'
      | 'ACTION_FORBIDDEN'
      | 'RESOURCE_FORBIDDEN'
      | 'CREDENTIAL_NOT_CONFIGURED'
      | 'CREDENTIAL_DISABLED'
      | 'CREDENTIAL_UNAVAILABLE',
    message: string,
  ) {
    super(message);
    this.name = 'GatewayCredentialError';
  }
}
