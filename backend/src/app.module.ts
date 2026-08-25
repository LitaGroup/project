import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AppVersionsModule } from './app-versions/app-versions.module';
import { AgentModule } from './agent/agent.module';
import { ProjectsModule } from './projects/projects.module';
import { DocumentsModule } from './documents/documents.module';
import { ChecksModule } from './checks/checks.module';
import { TasksModule } from './tasks/tasks.module';
import { TestsModule } from './tests/tests.module';
import { DefectsModule } from './defects/defects.module';
import { FeishuModule } from './feishu/feishu.module';
import { ScriptsModule } from './scripts/scripts.module';
import { SettingsModule } from './settings/settings.module';

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
    DocumentsModule,
    ChecksModule,
    TasksModule,
    TestsModule,
    DefectsModule,
    AppVersionsModule,
    AgentModule,
    ScriptsModule,
    FeishuModule,
    SettingsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
