import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FeishuModule } from '../feishu/feishu.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UserSyncService } from './user-sync.service';
import { User } from './user.entity';

/** 用户系统：飞书 OAuth 网页登录 + 会话 + 通讯录全量同步（AuthGuard 依赖 AuthService，须导出供根模块注入） */
@Module({
  imports: [TypeOrmModule.forFeature([User]), FeishuModule],
  controllers: [AuthController],
  providers: [AuthService, UserSyncService],
  exports: [AuthService],
})
export class AuthModule {}
