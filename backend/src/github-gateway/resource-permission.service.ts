import { Injectable, Logger } from '@nestjs/common';
import { UserRole, WorkerResourcePermission } from '../common/enums';
import { AuthService } from '../auth/auth.service';
import type { User } from '../auth/user.entity';
import { Worker } from '../workers/worker.entity';
import { WorkersService } from '../workers/workers.service';
import { GatewayCredentialError } from './gateway-credential-protocol';

/** 资源网关调用方身份：机器人独立令牌或真人个人 agent 令牌。 */
export type GatewayIdentityType = 'worker' | 'user';

/** 资源网关验权结果；permission=none 是合法结果，由调用方决定是否拒绝业务操作。 */
export interface GatewayResourcePermission {
  /** 机器人 ID；真人为其真人机器人 ID，保持 lita-proxy 现有 workerId > 0 校验兼容 */
  workerId: number;
  permission: WorkerResourcePermission;
  /** 调用方身份类型，供审计与 MCP 调用日志区分机器人/真人 */
  identityType: GatewayIdentityType;
  /** 真人身份对应的 users.id；机器人为 null */
  userId: number | null;
}

/**
 * 资源网关内部验权：校验机器人 / 真人令牌并返回资源权限，不发放任何凭证。
 * 每次请求实时查询，不缓存，令牌重置、用户停用或权限变更后立即失效。
 */
@Injectable()
export class GatewayResourcePermissionService {
  private readonly logger = new Logger(GatewayResourcePermissionService.name);

  constructor(
    private readonly workersService: WorkersService,
    private readonly authService: AuthService,
  ) {}

  async verify(
    workerToken: string | undefined,
  ): Promise<GatewayResourcePermission> {
    if (!workerToken) {
      throw new GatewayCredentialError('WORKER_UNAUTHORIZED', '访问令牌缺失');
    }

    // 先走既有机器人路径：保持原判定顺序与错误码语义，令牌碰撞时机器人优先。
    const worker = await this.workersService.findByAgentToken(workerToken);
    if (worker) {
      const result: GatewayResourcePermission = {
        workerId: worker.id,
        permission: this.permissionOfWorker(worker),
        identityType: 'worker',
        userId: null,
      };
      this.logResult(result);
      return result;
    }

    // 机器人未命中再按真人个人令牌反查；公共 Agent 令牌不参与资源网关身份。
    const user =
      await this.authService.getUserByPersonalAgentToken(workerToken);
    if (!user) {
      throw new GatewayCredentialError(
        'WORKER_UNAUTHORIZED',
        '访问令牌无效、已停用或用户已禁用',
      );
    }

    const humanWorker = await this.workersService.findByHumanUserId(user.id);
    if (!humanWorker) {
      this.logger.warn(
        `资源网关验权失败：真人用户 #${user.id} 缺少真人机器人绑定`,
      );
      throw new GatewayCredentialError(
        'WORKER_UNAUTHORIZED',
        '用户尚未绑定真人机器人',
      );
    }

    const result: GatewayResourcePermission = {
      workerId: humanWorker.id,
      permission: this.permissionOfUser(user),
      identityType: 'user',
      userId: user.id,
    };
    this.logResult(result);
    return result;
  }

  /** 机器人权限保持原样；存量数据缺失字段时按无权限处理。 */
  private permissionOfWorker(worker: Worker): WorkerResourcePermission {
    return worker.resourcePermission ?? WorkerResourcePermission.NONE;
  }

  /**
   * 真人默认权限策略：管理员可访问全部资源，成员仅只读资源。
   * 逐人精细授权后续可在此扩展，接口契约不变。
   */
  private permissionOfUser(user: User): WorkerResourcePermission {
    switch (user.role) {
      case UserRole.ADMIN:
        return WorkerResourcePermission.WRITE;
      case UserRole.MEMBER:
        return WorkerResourcePermission.READ;
      default:
        return WorkerResourcePermission.NONE;
    }
  }

  private logResult(result: GatewayResourcePermission): void {
    const subject =
      result.identityType === 'user'
        ? `user=${result.userId ?? 'unknown'} worker=${result.workerId}`
        : `worker=${result.workerId}`;
    this.logger.log(
      `资源网关验权: identity=${result.identityType} ${subject} permission=${result.permission}`,
    );
  }
}
