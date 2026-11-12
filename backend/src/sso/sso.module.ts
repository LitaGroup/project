import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { SsoClient } from './sso-client.entity';
import { SsoCode } from './sso-code.entity';
import { SsoController } from './sso.controller';
import { SsoService } from './sso.service';

/** 单点登录（OAuth2 授权码 IdP）：接入方管理 + authorize/token/userinfo；依赖 AuthService 校验会话与用户 */
@Module({
  imports: [TypeOrmModule.forFeature([SsoClient, SsoCode]), AuthModule],
  controllers: [SsoController],
  providers: [SsoService],
})
export class SsoModule {}
