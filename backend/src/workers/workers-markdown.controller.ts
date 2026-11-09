import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { AuthedRequest } from '../auth/auth.guard';
import {
  UserRole,
  WorkerGithubPermission,
  WorkerResourcePermission,
  WorkerRole,
  WorkerRuntime,
} from '../common/enums';
import { Worker } from './worker.entity';
import {
  CreateWorkerInput,
  UpdateWorkerInput,
  WorkersService,
} from './workers.service';
import { WorkersMarkdownService } from './workers-markdown.service';

class CreateWorkerMarkdownDto implements CreateWorkerInput {
  name: string;
  intro?: string | null;
  avatarUrl?: string | null;
  role?: WorkerRole;
  runtime?: WorkerRuntime;
  executorId?: number | null;
  providerId?: string | null;
  modelId?: string | null;
  variant?: string | null;
  prompt?: string | null;
  skills?: Worker['skills'];
  standards?: Worker['standards'];
  taskDefs?: Worker['taskDefs'];
  ownerUserId?: number | null;
  enabled?: boolean;
  githubPermission?: WorkerGithubPermission;
  resourcePermission?: WorkerResourcePermission;
}

class UpdateWorkerMarkdownDto implements UpdateWorkerInput {
  name?: string;
  intro?: string | null;
  avatarUrl?: string | null;
  role?: WorkerRole;
  runtime?: WorkerRuntime;
  executorId?: number | null;
  providerId?: string | null;
  modelId?: string | null;
  variant?: string | null;
  prompt?: string | null;
  skills?: Worker['skills'];
  standards?: Worker['standards'];
  taskDefs?: Worker['taskDefs'];
  ownerUserId?: number | null;
  enabled?: boolean;
  githubPermission?: WorkerGithubPermission;
  resourcePermission?: WorkerResourcePermission;
}

/** GET /api/workers.md：Agent 用的机器人清单 */
@Controller('workers.md')
export class WorkersListMarkdownController {
  constructor(private readonly markdown: WorkersMarkdownService) {}

  @Get()
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  list(@Query('role') role?: WorkerRole): Promise<string> {
    return this.markdown.listMarkdown({ role: role || undefined });
  }
}

/** 机器人 Agent CRUD：详情与写操作 */
@Controller('workers')
export class WorkersMarkdownController {
  constructor(
    private readonly markdown: WorkersMarkdownService,
    private readonly workersService: WorkersService,
  ) {}

  @Get(':id.md')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  async findOne(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthedRequest,
  ): Promise<string> {
    const worker = await this.workersService.findOne(id);
    // 个人 AGENT 只用于「我的 AI」与个人中心配置：仅本人、管理员或自身机器人令牌可读
    if (
      worker.personalAgentUserId &&
      req.user?.role !== UserRole.ADMIN &&
      req.worker?.id !== id &&
      worker.personalAgentUserId !== req.user?.id
    ) {
      throw new ForbiddenException('无权访问该个人 AGENT');
    }
    return this.markdown.findOneMarkdown(id);
  }

  @Post('create.md')
  @HttpCode(200)
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  create(@Body() dto: CreateWorkerMarkdownDto): Promise<string> {
    return this.markdown.createMarkdown(dto);
  }

  @Post(':id/update.md')
  @HttpCode(200)
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateWorkerMarkdownDto,
  ): Promise<string> {
    return this.markdown.updateMarkdown(id, dto);
  }

  @Post(':id/delete.md')
  @HttpCode(200)
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  remove(@Param('id', ParseIntPipe) id: number): Promise<string> {
    return this.markdown.removeMarkdown(id);
  }
}
