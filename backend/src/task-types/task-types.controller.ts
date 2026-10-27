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
