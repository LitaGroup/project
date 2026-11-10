import { Injectable } from '@nestjs/common';
import { WorkerResourcePermission } from '../common/enums';
import { WorkersService } from '../workers/workers.service';
import { GatewayCredentialError } from './gateway-credential-protocol';

/** 资源网关验权结果；permission=none 是合法结果，由调用方决定是否拒绝业务操作。 */
export interface GatewayResourcePermission {
  workerId: number;
  permission: WorkerResourcePermission;
}

/**
 * 资源网关内部验权：校验令牌与资源权限，不发放任何凭证。
 * 机器人独立令牌与真人用户 agent 访问令牌（解析到绑定真人机器人）均可通过，
 * 真人身份按其真人机器人的 resourcePermission 判定。
 * 每次请求实时查询，不缓存，身份停用后立即失效。
 */
@Injectable()
export class GatewayResourcePermissionService {
  constructor(private readonly workersService: WorkersService) {}

  async verify(
    workerToken: string | undefined,
  ): Promise<GatewayResourcePermission> {
    if (!workerToken) {
      throw new GatewayCredentialError('WORKER_UNAUTHORIZED', '令牌缺失');
    }
    const worker =
      await this.workersService.findGatewayWorkerByToken(workerToken);
    if (!worker) {
      throw new GatewayCredentialError(
        'WORKER_UNAUTHORIZED',
        '令牌无效或对应身份已停用',
      );
    }
    return {
      workerId: worker.id,
      permission: worker.resourcePermission ?? WorkerResourcePermission.NONE,
    };
  }
}
