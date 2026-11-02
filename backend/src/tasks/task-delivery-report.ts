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

/** 可识别的小节标题别名 → 结构化字段 */
const REPORT_SECTION_ALIASES: Record<string, keyof TaskDeliveryReport> = {
  交付内容: 'delivery',
  交付物与结论: 'delivery',
  实现问题与解决: 'problems',
  问题与解决: 'problems',
  走过的弯路: 'detours',
  任务记录与过程复盘: 'detours',
  经验总结: 'lessons',
  遗留建议与后续待办: 'followUps',
  遗留建议: 'followUps',
  后续待办: 'followUps',
  其它需要保留的信息: 'other',
  其他需要保留的信息: 'other',
};

/** 去掉整体包裹的 Markdown 代码围栏 */
function stripFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/);
  return (fenced ? fenced[1] : trimmed).trim();
}

/** 小节缺失时的明确占位：不编造复盘内容（机器人与真人共用） */
const EMPTY_SECTION = '（未填写，记录中未体现）';

/** 从 Markdown 中提取固定小节；缺失的小节给出明确占位而不是编造 */
export function splitHandoffSummary(raw: string): TaskDeliveryReport {
  const text = stripFence(raw);
  const heading =
    /^#{2,4}\s*(交付内容|交付物与结论|实现问题与解决|问题与解决|走过的弯路|任务记录与过程复盘|经验总结|遗留建议与后续待办|遗留建议|后续待办|其它需要保留的信息|其他需要保留的信息)\s*$/gm;
  const matches = [...text.matchAll(heading)];
  const sections: Partial<Record<keyof TaskDeliveryReport, string>> = {};
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const key = REPORT_SECTION_ALIASES[match[1]];
    if (!key) continue;
    const start = (match.index ?? 0) + match[0].length;
    const end =
      index + 1 < matches.length
        ? (matches[index + 1].index ?? text.length)
        : text.length;
    sections[key] = text.slice(start, end).trim();
  }
  const fallback = text || '（未提供交付说明）';
  return normalizeTaskDeliveryReport({
    delivery: sections.delivery || fallback,
    problems: sections.problems || EMPTY_SECTION,
    detours: sections.detours || EMPTY_SECTION,
    lessons: sections.lessons || EMPTY_SECTION,
    followUps: sections.followUps || EMPTY_SECTION,
    other: sections.other || EMPTY_SECTION,
  });
}

/** 工作台单输入框提交的交付说明（兼容旧的六个字段） */
export interface WorkbenchHandoffPayload extends TaskDeliveryReportInput {
  /** Markdown 全文：可带固定小节标题，也可只写一段自由文本 */
  content?: string | null;
}

/**
 * 去掉 Markdown 标题行与分割线后是否仍有正文。
 * 用于拦截"只有空模板标题"的提交，避免把整份空模板当成交付内容。
 */
export function hasHandoffBody(markdown: string): boolean {
  return (
    markdown
      .split('\n')
      .filter((line) => !/^\s{0,3}#{1,6}\s/.test(line))
      .join('\n')
      .replace(/^\s*(?:-{3,}|\*{3,})\s*$/gm, '')
      .trim().length > 0
  );
}

/**
 * 工作台交付说明解析：优先使用单输入框的 Markdown 全文，
 * 没有 content 时回退旧的六个字段。返回 null 表示没有有效正文。
 */
export function parseWorkbenchHandoff(
  input: WorkbenchHandoffPayload | null | undefined,
): TaskDeliveryReport | null {
  if (typeof input?.content === 'string') {
    const markdown = input.content.trim();
    if (!hasHandoffBody(markdown)) return null;
    return splitHandoffSummary(markdown);
  }
  return normalizeTaskDeliveryReport(input);
}
