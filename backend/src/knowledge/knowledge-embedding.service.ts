import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * OpenAI 兼容 Embedding 客户端。
 * Base URL 示例：https://api.openai.com/v1（请求 `${base}/embeddings`）
 */
@Injectable()
export class KnowledgeEmbeddingService {
  private readonly logger = new Logger(KnowledgeEmbeddingService.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  readonly dimensions: number;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = (
      config.get<string>('PROJECT_KNOWLEDGE_EMBEDDING_BASE_URL') ?? ''
    )
      .trim()
      .replace(/\/+$/, '');
    this.apiKey = (
      config.get<string>('PROJECT_KNOWLEDGE_EMBEDDING_API_KEY') ?? ''
    ).trim();
    this.model = (
      config.get<string>('PROJECT_KNOWLEDGE_EMBEDDING_MODEL') ?? ''
    ).trim();
    const rawDimensions = (
      config.get<string>('PROJECT_KNOWLEDGE_EMBEDDING_DIMENSIONS') ?? '1024'
    ).trim();
    const dimensions = Number(rawDimensions);
    this.dimensions =
      Number.isInteger(dimensions) && dimensions > 0 && dimensions <= 8192
        ? dimensions
        : 1024;
  }

  get configured(): boolean {
    return Boolean(this.baseUrl && this.model);
  }

  get modelName(): string {
    return this.model;
  }

  /** 单条查询向量；失败抛错，由搜索降级为全文 */
  async embedOne(text: string): Promise<number[]> {
    const vectors = await this.embedMany([text]);
    return vectors[0];
  }

  /** 批量向量；只支持 OpenAI `/embeddings` 的 data[].embedding 结构 */
  async embedMany(texts: string[]): Promise<number[][]> {
    if (!this.configured) throw new Error('Embedding 服务未配置');
    if (texts.length === 0) return [];
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
        dimensions: this.dimensions,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(
        `Embedding 请求失败（HTTP ${response.status}）${text ? `：${text.slice(0, 300)}` : ''}`,
      );
    }
    const payload = (await response.json()) as {
      data?: Array<{ embedding?: unknown; index?: number }>;
    };
    const data = payload.data;
    if (!Array.isArray(data) || data.length !== texts.length) {
      throw new Error('Embedding 响应格式不正确：data 数量与输入不一致');
    }
    const sorted = [...data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    return sorted.map((item, i) => {
      if (!Array.isArray(item.embedding)) {
        throw new Error(`Embedding 响应第 ${i + 1} 条缺少 embedding`);
      }
      const vector = item.embedding.map(Number);
      if (
        vector.length !== this.dimensions ||
        vector.some((v) => !Number.isFinite(v))
      ) {
        throw new Error(
          `Embedding 维度不匹配：期望 ${this.dimensions}，实际 ${vector.length}；请检查 PROJECT_KNOWLEDGE_EMBEDDING_DIMENSIONS`,
        );
      }
      return vector;
    });
  }

  logDisabled(): void {
    this.logger.warn(
      'Embedding 未配置，知识搜索降级为全文检索；请配置 PROJECT_KNOWLEDGE_EMBEDDING_*',
    );
  }
}
