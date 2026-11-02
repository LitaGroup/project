import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import type { AuthedRequest } from '../auth/auth.guard';
import { TaskTemplate } from './task-template.entity';
import {
  CreateTaskTemplateInput,
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
