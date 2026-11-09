import {
  Body,
  Controller,
  Get,
  Header,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { AuthedRequest } from '../auth/auth.guard';
import {
  AgentCreateTaskInput,
  AgentTaskQuery,
  TasksAgentService,
} from './tasks-agent.service';

class CreateTaskMarkdownDto implements AgentCreateTaskInput {
  title?: string;
  description?: string | null;
  input?: string | null;
  outputSpec?: string | null;
  templateId?: number | null;
}

/** GET /api/tasks.md：Agent 的「我的任务」清单（单段路径经独立控制器挂载） */
@Controller('tasks.md')
export class TasksListMarkdownController {
  constructor(private readonly agent: TasksAgentService) {}

  @Get()
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  async list(
    @Req() req: AuthedRequest,
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('subStatus') subStatus?: string,
    @Query('rootOnly') rootOnly?: string,
  ): Promise<string> {
    const scope = await this.agent.resolveScope(req);
    const params: AgentTaskQuery = {
      q,
      status,
      subStatus,
      rootOnly: rootOnly === 'true',
    };
    return this.agent.listMarkdown(scope, params);
  }
}

/** POST /api/tasks/create.md：机器人 / 个人 AGENT / 用户创建根任务 */
@Controller('tasks')
export class TasksAgentMarkdownController {
  constructor(private readonly agent: TasksAgentService) {}

  @Post('create.md')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  async create(
    @Req() req: AuthedRequest,
    @Body() dto: CreateTaskMarkdownDto,
  ): Promise<string> {
    return this.agent.createMarkdown(req, dto);
  }
}
