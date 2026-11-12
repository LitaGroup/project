import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../auth/user.entity';
import { FeishuBotModule } from '../feishu-bot/feishu-bot.module';
import { Project } from '../projects/project.entity';
import { TasksModule } from '../tasks/tasks.module';
import { Worker } from '../workers/worker.entity';
import { Backlog } from './backlog.entity';
import { BacklogsService } from './backlogs.service';
import { Iteration } from './iteration.entity';
import {
  BacklogsController,
  IterationsController,
  IterationsMarkdownController,
} from './iterations.controller';
import { IterationsService } from './iterations.service';

/**
 * 迭代：T0 常驻快速通道 + W1 周迭代。
 * 迭代项从需求转入，指定负责人机器人后自动创建交付任务并建立飞书沟通群。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Iteration, Backlog, Project, Worker, User]),
    TasksModule,
    FeishuBotModule,
  ],
  controllers: [
    IterationsController,
    IterationsMarkdownController,
    BacklogsController,
  ],
  providers: [IterationsService, BacklogsService],
  exports: [IterationsService, BacklogsService],
})
export class IterationsModule {}
