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
} from '@nestjs/common';
import { TaskTemplate } from './task-template.entity';
import {
  CreateTaskTemplateInput,
  TaskTemplatesService,
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
  findAll(): Promise<TaskTemplate[]> {
    return this.templatesService.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number): Promise<TaskTemplate> {
    return this.templatesService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateTaskTemplateDto): Promise<TaskTemplate> {
    return this.templatesService.create(dto);
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
