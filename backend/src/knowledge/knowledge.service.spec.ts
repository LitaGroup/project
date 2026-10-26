import type { AuthService } from '../auth/auth.service';
import type { FeishuService } from '../feishu/feishu.service';
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
  };
  let auth: { getFeishuAccessToken: jest.Mock };
  let feishu: { searchDocs: jest.Mock };

  beforeEach(() => {
    store = {
      isEnabled: true,
      unavailableMessage: '知识库不可用',
      search: jest.fn().mockResolvedValue(retrieval()),
      getByPath: jest.fn().mockResolvedValue({ kind: 'directory' }),
    };
    auth = { getFeishuAccessToken: jest.fn().mockResolvedValue('u-token') };
    feishu = {
      searchDocs: jest.fn().mockResolvedValue({
        total: 1,
        hasMore: false,
        docs: [
          {
            token: 'abc',
            title: '飞书部署文档',
            url: 'https://example.feishu.cn/docx/abc?from=search',
            docsType: 'DOCX',
            entityType: 'DOC',
            summary: '摘要',
            ownerName: '张三',
            ownerId: 'ou_1',
            updateTime: 1700000000,
            createTime: 1700000000,
          },
        ],
      }),
    };
    service = new KnowledgeService(
      store as unknown as KnowledgeStore,
      { configured: false } as unknown as KnowledgeEmbeddingService,
      auth as unknown as AuthService,
      feishu as unknown as FeishuService,
    );
  });

  it('默认搜站内并按 page/pageSize 计算 offset', async () => {
    const result = await service.search({
      query: '部署',
      page: 3,
      pageSize: 10,
      userId: 1,
    });
    expect(store.search).toHaveBeenCalledWith(
      expect.objectContaining({ offset: 20, limit: 10 }),
    );
    expect(result.project?.results).toHaveLength(1);
    expect(result.results).toEqual(result.project?.results);
    expect(result.feishu).toBeUndefined();
  });

  it('source=all 同时搜索两个源，飞书结果带 Markdown 转换地址', async () => {
    const result = await service.search({
      query: '部署',
      source: 'all',
      page: 1,
      pageSize: 8,
      userId: 1,
    });
    expect(store.search).toHaveBeenCalled();
    expect(auth.getFeishuAccessToken).toHaveBeenCalledWith(1);
    expect(feishu.searchDocs).toHaveBeenCalledWith('部署', 'u-token', {
      offset: 0,
      limit: 8,
    });
    expect(result.project?.results).toHaveLength(1);
    expect(result.feishu?.results[0].markdownUrl).toContain(
      '/api/feishu/read.md?url=',
    );
  });

  it('source=feishu 不依赖 PostgreSQL', async () => {
    store.isEnabled = false;
    const result = await service.search({
      query: '部署',
      source: 'feishu',
      userId: 1,
    });
    expect(store.search).not.toHaveBeenCalled();
    expect(result.feishu?.results).toHaveLength(1);
    expect(result.project).toBeUndefined();
  });

  it('source=all 时站内不可用仍返回飞书结果', async () => {
    store.isEnabled = false;
    const result = await service.search({
      query: '部署',
      source: 'all',
      userId: 1,
    });
    expect(result.project?.error).toBe('知识库不可用');
    expect(result.feishu?.results).toHaveLength(1);
  });

  it('source=all 时飞书失败仅标记飞书源', async () => {
    feishu.searchDocs.mockRejectedValueOnce(new Error('飞书授权过期'));
    const result = await service.search({
      query: '部署',
      source: 'all',
      userId: 1,
    });
    expect(result.project?.results).toHaveLength(1);
    expect(result.feishu?.error).toBe('飞书授权过期');
  });

  it('pageSize 最大 100 且飞书关键词最多 50 字', async () => {
    await expect(
      service.search({ query: '部署', pageSize: 101, userId: 1 }),
    ).rejects.toThrow('1..100');
    await expect(
      service.search({
        query: 'a'.repeat(51),
        source: 'feishu',
        userId: 1,
      }),
    ).rejects.toThrow('50 字');
  });
});
