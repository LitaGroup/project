import type { KnowledgeEmbeddingService } from './knowledge-embedding.service';
import { KnowledgeService } from './knowledge.service';
import type { KnowledgeStore } from './knowledge.store';
import type { KnowledgeRetrieval } from './knowledge.types';

function retrieval(over: Partial<KnowledgeRetrieval> = {}): KnowledgeRetrieval {
  return {
    query: '部署',
    path: '/',
    mode: 'fulltext',
    hasMore: false,
    results: [
      {
        nodeId: 'n1',
        title: '部署',
        path: '/guides/deploy',
        headingPath: '部署',
        content: '# 部署',
        score: 0.01,
        relevance: 1,
        vectorSimilarity: null,
        matchedBy: 'fulltext',
        updatedAt: new Date(),
      },
    ],
    ...over,
  };
}

describe('KnowledgeService.search', () => {
  let service: KnowledgeService;
  let store: {
    isEnabled: boolean;
    unavailableMessage: string;
    search: jest.Mock;
    getByPath: jest.Mock;
    createNode: jest.Mock;
  };

  beforeEach(() => {
    store = {
      isEnabled: true,
      unavailableMessage: '知识库不可用',
      search: jest.fn().mockResolvedValue(retrieval()),
      getByPath: jest.fn().mockResolvedValue({ kind: 'directory' }),
      createNode: jest.fn().mockResolvedValue({
        id: 'n2',
        kind: 'article',
        path: '/task/handoff/20261028/TK-0001/0',
        parentPath: '/task/handoff/20261028/TK-0001',
        name: '0.md',
        title: '任务总结',
        content: '# 总结',
        source: 'native',
        sourceDocumentId: null,
        contentHash: 'h',
        indexStatus: 'pending',
        indexError: null,
        indexAttempts: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    };
    service = new KnowledgeService(
      store as unknown as KnowledgeStore,
      { configured: false } as unknown as KnowledgeEmbeddingService,
    );
  });

  it('默认搜站内并按 page/pageSize 计算 offset', async () => {
    const result = await service.search({
      query: '部署',
      page: 3,
      pageSize: 10,
    });
    expect(store.search).toHaveBeenCalledWith(
      expect.objectContaining({ offset: 20, limit: 10 }),
    );
    expect(result.project.results).toHaveLength(1);
    expect(result.results).toEqual(result.project.results);
    expect(result.source).toBe('project');
  });

  it('飞书数据源已下线，source=feishu/all 直接报错', async () => {
    await expect(
      service.search({ query: '部署', source: 'feishu' as never }),
    ).rejects.toThrow('飞书云文档搜索已下线');
    await expect(
      service.search({ query: '部署', source: 'all' as never }),
    ).rejects.toThrow('飞书云文档搜索已下线');
    expect(store.search).not.toHaveBeenCalled();
  });

  it('知识库不可用时返回 503', async () => {
    store.isEnabled = false;
    await expect(service.search({ query: '部署' })).rejects.toThrow(
      '知识库不可用',
    );
    expect(store.search).not.toHaveBeenCalled();
  });

  it('搜索目录不存在时报错', async () => {
    store.getByPath.mockResolvedValueOnce(null);
    await expect(
      service.search({ query: '部署', path: '/missing' }),
    ).rejects.toThrow('搜索目录 /missing 不存在');
  });

  it('按完整路径创建文章时自动交给存储层创建父目录', async () => {
    const node = await service.createArticleAtPath({
      path: '/task/handoff/20261028/TK-0001/0.md',
      title: '任务总结',
      content: '# 总结',
    });

    expect(store.createNode).toHaveBeenCalledWith({
      kind: 'article',
      path: '/task/handoff/20261028/TK-0001/0.md',
      title: '任务总结',
      content: '# 总结',
    });
    expect(node.path).toContain('/task/handoff/');
  });

  it('pageSize 最大 100，关键词最多 500 字', async () => {
    await expect(
      service.search({ query: '部署', pageSize: 101 }),
    ).rejects.toThrow('1..100');
    await expect(service.search({ query: 'a'.repeat(501) })).rejects.toThrow(
      '500 字',
    );
  });
});
