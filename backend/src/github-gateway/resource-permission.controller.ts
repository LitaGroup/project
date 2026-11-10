import {
  Controller,
  Header,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import type { AuthedRequest } from '../auth/auth.guard';
import { Public } from '../auth/public.decorator';
import { GatewayCredentialError } from './gateway-credential-protocol';
import { GatewayCredentialService } from './gateway-credential.service';
import {
  GatewayResourcePermission,
  GatewayResourcePermissionService,
} from './resource-permission.service';

/**
 * 资源网关专用内部接口：Gateway Token + 机器人令牌换资源权限。
 * 仅可信 Gateway 可调用，不返回任何资源凭证；AI 直接调用缺少 Gateway Token 必然 401。
 */
@Controller('internal/gateway/v1/resource-permissions')
@Public()
export class GatewayResourcePermissionController {
  constructor(
    private readonly gatewayCredentials: GatewayCredentialService,
    private readonly resourcePermissions: GatewayResourcePermissionService,
  ) {}

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async verify(
    @Req() request: AuthedRequest & { headers: Record<string, unknown> },
    @Res({ passthrough: true }) res: Response,
  ): Promise<GatewayResourcePermission> {
    const header = (name: string): string | undefined => {
      const value = request.headers?.[name];
      return Array.isArray(value) ? value[0] : value;
    };
    try {
      this.gatewayCredentials.assertGatewayToken(header('x-gateway-token'));
      const result = await this.resourcePermissions.verify(
        header('x-worker-token'),
      );
      res.setHeader('Cache-Control', 'no-store');
      return result;
    } catch (error) {
      res.setHeader('Cache-Control', 'no-store');
      if (error instanceof GatewayCredentialError) {
        throw new HttpException(
          {
            code: error.code,
            message: error.message,
            requestId: header('x-request-id') ?? null,
          },
          errorStatus(error.code),
        );
      }
      throw error;
    }
  }
}

function errorStatus(code: GatewayCredentialError['code']): HttpStatus {
  if (code === 'GATEWAY_UNAUTHORIZED' || code === 'WORKER_UNAUTHORIZED') {
    return HttpStatus.UNAUTHORIZED;
  }
  if (code === 'CREDENTIAL_UNAVAILABLE') {
    return HttpStatus.SERVICE_UNAVAILABLE;
  }
  return HttpStatus.FORBIDDEN;
}
