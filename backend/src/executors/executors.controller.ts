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
  Query,
} from '@nestjs/common';
import { ExecutorType } from '../common/enums';
import { Executor, ExecutorProvider } from './executor.entity';
import {
  CreateExecutorInput,
  ExecutorsService,
  UpdateExecutorInput,
} from './executors.service';

class CreateExecutorDto implements CreateExecutorInput {
  name: string;
  ip: string;
  port: number;
  type?: ExecutorType;
  description?: string | null;
  token?: string | null;
}

class UpdateExecutorDto implements UpdateExecutorInput {
  name?: string;
  ip?: string;
  port?: number;
  type?: ExecutorType;
  description?: string | null;
  token?: string | null;
  enabled?: boolean;
}

@Controller('executors')
export class ExecutorsController {
  constructor(private readonly executorsService: ExecutorsService) {}

  /** 执行器列表（含在线状态/版本/默认目录/供应商缓存同步时间） */
  @Get()
  findAll(@Query('enabled') enabled?: string): Promise<Executor[]> {
    if (enabled === undefined) return this.executorsService.findAll();
    return this.executorsService
      .findAll()
      .then((list) => list.filter((e) => String(e.enabled) === enabled));
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number): Promise<Executor> {
    return this.executorsService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateExecutorDto): Promise<Executor> {
    return this.executorsService.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateExecutorDto,
  ): Promise<Executor> {
    return this.executorsService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.executorsService.remove(id);
  }

  /** 立即健康检查（刷新在线状态/版本/默认目录） */
  @Post(':id/check')
  check(@Param('id', ParseIntPipe) id: number): Promise<Executor> {
    return this.executorsService.check(id);
  }

  /** 同步供应商与模型缓存（从执行器拉取，落 providersCache） */
  @Post(':id/sync-providers')
  syncProviders(@Param('id', ParseIntPipe) id: number): Promise<Executor> {
    return this.executorsService.syncProviders(id);
  }

  /** 供应商缓存（机器人表单三级联动用） */
  @Get(':id/providers')
  async providers(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ExecutorProvider[]> {
    const executor = await this.executorsService.findOne(id);
    return executor.providersCache ?? [];
  }
}
