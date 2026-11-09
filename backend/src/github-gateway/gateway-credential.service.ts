import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { AuthService } from '../auth/auth.service';
import { WorkerGithubPermission } from '../common/enums';
import { Worker } from '../workers/worker.entity';
import { WorkersService } from '../workers/workers.service';
import { GithubPermissionCredentialService } from '../workers/github-permission-credential.service';
import { GatewayCredentialAudit } from './gateway-credential-audit.entity';
import {
  AcquireCredentialInput,
  GatewayCredentialError,
  GatewayCredentialLease,
  GATEWAY_CREDENTIAL_TYPES,
  GatewayCredentialType,
  GatewayGithubAction,
  allowedGithubActions,
  normalizeGithubResource,
} from './gateway-credential-protocol';

const DEFAULT_LEASE_SECONDS = 60;
const MAX_LEASE_SECONDS = 300;

/**
 * Gateway 凭证获取编排：
 * Gateway Token + Worker Token 双重鉴权 → 机器人权限 → 操作授权 → 解密凭证 → 审计。
 * 响应只返回给可信 Gateway；任何日志、审计、异常信息均不包含 Token / PAT。
 */
@Injectable()
export class GatewayCredentialService {
  private readonly logger = new Logger(GatewayCredentialService.name);
  private readonly sharedToken: string;
  private readonly leaseSeconds: number;

  constructor(
    @InjectRepository(GatewayCredentialAudit)
    private readonly audits: Repository<GatewayCredentialAudit>,
    private readonly workersService: WorkersService,
    private readonly authService: AuthService,
    private readonly githubCredentials: GithubPermissionCredentialService,
    config: ConfigService,
  ) {
    this.sharedToken =
      config.get<string>('OP_GATEWAY_SHARED_TOKEN')?.trim() || '';
    const configured = Number(
      config.get<string>('GATEWAY_CREDENTIAL_LEASE_SECONDS'),
    );
    this.leaseSeconds =
      Number.isFinite(configured) && configured > 0
        ? Math.min(Math.floor(configured), MAX_LEASE_SECONDS)
        : DEFAULT_LEASE_SECONDS;
  }

  /** 校验 OP Gateway 服务身份；AI / 普通机器人没有该 Token，无法直接换凭证 */
  assertGatewayToken(token: string | undefined): void {
    if (!this.sharedToken) {
      throw new GatewayCredentialError(
        'GATEWAY_UNAUTHORIZED',
        '平台未配置 OP_GATEWAY_SHARED_TOKEN',
      );
    }
    if (
      !token ||
      !GithubPermissionCredentialService.safeEqual(token, this.sharedToken)
    ) {
      throw new GatewayCredentialError(
        'GATEWAY_UNAUTHORIZED',
        'Gateway Token 无效',
      );
    }
  }

