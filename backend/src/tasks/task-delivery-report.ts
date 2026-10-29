/**
 * 执行机器人在申请验收时提交的结构化交付说明。
 * 与 REVIEW 的 AI 总结共用同一信息结构，确保 HANDOFF / REVIEW 口径一致。
 */
export interface TaskDeliveryReportInput {
  /** 交付结果，以及代码仓库/分支、文档路径等交付清单 */
  delivery?: string | null;
  /** 实现过程中遇到的问题、解决方式和验证结果 */
  problems?: string | null;
  /** 走过的弯路、返工或失败尝试 */
  detours?: string | null;
  /** 可复用的经验、检查清单和改进项 */
  lessons?: string | null;
  /** 遗留问题、使用限制、优化建议和后续待办 */
  followUps?: string | null;
  /** 其它需要保留的信息 */
  other?: string | null;
}

export interface TaskDeliveryReport {
  delivery: string | null;
  problems: string | null;
  detours: string | null;
  lessons: string | null;
  followUps: string | null;
  other: string | null;
}

/** 单节上限，避免异常长内容撑爆事件元数据与复盘上下文 */
const MAX_SECTION_CHARS = 12_000;

function section(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;
  if (text.length <= MAX_SECTION_CHARS) return text;
  return `${text.slice(0, MAX_SECTION_CHARS)}\n\n…（内容过长，已截断 ${
    text.length - MAX_SECTION_CHARS
  } 字）`;
}

export function normalizeTaskDeliveryReport(
  input: TaskDeliveryReportInput | null | undefined,
): TaskDeliveryReport {
  return {
    delivery: section(input?.delivery),
    problems: section(input?.problems),
    detours: section(input?.detours),
    lessons: section(input?.lessons),
    followUps: section(input?.followUps),
    other: section(input?.other),
  };
}

export function isEmptyTaskDeliveryReport(report: TaskDeliveryReport): boolean {
  return Object.values(report).every((value) => !value);
}
