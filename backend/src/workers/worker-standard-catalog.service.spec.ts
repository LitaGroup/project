import { BadRequestException } from '@nestjs/common';
import { WorkerStandardCatalogService } from './worker-standard-catalog.service';

const requestUrl = (input: Parameters<typeof fetch>[0]): string =>
  input instanceof URL
    ? input.href
    : typeof input === 'string'
      ? input
      : input.url;

const jsonResponse = (body: unknown): Promise<Response> =>
  Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  } as unknown as Response);

const textResponse = (body: string): Promise<Response> =>
  Promise.resolve({
    ok: true,
    status: 200,
    text: () => Promise.resolve(body),
  } as unknown as Response);

describe('WorkerStandardCatalogService', () => {
  const buildService = (repoUrl?: string) =>
    new WorkerStandardCatalogService({
      get: (key: string) =>
        key === 'WORKER_STANDARD_REPO_URL' ? repoUrl : undefined,
    } as never);

  it('规范化 raw 规范链接并保留元数据', () => {
    const service = buildService();
    const standard = service.normalizeStandard({
      name: 'H5 开发规范',
      description: '移动端 H5 页面开发',
      version: '2.0.0',
      url: 'http://gitea.cinta.team/docs/standard/raw/branch/main/fe/h5/README.md',
    });
    expect(standard).toMatchObject({
      name: 'H5 开发规范',
      path: 'fe/h5/README.md',
      directory: 'fe/h5',
      description: '移动端 H5 页面开发',
      version: '2.0.0',
      url: 'http://gitea.cinta.team/docs/standard/raw/branch/main/fe/h5/README.md',
      sourceUrl:
        'http://gitea.cinta.team/docs/standard/src/branch/main/fe/h5/README.md',
    });
  });

  it('把页面链接规范化为 raw 链接并按路径去重', () => {
    const service = buildService();
    const standard = service.normalizeStandard({
      url: 'http://gitea.cinta.team/docs/standard/src/branch/main/java/21/README.md',
    });
    expect(standard).toMatchObject({
      name: 'java/21',
      path: 'java/21/README.md',
      directory: 'java/21',
      url: 'http://gitea.cinta.team/docs/standard/raw/branch/main/java/21/README.md',
    });
    const standards = service.normalizeStandards([
      { url: standard.url },
      { url: standard.sourceUrl },
    ]);
    expect(standards).toHaveLength(1);
  });

  it('拒绝外部链接与规范库根目录 README', () => {
    const service = buildService();
    expect(() =>
      service.normalizeStandard({ url: 'https://example.com/README.md' }),
    ).toThrow(BadRequestException);
    expect(() =>
      service.normalizeStandard({
        url: 'http://gitea.cinta.team/docs/standard/raw/branch/main/README.md',
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      service.normalizeStandard({
        url: 'http://gitea.cinta.team/docs/standard/raw/branch/main/base/../README.md',
      }),
    ).toThrow(BadRequestException);
  });

  it('支持自定义规范库地址', () => {
    const service = buildService('http://gitea.example.com/team/standard/');
    const standard = service.normalizeStandard({
      url: 'http://gitea.example.com/team/standard/raw/branch/master/fe/web/README.md',
    });
    expect(standard.path).toBe('fe/web/README.md');
    expect(standard.directory).toBe('fe/web');
    expect(standard.sourceUrl).toBe(
      'http://gitea.example.com/team/standard/src/branch/master/fe/web/README.md',
    );
  });

  it('解析同步清单时拒绝来自不同分支的规范引用', async () => {
    const service = buildService();
    await expect(
      service.resolveManagedFiles([
        {
          path: 'fe/h5/README.md',
          url: 'http://gitea.cinta.team/docs/standard/raw/branch/main/fe/h5/README.md',
        },
        {
          path: 'fe/pc/README.md',
          url: 'http://gitea.cinta.team/docs/standard/raw/branch/develop/fe/pc/README.md',
        },
      ] as never),
    ).rejects.toThrow('同一分支');
  });

  it('分页遍历目录树，收录后续分页中的规范', async () => {
    const service = buildService();
    const treeCalls: string[] = [];
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation((input) => {
        const url = requestUrl(input);
        if (url.endsWith('/api/v1/repos/docs/standard')) {
          return jsonResponse({ default_branch: 'main' });
        }
        if (url.includes('/git/trees/main')) {
          treeCalls.push(url);
          return jsonResponse(
            new URL(url).searchParams.get('page') === '1'
              ? {
                  truncated: true,
                  page: 1,
                  total_count: 3,
                  tree: [
                    { path: 'fe/h5/README.md', type: 'blob' },
                    { path: 'fe/h5/base/a.md', type: 'blob' },
                  ],
                }
              : {
                  truncated: false,
                  page: 2,
                  total_count: 3,
                  tree: [{ path: 'base/db/README.md', type: 'blob' }],
                },
          );
        }
        if (url.endsWith('fe/h5/README.md')) {
          return textResponse('---\nname: H5 开发规范\nversion: 2.0.0\n---\n');
        }
        if (url.endsWith('base/db/README.md')) {
          return textResponse('# 数据库规范\n');
        }
        throw new Error(`未预期的请求：${url}`);
      });
    try {
      const standards = await service.list();
      expect(standards.map((item) => item.path)).toEqual([
        'base/db/README.md',
        'fe/h5/README.md',
      ]);
      expect(standards.map((item) => item.name)).toEqual([
        '数据库规范',
        'H5 开发规范',
      ]);
      expect(treeCalls).toHaveLength(2);
      expect(treeCalls[0]).toContain('page=1');
      expect(treeCalls[1]).toContain('page=2');
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('同步清单跨分页收集规范目录下的全部文件', async () => {
    const service = buildService();
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation((input) => {
        const url = requestUrl(input);
        if (url.endsWith('/api/v1/repos/docs/standard')) {
          return jsonResponse({ default_branch: 'main' });
        }
        if (url.includes('/git/trees/main')) {
          return jsonResponse(
            new URL(url).searchParams.get('page') === '1'
              ? {
                  truncated: true,
                  page: 1,
                  total_count: 5,
                  tree: [
                    { path: 'fe/h5/README.md', type: 'blob' },
                    { path: 'fe/h5/base/a.md', type: 'blob' },
                    { path: 'fe/h5/.DS_Store', type: 'blob' },
                    { path: 'fe/h5', type: 'tree' },
                  ],
                }
              : {
                  truncated: false,
                  page: 2,
                  total_count: 5,
                  tree: [
                    { path: 'java/21/README.md', type: 'blob' },
                    { path: 'java/21/deep/b.md', type: 'blob' },
                    { path: 'other/ignored.md', type: 'blob' },
                  ],
                },
          );
        }
        throw new Error(`未预期的请求：${url}`);
      });
    try {
      const managed = await service.resolveManagedFiles([
        {
          path: 'fe/h5/README.md',
          url: 'http://gitea.cinta.team/docs/standard/raw/branch/main/fe/h5/README.md',
        },
        {
          path: 'java/21/README.md',
          url: 'http://gitea.cinta.team/docs/standard/raw/branch/main/java/21/README.md',
        },
      ] as never);
      expect(managed.branch).toBe('main');
      expect(managed.directories).toEqual(['fe/h5', 'java/21']);
      expect(managed.files).toEqual([
        'fe/h5/base/a.md',
        'fe/h5/README.md',
        'java/21/deep/b.md',
        'java/21/README.md',
      ]);
    } finally {
      fetchMock.mockRestore();
    }
  });
});
