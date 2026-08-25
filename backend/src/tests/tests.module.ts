import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppVersion } from '../app-versions/app-version.entity';
import { RemoteRunModule } from '../remote-run/remote-run.module';
import { Project } from '../projects/project.entity';
import { TestRun } from './test-run.entity';
import { Test } from './test.entity';
import { TestsController } from './tests.controller';
import { TestsService } from './tests.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Test, TestRun, Project, AppVersion]),
    RemoteRunModule,
  ],
  controllers: [TestsController],
  providers: [TestsService],
  exports: [TestsService],
})
export class TestsModule {}
