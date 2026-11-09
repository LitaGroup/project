import { buildPersonalAgentPrompt } from './personal-agent';
import { isDeprecatedSkill } from './worker-skill-deprecation';

describe('个人 AGENT 技能配置', () => {
  it('识别已下线的 lita-work / project-manage / project-files 技能', () => {
    expect(isDeprecatedSkill('work/main/SKILL.md')).toBe(true);
    expect(isDeprecatedSkill('legacy/work/main/SKILL.md')).toBe(true);
    expect(isDeprecatedSkill('project/manage/SKILL.md')).toBe(true);
    expect(isDeprecatedSkill('project/files/SKILL.md')).toBe(true);
    expect(
      isDeprecatedSkill({ name: 'lita-work', path: 'work/main/SKILL.md' }),
    ).toBe(true);
    expect(isDeprecatedSkill('public/lita-query/SKILL.md')).toBe(false);
  });

  it('角色说明优先使用 lita-work MCP，不再依赖已下线技能', () => {
    const prompt = buildPersonalAgentPrompt(
      '张三',
      'http://localhost:3100/api',
    );

    expect(prompt).toContain('lita-work MCP');
    expect(prompt).toContain('不再提供 lita-work 技能');
    expect(prompt).not.toContain('使用工位已安装的 lita-work 技能');
  });
});
