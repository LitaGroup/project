import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppVersion } from '../app-versions/app-version.entity';
import { AgentModule } from '../agent/agent.module';
import { Check } from '../checks/check.entity';
import { CheckRun } from '../checks/check-run.entity';
import { Test } from '../tests/test.entity';
import { TestRun } from '../tests/test-run.entity';
import { RemoteRunService } from './remote-run.service';

@Module({
  imports: [
    AgentModule,
    TypeOrmModule.forFeature([TestRun, CheckRun, Test, Check, AppVersion]),
  ],
  providers: [RemoteRunService],
  exports: [RemoteRunService],
})
export class RemoteRunModule {}
