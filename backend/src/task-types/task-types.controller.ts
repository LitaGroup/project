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
} from '@nestjs/common';
import { TaskType } from './task-type.entity';
import {
  CreateTaskTypeInput,
  TaskTypesService,
  UpdateTaskTypeInput,
} from './task-types.service';

class CreateTaskTypeDto implements CreateTaskTypeInput {
  name: string;
  description?: string | null;
}

class UpdateTaskTypeDto implements UpdateTaskTypeInput {
  name?: string;
  description?: string | null;
}

@Controller('task-types')
export class TaskTypesController {
  constructor(private readonly taskTypesService: TaskTypesService) {}

  @Get()
  findAll(): Promise<TaskType[]> {
    return this.taskTypesService.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number): Promise<TaskType> {
    return this.taskTypesService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateTaskTypeDto): Promise<TaskType> {
    return this.taskTypesService.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTaskTypeDto,
  ): Promise<TaskType> {
    return this.taskTypesService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.taskTypesService.remove(id);
  }
}

/** GET /api/task-types.md：Agent 用的任务类型清单 */
@Controller('task-types.md')
export class TaskTypesListMarkdownController {
  constructor(private readonly taskTypesService: TaskTypesService) {}

  @Get()
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  list(): Promise<string> {
    return this.taskTypesService.listMarkdown();
  }
}

/** 任务类型 Agent CRUD：详情与写操作 */
@Controller('task-types')
export class TaskTypesMarkdownController {
  constructor(private readonly taskTypesService: TaskTypesService) {}

  @Get(':id.md')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  findOne(@Param('id', ParseIntPipe) id: number): Promise<string> {
    return this.taskTypesService.findOneMarkdown(id);
  }

  @Post('create.md')
  @HttpCode(200)
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  create(@Body() dto: CreateTaskTypeDto): Promise<string> {
    return this.taskTypesService.createMarkdown(dto);
  }

  @Post(':id/update.md')
  @HttpCode(200)
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTaskTypeDto,
  ): Promise<string> {
    return this.taskTypesService.updateMarkdown(id, dto);
  }

  @Post(':id/delete.md')
  @HttpCode(200)
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  remove(@Param('id', ParseIntPipe) id: number): Promise<string> {
    return this.taskTypesService.removeMarkdown(id);
  }
}
