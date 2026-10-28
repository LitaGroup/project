/**
 * opencode server HTTP 客户端（2.x）。
 * 鉴权：HTTP Basic，用户名固定 `opencode`，密码为登记的 server password（token 列）。
 * 响应包裹：部分端点返回 `{ data: ... }` 信封（如 /api/session、/api/provider），统一在方法内解包。
 */
import {
  extractOpencodeTodosFromMessage,
  type OpencodeTodo,
} from './opencode-todos';

/** 执行器连接信息（Executor 实体的连接子集） */
export interface OpencodeEndpoint {
  ip: string;
  port: number;
  token?: string | null;
}

export interface OpencodeServerInfo {
  version: string;
  pid: number;
  urls: string[];
}

/** 供应商（GET /api/provider 条目，仅取展示所需字段） */
export interface OpencodeProviderInfo {
  id: string;
  name?: string;
}

/** 模型（GET /api/model 条目） */
export interface OpencodeModelInfo {
  id: string;
  modelID: string;
  providerID: string;
  name?: string;
}

/** 模型引用（建会话 / 发 prompt 时指定模型；id 即 modelID） */
export interface OpencodeModelRef {
  id: string;
  providerID: string;
  variant?: string;
}

/** 会话（POST /api/session 返回的 data） */
export interface OpencodeSessionInfo {
  id: string;
  title: string;
  location?: { directory: string } | null;
}

/** 建会话入参：title 必带（任务编号+标题），模型/目录/权限按需 */
export interface OpencodeCreateSessionInput {
  title?: string;
  model?: OpencodeModelRef;
  location?: { directory: string };
  /** 预授权规则集（无人值守执行关键；结构为 opencode Permission.Ruleset） */
  permissions?: unknown;
  metadata?: Record<string, unknown>;
}

/** 发 prompt 入参：text 必填；skills 技能附件 / files 文件附件按需 */
export interface OpencodePromptInput {
  text: string;
  skills?: unknown[];
  files?: unknown[];
}

/**
 * POST /prompt 的响应（data 信封已解包）。
 * 该接口是异步投递：立即返回本轮创建的用户消息，不等执行结果；
 * 结果需轮询会话终态（outcome 具有粘性，须配合 isFreshOutcome 采信本轮运行）。
 */
export interface OpencodePromptResult {
  id?: string;
  sessionID?: string;
  time?: { created?: number | null };
}

/**
 * 会话终态是否来自「本轮」运行（晚于 afterMs 结束）。
 * prompt 为异步接口，outcome/time.idle 会保留上一轮运行的结果，直接采信会把
 * 上一轮回复误判为本轮完成（重复旧内容）；time.idle 与消息 time.created 同源
 * （执行器时钟），晚于本轮用户消息创建时间才可信。
 * 缺 time.idle 的旧版本或未知基准（afterMs<=0）退回旧行为直接采信。
 */
export function isFreshOutcome(
  info: { outcome?: string | null; time?: { idle?: number | null } },
  afterMs: number,
): boolean {
  if (info.outcome !== 'succeeded' && info.outcome !== 'failed') return false;
  const idle = info.time?.idle;
  if (typeof idle !== 'number' || afterMs <= 0) return true;
  return idle >= afterMs;
}

/** 提问选项（QuestionV2Option / QuestionOption 同构） */
export interface OpencodeQuestionOption {
  label: string;
  /** 选项说明（可选） */
  description?: string;
}

/** 单个问题（QuestionV2Info / QuestionInfo 同构） */
export interface OpencodeQuestionInfo {
  /** 完整问题 */
  question: string;
  /** 短标签（≤30 字符，前端用作标题） */
  header: string;
  /** 可选项；为空时只能自由输入 */
  options?: OpencodeQuestionOption[];
  /** 是否可多选 */
  multiple?: boolean;
  /** 是否接受自由输入（false 时只能选选项） */
  custom?: boolean;
  /** form 协议下的字段 key（答复 form 时按 key 提交） */
  fieldKey?: string;
}

