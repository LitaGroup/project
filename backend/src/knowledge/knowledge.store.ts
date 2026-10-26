import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { Pool, type PoolClient } from 'pg';
import { chunkKnowledgeMarkdown } from './knowledge.chunk';
import {
  encodeKnowledgePath,
  normalizeKnowledgePath,
  projectDocumentPath,
  projectRootPath,
} from './knowledge.path';
import type {
  KnowledgeDirectory,
  KnowledgeIndexStatus,
  KnowledgeNode,
  KnowledgeNodeKind,
  KnowledgeNodeSource,
  KnowledgeNodeSummary,
  KnowledgeRetrieval,
  KnowledgeSearchResult,
} from './knowledge.types';

interface NodeRow {
  id: string;
  kind: KnowledgeNodeKind;
  path: string;
  parent_path: string;
  name: string;
  title: string;
  content: string | null;
  source: KnowledgeNodeSource;
  source_document_id: number | null;
  content_hash: string;
  index_status: KnowledgeIndexStatus;
  index_error: string | null;
  index_attempts: number;
  created_at: Date;
  updated_at: Date;
}

interface ChunkRow {
  id: string;
  node_id: string;
  title: string;
  path: string;
  heading_path: string;
  content: string;
  updated_at: Date;
}

function hashContent(title: string, content: string): string {
  return createHash('sha256').update(`${title}\n\n${content}`).digest('hex');
}

