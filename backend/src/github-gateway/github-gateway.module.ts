import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GatewayCredentialAudit } from './gateway-credential-audit.entity';
import { GithubPermissionCredential } from './github-permission-credential.entity';
import { GatewayCredentialService } from './gateway-credential.service';
import {
  GatewayCredentialsController,
  GithubAccessController,
} from './github-gateway.controller';
import { WorkersModule } from '../workers/workers.module';

/**
 * OP Gateway 控制面：凭证获取接口 + 管理区 GitHub 凭证配置。
 * 档位凭证存储复用 workers 模块，避免权限逻辑分叉。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      GatewayCredentialAudit,
      GithubPermissionCredential,
    ]),
    WorkersModule,
  ],
  controllers: [GatewayCredentialsController, GithubAccessController],
  providers: [GatewayCredentialService],
})
export class GithubGatewayModule {}