  /**
   * 获取一次操作凭证。
   * 每次都实时校验机器人权限，不缓存授权结果；PAT 不做授权缓存。
   */
  async acquire(
    workerToken: string | undefined,
    input: AcquireCredentialInput,
    requestId?: string,
  ): Promise<GatewayCredentialLease> {
    const type = input.credentialType?.trim() || '';
    const action = input.action?.trim() || '';
    let identityType: 'worker' | 'user' = 'worker';
    let userId: number | null = null;
    let workerId = 0;
    let credentialId: number | null = null;
    let allowed = false;
    let denyReason: string | null = null;
    let leaseId: string | null = null;
    let resource = input.resource?.trim() ?? '';

    try {
      if (!GATEWAY_CREDENTIAL_TYPES.includes(type as GatewayCredentialType)) {
        throw new GatewayCredentialError(
          typeof type === 'string' && type
            ? 'CREDENTIAL_TYPE_UNSUPPORTED'
            : 'INVALID_REQUEST',
          type ? `凭证类型 ${type} 暂不支持` : 'credentialType 不能为空',
        );
      }
      resource = normalizeGithubResource(input.resource);
      if (!workerToken) {
        throw new GatewayCredentialError(
          'WORKER_UNAUTHORIZED',
          '机器人令牌缺失',
        );
      }
      const worker = await this.workersService.findByAgentToken(workerToken);
      if (!worker) {
        // 真人个人令牌可以访问资源网关，但不能获取 GitHub PAT；
        // 这里识别真人身份并落审计，保持 WORKER_UNAUTHORIZED 错误码不变。
        const user =
          await this.authService.getUserByPersonalAgentToken(workerToken);
        if (user) {
          identityType = 'user';
          userId = user.id;
          const human = await this.workersService.findByHumanUserId(user.id);
          workerId = human?.id ?? 0;
          throw new GatewayCredentialError(
            'WORKER_UNAUTHORIZED',
            '真人令牌不能获取 Gateway 凭证，请使用机器人令牌',
          );
        }
        throw new GatewayCredentialError(
          'WORKER_UNAUTHORIZED',
          '机器人令牌无效或机器人已停用',
        );
      }
      workerId = worker.id;
      if (worker.githubPermission === WorkerGithubPermission.NONE) {
        throw new GatewayCredentialError(
          'PERMISSION_NONE',
          '当前机器人没有 GitHub 权限',
        );
      }
      const actions = allowedGithubActions(worker.githubPermission);
      if (!actions.includes(action as GatewayGithubAction)) {
        throw new GatewayCredentialError(
          action ? 'ACTION_FORBIDDEN' : 'INVALID_REQUEST',
          action ? `当前权限不允许执行 ${action}` : 'action 不能为空',
        );
      }
      const pat = await this.githubCredentials
        .decryptEnabledPat(worker.githubPermission)
        .catch((error: Error) => {
          if (error.message === 'GITHUB_CREDENTIAL_NOT_CONFIGURED') {
            throw new GatewayCredentialError(
              'CREDENTIAL_NOT_CONFIGURED',
              '当前权限档位尚未配置 GitHub PAT',
            );
          }
          if (error.message === 'CREDENTIAL_DISABLED') {
            throw new GatewayCredentialError(
              'CREDENTIAL_DISABLED',
              '当前权限档位的 GitHub PAT 已停用',
            );
          }
          throw error;
        });
      credentialId = pat.credentialId;
      const now = new Date();
      const expiresAt = new Date(now.getTime() + this.leaseSeconds * 1000);
      leaseId = `lease_${randomUUID().replace(/-/g, '')}`;
      allowed = true;
      return {
        leaseId,
        workerId: worker.id,
        credential: {
          type: type as GatewayCredentialType,
          data: {
            host: 'github.com',
            username: pat.githubAccount ?? 'git',
            token: pat.pat,
          },
        },
        issuedAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
      };
    } catch (error) {
      if (error instanceof GatewayCredentialError) {
        denyReason = error.code;
        throw error;
      }
      denyReason = 'CREDENTIAL_UNAVAILABLE';
      this.logger.warn(
        `Gateway 凭证获取失败: worker=${workerId || 'unknown'}, type=${type || 'unknown'}, ${(error as Error).message}`,
      );
      throw new GatewayCredentialError(
        'CREDENTIAL_UNAVAILABLE',
        '凭证暂时不可用，请稍后重试',
      );
    } finally {
      await this.writeAudit({
        leaseId,
        identityType,
        userId,
        workerId,
        credentialId,
        credentialType: type || 'unknown',
        resource: resource.slice(0, 200) || 'unknown',
        action: action || 'unknown',
        allowed,
        denyReason,
        requestId,
      });
    }
  }

  private async writeAudit(input: {
    leaseId: string | null;
    identityType: 'worker' | 'user';
    userId: number | null;
    workerId: number;
    credentialId: number | null;
    credentialType: string;
    resource: string;
    action: string;
    allowed: boolean;
    denyReason: string | null;
    requestId?: string;
  }): Promise<void> {
    try {
      await this.audits.save(
        this.audits.create({
          leaseId: input.leaseId,
          identityType: input.identityType,
          userId: input.userId,
          workerId: input.workerId,
          credentialId: input.credentialId,
          credentialType: input.credentialType.slice(0, 60),
          resource: input.resource,
          action: input.action.slice(0, 60),
          allowed: input.allowed,
          denyReason: input.denyReason,
          requestId: input.requestId?.slice(0, 120) ?? null,
        }),
      );
    } catch (error) {
      // 审计失败不阻断主流程，但必须留日志（不含敏感信息）
      this.logger.error(
        `Gateway 凭证审计写入失败: ${(error as Error).message}`,
      );
    }
  }
}