function mapNode(row: NodeRow): KnowledgeNode {
  return {
    id: row.id,
    kind: row.kind,
    path: row.path,
    parentPath: row.parent_path,
    name: row.name,
    title: row.title,
    content: row.content,
    source: row.source,
    sourceDocumentId: row.source_document_id,
    contentHash: row.content_hash,
    indexStatus: row.index_status,
    indexError: row.index_error,
    indexAttempts: row.index_attempts,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSummary(row: NodeRow): KnowledgeNodeSummary {
  return {
    id: row.id,
    kind: row.kind,
    path: row.path,
    parentPath: row.parent_path,
    name: row.name,
    title: row.title,
    source: row.source,
    sourceDocumentId: row.source_document_id,
    indexStatus: row.index_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

@Injectable()
export class KnowledgeStore implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(KnowledgeStore.name);
  private pool: Pool | null = null;
  private enabled = false;
  private configured = false;
  private disabledReason = '';
  readonly embeddingDimensions: number;

  constructor(private readonly config: ConfigService) {
    const rawDimensions = (
      config.get<string>('PROJECT_KNOWLEDGE_EMBEDDING_DIMENSIONS') ?? '1024'
    ).trim();
    const dimensions = Number(rawDimensions);
    this.embeddingDimensions =
      Number.isInteger(dimensions) && dimensions > 0 && dimensions <= 8192
        ? dimensions
        : 1024;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** 是否提供了 PG 连接配置（用于区分“未启用知识库”和“已配置但不可用”） */
  get isConfigured(): boolean {
    return this.configured;
  }

  get unavailableMessage(): string {
    return this.disabledReason || '知识库未初始化';
  }

  async onApplicationBootstrap(): Promise<void> {
    const host = (
      this.config.get<string>('PROJECT_PG_HOST') ??
      this.config.get<string>('DB_HOST')
    )?.trim();
    const user = (
      this.config.get<string>('PROJECT_PG_USER') ??
      this.config.get<string>('DB_USER')
    )?.trim();
    const database = (
      this.config.get<string>('PROJECT_PG_DATABASE') ??
      this.config.get<string>('DB_NAME')
    )?.trim();
    const password =
      this.config.get<string>('PROJECT_PG_PASSWORD') ??
      this.config.get<string>('DB_PASSWORD') ??
      '';
    const portRaw =
      this.config.get<string>('PROJECT_PG_PORT') ??
      this.config.get<string>('DB_PORT') ??
      '5432';
    const port = Number(portRaw);
    this.configured = Boolean(host && user && database);
    if (!host || !user || !database) {
      this.disabledReason =
        '知识库未配置：请设置 DB_HOST / DB_USER / DB_NAME（或独立的 PROJECT_PG_*）';
      this.logger.warn(`${this.disabledReason}（项目文档继续使用业务库正文）`);
      return;
    }
    if (!Number.isInteger(port) || port <= 0) {
      this.disabledReason = `知识库 PostgreSQL 端口非法：${portRaw}`;
      this.logger.error(this.disabledReason);
      return;
    }
    this.pool = new Pool({
      host,
      port,
      user,
      password,
      database,
      max: 10,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 60_000,
      ssl:
        this.config.get<string>('PROJECT_PG_SSL') === 'true' ||
        (!this.config.get<string>('PROJECT_PG_HOST') &&
          this.config.get<string>('DB_SSL') === 'true')
          ? { rejectUnauthorized: false }
          : undefined,
    });
    try {
      await this.initializeSchema();
      this.enabled = true;
      this.logger.log(
        `知识库已连接 ${host}:${port}/${database}（vector ${this.embeddingDimensions} 维）`,
      );
    } catch (error) {
      this.disabledReason = `知识库 PostgreSQL 初始化失败：${this.errorMessage(error)}`;
      this.logger.error(this.disabledReason);
      await this.pool.end().catch(() => undefined);
      this.pool = null;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end().catch(() => undefined);
    this.pool = null;
  }

  private db(): Pool {
    if (!this.enabled || !this.pool) throw new Error(this.unavailableMessage);
    return this.pool;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private async initializeSchema(): Promise<void> {
    const db = this.pool;
    if (!db) throw new Error('PostgreSQL 连接池不可用');
    const dims = this.embeddingDimensions;
    if (!Number.isInteger(dims) || dims <= 0 || dims > 8192) {
      throw new Error('Embedding 维度必须在 1..8192 之间');
    }
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query('CREATE EXTENSION IF NOT EXISTS vector');
      await client.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
      await client.query(`
        CREATE TABLE IF NOT EXISTS knowledge_nodes (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          kind text NOT NULL CHECK (kind IN ('directory', 'article')),
          path text NOT NULL UNIQUE,
          parent_path text NOT NULL,
          name text NOT NULL,
          title text NOT NULL,
          content text,
          source text NOT NULL DEFAULT 'native'
            CHECK (source IN ('native', 'project-document', 'system')),
          source_document_id integer,
          content_hash text NOT NULL DEFAULT '',
          index_status text NOT NULL DEFAULT 'pending'
            CHECK (index_status IN ('pending', 'ready', 'error')),
          index_error text,
          index_attempts integer NOT NULL DEFAULT 0,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS knowledge_nodes_source_document_uidx
        ON knowledge_nodes (source_document_id)
        WHERE source_document_id IS NOT NULL
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS knowledge_nodes_parent_idx
        ON knowledge_nodes (parent_path, kind, name)
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS knowledge_chunks (
          id bigserial PRIMARY KEY,
          node_id uuid NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
          chunk_index integer NOT NULL,
          title text NOT NULL,
          path text NOT NULL,
          heading_path text NOT NULL DEFAULT '',
          content text NOT NULL,
          embedding vector(${dims}),
          search_vector tsvector GENERATED ALWAYS AS (
            setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
            setweight(to_tsvector('simple', coalesce(path, '')), 'B') ||
            setweight(to_tsvector('simple', coalesce(heading_path, '')), 'B') ||
            setweight(to_tsvector('simple', coalesce(content, '')), 'C')
          ) STORED,
          created_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE (node_id, chunk_index)
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS knowledge_chunks_search_idx
        ON knowledge_chunks USING gin (search_vector)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS knowledge_chunks_content_trgm_idx
        ON knowledge_chunks USING gin (content gin_trgm_ops)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding_idx
        ON knowledge_chunks USING hnsw (embedding vector_cosine_ops)
      `);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      const detail = this.errorMessage(error);
      if (detail.includes('different vector dimensions')) {
        throw new Error(
          `知识库向量维度与 PROJECT_KNOWLEDGE_EMBEDDING_DIMENSIONS=${dims} 不一致，请使用相同维度或迁移并重建向量`,
        );
      }
      throw error;
    } finally {
      client.release();
    }
  }

  private async withTransaction<T>(
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.db().connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async getById(id: string): Promise<KnowledgeNode | null> {
    const result = await this.db().query<NodeRow>(
      'SELECT * FROM knowledge_nodes WHERE id = $1',
      [id],
    );
    return result.rows[0] ? mapNode(result.rows[0]) : null;
  }

  async getByPath(path: string): Promise<KnowledgeNode | null> {
    const normalized = normalizeKnowledgePath(path).path;
    const result = await this.db().query<NodeRow>(
      'SELECT * FROM knowledge_nodes WHERE path = $1',
      [normalized],
    );
    return result.rows[0] ? mapNode(result.rows[0]) : null;
  }

  async listChildren(path: string): Promise<KnowledgeDirectory> {
    const normalized = normalizeKnowledgePath(path);
    const result = await this.db().query<NodeRow>(
      `SELECT * FROM knowledge_nodes
       WHERE parent_path = $1
       ORDER BY kind = 'article', name COLLATE "C"`,
      [normalized.path],
    );
    const rows = result.rows.map(mapSummary);
    return {
      path: normalized.path,
      title: normalized.path === '/' ? '知识库' : normalized.name,
      parentPath:
        normalized.path === '/'
          ? null
          : normalized.parentPath === '/'
            ? '/'
            : normalized.parentPath,
      directories: rows.filter((r) => r.kind === 'directory'),
      articles: rows.filter((r) => r.kind === 'article'),
    };
  }

  private async ensureDirectory(
    client: PoolClient,
    path: string,
    source: KnowledgeNodeSource,
    title?: string,
  ): Promise<void> {
    const normalized = normalizeKnowledgePath(path);
    if (normalized.path === '/') return;
    await this.ensureDirectory(client, normalized.parentPath, source);
    await client.query(
      `INSERT INTO knowledge_nodes
         (kind, path, parent_path, name, title, source, content_hash, index_status)
       VALUES ('directory', $1, $2, $3, $4, $5, '', 'ready')
       ON CONFLICT (path) DO NOTHING`,
      [
        normalized.path,
        normalized.parentPath,
        normalized.name,
        title ?? normalized.name,
        source,
      ],
    );
    const existing = await client.query<{ kind: string }>(
      'SELECT kind FROM knowledge_nodes WHERE path = $1',
      [normalized.path],
    );
    if (existing.rows[0]?.kind !== 'directory') {
      throw new Error(`路径 ${normalized.path} 已存在文章，不能作为目录`);
    }
  }

  async createNode(input: {
    kind: KnowledgeNodeKind;
    path: string;
    title?: string;
    content?: string;
    source?: KnowledgeNodeSource;
    sourceDocumentId?: number;
  }): Promise<KnowledgeNode> {
    const normalized = normalizeKnowledgePath(input.path);
    if (normalized.path === '/') throw new Error('不能创建根目录');
    const source = input.source ?? 'native';
    const content = input.kind === 'article' ? (input.content ?? '') : null;
    const title = input.title?.trim() || normalized.name;
    return this.withTransaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        'knowledge-path',
      ]);
      await this.ensureDirectory(client, normalized.parentPath, source);
      const result = await client.query<NodeRow>(
        `INSERT INTO knowledge_nodes
           (kind, path, parent_path, name, title, content, source,
            source_document_id, content_hash, index_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          input.kind,
          normalized.path,
          normalized.parentPath,
          normalized.name,
          title,
          content,
          source,
          input.sourceDocumentId ?? null,
          input.kind === 'article' ? hashContent(title, content ?? '') : '',
          input.kind === 'article' ? 'pending' : 'ready',
        ],
      );
      if (input.kind === 'article') {
        await this.replaceChunks(client, result.rows[0]);
      }
      return mapNode(result.rows[0]);
    });
  }

  /** 项目文档专用 upsert：以 sourceDocumentId 关联，固定路径由调用方传入 */
  async upsertProjectDocument(input: {
    projectId: number;
    documentId: number;
    title: string;
    content: string;
  }): Promise<KnowledgeNode> {
    const path = projectDocumentPath(input.projectId, input.documentId);
    const normalized = normalizeKnowledgePath(path);
    const projectRoot = projectRootPath(input.projectId);
    return this.withTransaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        'knowledge-path',
      ]);
      await this.ensureDirectory(client, projectRoot, 'system');
      await this.ensureDirectory(client, normalized.parentPath, 'system');
      const existing = await client.query<NodeRow>(
        'SELECT * FROM knowledge_nodes WHERE source_document_id = $1 FOR UPDATE',
        [input.documentId],
      );
      let row: NodeRow;
      if (existing.rows[0]) {
        const updated = await client.query<NodeRow>(
          `UPDATE knowledge_nodes
           SET path = $2, parent_path = $3, name = $4, title = $5,
               content = $6, source = 'project-document',
               content_hash = $7, index_status = 'pending',
               index_error = NULL, index_attempts = 0, updated_at = now()
           WHERE id = $1
           RETURNING *`,
          [
            existing.rows[0].id,
            normalized.path,
            normalized.parentPath,
            normalized.name,
            input.title,
            input.content,
            hashContent(input.title, input.content),
          ],
        );
        row = updated.rows[0];
      } else {
        const inserted = await client.query<NodeRow>(
          `INSERT INTO knowledge_nodes
             (kind, path, parent_path, name, title, content, source,
              source_document_id, content_hash, index_status)
           VALUES ('article', $1, $2, $3, $4, $5, 'project-document', $6, $7, 'pending')
           RETURNING *`,
          [
            normalized.path,
            normalized.parentPath,
            normalized.name,
            input.title,
            input.content,
            input.documentId,
            hashContent(input.title, input.content),
          ],
        );
        row = inserted.rows[0];
      }
      await this.replaceChunks(client, row);
      return mapNode(row);
    });
  }

  private async replaceChunks(
    client: PoolClient,
    node: NodeRow,
  ): Promise<void> {
    await client.query('DELETE FROM knowledge_chunks WHERE node_id = $1', [
      node.id,
    ]);
    const chunks = chunkKnowledgeMarkdown(node.content ?? '');
    for (const chunk of chunks) {
      await client.query(
        `INSERT INTO knowledge_chunks
           (node_id, chunk_index, title, path, heading_path, content)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          node.id,
          chunk.index,
          node.title,
          node.path,
          chunk.headingPath,
          chunk.content,
        ],
      );
    }
    if (chunks.length === 0) {
      await client.query(
        `UPDATE knowledge_nodes
         SET index_status = 'ready', index_error = NULL
         WHERE id = $1`,
        [node.id],
      );
    }
  }

  async updateNode(
    id: string,
    input: {
      title?: string;
      content?: string;
      name?: string;
      parentPath?: string;
    },
  ): Promise<KnowledgeNode> {
    return this.withTransaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        'knowledge-path',
      ]);
      const found = await client.query<NodeRow>(
        'SELECT * FROM knowledge_nodes WHERE id = $1 FOR UPDATE',
        [id],
      );
      const node = found.rows[0];
      if (!node) throw new Error('知识节点不存在');
      if (node.source !== 'native') {
        throw new Error('项目同步或系统知识为只读，不能直接编辑');
      }
      const parentPath =
        input.parentPath !== undefined
          ? normalizeKnowledgePath(input.parentPath).path
          : node.parent_path;
      const name = input.name !== undefined ? input.name.trim() : node.name;
      if (!name) throw new Error('名称不能为空');
      const newPath = normalizeKnowledgePath(
        parentPath === '/' ? `/${name}` : `${parentPath}/${name}`,
      ).path;
      const title =
        node.kind === 'directory'
          ? input.title?.trim() || node.title
          : input.title?.trim() || node.title;
      const content =
        input.content !== undefined ? input.content : node.content;
      if (newPath !== node.path) {
        await this.ensureDirectory(
          client,
          normalizeKnowledgePath(newPath).parentPath,
          'native',
        );
        const collision = await client.query(
          `SELECT 1 FROM knowledge_nodes
           WHERE (path = $1 OR path LIKE $1 || '/%')
             AND NOT (path = $2 OR path LIKE $2 || '/%')
           LIMIT 1`,
          [newPath, node.path],
        );
        if (collision.rowCount) throw new Error('目标路径已存在');
        await client.query(
          `UPDATE knowledge_nodes
           SET path = $1 || substr(path, length($2) + 1),
               parent_path = CASE
                 WHEN parent_path = $2 THEN $3
                 ELSE $1 || substr(parent_path, length($2) + 1)
               END,
               updated_at = now()
           WHERE path LIKE $2 || '/%'`,
          [newPath, node.path, normalizeKnowledgePath(newPath).parentPath],
        );
        await client.query(
          `UPDATE knowledge_chunks c
           SET path = n.path
           FROM knowledge_nodes n
           WHERE c.node_id = n.id
             AND (n.path = $1 OR n.path LIKE $1 || '/%')`,
          [newPath],
        );
        // 向量输入包含标题与路径：目录移动后后代文章的向量必须重建
        await client.query(
          `UPDATE knowledge_chunks c
           SET embedding = NULL
           FROM knowledge_nodes n
           WHERE c.node_id = n.id
             AND n.kind = 'article'
             AND (n.path = $1 OR n.path LIKE $1 || '/%')`,
          [newPath],
        );
        await client.query(
          `UPDATE knowledge_nodes
           SET index_status = 'pending', index_error = NULL, index_attempts = 0
           WHERE kind = 'article'
             AND (path = $1 OR path LIKE $1 || '/%')`,
          [newPath],
        );
      }
      const updated = await client.query<NodeRow>(
        `UPDATE knowledge_nodes
         SET path = $2, parent_path = $3, name = $4, title = $5, content = $6,
             content_hash = $7, index_status = $8, index_error = NULL,
             index_attempts = 0, updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [
          id,
          newPath,
          normalizeKnowledgePath(newPath).parentPath,
          normalizeKnowledgePath(newPath).name,
          title,
          node.kind === 'article' ? content : null,
          node.kind === 'article' ? hashContent(title, content ?? '') : '',
          node.kind === 'article' ? 'pending' : 'ready',
        ],
      );
      if (node.kind === 'article') {
        await this.replaceChunks(client, updated.rows[0]);
      }
      return mapNode(updated.rows[0]);
    });
  }

  async deleteNode(id: string, recursive: boolean): Promise<void> {
    await this.withTransaction(async (client) => {
      const found = await client.query<NodeRow>(
        'SELECT * FROM knowledge_nodes WHERE id = $1 FOR UPDATE',
        [id],
      );
      const node = found.rows[0];
      if (!node) return;
      if (node.source !== 'native') {
        throw new Error('项目同步或系统知识为只读，不能直接删除');
      }
      if (node.kind === 'directory' && !recursive) {
        const child = await client.query(
          'SELECT 1 FROM knowledge_nodes WHERE parent_path = $1 LIMIT 1',
          [node.path],
        );
        if (child.rowCount) throw new Error('目录非空，请先删除目录中的内容');
      }
      if (!recursive) {
        await client.query('DELETE FROM knowledge_nodes WHERE id = $1', [id]);
      } else {
        await client.query(
          "DELETE FROM knowledge_nodes WHERE path = $1 OR path LIKE $1 || '/%'",
          [node.path],
        );
      }
    });
  }

  async deleteDocumentNode(documentId: number): Promise<void> {
    if (!this.enabled) return;
    await this.db().query(
      `DELETE FROM knowledge_nodes
       WHERE source_document_id = $1 AND source = 'project-document'`,
      [documentId],
    );
  }

  async deleteProject(projectId: number): Promise<void> {
    if (!this.enabled) return;
    const root = projectRootPath(projectId);
    await this.db().query(
      `DELETE FROM knowledge_nodes WHERE path = $1 OR path LIKE $1 || '/%'`,
      [root],
    );
  }

  async listPendingNodes(limit = 20): Promise<KnowledgeNode[]> {
    const result = await this.db().query<NodeRow>(
      `SELECT * FROM knowledge_nodes
       WHERE kind = 'article' AND index_status IN ('pending', 'error')
         AND index_attempts < 5
       ORDER BY updated_at ASC
       LIMIT $1`,
      [limit],
    );
    return result.rows.map(mapNode);
  }

  async listChunksWithoutEmbedding(nodeId: string): Promise<
    Array<{
      id: string;
      title: string;
      path: string;
      headingPath: string;
      content: string;
    }>
  > {
    const result = await this.db().query<ChunkRow>(
      `SELECT c.id, c.node_id, c.title, c.path, c.heading_path, c.content,
              n.updated_at
       FROM knowledge_chunks c
       JOIN knowledge_nodes n ON n.id = c.node_id
       WHERE c.node_id = $1 AND c.embedding IS NULL
       ORDER BY c.chunk_index ASC`,
      [nodeId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      title: row.title,
      path: row.path,
      headingPath: row.heading_path,
      content: row.content,
    }));
  }

  async setChunkEmbedding(id: string, vector: number[]): Promise<void> {
    await this.db().query(
      'UPDATE knowledge_chunks SET embedding = $2::vector WHERE id = $1',
      [id, `[${vector.join(',')}]`],
    );
  }

  async markNodeIndexed(id: string): Promise<void> {
    const pending = await this.db().query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM knowledge_chunks
       WHERE node_id = $1 AND embedding IS NULL`,
      [id],
    );
    if ((pending.rows[0]?.count ?? 0) > 0) return;
    await this.db().query(
      `UPDATE knowledge_nodes
       SET index_status = 'ready', index_error = NULL, index_attempts = 0
       WHERE id = $1`,
      [id],
    );
  }

  async markNodeIndexError(id: string, message: string): Promise<void> {
    await this.db().query(
      `UPDATE knowledge_nodes
       SET index_status = 'error', index_error = $2,
           index_attempts = index_attempts + 1
       WHERE id = $1`,
      [id, message.slice(0, 1000)],
    );
  }

  async search(input: {
    query: string;
    path: string;
    offset: number;
    limit: number;
    queryVector: number[] | null;
  }): Promise<KnowledgeRetrieval> {
    const q = input.query.trim();
    const path = normalizeKnowledgePath(input.path).path;
    const offset = Math.max(input.offset, 0);
    const limit = Math.min(Math.max(input.limit, 1), 100);
    // RRF 需要在较大候选集上统一排序；窗口上限避免深分页拖垮数据库
    const candidateLimit = Math.min(Math.max(offset + limit + 1, 60), 1000);

    const lexical = await this.db().query<
      ChunkRow & { rank: number; similarity: number }
    >(
      `SELECT c.id, c.node_id, c.title, c.path, c.heading_path, c.content,
              n.updated_at,
              ts_rank_cd(c.search_vector, websearch_to_tsquery('simple', $1)) AS rank,
              similarity(c.content, $1) AS similarity
       FROM knowledge_chunks c
       JOIN knowledge_nodes n ON n.id = c.node_id
       WHERE ($2 = '/' OR c.path = $2 OR c.path LIKE $2 || '/%')
         AND (
           c.search_vector @@ websearch_to_tsquery('simple', $1)
           OR c.title ILIKE '%' || $1 || '%'
           OR c.path ILIKE '%' || $1 || '%'
           OR c.content ILIKE '%' || $1 || '%'
         )
       ORDER BY rank DESC, similarity DESC, n.updated_at DESC
       LIMIT $3`,
      [q, path, candidateLimit],
    );

    let vectorRows: Array<ChunkRow & { similarity: number }> = [];
    if (input.queryVector) {
      const value = `[${input.queryVector.join(',')}]`;
      const vector = await this.db().query<ChunkRow & { similarity: number }>(
        `SELECT c.id, c.node_id, c.title, c.path, c.heading_path, c.content,
                n.updated_at,
                1 - (c.embedding <=> $1::vector) AS similarity
         FROM knowledge_chunks c
         JOIN knowledge_nodes n ON n.id = c.node_id
         WHERE c.embedding IS NOT NULL
           AND ($2 = '/' OR c.path = $2 OR c.path LIKE $2 || '/%')
         ORDER BY c.embedding <=> $1::vector
         LIMIT $3`,
        [value, path, candidateLimit],
      );
      vectorRows = vector.rows;
    }

    // RRF 融合：不同检索方式的排名直接相加，避免分数量纲不可比
    const k = 60;
    const merged = new Map<
      string,
      {
        row: ChunkRow;
        score: number;
        matched: { vector: boolean; fulltext: boolean };
      }
    >();
    lexical.rows.forEach((row, index) => {
      merged.set(row.id, {
        row,
        score: 1 / (k + index + 1),
        matched: { vector: false, fulltext: true },
      });
    });
    vectorRows.forEach((row, index) => {
      const existing = merged.get(row.id);
      const contribution = 1 / (k + index + 1);
      if (existing) {
        existing.score += contribution;
        existing.matched.vector = true;
      } else {
        merged.set(row.id, {
          row,
          score: contribution,
          matched: { vector: true, fulltext: false },
        });
      }
    });

    const ordered = [...merged.values()].sort((a, b) => b.score - a.score);
    const results: KnowledgeSearchResult[] = ordered
      .slice(offset, offset + limit)
      .map(({ row, score, matched }) => ({
        nodeId: row.node_id,
        title: row.title,
        path: row.path,
        headingPath: row.heading_path,
        content: row.content,
        score: Number(score.toFixed(6)),
        matchedBy:
          matched.vector && matched.fulltext
            ? 'hybrid'
            : matched.vector
              ? 'vector'
              : 'fulltext',
        updatedAt: row.updated_at,
      }));

    return {
      query: q,
      path,
      mode: input.queryVector ? 'hybrid' : 'fulltext',
      results,
      hasMore:
        ordered.length > offset + limit || ordered.length >= candidateLimit,
    };
  }

  /** 项目文档 Markdown 视图链接（供现有文档模块使用） */
  documentMarkdownPath(projectId: number, documentId: number): string {
    return `/api/docs/detail${encodeKnowledgePath(projectDocumentPath(projectId, documentId))}.md`;
  }
}
