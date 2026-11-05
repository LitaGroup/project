import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import type { AuthedRequest } from '../auth/auth.guard';
import { Task } from './task.entity';
import { TaskTemplate } from './task-template.entity';
import {
  CreateTaskTemplateInput,
  TaskTemplateActor,
  TaskTemplatesService,
  TaskTemplateWithFollow,
  UpdateTaskTemplateInput,
} from './task-templates.service';

class CreateTaskTemplateDto implements CreateTaskTemplateInput {
  name: string;
  type?: string | null;
  description?: string | null;
  agentIds?: number[] | null;
}

class UpdateTaskTemplateDto implements UpdateTaskTemplateInput {
  name?: string;
  type?: string | null;
  description?: string | null;
  agentIds?: number[] | null;
}

@Controller('task-templates')
export class TaskTemplatesController {
  constructor(private readonly templatesService: TaskTemplatesService) {}

  @Get()
  findAll(@Req() req: AuthedRequest): Promise<TaskTemplateWithFollow[]> {
    return this.templatesService.findAll(req.user?.id);
  }

  /** 任务定义详情侧数据：匹配该定义的最近任务（最多 5 个，含根任务与子任务） */
  @Get(':id/tasks')
  findRecentTasks(@Param('id', ParseIntPipe) id: number): Promise<Task[]> {
    return this.templatesService.findRecentTasks(id);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number): Promise<TaskTemplate> {
    return this.templatesService.findOne(id);
  }

  @Post()
  create(
    @Body() dto: CreateTaskTemplateDto,
    @Req() req: AuthedRequest,
  ): Promise<TaskTemplateWithFollow> {
    return this.templatesService.create(dto, req.user ?? null);
  }

  /** 关注任务定义（个人中心「我的任务定义」） */
  @Post(':id/follow')
  follow(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthedRequest,
  ): Promise<TaskTemplateWithFollow> {
    return this.templatesService.follow(id, req.user!.id);
  }

  /** 取消关注任务定义 */
  @Delete(':id/follow')
  unfollow(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthedRequest,
  ): Promise<TaskTemplateWithFollow> {
    return this.templatesService.unfollow(id, req.user!.id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTaskTemplateDto,
  ): Promise<TaskTemplate> {
    return this.templatesService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.templatesService.remove(id);
  }
}

/** 用户 Agent / 公共 Agent 记录用户身份；机器人 Token 仅记录机器人名称 */
function resolveTemplateActor(req: AuthedRequest): TaskTemplateActor | null {
  if (req.user) return { id: req.user.id, name: req.user.name };
  if (req.worker) return { id: null, name: req.worker.name };
  return null;
}

/** GET /api/task-templates.md：Agent 用的任务定义清单 */
@Controller('task-templates.md')
export class TaskTemplatesListMarkdownController {
  constructor(private readonly templatesService: TaskTemplatesService) {}

  @Get()
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  list(): Promise<string> {
    return this.templatesService.listMarkdown();
  }
}

/** 任务定义 Agent CRUD：详情与写操作 */
@Controller('task-templates')
export class TaskTemplatesMarkdownController {
  constructor(private readonly templatesService: TaskTemplatesService) {}

  @Get(':id.md')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  findOne(@Param('id', ParseIntPipe) id: number): Promise<string> {
    return this.templatesService.findOneMarkdown(id);
  }

  @Post('create.md')
  @HttpCode(200)
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  create(
    @Body() dto: CreateTaskTemplateDto,
    @Req() req: AuthedRequest,
  ): Promise<string> {
    return this.templatesService.createMarkdown(dto, resolveTemplateActor(req));
  }

  @Post(':id/update.md')
  @HttpCode(200)
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTaskTemplateDto,
  ): Promise<string> {
    return this.templatesService.updateMarkdown(id, dto);
  }

  @Post(':id/delete.md')
  @HttpCode(200)
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  remove(@Param('id', ParseIntPipe) id: number): Promise<string> {
    return this.templatesService.removeMarkdown(id);
  }
}
