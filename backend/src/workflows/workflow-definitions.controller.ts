import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import type { AuthedRequest } from '../auth/auth.guard';
import {
  CreateWorkflowDefinitionInput,
  SaveWorkflowDefinitionInput,
  WorkflowActor,
  WorkflowDefinitionsService,
} from './workflow-definitions.service';
import type { WorkflowDefinitionJson } from './workflow.types';

class SaveWorkflowDefinitionDto implements SaveWorkflowDefinitionInput {
  name?: string;
  description?: string | null;
  enabled?: boolean;
  definition: WorkflowDefinitionJson;
}

class CreateWorkflowDefinitionDto implements CreateWorkflowDefinitionInput {
  name: string;
  description?: string | null;
  definition?: WorkflowDefinitionJson;
}

function resolveActor(req: AuthedRequest): WorkflowActor {
  if (req.user) return { id: req.user.id, name: req.user.name };
  if (req.worker) return { id: null, name: req.worker.name };
  return { id: null, name: '公共 Agent' };
}

/** 管理端「工单配置」：工单工作流配置、草稿与发布版本 */
@Controller('ticket-workflow-definitions')
export class WorkflowDefinitionsController {
  constructor(private readonly definitions: WorkflowDefinitionsService) {}

  @Get()
  findAll() {
    return this.definitions.findAll();
  }

  @Post()
  create(@Body() dto: CreateWorkflowDefinitionDto, @Req() req: AuthedRequest) {
    return this.definitions.create(dto, resolveActor(req));
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.definitions.findOne(id);
  }

  @Put(':id/draft')
  saveDraft(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SaveWorkflowDefinitionDto,
  ) {
    return this.definitions.saveDraft(id, dto);
  }

  @Post(':id/publish')
  publish(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SaveWorkflowDefinitionDto,
    @Req() req: AuthedRequest,
  ) {
    return this.definitions.publish(id, dto, resolveActor(req));
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.definitions.remove(id);
  }
}
