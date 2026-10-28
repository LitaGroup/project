import type { ConfigService } from '@nestjs/config';
import { KnowledgeStore } from './knowledge.store';

interface SearchChunkRow {
  id: string;
  node_id: string;
  title: string;
  path: string;
  heading_path: string;
  content: string;
  updated_at: Date;
}

function chunk(id: string, nodeId: string, content: string): SearchChunkRow {
  return {
    id,
    node_id: nodeId,
    title: `文档 ${nodeId}`,
    path: `/docs/${nodeId}`,
    heading_path: '章节',
    content,
    updated_at: new Date('2026-10-28T00:00:00Z'),
  };
}

interface SearchVectorRow extends SearchChunkRow {
  similarity: number;
}

function createStore(
  rows: SearchChunkRow[],
  options: {
    vectorRows?: SearchVectorRow[];
    minSimilarity?: string;
  } = {},
): {
  store: KnowledgeStore;
  query: jest.Mock;
} {
  // 默认向量路与全文路返回同一批文档，便于覆盖混合命中场景
  const vectorRows =
    options.vectorRows ?? rows.map((row) => ({ ...row, similarity: 0.9 }));
  const query = jest.fn().mockImplementation((sql: string) =>
    Promise.resolve({
      rows: sql.includes('c.embedding <=>') ? vectorRows : rows,
    }),
  );
  const store = new KnowledgeStore({
    get: jest.fn((key: string) =>
      key === 'PROJECT_KNOWLEDGE_SEARCH_VECTOR_MIN_SIMILARITY'
        ? options.minSimilarity
        : undefined,
    ),
  } as unknown as ConfigService);
  (store as unknown as { db: () => { query: jest.Mock } }).db = () => ({
    query,
  });
  return { store, query };
}

/** mock 调用记录转成强类型元组，避免测试里层层 as any */
function queryCalls(query: jest.Mock): Array<[string, unknown[]]> {
  return query.mock.calls as Array<[string, unknown[]]>;
}

describe('KnowledgeStore.search', () => {
  it('同一文档命中多个切片时只保留排名最高的一条', async () => {
    const { store } = createStore([
      chunk('c1', 'n1', '第一个切片'),
      chunk('c2', 'n1', '第二个切片'),
      chunk('c3', 'n2', '其它文档切片'),
    ]);

    const result = await store.search({
      query: '部署',
      path: '/',
      offset: 0,
      limit: 100,
      queryVector: null,
    });

    expect(result.results.map((item) => item.nodeId)).toEqual(['n1', 'n2']);
    expect(result.results[0].content).toBe('第一个切片');
    expect(result.results[0].relevance).toBe(1);
    expect(result.results[1].relevance).toBeLessThan(1);
    expect(result.hasMore).toBe(false);
  });

  it('混合检索按理论最高 RRF 分归一化相关度', async () => {
    const { store } = createStore([
      chunk('c1', 'n1', '第一个文档'),
      chunk('c2', 'n2', '第二个文档'),
    ]);

    const result = await store.search({
      query: '部署',
      path: '/',
      offset: 0,
      limit: 100,
      queryVector: [0, 0],
    });

    expect(result.mode).toBe('hybrid');
    expect(result.results[0].relevance).toBe(1);
    expect(result.results[0].vectorSimilarity).toBe(0.9);
    expect(result.results[0].matchedBy).toBe('hybrid');
    expect(result.results[1].relevance).toBeLessThan(1);
  });

  it('过滤低于向量相似度阈值的纯向量结果', async () => {
    const [low, high] = [
      chunk('n1', 'n1', '弱相关文档'),
      chunk('n2', 'n2', '真正相关文档'),
    ];
    const { store, query } = createStore([], {
      vectorRows: [
        { ...low, similarity: 0.64 },
        { ...high, similarity: 0.9 },
      ],
    });

    const result = await store.search({
      query: '导出 didibus 活动送礼总榜',
      path: '/',
      offset: 0,
      limit: 100,
      queryVector: [0, 0],
    });

    expect(result.results.map((item) => item.nodeId)).toEqual(['n2']);
    expect(result.results[0].vectorSimilarity).toBe(0.9);
    const vectorQuery = queryCalls(query).find(([sql]) =>
      sql.includes('c.embedding <=>'),
    );
    expect(vectorQuery?.[0]).toContain('>= $4');
    expect(vectorQuery?.[1][3]).toBe(0.65);
  });

  it('全文命中的文档不受低向量相似度影响', async () => {
    const row = chunk('n1', 'n1', '导出 didibus 活动送礼总榜');
    const { store } = createStore([row], {
      vectorRows: [{ ...row, similarity: 0.2 }],
    });

    const result = await store.search({
      query: '导出 didibus 活动送礼总榜',
      path: '/',
      offset: 0,
      limit: 100,
      queryVector: [0, 0],
    });

    expect(result.results.map((item) => item.nodeId)).toEqual(['n1']);
    expect(result.results[0].matchedBy).toBe('fulltext');
    expect(result.results[0].vectorSimilarity).toBeNull();
  });

  it('向量召回阈值支持环境配置', async () => {
    const { store, query } = createStore([], {
      vectorRows: [{ ...chunk('n1', 'n1', '相关文档'), similarity: 0.7 }],
      minSimilarity: '0.8',
    });

    const result = await store.search({
      query: '相关文档',
      path: '/',
      offset: 0,
      limit: 100,
      queryVector: [0, 0],
    });

    expect(result.results).toEqual([]);
    expect(queryCalls(query)[1]?.[1][3]).toBe(0.8);
  });

  it('阈值为 0 时关闭向量过滤', async () => {
    const { store, query } = createStore([], {
      vectorRows: [{ ...chunk('n1', 'n1', '任意向量结果'), similarity: -0.1 }],
      minSimilarity: '0',
    });

    const result = await store.search({
      query: '任意关键词',
      path: '/',
      offset: 0,
      limit: 100,
      queryVector: [0, 0],
    });

    expect(result.results.map((item) => item.nodeId)).toEqual(['n1']);
    const vectorQuery = queryCalls(query).find(([sql]) =>
      sql.includes('c.embedding <=>'),
    );
    expect(vectorQuery?.[0]).not.toContain('>= $4');
    expect(vectorQuery?.[1]).toHaveLength(3);
  });

  it('按去重后的文档数量分页', async () => {
    const { store } = createStore([
      chunk('c1', 'n1', '第一个文档'),
      chunk('c2', 'n1', '第一个文档的其他切片'),
      chunk('c3', 'n2', '第二个文档'),
      chunk('c4', 'n3', '第三个文档'),
    ]);

    const result = await store.search({
      query: '部署',
      path: '/',
      offset: 0,
      limit: 2,
      queryVector: null,
    });

    expect(result.results.map((item) => item.nodeId)).toEqual(['n1', 'n2']);
    expect(result.hasMore).toBe(true);
  });
});
