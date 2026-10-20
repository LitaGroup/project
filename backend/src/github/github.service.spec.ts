import { BadRequestException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { GithubService } from './github.service';
import { Repo } from './repo.entity';

function createService(env: Record<string, string> = {}): GithubService {
  const config = {
    get: (key: string) => env[key],
  } as unknown as ConstructorParameters<typeof GithubService>[0];
  // 单元测试只覆盖纯函数逻辑（归一化/配置），仓库登记表用空实现
  const repoRegistry = {
    find: () => Promise.resolve([]),
  } as unknown as Repository<Repo>;
  return new GithubService(config, repoRegistry);
}

describe('GithubService.normalizeRepo（仓库标识归一化）', () => {
  it('只有仓库名时默认归属组织', () => {
    expect(
      createService({ GITHUB_ORG: 'LitaGroup' }).normalizeRepo('lita-android'),
    ).toBe('LitaGroup/lita-android');
  });

  it('owner/name 全名保持（owner 大小写归一为组织原名）', () => {
    const service = createService({ GITHUB_ORG: 'LitaGroup' });
    expect(service.normalizeRepo('LitaGroup/lita-android')).toBe(
      'LitaGroup/lita-android',
    );
    expect(service.normalizeRepo('litagroup/lita-android')).toBe(
      'LitaGroup/lita-android',
    );
  });

  it('完整 URL 与 .git 后缀剥离', () => {
    const service = createService({ GITHUB_ORG: 'LitaGroup' });
    expect(
      service.normalizeRepo('https://github.com/LitaGroup/lita-android.git'),
    ).toBe('LitaGroup/lita-android');
    expect(
      service.normalizeRepo('http://www.github.com/litagroup/lita-android/'),
    ).toBe('LitaGroup/lita-android');
  });

  it('非组织仓库拒绝', () => {
    const service = createService({ GITHUB_ORG: 'LitaGroup' });
    expect(() => service.normalizeRepo('facebook/react')).toThrow(
      BadRequestException,
    );
  });

  it('空值拒绝', () => {
    const service = createService({ GITHUB_ORG: 'LitaGroup' });
    expect(() => service.normalizeRepo('')).toThrow(BadRequestException);
    expect(() => service.normalizeRepo('   ')).toThrow(BadRequestException);
  });
});

describe('GithubService.tokenConfigured', () => {
  it('未配置 GITHUB_TOKEN 时为 false', () => {
    expect(createService({}).tokenConfigured).toBe(false);
    expect(createService({ GITHUB_TOKEN: '  ' }).tokenConfigured).toBe(false);
  });

  it('配置后为 true', () => {
    expect(
      createService({ GITHUB_TOKEN: 'github_pat_x' }).tokenConfigured,
    ).toBe(true);
  });
});

describe('GithubService.orgName', () => {
  it('默认 LitaGroup，可被 GITHUB_ORG 覆盖', () => {
    expect(createService({}).orgName).toBe('LitaGroup');
    expect(createService({ GITHUB_ORG: 'OtherOrg' }).orgName).toBe('OtherOrg');
  });
});
