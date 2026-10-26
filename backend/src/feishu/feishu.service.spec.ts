import { ConfigService } from '@nestjs/config';
import { FeishuService } from './feishu.service';

describe('FeishuService.searchDocs', () => {
  let service: FeishuService;
  let post: jest.Mock;

  beforeEach(() => {
    service = new FeishuService(new ConfigService({}));
    post = jest.fn();
    (service as unknown as { http: { post: jest.Mock } }).http = { post };
  });

  it('按 offset/limit 翻页并映射搜索结果', async () => {
    const entities = Array.from({ length: 25 }, (_, i) => ({
      title_highlighted: `文档 ${i}`,
      summary_highlighted: `摘要 ${i}`,
      entity_type: 'DOC',
      result_meta: {
        token: `token-${i}`,
        doc_types: 'DOCX',
        url: `https://example.feishu.cn/docx/token-${i}`,
        owner_name: '张三',
        owner_id: 'ou_1',
        update_time: 1700000000,
        create_time: 1700000000,
      },
    }));
    post
      .mockResolvedValueOnce({
        data: {
          code: 0,
          data: {
            total: 30,
            has_more: true,
            page_token: 'next',
            res_units: entities.slice(0, 20),
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          code: 0,
          data: {
            total: 30,
            has_more: true,
            page_token: 'next2',
            res_units: entities.slice(20),
          },
        },
      });

    const result = await service.searchDocs('关键词', 'u-token', {
      offset: 20,
      limit: 5,
    });
    expect(post).toHaveBeenCalledTimes(2);
    expect(result.docs).toHaveLength(5);
    expect(result.docs[0].token).toBe('token-20');
    expect(result.total).toBe(30);
    expect(result.hasMore).toBe(true);
    const firstCall = post.mock.calls[0] as [
      string,
      Record<string, unknown>,
      { headers: Record<string, string> },
    ];
    expect(firstCall[0]).toBe('/search/v2/doc_wiki/search');
    expect(firstCall[2].headers.Authorization).toBe('Bearer u-token');
    expect(firstCall[1].page_size).toBe(20);
  });

  it('末页 hasMore=false', async () => {
    post.mockResolvedValueOnce({
      data: {
        code: 0,
        data: {
          total: 1,
          has_more: false,
          res_units: [
            {
              title_highlighted: '<em>部署</em>说明',
              result_meta: {
                token: 'abc',
                doc_types: 'DOCX',
                url: 'https://example.feishu.cn/docx/abc',
              },
            },
          ],
        },
      },
    });
    const result = await service.searchDocs('部署', 'u-token', {
      offset: 0,
      limit: 10,
    });
    expect(result.docs[0].title).toBe('部署说明');
    expect(result.hasMore).toBe(false);
  });

  it('缺少 search:docs:read 时给出重新授权指引', async () => {
    post.mockResolvedValueOnce({
      data: { code: 99991679, msg: 'Unauthorized' },
    });
    await expect(
      service.searchDocs('部署', 'no-scope', { offset: 0, limit: 10 }),
    ).rejects.toThrow('search:docs:read');
  });

  it('飞书业务错误转为可读异常', async () => {
    post.mockResolvedValueOnce({
      data: { code: 1274011, msg: 'user_access_token is invalid' },
    });
    await expect(
      service.searchDocs('部署', 'bad', { offset: 0, limit: 10 }),
    ).rejects.toThrow('user_access_token is invalid');
  });
});
