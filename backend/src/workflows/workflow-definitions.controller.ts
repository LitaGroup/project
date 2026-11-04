import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import type { AuthedRequest } from '../auth/auth.guard';
import {
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

function resolveActor(req: AuthedRequest): WorkflowActor {
  if (req.user) return { id: req.user.id, name: req.user.name };
  if (req.worker) return { id: null, name: req.worker.name };
  return { id: null, name: '公共 Agent' };
}

/** 管理端「工单定义」：系统内置工单类型的工作流配置与发布 */
@Controller('ticket-workflow-definitions')
export class WorkflowDefinitionsController {
  constructor(private readonly definitions: WorkflowDefinitionsService) {}

  @Get()
  findAll() {
    return this.definitions.findAll();
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
}