/** opencode Form API 条目（2.1+ question 工具经 form 呈现） */
export interface OpencodeFormDetail {
  id: string;
  sessionID: string;
  title?: string;
  metadata?: Record<string, unknown> | null;
  fields?: Array<Record<string, unknown>> | null;
  state?: Record<string, unknown> | null;
}

/** 待回答的提问请求（2.x 会话级 question） */
export interface OpencodeQuestionRequest {
  id: string;
  sessionID: string;
  questions: OpencodeQuestionInfo[];
  /** 关联的工具调用（用于把提问挂到对应 tool part 上） */
  tool?: { messageID?: string; callID?: string };
}

/** 判断 Form 条目是否由 question 工具产生（metadata.kind=question） */
export function isQuestionForm(form: OpencodeFormDetail): boolean {
  return (
    !!form &&
    typeof form.id === 'string' &&
    typeof form.sessionID === 'string' &&
    !!form.metadata &&
    typeof form.metadata === 'object' &&
    (form.metadata as Record<string, unknown>).kind === 'question'
  );
}

/** Form 条目 → QuestionRequest（question 工具在 2.1+ 经 form API 呈现） */
export function formToQuestionRequest(
  form: OpencodeFormDetail,
): OpencodeQuestionRequest | null {
  if (!isQuestionForm(form)) return null;
  const metadata = (form.metadata ?? {}) as Record<string, unknown>;
  const rawFields = Array.isArray(form.fields) ? form.fields : [];
  const questions = rawFields
    .map((raw, index): OpencodeQuestionInfo | null => {
      const field = raw ?? {};
      const title = typeof field.title === 'string' ? field.title : '';
      const description =
        typeof field.description === 'string' ? field.description : '';
      if (!title && !description) return null;
      const options = Array.isArray(field.options)
        ? field.options
            .map((rawOption): OpencodeQuestionOption | null => {
              const option = rawOption ?? {};
              const value =
                typeof option.value === 'string' ? option.value : '';
              const label =
                typeof option.label === 'string' && option.label
                  ? option.label
                  : value;
              if (!label) return null;
              return {
                label,
                description:
                  typeof option.description === 'string'
                    ? option.description
                    : undefined,
              };
            })
            .filter(
              (option): option is OpencodeQuestionOption => option !== null,
            )
        : undefined;
      return {
        question: description || title,
        header: title || `问题 ${index + 1}`,
        options: options?.length ? options : undefined,
        multiple: field.type === 'multiselect',
        custom: field.custom !== false,
        fieldKey: typeof field.key === 'string' ? field.key : `q${index}`,
      };
    })
    .filter((question): question is OpencodeQuestionInfo => question !== null);
  if (questions.length === 0) return null;
  const rawTool =
    metadata.tool && typeof metadata.tool === 'object'
      ? (metadata.tool as Record<string, unknown>)
      : null;
  return {
    id: form.id,
    sessionID: form.sessionID,
    questions,
    tool: rawTool
      ? {
          messageID:
            typeof rawTool.messageID === 'string'
              ? rawTool.messageID
              : undefined,
          callID:
            typeof rawTool.callID === 'string'
              ? rawTool.callID
              : typeof rawTool.id === 'string'
                ? rawTool.id
                : undefined,
        }
      : undefined,
  };
}

/** opencode form.* 事件 → 既有 question.* 事件（form 协议兼容层） */
export function formEventToQuestionEvent(
  eventType: string,
  data: Record<string, unknown>,
): { type: string; data: Record<string, unknown> } | null {
  if (eventType === 'form.created') {
    const rawForm = data.form;
    if (!rawForm || typeof rawForm !== 'object') return null;
    const request = formToQuestionRequest(rawForm as OpencodeFormDetail);
    return request
      ? { type: 'question.asked', data: request as unknown as Record<string, unknown> }
      : null;
  }
  if (eventType !== 'form.replied' && eventType !== 'form.cancelled') {
    return null;
  }
  const requestId = typeof data.id === 'string' ? data.id : '';
  if (!requestId) return null;
  return {
    type: eventType === 'form.replied' ? 'question.replied' : 'question.rejected',
    data: {
      requestID: requestId,
      sessionID: typeof data.sessionID === 'string' ? data.sessionID : '',
    },
  };
}

