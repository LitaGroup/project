import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../auth/user.entity';
import { TaskTemplate } from '../tasks/task-template.entity';
import { Task } from '../tasks/task.entity';
import { TasksModule } from '../tasks/tasks.module';
import { Worker } from '../workers/worker.entity';
import { TicketConfig } from './ticket-config.entity';
import { Ticket } from './ticket.entity';
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
      Task,
      TaskTemplate,
      Worker,
      User,
    ]),
    TasksModule,
  ],
  controllers: [
    TicketsController,
    TicketConfigsController,
    TicketTaskController,
  ],
  providers: [TicketsService],
})
export class TicketsModule {}
