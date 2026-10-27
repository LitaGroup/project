import { BadRequestException } from '@nestjs/common';
import { WorkerSkillCatalogService } from './worker-skill-catalog.service';

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
});
