import { Module } from '@nestjs/common';
import { AgentModule } from '../agent/agent.module';
import {
  SettingsController,
  SettingsMarkdownController,
} from './settings.controller';
import { SettingsService } from './settings.service';

@Module({
  imports: [AgentModule],
  controllers: [SettingsController, SettingsMarkdownController],
  providers: [SettingsService],
})
export class SettingsModule {}
