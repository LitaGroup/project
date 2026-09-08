import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Document } from '../documents/document.entity';
import { DocumentsModule } from '../documents/documents.module';
import { Project } from '../projects/project.entity';
import { Resource } from './resource.entity';
import { ResourcesController } from './resources.controller';
import { ResourcesService } from './resources.service';
import { WordSheetService } from './word-sheet.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Resource, Project, Document]),
    DocumentsModule,
  ],
  controllers: [ResourcesController],
  providers: [ResourcesService, WordSheetService],
  exports: [ResourcesService],
})
export class ResourcesModule {}
