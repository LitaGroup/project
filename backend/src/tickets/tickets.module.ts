import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TaskTemplate } from '../tasks/task-template.entity';
import { Task } from '../tasks/task.entity';
import { TaskMessage } from '../tasks/task-message.entity';
import { TasksModule } from '../tasks/tasks.module';
import { Worker } from '../workers/worker.entity';
import { WorkflowDefinition } from '../workflows/workflow-definition.entity';
import { WorkflowDefinitionVersion } from '../workflows/workflow-definition-version.entity';
import { TicketConfig } from './ticket-config.entity';
import { Ticket } from './ticket.entity';
import { TicketWorkflowRun } from './ticket-workflow-run.entity';
import { TicketWorkflowRuntimeService } from './ticket-workflow-runtime.service';
import {
  TicketConfigsController,
  TicketsController,
  TicketTaskController,
} from './tickets.controller';
import { TicketsService } from './tickets.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Ticket,
      TicketConfig,
      TicketWorkflowRun,
      Task,
      TaskMessage,
      TaskTemplate,
      Worker,
      WorkflowDefinition,
      WorkflowDefinitionVersion,
    ]),
    TasksModule,
  ],
  controllers: [
    TicketsController,
    TicketConfigsController,
    TicketTaskController,
  ],
  providers: [TicketsService, TicketWorkflowRuntimeService],
})
export class TicketsModule {}
