import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WorkerResourcePermission } from '../common/enums';
import { User } from '../auth/user.entity';
import { WorkersService } from '../workers/workers.service';
import { GatewayCredentialError } from './gateway-credential-protocol';

/** 绑定真人的展示属性（仅真人机器人有；AI 机器人或未绑定真人时为 null） */
export interface GatewayUserIdentity {
  userId: number;
  /** 姓名（昵称展示用） */
  name: string;
  avatarUrl: string | null;
  email: string | null;
  department: string | null;
}

/**
 * 资源网关验权结果；permission=none 是合法结果，由调用方决定是否拒绝业务操作。
 * workerName / user 仅作展示与审计，不含任何凭证与敏感标识。
 */
export interface GatewayResourcePermission {
  workerId: number;
  /** 机器人名称 */
  workerName: string;
  permission: WorkerResourcePermission;
  /** 绑定真人的属性；AI 机器人或未绑定真人时为 null */
  user: GatewayUserIdentity | null;
}

/**
 * 资源网关内部验权：校验令牌与资源权限，不发放任何凭证。
 * 只接受机器人令牌；真人用户的令牌就是其真人机器人的 workers.agentToken，
 * 按该机器人的 resourcePermission 判定。每次请求实时查询，不缓存，身份停用后立即失效。
 */
@Injectable()
export class GatewayResourcePermissionService {
  constructor(
    private readonly workersService: WorkersService,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
  ) {}

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
    // 绑定真人的展示属性（仅真人机器人有）；仅取展示列，不透出 open_id 等标识与令牌
    const user = worker.humanUserId
      ? await this.usersRepo.findOne({
          where: { id: worker.humanUserId },
          select: {
            id: true,
            name: true,
            avatarUrl: true,
            email: true,
            department: true,
          },
        })
      : null;
    return {
      workerId: worker.id,
      workerName: worker.name,
      permission: worker.resourcePermission ?? WorkerResourcePermission.NONE,
      user: user
        ? {
            userId: user.id,
            name: user.name,
            avatarUrl: user.avatarUrl,
            email: user.email,
            department: user.department,
          }
        : null,
    };
  }
}
