import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { homedir } from 'os';
import { resolve } from 'path';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AppVersionsModule } from './app-versions/app-versions.module';
import { AgentModule } from './agent/agent.module';
import { AgentAppsModule } from './agent/agent-apps.module';
import { ExecutorsModule } from './executors/executors.module';
import { TasksModule } from './tasks/tasks.module';
import { WorkersModule } from './workers/workers.module';
import { AuthModule } from './auth/auth.module';
import { AuthGuard } from './auth/auth.guard';
import { ProjectsModule } from './projects/projects.module';
import { KnowledgeModule } from './knowledge/knowledge.module';
import { DocumentsModule } from './documents/documents.module';
import { ChecksModule } from './checks/checks.module';
import { SchedulesModule } from './schedules/schedules.module';
import { TestsModule } from './tests/tests.module';
import { ExportsModule } from './exports/exports.module';
import { DefectsModule } from './defects/defects.module';
import { FeedbacksModule } from './feedbacks/feedbacks.module';
import { IdeasModule } from './ideas/ideas.module';
import { IterationsModule } from './iterations/iterations.module';
import { ResourcesModule } from './resources/resources.module';
import { MilestonesModule } from './milestones/milestones.module';
import { FeishuModule } from './feishu/feishu.module';
import { GithubModule } from './github/github.module';
import { GithubGatewayModule } from './github-gateway/github-gateway.module';
import { ScriptsModule } from './scripts/scripts.module';
import { SettingsModule } from './settings/settings.module';
import { FilesModule } from './files/files.module';
import { ImagesModule } from './images/images.module';
import { ReleasesModule } from './releases/releases.module';
import { TicketsModule } from './tickets/tickets.module';
import { WorkflowsModule } from './workflows/workflows.module';
import { McpModule } from './mcp/mcp.module';
import { McpServersModule } from './mcp-servers/mcp-servers.module';
import { ModelConfigModule } from './model-config/model-config.module';
import { FeishuBotModule } from './feishu-bot/feishu-bot.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // 优先级：进程环境变量 > backend/.env > ~/.env（Nest 按数组顺序合并，先出现者优先）
      envFilePath: [resolve(process.cwd(), '.env'), resolve(homedir(), '.env')],
    }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        host: config.get<string>('DB_HOST', '127.0.0.1'),
        port: config.get<number>('DB_PORT', 5432),
        username: config.get<string>('DB_USER', 'postgres'),
        password:
          config.get<string>('DB_PASSWORD') ||
          config.get<string>('PROJECT_PG_PASSWORD', ''),
        database: config.get<string>('DB_NAME', 'project'),
        ssl:
          config.get<string>('DB_SSL') === 'true'
            ? { rejectUnauthorized: false }
            : undefined,
        // 每个连接固定会话时区：库端 DEFAULT now()/CURRENT_TIMESTAMP 写北京墙钟，与 JS new Date() 写入对齐
        extra: { options: '-c timezone=Asia/Shanghai' },
        autoLoadEntities: true,
        // 仅开发期使用，生产前必须切换为 migrations
        synchronize: config.get<string>('NODE_ENV') !== 'production',
      }),
    }),
    ProjectsModule,
    AuthModule,
    KnowledgeModule,
    DocumentsModule,
    ChecksModule,
    SchedulesModule,
    TestsModule,
    ExportsModule,
    DefectsModule,
    FeedbacksModule,
    IdeasModule,
    IterationsModule,
    ResourcesModule,
    MilestonesModule,
    AppVersionsModule,
    AgentModule,
    AgentAppsModule,
    ExecutorsModule,
    WorkersModule,
    TasksModule,
    TicketsModule,
    WorkflowsModule,
    McpModule,
    McpServersModule,
    ModelConfigModule,
    ScriptsModule,
    FeishuModule,
    FeishuBotModule,
    GithubModule,
    GithubGatewayModule,
    SettingsModule,
    FilesModule,
    ImagesModule,
    ReleasesModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // 全局登录 Guard：网页 JSON 接口要求登录（.md / @Public / WS 例外，见 auth.guard.ts）
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
