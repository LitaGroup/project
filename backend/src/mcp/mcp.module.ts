import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { WorkersModule } from '../workers/workers.module';
import { McpCallLog } from './mcp-log.entity';
import { McpController } from './mcp.controller';
import { McpLogsController } from './mcp-logs.controller';
import { McpLogsService } from './mcp-logs.service';
import { McpService } from './mcp.service';

/** 平台机器人 MCP 开放：外部 AI Agent 经 Streamable HTTP 调用机器人（子 Agent 模式） */
@Module({
  imports: [TypeOrmModule.forFeature([McpCallLog]), AuthModule, WorkersModule],
  controllers: [McpController, McpLogsController],
  providers: [McpService, McpLogsService],
})
export class McpModule {}
