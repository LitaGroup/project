import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { embeddingText } from './knowledge.chunk';
import { KnowledgeEmbeddingService } from './knowledge-embedding.service';
import { KnowledgeStore } from './knowledge.store';

/** 后台为知识切片生成向量；正文与全文索引先落库，Embedding 失败可重试 */
@Injectable()
export class KnowledgeIndexService implements OnApplicationBootstrap {
  private readonly logger = new Logger(KnowledgeIndexService.name);
  private running = false;

  constructor(
    private readonly store: KnowledgeStore,
    private readonly embedding: KnowledgeEmbeddingService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.embedding.configured) this.embedding.logDisabled();
    // 启动后立即补一轮，避免每次都要等 Interval
    setTimeout(() => void this.processPending(), 2_000).unref();
  }

  @Interval(10_000)
  async processPending(): Promise<void> {
    if (this.running || !this.store.isEnabled || !this.embedding.configured) {
      return;
    }
    this.running = true;
    try {
      const nodes = await this.store.listPendingNodes(10);
      for (const node of nodes) {
        const chunks = await this.store.listChunksWithoutEmbedding(node.id);
        if (chunks.length === 0) {
          await this.store.markNodeIndexed(node.id);
          continue;
        }
        try {
          for (let i = 0; i < chunks.length; i += 10) {
            const batch = chunks.slice(i, i + 10);
            const vectors = await this.embedding.embedMany(
              batch.map((chunk) =>
                embeddingText({
                  title: chunk.title,
                  path: chunk.path,
                  headingPath: chunk.headingPath,
                  content: chunk.content,
                }),
              ),
            );
            for (let j = 0; j < batch.length; j += 1) {
              await this.store.setChunkEmbedding(batch[j].id, vectors[j]);
            }
          }
          await this.store.markNodeIndexed(node.id);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          await this.store.markNodeIndexError(node.id, message);
          this.logger.warn(
            `知识向量生成失败（${node.path}）：${message}（将在下一轮重试）`,
          );
        }
      }
    } catch (error) {
      this.logger.warn(
        `知识向量任务扫描失败：${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.running = false;
    }
  }
}
