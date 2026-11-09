import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import { z } from 'zod';
import { User } from '../auth/user.entity';
import type { WorkerDebugOption } from '../workers/worker-debug.service';
import { WorkerChatService } from '../workers/worker-chat.service';
import {
  WorkerDebugService,
  type DebugStreamPayload,
} from '../workers/worker-debug.service';
import {
  currentRunText,
  diffRunProgress,
  initialRunState,
  interruptedResultFrom,
  pendingQuestionsOf,
  runArtifactsOf,
  settleRunResult,
  toolSummariesOf,
} from './mcp-bot-runner';
import {
  MCP_DEFAULT_TIMEOUT_MS,
  MCP_FIRST_PROMPT,
  MCP_MAX_TIMEOUT_MS,
  MCP_SCOPE_PREFIX,
  MCP_SESSION_ID_PATTERN,
  type McpBotItem,
  type McpBotQuestionGroup,
  type McpRunPayload,
  type McpSessionPayload,
} from './mcp.types';
import { McpLogsService } from './mcp-logs.service';

/** MCP progress 文本增量的推送节流（毫秒）：避免逐字符刷屏 */
const TEXT_FLUSH_MS = 300;

/** status=question 时附带的答复格式说明 */
const ANSWERS_HINT =
  '调用 bot_answer 续跑：answers 为二维字符串数组且每个问题对应一项，每项为所选选项 label（可多项）或自由输入文本；也可只传 skip=true 跳过提问继续执行。';

/** 进度推送函数（客户端提供 progressToken 时才存在） */
type ProgressFn = (progress: number, message: string) => Promise<void>;

/** 等待轮次终态的参数 */
interface WaitOptions {
  userId: number;
  workerId: number;
  sessionId: string;
  scope: string;
  notify: ProgressFn | null;
  signal?: AbortSignal;
  timeoutMs: number;
  autoSkip: boolean;
}

/**
 * 平台机器人 MCP 开放：
 * - 复用 WorkerDebugService 会话执行引擎（scope = mcp:{sessionId}）；
 * - bot_call 发起一轮调用并等待终态，期间经 MCP progress 实时回传文本与工具变化；
 * - 可见性过滤复用 WorkerChatService（启用 + opencode + 执行器在线 + 他人个人 AGENT 隐藏）。
 */
@Injectable()
export class McpService {
  private readonly logger = new Logger(McpService.name);

  constructor(
    private readonly debug: WorkerDebugService,
    private readonly chats: WorkerChatService,
    private readonly logs: McpLogsService,
  ) {}

