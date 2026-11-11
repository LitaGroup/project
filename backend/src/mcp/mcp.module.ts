import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ChecksModule } from '../checks/checks.module';
import { DefectsModule } from '../defects/defects.module';
import { DocumentsModule } from '../documents/documents.module';
import { ExportsModule } from '../exports/exports.module';
import { FeedbacksModule } from '../feedbacks/feedbacks.module';
import { FeishuModule } from '../feishu/feishu.module';
import { FeishuBotGroup } from '../feishu-bot/feishu-bot-group.entity';
import { FeishuBotModule } from '../feishu-bot/feishu-bot.module';
import { FilesModule } from '../files/files.module';
import { GithubModule } from '../github/github.module';
import { IdeasModule } from '../ideas/ideas.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { MilestonesModule } from '../milestones/milestones.module';
import { ProjectsModule } from '../projects/projects.module';
import { ReleasesModule } from '../releases/releases.module';
import { ResourcesModule } from '../resources/resources.module';
import { SchedulesModule } from '../schedules/schedules.module';
import { ScriptsModule } from '../scripts/scripts.module';
import { SettingsModule } from '../settings/settings.module';
import { TasksModule } from '../tasks/tasks.module';
import { TestsModule } from '../tests/tests.module';
import { TicketsModule } from '../tickets/tickets.module';
import { WorkersModule } from '../workers/workers.module';
import { McpCallLog } from './mcp-log.entity';
import { McpController } from './mcp.controller';
import { McpLogsController } from './mcp-logs.controller';
import { McpLogsService } from './mcp-logs.service';
import { McpService } from './mcp.service';
import { McpWorkController } from './mcp-work.controller';
import { McpWorkService } from './mcp-work.service';
import { WorkDefectTools } from './work-tools/work-defect.tools';
import { WorkFeedbackTools } from './work-tools/work-feedback.tools';
import { WorkFeishuTools } from './work-tools/work-feishu.tools';
import { WorkFileTools } from './work-tools/work-file.tools';
import { WorkGithubTools } from './work-tools/work-github.tools';
import { WorkIdeaTools } from './work-tools/work-idea.tools';
import { WorkKnowledgeTools } from './work-tools/work-knowledge.tools';
import { WorkProjectTools } from './work-tools/work-project.tools';
import { WorkRunTools } from './work-tools/work-run.tools';
import { WorkTaskTools } from './work-tools/work-task.tools';
import { WorkTicketTools } from './work-tools/work-ticket.tools';
import { WorkAgentTools } from './work-tools/work-agent.tools';
/**
 * MCP 开放：
 * - POST /api/mcp/bots：lita-bots，外部 Agent 把平台机器人当子 Agent 调用；
 * - POST /api/mcp/work：lita-work，平台项目/知识/运行等工具（替代 lita-work 等技能）。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([McpCallLog, FeishuBotGroup]),
    AuthModule,
    WorkersModule,
    ProjectsModule,
    DocumentsModule,
    ResourcesModule,
    MilestonesModule,
    ChecksModule,
    TestsModule,
    ExportsModule,
    SchedulesModule,
    KnowledgeModule,
    FilesModule,
    DefectsModule,
    ReleasesModule,
    FeedbacksModule,
    IdeasModule,
    SettingsModule,
    ScriptsModule,
    FeishuModule,
    FeishuBotModule,
    GithubModule,
    TasksModule,
    TicketsModule,
  ],
  controllers: [McpController, McpWorkController, McpLogsController],
  providers: [
    McpService,
    McpWorkService,
    McpLogsService,
    WorkProjectTools,
    WorkRunTools,
    WorkKnowledgeTools,
    WorkDefectTools,
    WorkFeedbackTools,
    WorkIdeaTools,
    WorkGithubTools,
    WorkFileTools,
    WorkTaskTools,
    WorkTicketTools,
    WorkAgentTools,
    WorkFeishuTools,
  ],
})
export class McpModule {}
