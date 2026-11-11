import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentModule } from '../agent/agent.module';
import { FeishuBotConfig } from '../feishu-bot/feishu-bot-config.entity';
import { ScriptsModule } from '../scripts/scripts.module';
import {
  SettingsController,
  SettingsMarkdownController,
} from './settings.controller';
import { SettingsService } from './settings.service';

@Module({
  imports: [
    AgentModule,
    ScriptsModule,
    TypeOrmModule.forFeature([FeishuBotConfig]),
  ],
  controllers: [SettingsController, SettingsMarkdownController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
