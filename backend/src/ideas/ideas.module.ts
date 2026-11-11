import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectsModule } from '../projects/projects.module';
import { Idea } from './idea.entity';
import { IdeasController, IdeasMarkdownController } from './ideas.controller';
import { IdeasService } from './ideas.service';

@Module({
  imports: [TypeOrmModule.forFeature([Idea]), ProjectsModule],
  controllers: [IdeasController, IdeasMarkdownController],
  providers: [IdeasService],
  exports: [IdeasService],
})
export class IdeasModule {}
