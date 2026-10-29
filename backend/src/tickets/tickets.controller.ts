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
import type { TicketAssigneeType } from './ticket.entity';
import {
  CreateTicketInput,
  RouteTicketInput,
  TicketsService,
  UpdateTicketConfigInput,
} from './tickets.service';

class CreateTicketDto implements CreateTicketInput {
  category: string;
  title?: string;
  description?: string;
  assigneeType: TicketAssigneeType;
  assigneeId: number;
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
    @Query('category') category?: string,
    @Query('status') status?: string,
    @Query('q') q?: string,
  ) {
    return this.tickets.findAll({ category, status, q });
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
