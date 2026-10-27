/**
 * opencode 待办（todowrite 工具）解析。
 * 待办面板的数据源：模型调用 todowrite 工具时写入的完整 todos 清单。
 * 事件与消息详情的字段命名随版本略有差异，这里统一宽松提取 + 严格校验：
 * 任一条目不合法即整体视为未产出（返回 null），避免把半截流式输入渲染成假待办。
 */

/** opencode 待办条目（todowrite 工具输入，状态为 opencode 原生枚举） */
export interface OpencodeTodo {
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority?: string;
}

/** todowrite 工具名（历史版本存在 todo_write 等变体） */
const TODO_TOOL_NAMES = new Set(['todowrite', 'todo_write', 'todo-write']);

/** 可能携带完整工具输入的事件（input.delta 等分片事件不在此列） */
const TODO_TOOL_EVENT_TYPES = new Set([
  'session.tool.input.started',
  'session.tool.input.updated',
  'session.tool.input.update',
  'session.tool.input.ended',
  'session.tool.success',
  'session.tool.failed',
]);

const TODO_STATUSES = new Set([
  'pending',
  'in_progress',
  'completed',
  'cancelled',
]);

/** 待办条数上限（防御异常超大输入） */
const MAX_TODOS = 200;

/** 事件是否为 todowrite 工具相关（按 data.name 判定） */
export function isTodoToolEvent(type: string, data: unknown): boolean {
  if (!TODO_TOOL_EVENT_TYPES.has(type)) return false;
  const name = (data as { name?: unknown } | null)?.name;
  if (typeof name !== 'string') return false;
  return TODO_TOOL_NAMES.has(name.trim().toLowerCase());
}

/**
 * 从事件 data 提取完整 todos：依次尝试 data.input / data.args / data.state.input / data 本体。
 * 返回 null 表示本次事件不含完整合法 todos（如流式半截输入），调用方应忽略。
 */
export function extractOpencodeTodos(data: unknown): OpencodeTodo[] | null {
  if (!data || typeof data !== 'object') return null;
  const source = data as Record<string, unknown>;
  const candidates: unknown[] = [
    source.input,
    source.args,
    (source.state as Record<string, unknown> | null)?.input,
    source,
  ];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue;
    const todos = (candidate as Record<string, unknown>).todos;
    if (Array.isArray(todos)) {
      const parsed = normalizeOpencodeTodos(todos);
      if (parsed) return parsed;
    }
  }
  return null;
}

/**
 * 从消息详情提取 todowrite 的 todos（单条消息内取第一个命中的工具分片）。
 * 兼容 content[].tool / parts[].name 两种形态与 state.input / input 两种挂载位置。
 */
export function extractOpencodeTodosFromMessage(
  message: unknown,
): OpencodeTodo[] | null {
  if (!message || typeof message !== 'object') return null;
  const detail = message as { content?: unknown; parts?: unknown };
  const content = Array.isArray(detail.content)
    ? (detail.content as unknown[])
    : [];
  const extra = Array.isArray(detail.parts) ? (detail.parts as unknown[]) : [];
  const parts = [...content, ...extra];
  for (const part of parts) {
    if (!part || typeof part !== 'object') continue;
    const piece = part as Record<string, unknown>;
    const name =
      typeof piece.tool === 'string'
        ? piece.tool
        : typeof piece.name === 'string'
          ? piece.name
          : '';
    if (!TODO_TOOL_NAMES.has(name.trim().toLowerCase())) continue;
    const state = piece.state as Record<string, unknown> | null;
    const todos = extractOpencodeTodos({ input: state?.input ?? piece.input });
    if (todos) return todos;
  }
  return null;
}

/** 严格规范化 todos 数组：任一条不合法整体返回 null；空数组视为合法（清空待办） */
export function normalizeOpencodeTodos(raw: unknown[]): OpencodeTodo[] | null {
  if (raw.length > MAX_TODOS) return null;
  const todos: OpencodeTodo[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') return null;
    const source = item as Record<string, unknown>;
    const content =
      typeof source.content === 'string' ? source.content.trim() : '';
    if (!content) return null;
    const status =
      typeof source.status === 'string' && TODO_STATUSES.has(source.status)
        ? (source.status as OpencodeTodo['status'])
        : 'pending';
    const priority =
      typeof source.priority === 'string' && source.priority.trim()
        ? source.priority.trim()
        : undefined;
    todos.push(priority ? { content, status, priority } : { content, status });
  }
  return todos;
}
