import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FeishuModule } from '../feishu/feishu.module';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeEmbeddingService } from './knowledge-embedding.service';
import { KnowledgeIndexService } from './knowledge-index.service';
import { KnowledgeService } from './knowledge.service';
import { KnowledgeStore } from './knowledge.store';

@Module({
  imports: [AuthModule, FeishuModule],
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