  /**
   * 处理一次 MCP HTTP 请求（stateless 模式：每个请求独立的 transport/server，
   * 响应为 SSE 流，tools/call 期间可持续发送 progress notification）。
   */
  async handleRequest(
    user: User,
    req: import('express').Request,
    res: import('express').Response,
    body: unknown,
  ): Promise<void> {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    const server = new McpServer(
      { name: 'lita-bots', version: '1.0.0' },
      { capabilities: { tools: {} } },
    );
    this.registerTools(server, user);
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      void server.close().catch(() => {});
      void transport.close().catch(() => {});
    };
    res.on('close', cleanup);
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  }

  // ---- 工具注册 ----

  private registerTools(server: McpServer, user: User): void {
    const BotArg = z
      .string()
      .min(1)
      .describe('机器人名称或数字 ID（先调 list_bots 获取）');
    const SessionArg = z
      .string()
      .regex(MCP_SESSION_ID_PATTERN)
      .describe('会话 ID（bot_call 返回的 session_id）');

    server.registerTool(
      'list_bots',
      {
        title: '机器人清单',
        description:
          '列出当前可调用的平台机器人（启用、执行器在线、模型配置完整）。',
        inputSchema: {},
      },
      async () => textResult(await this.listBots(user.id)),
    );

    server.registerTool(
      'bot_call',
      {
        title: '调用机器人',
        description:
          '向平台机器人发起一轮对话/任务（机器人作为子 Agent 在平台执行器上运行）。' +
          '执行过程通过 progress notification 实时推送文本与工具调用；' +
          '机器人发起提问时返回 status=question，用 bot_answer 续跑；' +
          '返回的 session_id 可在后续调用中携带以保持多轮上下文。',
        inputSchema: {
          bot: BotArg,
          message: z
            .string()
            .min(1)
            .max(50_000)
            .describe('发给机器人的消息（Markdown）'),
          session_id: SessionArg.optional().describe(
            '续聊会话 ID；不传则新开会话',
          ),
          auto_skip_questions: z
            .boolean()
            .default(false)
            .describe('机器人提问时自动跳过（reject）继续执行'),
          timeout_seconds: z
            .number()
            .int()
            .min(10)
            .max(1800)
            .optional()
            .describe('单轮超时秒数（10-1800，默认 600），超时自动中断并返回已完成部分'),
        },
      },
      async (args, extra) => {
        try {
          const payload = await this.callBot(
            user,
            args,
            this.progressEmitterOf(extra),
            extra.signal,
          );
          return textResult(payload);
        } catch (error) {
          return toolError(error);
        }
      },
    );

    server.registerTool(
      'bot_answer',
      {
        title: '答复机器人提问',
        description:
          '回答机器人在 bot_call 中提出的问题（status=question）并继续等待本轮执行完成。',
        inputSchema: {
          bot: BotArg,
          session_id: SessionArg,
          question_id: z
            .string()
            .optional()
            .describe('要回答的提问 ID；不传默认取最近的待回答提问'),
          answers: z
            .array(z.array(z.string()).min(1))
            .optional()
            .describe(
              '按问题顺序的答案数组：每项为所选选项 label（可多个）或自由输入文本',
            ),
          skip: z
            .boolean()
            .default(false)
            .describe('跳过提问（reject）继续执行'),
        },
      },
      async (args, extra) => {
        try {
          const payload = await this.answerBot(
            user,
            args,
            this.progressEmitterOf(extra),
            extra.signal,
          );
          return textResult(payload);
        } catch (error) {
          return toolError(error);
        }
      },
    );

    server.registerTool('bot_interrupt', {
      title: '中断机器人',
      description: '中断机器人当前正在执行的一轮（会话保留，可继续续聊）。',
      inputSchema: { bot: BotArg, session_id: SessionArg },
    }, async (args) => {
      try {
        return textResult(await this.interruptBot(user, args));
      } catch (error) {
        return toolError(error);
      }
    });

    server.registerTool('bot_reset', {
      title: '重置机器人会话',
      description: '清空指定会话并解绑 opencode 上下文；下次调用将新开会话。',
      inputSchema: { bot: BotArg, session_id: SessionArg },
    }, async (args) => {
      try {
        return textResult(await this.resetBot(user, args));
      } catch (error) {
        return toolError(error);
      }
    });

    server.registerTool('get_session', {
      title: '读取机器人会话',
      description: '读取指定会话的消息摘要、工具调用与执行状态。',
      inputSchema: { bot: BotArg, session_id: SessionArg },
    }, async (args) => {
      try {
        return textResult(await this.getSession(user, args));
      } catch (error) {
        return toolError(error);
      }
    });
  }

  // ---- 工具实现 ----

  private async listBots(userId: number): Promise<{
    bots: McpBotItem[];
    hint: string;
  }> {
    const options = await this.chats.listWorkers(userId);
    return {
      bots: options.map((option) => ({
        id: option.id,
        name: option.name,
        intro: option.intro,
        executor: option.executorName,
        model: [option.providerId, option.modelId, option.variant]
          .filter(Boolean)
          .join('/'),
      })),
      hint: 'bot_call 的 bot 参数传机器人名称或数字 ID。',
    };
  }

  private async callBot(
    user: User,
    input: {
      bot: string;
      message: string;
      session_id?: string;
      auto_skip_questions?: boolean;
      timeout_seconds?: number;
    },
    notify: ProgressFn | null,
    signal: AbortSignal | undefined,
  ): Promise<McpRunPayload> {
    const worker = await this.resolveWorker(user.id, input.bot);
    const sessionId = this.assertSessionId(input.session_id);
    const scope = `${MCP_SCOPE_PREFIX}${sessionId}`;
    const startedAt = Date.now();
    const timeoutMs = this.timeoutMsOf(input.timeout_seconds);
    try {
      await this.debug.send(user.id, worker.id, input.message, {
        scope,
        firstPrompt: MCP_FIRST_PROMPT,
      });
    } catch (error) {
      await this.logs.record({
        userId: user.id,
        userName: user.name,
        workerId: worker.id,
        workerName: worker.name,
        sessionId,
        tool: 'bot_call',
        status: error instanceof ConflictException ? 'conflict' : 'error',
        durationMs: Date.now() - startedAt,
        messageLength: input.message.length,
        error: (error as Error).message,
      });
      throw error;
    }
    const result = await this.waitForRun({
      userId: user.id,
      workerId: worker.id,
      sessionId,
      scope,
      notify,
      signal,
      timeoutMs,
      autoSkip: input.auto_skip_questions === true,
    });
    await this.logs.record({
      userId: user.id,
      userName: user.name,
      workerId: worker.id,
      workerName: worker.name,
      sessionId,
      tool: 'bot_call',
      status: result.status,
      durationMs: Date.now() - startedAt,
      messageLength: input.message.length,
      contentLength: result.content.length,
      error: result.error ?? null,
    });
    return result;
  }

  private async answerBot(
    user: User,
    input: {
      bot: string;
      session_id: string;
      question_id?: string;
      answers?: string[][];
      skip?: boolean;
    },
    notify: ProgressFn | null,
    signal: AbortSignal | undefined,
  ): Promise<McpRunPayload> {
    const worker = await this.resolveWorker(user.id, input.bot);
    const sessionId = this.assertSessionId(input.session_id);
    const scope = `${MCP_SCOPE_PREFIX}${sessionId}`;
    const startedAt = Date.now();
    const snapshot = await this.debug.snapshot(user.id, worker.id, scope);
    const questions = pendingQuestionsOf(snapshot.messages);
    if (questions.length === 0) {
      throw new BadRequestException('当前会话没有待回答的提问');
    }
    const questionId =
      input.question_id?.trim() ||
      (questions.length === 1 ? questions[0].id : null);
    if (!questionId) {
      throw new BadRequestException(
        `会话有 ${questions.length} 组待回答提问，请传 question_id 指定`,
      );
    }
    const group = questions.find((item) => item.id === questionId);
    if (!group) {
      throw new NotFoundException(`提问 ${questionId} 不存在或已处理`);
    }
    const input_: { answers?: string[][]; reject?: boolean } = input.skip
      ? { reject: true }
      : { answers: input.answers };
    try {
      await this.debug.replyQuestion(user.id, worker.id, questionId, input_, scope);
    } catch (error) {
      await this.logs.record({
        userId: user.id,
        userName: user.name,
        workerId: worker.id,
        workerName: worker.name,
        sessionId,
        tool: 'bot_answer',
        status: 'error',
        durationMs: Date.now() - startedAt,
        messageLength: JSON.stringify(input.answers ?? '').length,
        error: (error as Error).message,
      });
      throw error;
    }
    const result = await this.waitForRun({
      userId: user.id,
      workerId: worker.id,
      sessionId,
      scope,
      notify,
      signal,
      timeoutMs: MCP_DEFAULT_TIMEOUT_MS,
      autoSkip: false,
    });
    await this.logs.record({
      userId: user.id,
      userName: user.name,
      workerId: worker.id,
      workerName: worker.name,
      sessionId,
      tool: 'bot_answer',
      status: result.status,
      durationMs: Date.now() - startedAt,
      messageLength: JSON.stringify(input.answers ?? '').length,
      contentLength: result.content.length,
      error: result.error ?? null,
    });
    return result;
  }

  private async interruptBot(
    user: User,
    input: { bot: string; session_id: string },
  ): Promise<McpRunPayload> {
    const worker = await this.resolveWorker(user.id, input.bot);
    const sessionId = this.assertSessionId(input.session_id);
    const scope = `${MCP_SCOPE_PREFIX}${sessionId}`;
    const snapshot = await this.debug.interrupt(user.id, worker.id, scope);
    const artifacts = interruptedResultFrom(snapshot);
    return {
      session_id: sessionId,
      status: 'interrupted',
      content: artifacts.content,
      tools: artifacts.tools,
      todos: artifacts.todos,
      error: snapshot.status === 'idle' && !artifacts.content
        ? '该会话当前没有正在执行的一轮'
        : undefined,
    };
  }

  private async resetBot(
    user: User,
    input: { bot: string; session_id: string },
  ): Promise<McpSessionPayload> {
    const worker = await this.resolveWorker(user.id, input.bot);
    const sessionId = this.assertSessionId(input.session_id);
    const scope = `${MCP_SCOPE_PREFIX}${sessionId}`;
    await this.debug.reset(user.id, worker.id, scope);
    return { session_id: sessionId, idle: true, messages: [] };
  }

  private async getSession(
    user: User,
    input: { bot: string; session_id: string },
  ): Promise<McpSessionPayload> {
    const worker = await this.resolveWorker(user.id, input.bot);
    const sessionId = this.assertSessionId(input.session_id);
    const scope = `${MCP_SCOPE_PREFIX}${sessionId}`;
    const snapshot = await this.debug.snapshot(user.id, worker.id, scope);
    return {
      session_id: sessionId,
      idle: snapshot.status === 'idle',
      messages: snapshot.messages
        .filter((message) => !message.question)
        .slice(-20)
        .map((message) => ({
          role: message.role,
          content: message.content,
          status: message.status,
          tools: toolSummariesOf(message),
        })),
    };
  }

  // ---- 内部 ----

  /**
   * 订阅会话快照流等待本轮终态：
   * - 文本增量 300ms 节流、工具变化即时经 progress 推送；
   * - 提问出现时结束等待（autoSkip 时自动 reject 继续）；
   * - 超时中断并返回已完成部分；客户端 abort 时立即收尾（平台侧继续执行，可 get_session 找回）。
   */
  private waitForRun(options: WaitOptions): Promise<McpRunPayload> {
    const { userId, workerId, scope } = options;
    return new Promise<McpRunPayload>((resolve) => {
      let settled = false;
      let progressCounter = 0;
      const state = initialRunState();
      const skipping = new Set<string>();
      let textBuffer = '';
      let flushTimer: NodeJS.Timeout | null = null;
      let timeoutTimer: NodeJS.Timeout | null = null;

      const push = async (message: string) => {
        if (!options.notify || settled) return;
        progressCounter += 1;
        try {
          await options.notify(progressCounter, message);
        } catch {
          // 推送失败（客户端断开等）不影响执行
        }
      };

      const flushText = () => {
        if (flushTimer) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
        if (!textBuffer) return;
        const chunk = textBuffer;
        textBuffer = '';
        void push(chunk);
      };

      const scheduleText = () => {
        if (flushTimer) return;
        flushTimer = setTimeout(flushText, TEXT_FLUSH_MS);
        flushTimer.unref?.();
      };

      const cleanup = () => {
        if (flushTimer) clearTimeout(flushTimer);
        if (timeoutTimer) clearTimeout(timeoutTimer);
        subscription.unsubscribe();
        options.signal?.removeEventListener('abort', onAbort);
      };

      const finish = (
        result: Pick<McpRunPayload, 'status' | 'content'> &
          Partial<McpRunPayload>,
      ) => {
        if (settled) return;
        settled = true;
        cleanup();
        const artifacts = result.tools
          ? { tools: result.tools, todos: result.todos ?? [] }
          : { tools: [], todos: [] };
        resolve({
          session_id: options.sessionId,
          status: result.status,
          content: result.content ?? '',
          tools: artifacts.tools,
          todos: artifacts.todos,
          ...(result.questions ? { questions: result.questions } : {}),
          ...(result.questions ? { answers_hint: ANSWERS_HINT } : {}),
          ...(result.error ? { error: result.error } : {}),
        });
      };

      const onAbort = () => {
        // 客户端断开：平台侧继续执行，结果可 get_session 找回
        finish({
          status: 'interrupted',
          content: '',
          error: '调用方已断开（本轮在平台继续执行，可用 get_session 查看结果）',
        });
      };
      options.signal?.addEventListener('abort', onAbort, { once: true });

      const subscription = this.debug.stream(userId, workerId, scope).subscribe({
        next: ({ data }: { data: DebugStreamPayload }) => {
          if (settled || data.type !== 'snapshot' || !data.snapshot) return;
          const snapshot = data.snapshot;
          const questions = pendingQuestionsOf(snapshot.messages);
          if (questions.length > 0) {
            const group: McpBotQuestionGroup = questions[0];
            if (options.autoSkip) {
              if (skipping.has(group.id)) return;
              skipping.add(group.id);
              void push('（提问已自动跳过，继续执行）');
              this.debug
                .replyQuestion(userId, workerId, group.id, { reject: true }, scope)
                .catch((error: Error) =>
                  finish({
                    status: 'error',
                    content: currentRunText(snapshot),
                    error: `自动跳过提问失败：${error.message}`,
                  }),
                );
              return;
            }
            finish({
              status: 'question',
              content: currentRunText(snapshot),
              ...runArtifactsOf(snapshot),
              questions,
            });
            return;
          }
          const step = diffRunProgress(state, snapshot);
          if (step?.toolEvents?.length) {
            for (const event of step.toolEvents) void push(event);
          }
          if (step?.text) {
            textBuffer += step.text;
            scheduleText();
          }
          if (snapshot.status === 'idle') {
            const settledResult = settleRunResult(snapshot);
            if (settledResult) {
              finish({
                status: settledResult.status,
                content: settledResult.content,
                error: settledResult.error,
                ...runArtifactsOf(snapshot),
              });
            }
          }
        },
        error: (error: Error) =>
          finish({ status: 'error', content: '', error: error.message }),
      });

      timeoutTimer = setTimeout(() => {
        if (settled) return;
        this.debug
          .interrupt(userId, workerId, scope)
          .then((snapshot) => {
            const artifacts = interruptedResultFrom(snapshot);
            finish({
              status: 'interrupted',
              content: artifacts.content,
              tools: artifacts.tools,
              todos: artifacts.todos,
              error: `执行超过 ${Math.round(options.timeoutMs / 1000)} 秒，已中断并返回已完成部分`,
            });
          })
          .catch((error: Error) =>
            finish({
              status: 'interrupted',
              content: '',
              error: `执行超时且中断失败：${error.message}`,
            }),
          );
      }, options.timeoutMs);
      timeoutTimer.unref?.();
    });
  }

  /** 按名称或数字 ID 精确匹配可调用机器人（可见性过滤复用聊天清单） */
  private async resolveWorker(
    userId: number,
    bot: string,
  ): Promise<WorkerDebugOption> {
    const q = bot.trim();
    const options = await this.chats.listWorkers(userId);
    if (options.length === 0) {
      throw new ServiceUnavailableException(
        '当前没有可调用的机器人（需启用、执行器在线且模型配置完整）',
      );
    }
    const numeric = Number(q);
    const found =
      Number.isInteger(numeric) && numeric > 0
        ? options.find((option) => option.id === numeric)
        : (options.find((option) => option.name === q) ??
          options.find(
            (option) => option.name.toLowerCase() === q.toLowerCase(),
          ));
    if (!found) {
      const names = options
        .slice(0, 10)
        .map((option) => `${option.name}(id=${option.id})`)
        .join('、');
      throw new NotFoundException(
        `未找到可调用的机器人「${q}」。可用：${names}${options.length > 10 ? ' …' : ''}（先调 list_bots 获取完整清单）`,
      );
    }
    return found;
  }

  /** 校验/生成会话 ID；不传则新开 */
  private assertSessionId(sessionId: string | undefined): string {
    const trimmed = sessionId?.trim();
    if (!trimmed) return this.newSessionId();
    if (!MCP_SESSION_ID_PATTERN.test(trimmed)) {
      throw new BadRequestException(
        '无效的 session_id（应为 bot_call 返回的 8-64 位标识）',
      );
    }
    return trimmed;
  }

  private newSessionId(): string {
    return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  }

  private timeoutMsOf(seconds: number | undefined): number {
    if (!seconds || seconds <= 0) return MCP_DEFAULT_TIMEOUT_MS;
    return Math.min(Math.max(seconds, 10) * 1000, MCP_MAX_TIMEOUT_MS);
  }

  /** 客户端提供 progressToken 时构造进度推送函数，否则返回 null（仅等终态） */
  private progressEmitterOf(
    extra: RequestHandlerExtra<
      import('@modelcontextprotocol/sdk/types.js').Request,
      import('@modelcontextprotocol/sdk/types.js').Notification
    >,
  ): ProgressFn | null {
    const progressToken = extra._meta?.progressToken;
    if (progressToken === undefined || progressToken === null) return null;
    return async (progress: number, message: string) => {
      await extra.sendNotification({
        method: 'notifications/progress',
        params: { progressToken, progress, message },
      });
    };
  }
}

/** 工具结果：JSON 文本 */
function textResult(payload: unknown): {
  content: { type: 'text'; text: string }[];
} {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  };
}

/** 工具失败：isError=true，文本为错误信息与建议 */
function toolError(error: unknown): {
  isError: true;
  content: { type: 'text'; text: string }[];
} {
  const message = error instanceof Error ? error.message : String(error);
  const hint =
    error instanceof ConflictException
      ? '（可先调 bot_interrupt 中断当前轮，或稍后重试；机器人执行配置变更时需先 bot_reset）'
      : '';
  return {
    isError: true,
    content: [{ type: 'text', text: `${message}${hint}` }],
  };
}
