import {
  buildPersonalAgentPrompt,
  isDeprecatedPersonalAgentSkill,
  PERSONAL_AGENT_SKILL_PATHS,
} from './personal-agent';

describe('个人 AGENT 技能配置', () => {
  it('默认安装技能库 lita-work', () => {
    expect(PERSONAL_AGENT_SKILL_PATHS).toEqual(['work/main/SKILL.md']);
  });

  it('识别已废弃的 project-manage / project-files 技能路径', () => {
    expect(isDeprecatedPersonalAgentSkill('project/manage/SKILL.md')).toBe(
      true,
    );
    expect(isDeprecatedPersonalAgentSkill('project/files/SKILL.md')).toBe(true);
    expect(
      isDeprecatedPersonalAgentSkill('legacy/project/manage/SKILL.md'),
    ).toBe(true);
    expect(isDeprecatedPersonalAgentSkill('work/main/SKILL.md')).toBe(false);
    expect(isDeprecatedPersonalAgentSkill('public/lita-query/SKILL.md')).toBe(
      false,
    );
  });

  it('角色说明使用 lita-work 并声明 project-manage 已废弃', () => {
    const prompt = buildPersonalAgentPrompt(
      '张三',
      'http://localhost:3100/api',
    );

    expect(prompt).toContain('lita-work 技能');
    expect(prompt).toContain('project-manage 已废弃');
  });
});
