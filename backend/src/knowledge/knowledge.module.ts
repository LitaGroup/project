import { Module } from '@nestjs/common';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeEmbeddingService } from './knowledge-embedding.service';
import { KnowledgeIndexService } from './knowledge-index.service';
import { KnowledgeService } from './knowledge.service';
import { KnowledgeStore } from './knowledge.store';

@Module({
  controllers: [KnowledgeController],
  providers: [
    KnowledgeStore,
    KnowledgeEmbeddingService,
    KnowledgeIndexService,
    KnowledgeService,
  ],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
