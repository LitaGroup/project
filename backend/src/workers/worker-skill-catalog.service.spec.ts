import { BadRequestException } from '@nestjs/common';
import { WorkerSkillCatalogService } from './worker-skill-catalog.service';

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

describe('WorkerSkillCatalogService', () => {
  const buildService = (repoUrl?: string) =>
    new WorkerSkillCatalogService({
      get: (key: string) =>
        key === 'WORKER_SKILL_REPO_URL' ? repoUrl : undefined,
    } as never);

  it('规范化 raw 技能链接并保留元数据', () => {
    const service = buildService();
    const skill = service.normalizeSkill({
      name: '榜单技能',
      description: '查询活动榜单',
      version: '1.2.0',
      url: 'http://gitea.cinta.team/docs/skills/raw/branch/main/active/rank/SKILL.md',
    });
    expect(skill).toMatchObject({
      name: '榜单技能',
      path: 'active/rank/SKILL.md',
      description: '查询活动榜单',
      version: '1.2.0',
      url: 'http://gitea.cinta.team/docs/skills/raw/branch/main/active/rank/SKILL.md',
      sourceUrl:
        'http://gitea.cinta.team/docs/skills/src/branch/main/active/rank/SKILL.md',
    });
  });

  it('把页面链接规范化为 raw 链接并按 path 去重', () => {
    const service = buildService();
    const skill = service.normalizeSkill({
      url: 'http://gitea.cinta.team/docs/skills/src/branch/main/public/lita-api/SKILL.md',
    });
    expect(skill.url).toBe(
      'http://gitea.cinta.team/docs/skills/raw/branch/main/public/lita-api/SKILL.md',
    );
    expect(skill.name).toBe('public/lita-api');
    const skills = service.normalizeSkills([
      { url: skill.url },
      { url: skill.sourceUrl },
    ]);
    expect(skills).toHaveLength(1);
  });

  it('拒绝技能库以外的链接与旧内联技能', () => {
    const service = buildService();
    expect(() =>
      service.normalizeSkill({ url: 'https://example.com/SKILL.md' }),
    ).toThrow(BadRequestException);
    expect(() =>
      service.normalizeSkill({
        url: 'http://gitea.cinta.team/docs/skills/raw/branch/main/README.md',
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      service.normalizeSkill({
        content: '# legacy',
        url: 'http://gitea.cinta.team/docs/skills/raw/branch/main/public/lita-api/SKILL.md',
      }),
    ).toThrow(BadRequestException);
  });

  it('保存时丢弃已下线的平台能力技能', () => {
    const service = buildService();
    const skills = service.normalizeSkills([
      {
        url: 'http://gitea.cinta.team/docs/skills/raw/branch/main/work/main/SKILL.md',
      },
      {
        url: 'http://gitea.cinta.team/docs/skills/raw/branch/main/project/manage/SKILL.md',
      },
      {
        url: 'http://gitea.cinta.team/docs/skills/raw/branch/main/public/lita-api/SKILL.md',
      },
    ]);
    expect(skills?.map((item) => item.path)).toEqual([
      'public/lita-api/SKILL.md',
    ]);
    expect(
      service.normalizeSkills([
        {
          url: 'http://gitea.cinta.team/docs/skills/raw/branch/main/work/main/SKILL.md',
        },
      ]),
    ).toBeNull();
  });

  it('支持自定义技能库地址', () => {
    const service = buildService('http://gitea.example.com/team/skills/');
    const skill = service.normalizeSkill({
      url: 'http://gitea.example.com/team/skills/raw/branch/master/other/demo/SKILL.md',
    });
    expect(skill.path).toBe('other/demo/SKILL.md');
    expect(skill.sourceUrl).toBe(
      'http://gitea.example.com/team/skills/src/branch/master/other/demo/SKILL.md',
    );
  });

  it('分页遍历目录树，收录后续分页中的技能', async () => {
    const service = buildService();
    const treeCalls: string[] = [];
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation((input) => {
        const url = requestUrl(input);
        if (url.endsWith('/api/v1/repos/docs/skills')) {
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
                    { path: 'active/rank/SKILL.md', type: 'blob' },
                    { path: 'active/rank/script/query.py', type: 'blob' },
                  ],
                }
              : {
                  truncated: false,
                  page: 2,
                  total_count: 3,
                  tree: [{ path: 'data/odps/SKILL.md', type: 'blob' }],
                },
          );
        }
        if (url.endsWith('active/rank/SKILL.md')) {
          return textResponse('---\nname: 榜单查询\nversion: 1.0.0\n---\n');
        }
        if (url.endsWith('data/odps/SKILL.md')) {
          return textResponse('---\nname: ODPS 查询\n---\n');
        }
        throw new Error(`未预期的请求：${url}`);
      });
    try {
      const skills = await service.list();
      expect(skills.map((item) => item.path)).toEqual([
        'active/rank/SKILL.md',
        'data/odps/SKILL.md',
      ]);
      expect(skills.map((item) => item.name)).toEqual([
        '榜单查询',
        'ODPS 查询',
      ]);
      expect(treeCalls).toHaveLength(2);
      expect(treeCalls[0]).toContain('page=1');
      expect(treeCalls[1]).toContain('page=2');
    } finally {
      fetchMock.mockRestore();
    }
  });
});
