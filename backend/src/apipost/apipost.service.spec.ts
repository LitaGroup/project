import axios from 'axios';
import { BadRequestException } from '@nestjs/common';
import { ApipostService, parseApipostUrl } from './apipost.service';

describe('parseApipostUrl', () => {
  it('docs 文档页链接（含 target_id/locale 查询参数）', () => {
    const ref = parseApipostUrl(
      'https://docs.apipost.net/docs/detail/6d6ae8d94470000?target_id=15227d10be5077&locale=zh-cn',
    );
    expect(ref.projectId).toBe('6d6ae8d94470000');
    expect(ref.docsUrl).toBe(
      'https://docs.apipost.net/docs/detail/6d6ae8d94470000',
    );
    expect(ref.swaggerUrl).toBe(
      'https://openapi.apipost.net/swagger/v3/6d6ae8d94470000',
    );
  });

  it('openapi swagger 链接', () => {
    const ref = parseApipostUrl(
      'https://openapi.apipost.net/swagger/v3/6d6ae8d94470000?locale=zh-cn',
    );
    expect(ref.projectId).toBe('6d6ae8d94470000');
    expect(ref.docsUrl).toBe(
      'https://docs.apipost.net/docs/detail/6d6ae8d94470000',
    );
    expect(ref.swaggerUrl).toBe(
      'https://openapi.apipost.net/swagger/v3/6d6ae8d94470000',
    );
  });

  it('非 apipost 链接 400', () => {
    expect(() =>
      parseApipostUrl('https://lita-group.feishu.cn/wiki/x'),
    ).toThrow(BadRequestException);
    expect(() => parseApipostUrl('')).toThrow(BadRequestException);
  });
});

describe('ApipostService.readByUrl', () => {
  const service = new ApipostService();
  const url = 'https://openapi.apipost.net/swagger/v3/notexist';

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('拉取失败（网络/HTTP 错误）转 400', async () => {
    jest
      .spyOn(axios, 'get')
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({
        status: 404,
        data: 'Not Found',
      });
    await expect(service.readByUrl(url)).rejects.toThrow(
      /APIPOST swagger 拉取失败/,
    );
  });

  it('返回非 swagger 内容 → 400', async () => {
    jest.spyOn(axios, 'get').mockResolvedValueOnce({
      status: 200,
      data: { error: 'not found' },
    });
    await expect(service.readByUrl(url)).rejects.toThrow(
      '链接返回的不是有效的 APIPOST swagger 内容',
    );
  });
});
