import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { AuthedRequest } from '../auth/auth.guard';
import {
  CreateTicketInput,
  RouteTicketInput,
  TicketsService,
  UpdateTicketConfigInput,
} from './tickets.service';

class CreateTicketDto implements CreateTicketInput {
  category?: string;
  title?: string;
  description?: string;
  workflowDefinitionId?: number;
  inputValues?: Record<string, unknown>;
}

class RouteTicketDto implements RouteTicketInput {
  templateId: number;
  title: string;
  content: string;
  outputSpec: string;
  workPlan: string;
}

class UpdateTicketConfigDto implements UpdateTicketConfigInput {
  allowedTemplateIds?: number[];
}

@Controller('tickets')
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Get()
  findAll(
    @Req() req: AuthedRequest,
    @Query('category') category?: string,
    @Query('status') status?: string,
    @Query('q') q?: string,
    @Query('workflowDefinitionId') workflowDefinitionId?: string,
    @Query('scope') scope?: string,
  ) {
    const definitionId = Number(workflowDefinitionId);
    const mine = scope?.trim() === 'mine';
    if (mine && !req.user) {
      throw new ForbiddenException('查看我的工单需要用户身份');
    }
    return this.tickets.findAll({
      category,
      status,
      q,
      workflowDefinitionId:
        Number.isInteger(definitionId) && definitionId > 0
          ? definitionId
          : undefined,
      createdById: mine ? req.user?.id : undefined,
    });
  }

  @Get(':id.md')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  ticketMarkdown(@Param('id', ParseIntPipe) id: number) {
    return this.tickets.ticketMarkdown(id);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.tickets.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateTicketDto, @Req() req: AuthedRequest) {
    if (!req.user) throw new ForbiddenException('创建工单需要用户身份');
    return this.tickets.create(dto, req.user);
  }

  /** 机器人拒绝当前节点：nodeKey 须与当前节点一致，仅当前节点处理机器人可用 */
  @Post(':id/reject.md')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  rejectMarkdown(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: { nodeKey?: string; reason?: string },
    @Req() req: AuthedRequest,
  ) {
    if (!req.worker) {
      throw new ForbiddenException(
        '工单节点拒绝仅接受机器人身份（X-Worker-Token）',
      );
    }
    return this.tickets.rejectMarkdown(id, req.worker, dto);
  }

  @Post(':id/workflow/accept')
  acceptWorkflow(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: { remark?: string },
    @Req() req: AuthedRequest,
  ) {
    return this.tickets.acceptWorkflow(id, 'approved', req, dto?.remark);
  }

  @Post(':id/workflow/reject')
  rejectWorkflow(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: { remark?: string },
    @Req() req: AuthedRequest,
  ) {
    return this.tickets.acceptWorkflow(id, 'rejected', req, dto?.remark);
  }
}

@Controller('ticket-configs')
export class TicketConfigsController {
  constructor(private readonly tickets: TicketsService) {}

  @Get()
  findAll() {
    return this.tickets.listConfigs();
  }

  @Patch(':category')
  update(
    @Param('category') category: string,
    @Body() dto: UpdateTicketConfigDto,
  ) {
    return this.tickets.updateConfig(category, dto);
  }
}

/** 调度机器人专用任务视图与转交接口（路径挂在 tasks 下，使用当前任务 ID） */
@Controller('tasks')
export class TicketTaskController {
  constructor(private readonly tickets: TicketsService) {}

  @Get(':id/ticket.md')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  ticket(@Param('id', ParseIntPipe) id: number) {
    return this.tickets.taskTicketMarkdown(id);
  }

  @Post(':id/ticket-route.md')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  route(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RouteTicketDto,
    @Req() req: AuthedRequest,
  ) {
    if (!req.worker) {
      throw new ForbiddenException(
        '工单转交仅接受当前执行机器人身份（X-Worker-Token）',
      );
    }
    return this.tickets.routeMarkdown(id, req.worker, dto);
  }
}
