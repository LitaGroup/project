import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ModelConfigModule } from '../model-config/model-config.module';
import { ProjectsModule } from '../projects/projects.module';
import { Idea } from './idea.entity';
import { IdeasController, IdeasMarkdownController } from './ideas.controller';
import { IdeasService } from './ideas.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Idea]),
    ProjectsModule,
    ModelConfigModule,
  ],
  controllers: [IdeasController, IdeasMarkdownController],
  providers: [IdeasService],
  exports: [IdeasService],
})
export class IdeasModule {}
