/**
 * 提问选项规范化。
 * 机器人调用 questions/ask 或执行器 question 事件时，选项可能是字符串、
 * {label} / {value} / {text} 对象，甚至历史脏数据（字符串曾被展开成数字键对象）。
 * 统一收敛为 {label, description?}，避免前端渲染出空白选项。
 */
export interface NormalizedQuestionOption {
  label: string;
  description?: string;
}

/** 单个选项规范化；无法提取出非空 label 时返回 null */
export function normalizeQuestionOption(
  raw: unknown,
): NormalizedQuestionOption | null {
  if (typeof raw === 'string') {
    const label = raw.trim();
    return label ? { label } : null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const option = raw as Record<string, unknown>;
  const label = [option.label, option.value, option.text]
    .find(
      (value): value is string =>
        typeof value === 'string' && value.trim().length > 0,
    )
    ?.trim();
  if (label) {
    const description =
      typeof option.description === 'string' && option.description.trim()
        ? option.description.trim()
        : undefined;
    return description ? { label, description } : { label };
  }
  // 兼容历史脏数据：字符串选项曾被 {...option} 展开成 {0:'按',1:'日',...}，
  // 全部键都是数字时按序拼回原文。
  const keys = Object.keys(option);
  if (keys.length > 0 && keys.every((key) => /^\d+$/.test(key))) {
    const label = keys
      .sort((a, b) => Number(a) - Number(b))
      .map((key) => String(option[key]))
      .join('')
      .trim();
    return label ? { label } : null;
  }
  return null;
}

/** 选项数组规范化；输入不是数组或全部无效时返回 undefined（视为无选项） */
export function normalizeQuestionOptions(
  options: unknown,
): NormalizedQuestionOption[] | undefined {
  if (!Array.isArray(options)) return undefined;
  const normalized = options
    .map((option) => normalizeQuestionOption(option))
    .filter((option): option is NormalizedQuestionOption => option !== null);
  return normalized.length > 0 ? normalized : undefined;
}
