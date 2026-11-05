import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import type { AuthedRequest } from '../auth/auth.guard';
import { Public } from '../auth/public.decorator';
import { WorkerGithubPermission } from '../common/enums';
import { GithubPermissionCredentialService } from '../workers/github-permission-credential.service';
import {
  AcquireCredentialInput,
  GatewayCredentialError,
  GatewayCredentialLease,
} from './gateway-credential-protocol';
import { GatewayCredentialService } from './gateway-credential.service';

class AcquireCredentialDto implements AcquireCredentialInput {
  credentialType?: string;
  resource?: string;
  action?: string;
}

class SaveGithubAccessDto {
  permission?: string;
  pat?: string | null;
  enabled?: boolean;
}

/**
 * OP Gateway 专用内部接口：凭 Gateway Token + 机器人 Token 获取一次操作凭证。
 * 仅 OP Gateway 可调用；AI 直接调用缺少 X-Gateway-Token，必然 401。
 */
@Controller('internal/gateway/v1/credentials')
@Public()
export class GatewayCredentialsController {
  constructor(private readonly gatewayCredentials: GatewayCredentialService) {}

  @Post('acquire')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async acquire(
    @Req() request: AuthedRequest & { headers: Record<string, unknown> },
    @Body() dto: AcquireCredentialDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<GatewayCredentialLease> {
    const header = (name: string): string | undefined => {
      const value = request.headers?.[name];
      return Array.isArray(value) ? value[0] : value;
    };
    try {
      this.gatewayCredentials.assertGatewayToken(header('x-gateway-token'));
      const lease = await this.gatewayCredentials.acquire(
        header('x-worker-token'),
        dto,
        header('x-request-id'),
      );
      res.setHeader('Cache-Control', 'no-store');
      return lease;
    } catch (error) {
      if (error instanceof GatewayCredentialError) {
        const status = errorStatus(error.code);
        res.setHeader('Cache-Control', 'no-store');
        throw new HttpException(
          {
            code: error.code,
            message: error.message,
            requestId: header('x-request-id') ?? null,
          },
          status,
        );
      }
      res.setHeader('Cache-Control', 'no-store');
      throw error;
    }
  }
}

/** 管理区「GitHub 权限」档位凭证配置：仅管理员可访问 */
@Controller('github-access')
export class GithubAccessController {
  constructor(
    private readonly credentials: GithubPermissionCredentialService,
  ) {}

  @Get()
  list(@Req() req: AuthedRequest) {
    this.credentials.assertAdmin(req.user?.role);
    return this.credentials.list();
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  async save(
    @Req() req: AuthedRequest,
    @Body() dto: SaveGithubAccessDto,
  ): Promise<{ ok: true }> {
    this.credentials.assertAdmin(req.user?.role);
    await this.credentials.save({
      permission: (dto.permission ?? '') as WorkerGithubPermission,
      pat: dto.pat ?? null,
      enabled: dto.enabled,
    });
    return { ok: true };
  }

  @Delete(':permission')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Req() req: AuthedRequest,
    @Param('permission') permission: string,
  ): Promise<void> {
    this.credentials.assertAdmin(req.user?.role);
    await this.credentials.remove(permission as WorkerGithubPermission);
  }
}

function errorStatus(code: GatewayCredentialError['code']): HttpStatus {
  if (code === 'INVALID_REQUEST' || code === 'CREDENTIAL_TYPE_UNSUPPORTED') {
    return HttpStatus.BAD_REQUEST;
  }
  if (code === 'GATEWAY_UNAUTHORIZED' || code === 'WORKER_UNAUTHORIZED') {
    return HttpStatus.UNAUTHORIZED;
  }
  if (code === 'CREDENTIAL_UNAVAILABLE') {
    return HttpStatus.SERVICE_UNAVAILABLE;
  }
  return HttpStatus.FORBIDDEN;
}
