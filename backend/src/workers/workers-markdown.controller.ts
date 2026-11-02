import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { WorkerRole, WorkerRuntime } from '../common/enums';
import { Worker } from './worker.entity';
import { CreateWorkerInput, UpdateWorkerInput } from './workers.service';
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
  constructor(private readonly markdown: WorkersMarkdownService) {}

  @Get(':id.md')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  findOne(@Param('id', ParseIntPipe) id: number): Promise<string> {
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
