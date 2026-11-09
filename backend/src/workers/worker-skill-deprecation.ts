/**
 * 已下线的平台能力技能（平台工具已由 lita-work MCP 完整覆盖）：
 * - lita-work（Gitea 路径 work/main，旧名 project-manage / project-files）
 * - knowledge-search（知识库，已由 search_knowledge 等工具覆盖）
 * - file-upload（文件上传，已由 upload_file 工具覆盖）
 *
 * 技能目录不再展示、机器人保存时自动丢弃，避免已下线的技能被重新安装。
 */
const DEPRECATED_SKILL_NAMES = new Set([
  'lita-work',
  'project-manage',
  'project-files',
  'knowledge-search',
  'file-upload',
]);

const DEPRECATED_SKILL_PATHS = [
  'work/main/SKILL.md',
  'project/manage/SKILL.md',
  'project/files/SKILL.md',
  'knowledge-search/SKILL.md',
  'file-upload/SKILL.md',
];

/** 归一技能标识：去空白与前导 / */
function normalize(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/^\/+/, '');
}

/** 是否为已下线的平台能力技能（支持名称或 Gitea 相对路径） */
export function isDeprecatedSkill(
  skill: string | { name?: string | null; path?: string | null },
): boolean {
  if (typeof skill === 'string') {
    const value = normalize(skill);
    return (
      DEPRECATED_SKILL_PATHS.some(
        (path) => value === path || value.endsWith(`/${path}`),
      ) || DEPRECATED_SKILL_NAMES.has(value.toLowerCase())
    );
  }
  const name = normalize(skill.name).toLowerCase();
  if (name && DEPRECATED_SKILL_NAMES.has(name)) return true;
  const path = normalize(skill.path);
  return DEPRECATED_SKILL_PATHS.some(
    (item) => path === item || path.endsWith(`/${item}`),
  );
}
