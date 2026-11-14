import type { OpencodeTodo } from '../executors/opencode-todos';

/**
 * MCP 开放工具共享类型与常量。
 * 外部机器上的 AI Agent（opencode / Claude Code 等）经 MCP Streamable HTTP
 * 把平台机器人当子 Agent 调用：bot_call 流式执行 + 多轮续聊。
 */

/** MCP 会话 scope 前缀：worker_debug_sessions.contextKey = `mcp:{sessionId}` */
export const MCP_SCOPE_PREFIX = 'mcp:';

/** 默认单轮执行超时：60 分钟 */
export const MCP_DEFAULT_TIMEOUT_MS = 60 * 60_000;

/** 单轮执行超时上限：60 分钟 */
export const MCP_MAX_TIMEOUT_MS = 60 * 60_000;

/** 外部调用会话 ID 格式：8-64 位字母数字下划线连字符 */
export const MCP_SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/** 首条消息注入的说明（仅会话第一条消息时进入执行器提示词，不写用户气泡） */
export const MCP_FIRST_PROMPT = [
  '# 外部 Agent 调用',
  '',
  '你正被外部机器上的 AI Agent 通过 MCP 调用（作为其子 Agent）。',
  '你的最终回复会作为工具结果返回给调用方主 Agent：请直接给出结论与关键信息，不要寒暄或复述角色设定；',
  '任务无法推进时优先使用提问工具向调用方澄清，而不要自行假设。',
].join('\n');

/**
 * lita-bots 调用方身份：
 * - 公共 Agent 令牌：id 为公共 Agent 虚拟用户（0）；
 * - 机器人令牌：优先落到机器人绑定的真人（humanUserId / personalAgentUserId），
 *   未绑定真人的 AI 机器人使用负的机器人 ID，隔离会话与审计身份。
 * 真人用户没有独立令牌，个人 AGENT 使用其主人真人机器人的令牌。
 */
export interface McpBotCaller {
  /** 会话归属与可见性过滤使用的 ID（AI 机器人为 -workerId） */
  id: number;
  /** 审计展示名称 */
  name: string;
}

/** list_bots 返回的机器人条目 */
export interface McpBotItem {
  id: number;
  name: string;
  intro: string | null;
  executor: string;
  /** 供应商/模型（含思考等级提示） */
  model: string;
}

/** 提问选项（返回给调用方组织答案用） */
export interface McpBotQuestionOptionView {
  label: string;
  description?: string;
}

/** 单个问题（返回给调用方） */
export interface McpBotQuestionView {
  question: string;
  header: string;
  options?: McpBotQuestionOptionView[];
  multiple?: boolean;
  /** 是否接受自由输入（false 时只能选选项） */
  custom?: boolean;
}

/** 一组待回答的提问（bot_call 返回 status=question 时附带） */
export interface McpBotQuestionGroup {
  /** 答复时回传 question_id */
  id: string;
  questions: McpBotQuestionView[];
}

/** 本轮工具调用摘要 */
export interface McpToolSummary {
  /** 工具调用 id（签名对比用） */
  id?: string;
  name: string;
  status: string;
  /** 参数摘要（截断） */
  detail?: string;
}

/** bot_call / bot_answer 的最终返回 */
export interface McpRunPayload {
  /** 会话 ID：续聊时回传给 bot_answer / bot_call 的 session_id */
  session_id: string;
  status: 'complete' | 'question' | 'error' | 'interrupted';
  /** 机器人最终文本回复 */
  content: string;
  /** 本轮工具调用清单 */
  tools: McpToolSummary[];
  /** 最近一次 todowrite 的待办 */
  todos: OpencodeTodo[];
  /** status=question 时的待回答提问 */
  questions?: McpBotQuestionGroup[];
  /** 答复格式说明（status=question 时附带） */
  answers_hint?: string;
  /** 失败原因 */
  error?: string;
}

/** bot_reset / get_session 的返回 */
export interface McpSessionPayload {
  session_id: string;
  /** 当前是否空闲（false 表示上一轮仍在执行） */
  idle: boolean;
  /** 消息摘要（get_session 返回，reset 为空） */
  messages: {
    role: 'user' | 'assistant';
    content: string;
    status: string;
    tools: McpToolSummary[];
  }[];
}