/** opencode 请求错误（保留状态码与响应体摘要） */
export class OpencodeClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'OpencodeClientError';
  }
}

export class OpencodeClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;

  constructor(endpoint: OpencodeEndpoint) {
    this.baseUrl = `http://${endpoint.ip}:${endpoint.port}`;
    this.headers = { 'Content-Type': 'application/json' };
    if (endpoint.token) {
      const basic = Buffer.from(`opencode:${endpoint.token}`).toString(
        'base64',
      );
      this.headers.Authorization = `Basic ${basic}`;
    }
  }

  /** 通用 JSON 请求：非 2xx 抛 OpencodeClientError（message 取响应体 message 或状态文本） */
  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: { ...this.headers, ...(init?.headers ?? {}) },
        signal: init?.signal,
      });
    } catch (e) {
      throw new OpencodeClientError(
        `执行器连接失败: ${(e as Error).message}`,
        0,
      );
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      let message = `HTTP ${res.status}`;
      try {
        const json = JSON.parse(body) as { message?: string };
        if (json.message) message = json.message;
      } catch {
        if (body) message = `${message}: ${body.slice(0, 200)}`;
      }
      throw new OpencodeClientError(message, res.status);
    }
    return (await res.json().catch(() => null)) as T;
  }

  /** 解 `{ data }` 信封（无信封原样返回） */
  private static unwrap<T>(json: T): T {
    if (
      json !== null &&
      typeof json === 'object' &&
      'data' in (json as Record<string, unknown>) &&
      (json as Record<string, unknown>).data !== undefined
    ) {
      return (json as Record<string, unknown>).data as T;
    }
    return json;
  }

  /** 服务器信息（健康检查用） */
  async info(signal?: AbortSignal): Promise<OpencodeServerInfo> {
    return this.request<OpencodeServerInfo>('/api/info', { signal });
  }

  /** server 默认工作目录 */
  async location(signal?: AbortSignal): Promise<{ directory: string }> {
    const json = await this.request<{ directory: string }>('/api/location', {
      signal,
    });
    return OpencodeClient.unwrap(json);
  }

  /** 供应商清单 */
  async providers(signal?: AbortSignal): Promise<OpencodeProviderInfo[]> {
    const json = await this.request<
      OpencodeProviderInfo[] | { data?: OpencodeProviderInfo[] }
    >('/api/provider', { signal });
    return (OpencodeClient.unwrap(json) ??
      []) as unknown as OpencodeProviderInfo[];
  }

  /** 模型清单（含 providerID/modelID/name） */
  async models(signal?: AbortSignal): Promise<OpencodeModelInfo[]> {
    const json = await this.request<
      OpencodeModelInfo[] | { data?: OpencodeModelInfo[] }
    >('/api/model', { signal });
    return (OpencodeClient.unwrap(json) ??
      []) as unknown as OpencodeModelInfo[];
  }

  /** 建会话（title/model/location/permissions），返回会话信息 */
  async createSession(
    input: OpencodeCreateSessionInput,
    signal?: AbortSignal,
  ): Promise<OpencodeSessionInfo> {
    const json = await this.request<OpencodeSessionInfo>('/api/session', {
      method: 'POST',
      body: JSON.stringify(input),
      signal,
    });
    return OpencodeClient.unwrap(json);
  }

  /**
   * 发送消息（任务派发的 prompt）。异步投递：立即返回本轮创建的用户消息。
   * 执行结果须轮询会话终态，且 outcome 具有粘性（保留上一轮结果），
   * 判定时使用 isFreshOutcome 以本轮用户消息时间作为基准。
   */
  async prompt(
    sessionId: string,
    input: OpencodePromptInput,
    signal?: AbortSignal,
  ): Promise<OpencodePromptResult | null> {
    const json = await this.request<unknown>(
      `/api/session/${sessionId}/prompt`,
      {
        method: 'POST',
        body: JSON.stringify(input),
        signal,
      },
    );
    return OpencodeClient.unwrap(json) as OpencodePromptResult | null;
  }

  /** 会话消息历史（列表，assistant 项 text 可能为空，需取详情） */
  async messages(sessionId: string): Promise<unknown> {
    return this.request(`/api/session/${sessionId}/message`);
  }

  /** 单条消息详情（含 content 分段，assistant 文本在此） */
  async message(sessionId: string, messageId: string): Promise<unknown> {
    return this.request(`/api/session/${sessionId}/message/${messageId}`);
  }

  /**
   * 会话最后一条 assistant 消息的文本。
   * 消息列表项的 text 可能为空，需取单条详情读取 content 分段。
   * 兼容列表按时间倒序/正序返回：优先按 time.created 排序后取最新一条。
   * afterCreatedMs：只取该时间之后创建的 assistant 消息（本轮基准），
   * 避免终态先于消息落库的瞬间取到上一轮回复。
   */
  async lastAssistantText(
    sessionId: string,
    afterCreatedMs = 0,
  ): Promise<string | null> {
    interface ListMessage {
      id?: string;
      type?: string;
      role?: string;
      time?: { created?: number | null };
    }
    type Detail = { content?: Array<{ type?: string; text?: string }> };
    const json = (await this.messages(sessionId)) as
      ListMessage[] | { data?: ListMessage[] };
    const list: ListMessage[] = Array.isArray(json) ? json : (json.data ?? []);
    const assistants = list
      .filter(
        (message) =>
          (message?.type === 'assistant' || message?.role === 'assistant') &&
          (message.time?.created ?? 0) >= afterCreatedMs,
      )
      .sort((a, b) => {
        const left = a.time?.created ?? 0;
        const right = b.time?.created ?? 0;
        if (left !== right) return right - left;
        // 兜底：消息 ID 内含单调时间戳
        return (b.id ?? '').localeCompare(a.id ?? '');
      });
    for (const message of assistants) {
      if (!message.id) continue;
      const raw = (await this.message(sessionId, message.id)) as
        Detail | { data?: Detail };
      const detail = (raw as { data?: Detail }).data ?? (raw as Detail);
      const text = (detail.content ?? [])
        .filter((part) => part.type === 'text' && part.text?.trim())
        .map((part) => part.text!.trim())
        .join('\n\n');
      if (text) return text;
    }
    return null;
  }

  /** 会话最后一条用户消息的创建时间（毫秒，无用户消息返回 0）；作为本轮运行的新鲜度基准 */
  async lastUserMessageCreatedAt(sessionId: string): Promise<number> {
    interface ListMessage {
      type?: string;
      role?: string;
      time?: { created?: number | null };
    }
    const json = (await this.messages(sessionId)) as
      ListMessage[] | { data?: ListMessage[] };
    const list: ListMessage[] = Array.isArray(json) ? json : (json.data ?? []);
    const created = list
      .filter((message) => message?.type === 'user' || message?.role === 'user')
      .map((message) => message.time?.created ?? 0)
      .sort((left, right) => right - left);
    return created[0] ?? 0;
  }

  /** 会话信息（outcome=运行结果，time.idle=空闲时间；重启后对账用） */
  async session(sessionId: string): Promise<{
    id: string;
    outcome?: string | null;
    time?: { idle?: number | null };
  }> {
    const json = await this.request<{
      id: string;
      outcome?: string | null;
      time?: { idle?: number | null };
    }>(`/api/session/${sessionId}`);
    return OpencodeClient.unwrap(json);
  }

  /**
   * 最近一次 todowrite 工具输入中的 todos（消息详情从新到旧扫描；无则 null）。
   * 用于调试待办面板的兜底对账：SSE 漏事件时从消息历史补齐。
   */
  async latestTodos(sessionId: string): Promise<OpencodeTodo[] | null> {
    interface ListMessage {
      id?: string;
      type?: string;
      role?: string;
      time?: { created?: number | null };
    }
    const json = (await this.messages(sessionId)) as
      ListMessage[] | { data?: ListMessage[] };
    const list: ListMessage[] = Array.isArray(json) ? json : (json.data ?? []);
    const assistants = list
      .filter(
        (message) =>
          message?.type === 'assistant' || message?.role === 'assistant',
      )
      .sort((a, b) => {
        const left = a.time?.created ?? 0;
        const right = b.time?.created ?? 0;
        if (left !== right) return right - left;
        // 兜底：消息 ID 内含单调时间戳
        return (b.id ?? '').localeCompare(a.id ?? '');
      });
    for (const message of assistants) {
      if (!message.id) continue;
      const raw = await this.message(sessionId, message.id);
      const detail = (raw as { data?: unknown }).data ?? raw;
      const todos = extractOpencodeTodosFromMessage(detail);
      if (todos) return todos;
    }
    return null;
  }

  /** 中断会话执行 */
  async interrupt(sessionId: string): Promise<unknown> {
    return this.request(`/api/session/${sessionId}/interrupt`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }

  /** 等待会话 agent loop 空闲（experimental wait；用于回答提问后接管既有执行） */
  async waitForIdle(sessionId: string, timeoutMs: number): Promise<void> {
    await this.request(`/api/experimental/session/${sessionId}/wait`, {
      method: 'POST',
      signal: AbortSignal.timeout(timeoutMs),
    });
  }

  /** 当前正在运行的会话清单（sessionId → { type: 'running' }） */
  async activeSessions(): Promise<Record<string, { type?: string }>> {
    const json = await this.request<
      Record<string, { type?: string }> | { data?: Record<string, { type?: string }> } | null
    >('/api/session/active');
    const data = OpencodeClient.unwrap(json);
    return data && typeof data === 'object' ? data : {};
  }

  /** 批复权限请求（decision：once=本次允许 / always=总是 / reject=拒绝） */
  async replyPermission(
    sessionId: string,
    requestId: string,
    decision: 'once' | 'always' | 'reject',
    message?: string,
  ): Promise<unknown> {
    return this.request(
      `/api/session/${sessionId}/permission/${requestId}/reply`,
      { method: 'POST', body: JSON.stringify({ decision, message }) },
    );
  }

  /** 待回答的提问：兼容 question 端点（新）与 form 端点（2.1+ question 工具） */
  async listQuestions(sessionId: string): Promise<OpencodeQuestionRequest[]> {
    const direct = await this.listDirectQuestions(sessionId);
    if (direct.length > 0) return direct;
    const forms = await this.listFormQuestions(sessionId);
    if (forms.length > 0) return forms;
    return this.listLegacyGlobalQuestions(sessionId);
  }

  /** 回答提问（answers 与问题顺序一致，每项为所选 label 与自定义文本） */
  async replyQuestion(
    sessionId: string,
    requestId: string,
    answers: string[][],
    questions: OpencodeQuestionInfo[] = [],
  ): Promise<void> {
    try {
      await this.request(
        `/api/session/${sessionId}/question/${requestId}/reply`,
        { method: 'POST', body: JSON.stringify({ answers }) },
      );
      return;
    } catch (error) {
      if (!(error instanceof OpencodeClientError) || error.status !== 404) {
        throw error;
      }
    }
    try {
      await this.replyQuestionForm(sessionId, requestId, answers, questions);
      return;
    } catch (error) {
      if (!(error instanceof OpencodeClientError) || error.status !== 404) {
        throw error;
      }
    }
    await this.request(`/question/${requestId}/reply`, {
      method: 'POST',
      body: JSON.stringify({ answers }),
    });
  }

  /** 跳过提问 */
  async rejectQuestion(sessionId: string, requestId: string): Promise<void> {
    try {
      await this.request(
        `/api/session/${sessionId}/question/${requestId}/reject`,
        { method: 'POST', body: JSON.stringify({}) },
      );
      return;
    } catch (error) {
      if (!(error instanceof OpencodeClientError) || error.status !== 404) {
        throw error;
      }
    }
    try {
      await this.request(
        `/api/session/${sessionId}/form/${encodeURIComponent(requestId)}`,
        { method: 'DELETE' },
      );
      return;
    } catch (error) {
      if (!(error instanceof OpencodeClientError) || error.status !== 404) {
        throw error;
      }
    }
    await this.request(`/question/${requestId}/reject`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }

  /** question 专用端点（部分版本提供；无该端点时返回空） */
  private async listDirectQuestions(
    sessionId: string,
  ): Promise<OpencodeQuestionRequest[]> {
    try {
      const json = await this.request<
        | OpencodeQuestionRequest[]
        | { data?: OpencodeQuestionRequest[] }
        | null
      >(`/api/session/${sessionId}/question`);
      const data = OpencodeClient.unwrap(json);
      return Array.isArray(data) ? data : [];
    } catch (error) {
      if (error instanceof OpencodeClientError && error.status === 404) {
        return [];
      }
      throw error;
    }
  }

  /** 旧版全局 question 端点兜底（按会话过滤；无该端点时返回空） */
  private async listLegacyGlobalQuestions(
    sessionId: string,
  ): Promise<OpencodeQuestionRequest[]> {
    try {
      const json = await this.request<
        | OpencodeQuestionRequest[]
        | { data?: OpencodeQuestionRequest[] }
        | null
      >('/question');
      const data = OpencodeClient.unwrap(json);
      return Array.isArray(data)
        ? data.filter((item) => item.sessionID === sessionId)
        : [];
    } catch {
      return [];
    }
  }

  /** form 端点中的 question 表单（question 工具经 form 呈现） */
  private async listFormQuestions(
    sessionId: string,
  ): Promise<OpencodeQuestionRequest[]> {
    const json = await this.request<
      OpencodeFormDetail[] | { data?: OpencodeFormDetail[] } | null
    >(`/api/session/${sessionId}/form`);
    const forms = OpencodeClient.unwrap(json) ?? [];
    if (!Array.isArray(forms)) return [];
    return forms
      .map((form) => formToQuestionRequest(form))
      .filter((request): request is OpencodeQuestionRequest => request !== null);
  }

  /** form 协议答复：按字段 key 组装 answer（multiselect 为数组，其余取首项） */
  private async replyQuestionForm(
    sessionId: string,
    requestId: string,
    answers: string[][],
    questions: OpencodeQuestionInfo[],
  ): Promise<void> {
    const answer: Record<string, string | string[]> = {};
    answers.forEach((row, index) => {
      const key = questions[index]?.fieldKey || `q${index}`;
      answer[key] = questions[index]?.multiple === true ? row : (row[0] ?? '');
    });
    await this.request(
      `/api/session/${sessionId}/form/${encodeURIComponent(requestId)}/reply`,
      { method: 'POST', body: JSON.stringify({ answer }) },
    );
  }

  /** 执行 shell 命令（建工位目录等；在 server 默认目录下用绝对路径操作） */
  async shell(command: string, timeoutMs = 15_000): Promise<unknown> {
    return this.request('/api/shell', {
      method: 'POST',
      body: JSON.stringify({ command, timeout: timeoutMs }),
    });
  }

  /** 订阅事件流（GET /api/event SSE）。返回原始 Response，由调用方读流解析 */
  async eventStream(signal: AbortSignal): Promise<Response> {
    return fetch(`${this.baseUrl}/api/event`, {
      headers: { ...this.headers, Accept: 'text/event-stream' },
      signal,
    });
  }
}
