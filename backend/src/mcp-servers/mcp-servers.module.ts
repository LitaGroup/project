import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Worker } from '../workers/worker.entity';
import { McpServer } from './mcp-server.entity';
import { McpServersController } from './mcp-servers.controller';
import { McpServersService } from './mcp-servers.service';

/**
 * 机器人可用的 MCP 服务配置：管理区 CRUD、连接测试与工位 opencode.json 生成。
 * 直接注册 Worker 实体做软引用校验（不 import WorkersModule，避免循环依赖）。
 */
@Module({
  imports: [TypeOrmModule.forFeature([McpServer, Worker])],
  controllers: [McpServersController],
  providers: [McpServersService],
  exports: [McpServersService],
})
export class McpServersModule {}
