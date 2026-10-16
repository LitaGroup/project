import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AppVersionsModule } from './app-versions/app-versions.module';
import { AgentModule } from './agent/agent.module';
import { AgentAppsModule } from './agent/agent-apps.module';
import { AuthModule } from './auth/auth.module';
import { AuthGuard } from './auth/auth.guard';
import { ProjectsModule } from './projects/projects.module';
import { DocumentsModule } from './documents/documents.module';
import { ChecksModule } from './checks/checks.module';
import { TasksModule } from './tasks/tasks.module';
import { TestsModule } from './tests/tests.module';
import { ExportsModule } from './exports/exports.module';
import { DefectsModule } from './defects/defects.module';
import { ResourcesModule } from './resources/resources.module';
import { MilestonesModule } from './milestones/milestones.module';
import { FeishuModule } from './feishu/feishu.module';
import { GithubModule } from './github/github.module';
import { ScriptsModule } from './scripts/scripts.module';
import { SettingsModule } from './settings/settings.module';
import { ImagesModule } from './images/images.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'mysql' as const,
        host: config.get<string>('DB_HOST', '127.0.0.1'),
        port: config.get<number>('DB_PORT', 3306),
        username: config.get<string>('DB_USER', 'root'),
        password: config.get<string>('DB_PASSWORD', ''),
        database: config.get<string>('DB_NAME', 'ai_pmp'),
        autoLoadEntities: true,
        // 仅开发期使用，生产前必须切换为 migrations
        synchronize: config.get<string>('NODE_ENV') !== 'production',
      }),
    }),
    ProjectsModule,
    AuthModule,
    DocumentsModule,
    ChecksModule,
    TasksModule,
    TestsModule,
    ExportsModule,
    DefectsModule,
    ResourcesModule,
    MilestonesModule,
    AppVersionsModule,
    AgentModule,
    AgentAppsModule,
    ScriptsModule,
    FeishuModule,
    GithubModule,
    SettingsModule,
    ImagesModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // 全局登录 Guard：网页 JSON 接口要求登录（.md / @Public / WS 例外，见 auth.guard.ts）
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
