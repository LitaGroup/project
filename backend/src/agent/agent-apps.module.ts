import { Module } from '@nestjs/common';
import { AgentModule } from './agent.module';
import { RemoteRunModule } from '../remote-run/remote-run.module';
import { AgentAppsController } from './agent-apps.controller';

/**
 * APP 包管理模块：/api/agent/apps/* 端点。
 * 依赖 RemoteRunModule（互斥检查），RemoteRunModule 又依赖 AgentModule——
 * 本模块独立挂载避免循环依赖。
 */
@Module({
  imports: [AgentModule, RemoteRunModule],
  controllers: [AgentAppsController],
})
export class AgentAppsModule {}
