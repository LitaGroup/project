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
 * 资源网关内部验权：只校验机器人 Token 与资源权限，不发放任何凭证。
 * 每次请求实时查询，不缓存，机器人停用后立即失效。
 */
@Injectable()
export class GatewayResourcePermissionService {
  constructor(private readonly workersService: WorkersService) {}

  async verify(
    workerToken: string | undefined,
  ): Promise<GatewayResourcePermission> {
    if (!workerToken) {
      throw new GatewayCredentialError('WORKER_UNAUTHORIZED', '机器人令牌缺失');
    }
    const worker = await this.workersService.findByAgentToken(workerToken);
    if (!worker) {
      throw new GatewayCredentialError(
        'WORKER_UNAUTHORIZED',
        '机器人令牌无效或机器人已停用',
      );
    }
    return {
      workerId: worker.id,
      permission: worker.resourcePermission ?? WorkerResourcePermission.NONE,
    };
  }
}
