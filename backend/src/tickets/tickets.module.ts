import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TaskTemplate } from '../tasks/task-template.entity';
import { Task } from '../tasks/task.entity';
import { TaskMessage } from '../tasks/task-message.entity';
import { TasksModule } from '../tasks/tasks.module';
import { Worker } from '../workers/worker.entity';
import { WorkersModule } from '../workers/workers.module';
import { WorkflowDefinition } from '../workflows/workflow-definition.entity';
import { WorkflowDefinitionVersion } from '../workflows/workflow-definition-version.entity';
import { TicketConfig } from './ticket-config.entity';
import { TicketDocument } from './ticket-document.entity';
import { TicketDocumentsService } from './ticket-documents.service';
import { Ticket } from './ticket.entity';
import { TicketWorkflowRun } from './ticket-workflow-run.entity';
import { TicketWorkflowRuntimeService } from './ticket-workflow-runtime.service';
import { TicketsController, TicketTaskController } from './tickets.controller';
import { TicketsService } from './tickets.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Ticket,
      TicketConfig,
      TicketDocument,
      TicketWorkflowRun,
      Task,
      TaskMessage,
      TaskTemplate,
      Worker,
      WorkflowDefinition,
      WorkflowDefinitionVersion,
    ]),
    forwardRef(() => TasksModule),
    WorkersModule,
  ],
  controllers: [TicketsController, TicketTaskController],
  providers: [
    TicketsService,
    TicketDocumentsService,
    TicketWorkflowRuntimeService,
  ],
  exports: [TicketsService, TicketDocumentsService],
})
export class TicketsModule {}
