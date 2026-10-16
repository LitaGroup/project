/**
 * 人员姓名串拆分：项目人员（resources）与提测测试人员的值支持多人，
 * 以 、 , ， ; ； 空格 换行 等常见分隔符拆分，去空去重，保持顺序。
 */
export function splitMemberNames(value: string | null | undefined): string[] {
  if (!value) return [];
  const names: string[] = [];
  for (const part of value.split(/[、,，;；\s]+/)) {
    const name = part.trim();
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}
