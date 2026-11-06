import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { AuthedRequest } from '../auth/auth.guard';
import {
  TicketDocumentInput,
  TicketDocumentsService,
} from './ticket-documents.service';
import {
  CreateTicketInput,
  RouteTicketInput,
  TicketsService,
} from './tickets.service';

class CreateTicketDto implements CreateTicketInput {
  title?: string;
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

class TicketDocumentDto implements TicketDocumentInput {
  title?: string;
  url?: string;
  content?: string;
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

  /** 当前审批节点直接通过：仅节点任务绑定的真人处理人可用 */
  @Post(':id/workflow/approve')
  approveWorkflow(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthedRequest,
  ) {
    if (!req.user) throw new ForbiddenException('审批节点需要用户身份');
    return this.tickets.approveWorkflow(id, req.user);
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

/** 调度机器人专用任务视图、工单文档与转交接口（路径挂在 tasks 下，使用当前任务 ID） */
@Controller('tasks')
export class TicketTaskController {
  constructor(
    private readonly tickets: TicketsService,
    private readonly ticketDocuments: TicketDocumentsService,
  ) {}

  @Get(':id/ticket.md')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  ticket(@Param('id', ParseIntPipe) id: number) {
    return this.tickets.taskTicketMarkdown(id);
  }

  /** 当前任务所属工单的交付文档清单与调用指引 */
  @Get(':id/ticket-documents.md')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  listTicketDocuments(@Param('id', ParseIntPipe) id: number) {
    return this.ticketDocuments.listMarkdown(id);
  }

  /** 读取一篇工单交付文档（链接或正文） */
  @Get(':id/ticket-documents/:documentId.md')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  readTicketDocument(
    @Param('id', ParseIntPipe) id: number,
    @Param('documentId', ParseIntPipe) documentId: number,
  ) {
    return this.ticketDocuments.readMarkdown(id, documentId);
  }

  /** 交付任务文档到工单：url 与 content 二选一 */
  @Post(':id/ticket-documents.md')
  @HttpCode(200)
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  createTicketDocument(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: TicketDocumentDto,
    @Req() req: AuthedRequest,
  ) {
    if (!req.worker) {
      throw new ForbiddenException(
        '工单文档交付仅接受任务执行机器人身份（X-Worker-Token）',
      );
    }
    return this.ticketDocuments.createMarkdown(id, req.worker, dto);
  }

  /** 更新本任务交付的工单文档；url 或 content 只能传一项 */
  @Post(':id/ticket-documents/:documentId/update.md')
  @HttpCode(200)
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  updateTicketDocument(
    @Param('id', ParseIntPipe) id: number,
    @Param('documentId', ParseIntPipe) documentId: number,
    @Body() dto: TicketDocumentDto,
    @Req() req: AuthedRequest,
  ) {
    if (!req.worker) {
      throw new ForbiddenException(
        '工单文档维护仅接受任务执行机器人身份（X-Worker-Token）',
      );
    }
    return this.ticketDocuments.updateMarkdown(id, documentId, req.worker, dto);
  }

  /** 删除本任务交付的工单文档 */
  @Post(':id/ticket-documents/:documentId/delete.md')
  @HttpCode(200)
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  deleteTicketDocument(
    @Param('id', ParseIntPipe) id: number,
    @Param('documentId', ParseIntPipe) documentId: number,
    @Req() req: AuthedRequest,
  ) {
    if (!req.worker) {
      throw new ForbiddenException(
        '工单文档维护仅接受任务执行机器人身份（X-Worker-Token）',
      );
    }
    return this.ticketDocuments.deleteMarkdown(id, documentId, req.worker);
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
