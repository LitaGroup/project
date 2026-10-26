import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApipostModule } from '../apipost/apipost.module';
import { FeishuModule } from '../feishu/feishu.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { Document } from './document.entity';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Document]),
    FeishuModule,
    ApipostModule,
    KnowledgeModule,
  ],
  controllers: [DocumentsController],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
