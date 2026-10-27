import { BadRequestException } from '@nestjs/common';
import { WorkerStandardCatalogService } from './worker-standard-catalog.service';

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
});
