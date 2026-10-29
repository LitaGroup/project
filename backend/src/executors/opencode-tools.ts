/**
 * opencode 工具调用事件解析。
 *
 * 事件协议在不同版本里字段略有差异：工具名可能在 data.name / data.tool.name，
 * 调用 ID 可能在 toolCallID / callID / tool.callID，输入与结果可能挂在
 * input/args/state.input 与 output/result/state.output。这里统一宽松提取，
 * 供任务对话与机器人调试共用。
 */

export type OpencodeToolPhase = 'started' | 'updated' | 'finished';

export interface OpencodeToolEvent {
  phase: OpencodeToolPhase;
  /** 工具名；finished 事件缺失时调用方可按调用 ID 匹配已有工具 */
  name: string;
  toolCallId?: string;
  /** 工具参数（JSON 文本，超长截断） */
  argsText?: string;
  /** 工具结果或错误（字符串或 JSON 文本，超长截断） */
  resultText?: string;
  /** 仅 finished：true=success，false=failed */
  ok?: boolean;
}

const STARTED_EVENTS = new Set(['session.tool.input.started']);
const UPDATED_EVENTS = new Set([
  'session.tool.called',
  'session.tool.input.updated',
  'session.tool.input.update',
  'session.tool.input.ended',
]);
const FINISHED_EVENTS = new Set([
  'session.tool.success',
  'session.tool.failed',
]);

/** 单个参数/结果保留的最大字符数，避免 shell 大输出撑爆消息快照与 SSE */
export const MAX_TOOL_TEXT = 20_000;

/** 把任意工具输入/输出转成可展示文本；字符串原样保留，其余 JSON 美化 */
export function stringifyToolValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  let text: string;
  if (typeof value === 'string') {
    text = value;
  } else {
    try {
      text = JSON.stringify(value, null, 2) ?? '[无法序列化的值]';
    } catch {
      text = '[无法序列化的值]';
    }
  }
  text = text.trim();
  if (!text) return undefined;
  return text.length > MAX_TOOL_TEXT
    ? `${text.slice(0, MAX_TOOL_TEXT)}\n…（已截断）`
    : text;
}

function objectOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : null;
}

function stringField(
  source: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

/** 工具结果可能是文本，也可能是 opencode 的 content 片段数组 */
function toolResultText(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => {
        const piece = objectOf(item);
        if (piece && typeof piece.text === 'string') return piece.text;
        return stringifyToolValue(item);
      })
      .filter((item): item is string => Boolean(item));
    if (parts.length > 0) return stringifyToolValue(parts.join('\n'));
  }
  return stringifyToolValue(value);
}

/** 解析工具事件；非工具事件或缺少可识别内容时返回 null */
export function parseOpencodeToolEvent(
  type: string,
  data: unknown,
): OpencodeToolEvent | null {
  const phase: OpencodeToolPhase | null = STARTED_EVENTS.has(type)
    ? 'started'
    : UPDATED_EVENTS.has(type)
      ? 'updated'
      : FINISHED_EVENTS.has(type)
        ? 'finished'
        : null;
  if (!phase) return null;

  const source = objectOf(data);
  if (!source) return null;
  const tool = objectOf(source.tool);
  const state = objectOf(source.state);

  const name =
    stringField(source, 'name', 'toolName') ??
    (tool ? stringField(tool, 'name') : undefined) ??
    '';
  const toolCallId =
    stringField(source, 'toolCallID', 'toolCallId', 'callID', 'callId', 'id') ??
    (tool ? stringField(tool, 'callID', 'callId', 'id') : undefined);
  const input =
    source.input ??
    source.args ??
    (type === 'session.tool.input.ended' ? source.text : undefined) ??
    state?.input ??
    (tool ? tool.input : undefined);
  const argsText = stringifyToolValue(input);

  if (phase !== 'finished') {
    if (!name && !toolCallId) return null;
    return {
      phase,
      name,
      ...(toolCallId ? { toolCallId } : {}),
      ...(argsText ? { argsText } : {}),
    };
  }

  const ok = type === 'session.tool.success';
  const error = objectOf(source.error);
  const result = ok
    ? (source.content ??
      source.output ??
      source.result ??
      state?.content ??
      state?.output ??
      state?.result ??
      (tool ? tool.output : undefined))
    : ((error ? (stringField(error, 'message') ?? error) : source.error) ??
      source.content ??
      source.output ??
      state?.error ??
      state?.output ??
      (tool ? tool.output : undefined));
  const resultText = toolResultText(result);
  if (!name && !toolCallId) return null;
  return {
    phase,
    name,
    ok,
    ...(toolCallId ? { toolCallId } : {}),
    ...(argsText ? { argsText } : {}),
    ...(resultText ? { resultText } : {}),
  };
}
