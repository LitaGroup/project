import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TaskTemplate } from '../tasks/task-template.entity';
import { Worker } from '../workers/worker.entity';
import { WorkflowDefinitionVersion } from './workflow-definition-version.entity';
import { WorkflowDefinition } from './workflow-definition.entity';
import { WorkflowDefinitionsController } from './workflow-definitions.controller';
import { WorkflowDefinitionsService } from './workflow-definitions.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      WorkflowDefinition,
      WorkflowDefinitionVersion,
      TaskTemplate,
      Worker,
    ]),
  ],
  controllers: [WorkflowDefinitionsController],
  providers: [WorkflowDefinitionsService],
  exports: [WorkflowDefinitionsService],
})
export class WorkflowsModule {}
