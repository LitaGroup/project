import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter } from 'events';
import { In, LessThan, Repository } from 'typeorm';
import { Observable } from 'rxjs';
import { WorkerKind, WorkerRuntime } from '../common/enums';
import { Executor } from '../executors/executor.entity';
import {
  OpencodeEvent,
  OpencodeEventHub,
} from '../executors/opencode-event-hub.service';
import {
  extractOpencodeTodos,
  isTodoToolEvent,
  type OpencodeTodo,
} from '../executors/opencode-todos';
import {
  OpencodeClient,
  OpencodeClientError,
  isFreshOutcome,
  type OpencodeQuestionRequest,
} from '../executors/opencode-client';
import { Worker } from './worker.entity';
import { WorkerDebugSession } from './worker-debug-session.entity';
import type {
  DebugStreamPayload,
  WorkerDebugMessage,
  WorkerDebugOption,
  WorkerDebugQuestion,
  WorkerDebugQuestionState,
  WorkerDebugSnapshot,
} from './worker-debug.types';
import { WorkersService } from './workers.service';

export type {
  DebugStreamPayload,
  WorkerDebugMessage,
  WorkerDebugOption,
  WorkerDebugQuestion,
  WorkerDebugQuestionState,
  WorkerDebugSnapshot,
} from './worker-debug.types';

/**
 * 把 opencode 流式事件落到调试 assistant 消息上（纯函数，便于单测）。
 * 文本/思考增量分别追加，ended 追加段落分隔符；返回是否发生了变更。
 */
export function applyDebugStreamEvent(
  message: WorkerDebugMessage,
  type: string,
  data: Record<string, unknown>,
): boolean {
  const delta = typeof data.delta === 'string' ? data.delta : '';
  switch (type) {
    case 'session.text.delta': {
      if (!delta) return false;
      message.content += delta;
      return true;
    }
    case 'session.text.ended': {
      if (!message.content) return false;
      message.content += '\n\n';
      return true;
    }
    case 'session.reasoning.delta': {
      if (!delta) return false;
      message.reasoning = (message.reasoning ?? '') + delta;
      return true;
    }
    case 'session.reasoning.ended': {
      if (!message.reasoning) return false;
      message.reasoning += '\n\n';
      return true;
    }
    default:
      return false;
  }
}

/** 平台重启后恢复消息：上一轮还在 running 的助手消息按中断收尾、待回答提问失效（纯函数，便于单测） */
export function recoverDebugMessages(
  messages: WorkerDebugMessage[] | null | undefined,
): WorkerDebugMessage[] {
  return (messages ?? []).map((message) => {
    if (message.question) {
      // 恢复后旧 request 已无法答复，待回答的提问随本轮中断一并失效
      return message.question.state === 'pending'
        ? {
            ...message,
            status: 'complete' as const,
            question: { ...message.question, state: 'cancelled' as const },
          }
        : { ...message };
    }
    return message.role === 'assistant' && message.status === 'running'
      ? {
          ...message,
          status: 'error' as const,
          content:
            message.content ||
            '本轮回复已中断（平台重启或会话已断开），可继续发送新消息。',
        }
      : { ...message };
  });
}

/**
 * 解析 question 事件 data（纯函数，便于单测）。
 * v1/v2 的 data 直接是 request 结构，部分版本包在 `request` 字段里。
 */
export function parseQuestionEvent(
  data: Record<string, unknown>,
): OpencodeQuestionRequest | null {
  const raw = (data.request ?? data) as Partial<OpencodeQuestionRequest>;
  if (typeof raw.id !== 'string' || !Array.isArray(raw.questions)) return null;
  return {
    id: raw.id,
    sessionID: typeof raw.sessionID === 'string' ? raw.sessionID : '',
    questions: raw.questions,
    tool: raw.tool,
  };
}

/**
 * question.asked：插入独立的提问卡片消息（同一 request 幂等），返回是否新增。
 * 卡片独立成消息，不打断当前助手气泡的文本流。
 */
export function upsertDebugQuestion(
  messages: WorkerDebugMessage[],
  request: OpencodeQuestionRequest,
  fallbackSessionId: string,
  createdAt: string,
): boolean {
  const id = `question:${request.id}`;
  if (messages.some((message) => message.id === id)) return false;
  messages.push({
    id,
    role: 'assistant',
    kind: 'question',
    content: '',
    status: 'running',
    createdAt,
    question: {
      id: request.id,
      sessionId: request.sessionID || fallbackSessionId,
      questions: (request.questions ?? []).map((question) => ({
        ...question,
        options: question.options?.map((option) => ({ ...option })),
      })),
      state: 'pending',
      askedAt: createdAt,
      toolCallId: request.tool?.callID,
    },
  });
  return true;
}

/** 指定会话消息里全部待回答的提问（对账/失效清理用） */
export function pendingDebugQuestions(
  messages: WorkerDebugMessage[],
): WorkerDebugQuestion[] {
  return messages
    .map((message) => message.question)
    .filter(
      (question): question is WorkerDebugQuestion =>
        question?.state === 'pending',
    );
}

/**
 * 提问结算（answered/rejected/cancelled）：就地更新卡片为回执，
 * 仅 pending 可结算（重复事件幂等），返回是否发生了变更。
 */
export function settleDebugQuestion(
  messages: WorkerDebugMessage[],
  requestId: string,
  state: Exclude<WorkerDebugQuestionState, 'pending'>,
  answers?: string[][],
): boolean {
  const message = messages.find((item) => item.question?.id === requestId);
  if (!message?.question || message.question.state !== 'pending') return false;
  message.question = {
    ...message.question,
    state,
    answers: answers?.map((answer) => [...answer]),
  };
  message.status = 'complete';
  return true;
}

/** 校验并规范化答案：二维字符串数组（每行去空白），非法返回 null */
export function normalizeDebugAnswers(value: unknown): string[][] | null {
  if (!Array.isArray(value)) return null;
  const rows: string[][] = [];
  for (const row of value) {
    if (!Array.isArray(row)) return null;
    rows.push(
      row
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean),
    );
  }
  return rows;
}

/** question.replied/rejected 事件里的 requestID（data.requestID） */
export function questionEventRequestId(
  data: Record<string, unknown>,
): string | null {
  const value =
    typeof data.requestID === 'string'
      ? data.requestID
      : typeof (data.request as Record<string, unknown> | undefined)
            ?.requestID === 'string'
        ? ((data.request as Record<string, unknown>).requestID as string)
        : '';
  return value || null;
}

interface DebugContext {
  worker: Worker;
  executor: Executor;
  option: WorkerDebugOption;
  workdir: string;
}

/** 当前流式目标：最后一条 running 的非提问 assistant 消息（提问卡片不打断文本流） */
export function runningAssistantOf(
  messages: WorkerDebugMessage[],
): WorkerDebugMessage | undefined {
  return [...messages]
    .reverse()
    .find(
      (message) =>
        message.role === 'assistant' &&
        message.status === 'running' &&
        message.kind !== 'question',
    );
}

interface DebugBinding {
  executorId: number;
  providerId: string;
  modelId: string;
}

interface DebugSession {
  key: string;
  userId: number;
  workerId: number;
  /** worker_debug_sessions.id（首条消息后落库） */
  rowId: number | null;
  context: DebugContext;
  client: OpencodeClient;
  sessionId: string | null;
  /** 建 opencode 会话时绑定的执行器/供应商/模型；配置变更后须重置 */
  bound: DebugBinding | null;
  initialized: boolean;
  running: boolean;
  interruptRequested: boolean;
  /** 每次发送/中断/重置递增，避免上一轮异步轮询收尾到新一轮会话 */
  runSeq: number;
  messages: WorkerDebugMessage[];
  /** 最近一次 todowrite 的待办清单（SSE 事件采集 + 执行结束消息历史对账） */
  todos: OpencodeTodo[];
  error: string | null;
  updatedAt: Date;
}

const RUN_TIMEOUT_MS = 10 * 60_000;
const POLL_MS = 1_000;
/** 会话保留期：7 天不活跃才丢弃（重进页面仍复用原 opencode 会话） */
const SESSION_TTL_MS = 7 * 24 * 60 * 60_000;
const CLEANUP_MS = 10 * 60_000;

/**
 * 机器人调试会话：每个「登录用户 + 机器人」固定绑定一个 opencode 会话。
 * 绑定与消息快照落库（worker_debug_sessions），平台重启/离开页面后回来仍可续聊；
 * prompt 只发新消息，历史上下文完全由 opencode 会话自身维持。
 */
@Injectable()
export class WorkerDebugService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkerDebugService.name);
  private readonly sessions = new Map<string, DebugSession>();
  /** 调试会话变更总线（事件名=会话 key，SSE 订阅转发） */
  private readonly updates = new EventEmitter();
  /** 同一会话的落库串行化（避免并发创建行唯一键冲突） */
  private readonly persistQueues = new Map<string, Promise<void>>();
  /** 流式期间的落库防抖（最多每 2s 写一次，进程异常退出也能保留大部分内容） */
  private readonly persistTimers = new Map<string, NodeJS.Timeout>();
  private readonly cleanupTimer: NodeJS.Timeout;
  private sequence = 0;
  private offEvent: (() => void) | null = null;

  constructor(
    @InjectRepository(Worker)
    private readonly workers: Repository<Worker>,
    @InjectRepository(Executor)
    private readonly executors: Repository<Executor>,
    @InjectRepository(WorkerDebugSession)
    private readonly debugSessions: Repository<WorkerDebugSession>,
    private readonly workersService: WorkersService,
    private readonly eventHub: OpencodeEventHub,
  ) {
    this.updates.setMaxListeners(0);
    this.cleanupTimer = setInterval(() => this.cleanupIdle(), CLEANUP_MS);
    this.cleanupTimer.unref();
  }

  /** 订阅执行器事件流，采集调试会话的 todowrite 待办与文本/思考流式增量 */
  onModuleInit(): void {
    this.offEvent = this.eventHub.onEvent((event) => {
      try {
        this.handleExecutorEvent(event);
      } catch {
        // 待办/流式采集失败不影响调试主流程
      }
    });
  }

  /** 仅返回可立即调试的 Agent：启用、模型配置完整、执行器启用且在线、工位可用 */
  async listWorkers(): Promise<WorkerDebugOption[]> {
    const workers = await this.workers.find({
      where: { kind: WorkerKind.AGENT, enabled: true },
      order: { id: 'ASC' },
    });
    const executorIds = [
      ...new Set(
        workers
          .map((worker) => worker.executorId)
          .filter((id): id is number => Boolean(id)),
      ),
    ];
    const executors = executorIds.length
      ? await this.executors.find({ where: { id: In(executorIds) } })
      : [];
    const executorMap = new Map(executors.map((item) => [item.id, item]));
    const options: WorkerDebugOption[] = [];
    for (const worker of workers) {
      if (
        worker.runtime !== WorkerRuntime.OPENCODE ||
        !worker.executorId ||
        !worker.providerId?.trim() ||
        !worker.modelId?.trim() ||
        !this.workersService.workdirOf(worker.id)
      ) {
        continue;
      }
      const executor = executorMap.get(worker.executorId);
      if (!executor?.enabled || !executor.online) continue;
      options.push(this.toOption(worker, executor));
    }
    return options;
  }

  async snapshot(
    userId: number,
    workerId: number,
  ): Promise<WorkerDebugSnapshot> {
    const context = await this.resolveContext(workerId);
    const session = await this.findSession(userId, workerId, context);
    if (!session) return this.emptySnapshot(context.option);
    // 机器人模型/执行器配置变更后，旧上下文不能继续沿用；重置后才能用新配置。
    return this.toSnapshot(session);
  }

  /** 启动一轮调试并立即返回 running 快照；后续通过 SSE 推送最终消息 */
  async send(
    userId: number,
    workerId: number,
    content: string,
  ): Promise<WorkerDebugSnapshot> {
    const text = content?.trim();
    if (!text) throw new BadRequestException('消息内容不能为空');
    if (text.length > 50_000) {
      throw new BadRequestException('单条消息不能超过 50000 个字符');
    }
    const context = await this.resolveContext(workerId);
    const key = this.keyOf(userId, workerId);
    let session = await this.findSession(userId, workerId, context);
    if (session?.running) {
      throw new ConflictException('机器人正在回复，请等待完成或先中断');
    }
    if (session?.bound && !this.sameBinding(session.bound, context)) {
      // 配置发生变化时保留旧会话的上下文语义，提示用户显式重置，避免静默切换模型。
      throw new ConflictException('机器人执行配置已变更，请先重置调试会话');
    }
    if (!session) {
      session = this.newSession(userId, workerId, context);
      this.sessions.set(key, session);
    } else {
      session.context = context;
      session.client = new OpencodeClient(context.executor);
    }

    const now = new Date().toISOString();
    session.messages.push({
      id: this.nextId('user'),
      role: 'user',
      content: text,
      status: 'complete',
      createdAt: now,
    });
    const assistantId = this.nextId('assistant');
    session.messages.push({
      id: assistantId,
      role: 'assistant',
      content: '',
      status: 'running',
      createdAt: now,
    });
    // 单任务最多保留 200 条消息，避免会话无限增长
    if (session.messages.length > 200) {
      session.messages.splice(0, session.messages.length - 200);
    }
    session.running = true;
    session.interruptRequested = false;
    session.error = null;
    session.updatedAt = new Date();
    const runSeq = ++session.runSeq;
    await this.persist(session);
    void this.run(session, assistantId, text, runSeq);
    this.emitUpdate(session);
    return this.toSnapshot(session);
  }

  /** 中断当前轮次；会话保留，之后仍可继续多轮对话 */
  async interrupt(
    userId: number,
    workerId: number,
  ): Promise<WorkerDebugSnapshot> {
    const context = await this.resolveContext(workerId);
    const session = await this.findSession(userId, workerId, context);
    if (!session) return this.emptySnapshot(context.option);
    if (!session.running) return this.toSnapshot(session);
    session.interruptRequested = true;
    session.runSeq += 1;
    if (session.sessionId) {
      try {
        await session.client.interrupt(session.sessionId);
      } catch (error) {
        session.interruptRequested = false;
        throw new ServiceUnavailableException(
          `中断失败：${(error as Error).message}`,
        );
      }
    }
    this.finishInterrupted(session);
    return this.toSnapshot(session);
  }

  /** 重置即解绑旧 opencode 会话；下一条消息会创建新会话并重新注入角色与技能 */
  async reset(userId: number, workerId: number): Promise<WorkerDebugSnapshot> {
    const context = await this.resolveContext(workerId);
    const key = this.keyOf(userId, workerId);
    const previous = this.sessions.get(key);
    this.sessions.delete(key);
    this.clearPersistTimer(key);
    await this.debugSessions
      .delete({ userId, workerId })
      .catch((error: Error) => {
        this.logger.warn(`删除调试会话绑定失败（${key}）: ${error.message}`);
      });
    if (previous) previous.runSeq += 1;
    if (previous?.running && previous.sessionId) {
      previous.interruptRequested = true;
      await previous.client
        .interrupt(previous.sessionId)
        .catch((error: Error) => {
          this.logger.warn(`重置时中断旧会话失败：${error.message}`);
        });
    }
    const empty = this.emptySnapshot(context.option);
    this.updates.emit(key, {
      type: 'snapshot',
      snapshot: empty,
    } satisfies DebugStreamPayload);
    return empty;
  }

  /**
   * 回答/跳过调试提问：转发到 opencode question 接口，
   * 本地卡片同步为回执（事件到达时会再次幂等校准）。
   */
  async replyQuestion(
    userId: number,
    workerId: number,
    questionId: string,
    input: { answers?: unknown; reject?: boolean },
  ): Promise<WorkerDebugSnapshot> {
    const context = await this.resolveContext(workerId);
    const session = await this.findSession(userId, workerId, context);
    const question = session?.messages.find(
      (message) => message.question?.id === questionId,
    )?.question;
    if (!session || !question || question.state !== 'pending') {
      throw new NotFoundException(`提问 ${questionId} 不存在或已处理`);
    }
    if (!session.sessionId) {
      throw new NotFoundException('调试会话不存在或已重置');
    }
    // 提问可能来自 opencode 子会话（task 工具），优先用提问自带的会话
    const sessionId = question.sessionId || session.sessionId;

    if (input.reject === true) {
      try {
        await session.client.rejectQuestion(sessionId, questionId);
      } catch (error) {
        throw this.questionSubmitError(error);
      }
      settleDebugQuestion(session.messages, questionId, 'rejected');
    } else {
      const answers = normalizeDebugAnswers(input.answers);
      if (!answers) {
        throw new BadRequestException('answers 必须是二维字符串数组');
      }
      if (answers.length !== question.questions.length) {
        throw new BadRequestException(
          `answers 数量（${answers.length}）与问题数（${question.questions.length}）不一致`,
        );
      }
      if (answers.some((answer) => answer.length === 0)) {
        throw new BadRequestException('每个问题至少需要选择一个选项或输入回答');
      }
      try {
        await session.client.replyQuestion(sessionId, questionId, answers);
      } catch (error) {
        throw this.questionSubmitError(error);
      }
      settleDebugQuestion(session.messages, questionId, 'answered', answers);
    }
    session.updatedAt = new Date();
    await this.persist(session);
    this.emitUpdate(session);
    return this.toSnapshot(session);
  }

  private questionSubmitError(error: unknown): Error {
    if (error instanceof OpencodeClientError) {
      return new BadRequestException(`提问提交失败：${error.message}`);
    }
    return error instanceof Error ? error : new Error(String(error));
  }

  private async run(
    session: DebugSession,
    assistantId: string,
    text: string,
    runSeq: number,
  ): Promise<void> {
    this.eventHub.retain(session.context.executor);
    try {
      // 会话绑定可能指向已重启/清理的执行器会话，先校验；丢失则新建
      if (session.sessionId) {
        try {
          await session.client.session(session.sessionId);
        } catch (error) {
          if (!isSessionMissing(error)) throw error;
          session.sessionId = null;
          session.bound = null;
          session.initialized = false;
        }
      }
      if (!session.sessionId) {
        await session.client.shell(`mkdir -p '${session.context.workdir}'`);
        const created = await session.client.createSession({
          title: `机器人调试 ${session.context.worker.name}`,
          model: {
            id: session.context.worker.modelId!,
            providerID: session.context.worker.providerId!,
          },
          location: { directory: session.context.workdir },
        });
        session.sessionId = created.id;
        session.initialized = false;
        session.bound = this.bindingOf(session.context);
        session.updatedAt = new Date();
        await this.persist(session);
      } else if (!session.bound) {
        // 兼容早期落库但未记录绑定配置的会话
        session.bound = this.bindingOf(session.context);
        await this.persist(session);
      }
      if (session.interruptRequested || session.runSeq !== runSeq) return;
      const prompt = session.initialized ? text : this.buildFirstPrompt(text);
      const promptResult = await session.client.prompt(session.sessionId, {
        text: prompt,
      });
      session.initialized = true;
      // prompt 为异步接口（立即返回本轮用户消息），会话 outcome/time.idle 具有粘性：
      // 只采信晚于本轮用户消息结束的运行，否则续聊轮次会把上一轮回复误判为本轮完成
      const runAfterMs = promptResult?.time?.created ?? 0;

      const deadline = Date.now() + RUN_TIMEOUT_MS;
      let questionSyncedAt = 0;
      while (Date.now() < deadline) {
        if (session.interruptRequested || session.runSeq !== runSeq) return;
        // 补齐漏收的提问（事件流断连期间 question.asked 可能丢失），
        // 并把远端已不存在的本地待答卡片置为「已失效」（每 5s 一次）
        if (Date.now() - questionSyncedAt >= 5_000) {
          questionSyncedAt = Date.now();
          await this.reconcileDebugQuestions(session, runSeq);
          if (session.interruptRequested || session.runSeq !== runSeq) return;
        }
        const info = await session.client.session(session.sessionId);
        if (isFreshOutcome(info, runAfterMs)) {
          if (info.outcome === 'succeeded') {
            let output: string | null = null;
            // 会话终态可能略早于消息可读，做短重试避免误报空输出。
            for (let attempt = 0; attempt < 3 && !output; attempt++) {
              output = await session.client.lastAssistantText(
                session.sessionId,
                runAfterMs,
              );
              if (!output && attempt < 2) await sleep(500);
            }
            if (!output?.trim())
              throw new Error('执行完成，但机器人没有文本输出');
            if (session.interruptRequested || session.runSeq !== runSeq) return;
            // 待办对账：SSE 漏事件时从消息历史补齐最近一次 todowrite
            const todos = await session.client
              .latestTodos(session.sessionId)
              .catch(() => null);
            if (
              todos &&
              !session.interruptRequested &&
              session.runSeq === runSeq
            ) {
              session.todos = todos;
            }
            this.finishSuccess(session, assistantId, output.trim());
            return;
          }
          throw new Error('opencode 会话执行失败');
        }
        await sleep(POLL_MS);
      }
      if (session.interruptRequested || session.runSeq !== runSeq) return;
      await session.client.interrupt(session.sessionId).catch(() => undefined);
      throw new Error('执行超时（超过 10 分钟），已中断本轮回复');
    } catch (error) {
      if (session.interruptRequested || session.runSeq !== runSeq) return;
      this.finishError(session, assistantId, (error as Error).message);
    } finally {
      // 回复结束即释放事件流占用；下次发送/进入执行中的任务会重新连接
      this.eventHub.release(session.context.executor.id);
    }
  }

  /**
   * 提问对账：按 opencode 待回答清单补建漏收的提问卡片，
   * 远端已不存在的本地待答卡片置为「已失效」。
   */
  private async reconcileDebugQuestions(
    session: DebugSession,
    runSeq: number,
  ): Promise<void> {
    if (!session.sessionId) return;
    try {
      const requests = await session.client.listQuestions(session.sessionId);
      if (session.interruptRequested || session.runSeq !== runSeq) return;
      let changed = false;
      const remote = new Set(requests.map((request) => request.id));
      for (const request of requests) {
        if (
          upsertDebugQuestion(
            session.messages,
            request,
            session.sessionId,
            new Date().toISOString(),
          )
        ) {
          changed = true;
        }
      }
      for (const question of pendingDebugQuestions(session.messages)) {
        if (
          !remote.has(question.id) &&
          settleDebugQuestion(session.messages, question.id, 'cancelled')
        ) {
          changed = true;
        }
      }
      if (changed) {
        session.updatedAt = new Date();
        this.schedulePersist(session);
        this.emitUpdate(session);
      }
    } catch {
      // 对账失败不阻断本轮轮询（事件流仍在采集，下轮重试）
    }
  }

  /** 本轮已终止：未回答的提问置为失效，避免遗留可提交的旧卡片 */
  private cancelPendingQuestions(session: DebugSession): void {
    for (const question of pendingDebugQuestions(session.messages)) {
      settleDebugQuestion(session.messages, question.id, 'cancelled');
    }
  }

  private finishSuccess(
    session: DebugSession,
    assistantId: string,
    output: string,
  ): void {
    this.cancelPendingQuestions(session);
    const message = session.messages.find((item) => item.id === assistantId);
    if (message) {
      message.content = output;
      message.status = 'complete';
    }
    session.running = false;
    session.error = null;
    session.updatedAt = new Date();
    this.clearPersistTimer(session.key);
    void this.persist(session);
    this.emitUpdate(session);
  }

  private finishError(
    session: DebugSession,
    assistantId: string,
    reason: string,
  ): void {
    this.cancelPendingQuestions(session);
    const message = session.messages.find((item) => item.id === assistantId);
    if (message) {
      message.content = `执行失败：${reason}`;
      message.status = 'error';
    }
    session.running = false;
    session.error = reason;
    session.updatedAt = new Date();
    this.clearPersistTimer(session.key);
    void this.persist(session);
    this.emitUpdate(session);
  }

  private finishInterrupted(session: DebugSession): void {
    this.cancelPendingQuestions(session);
    const running = [...session.messages]
      .reverse()
      .find((item) => item.role === 'assistant' && item.status === 'running');
    if (running) {
      running.content = '本轮回复已中断。你可以继续发送消息，仍使用当前会话。';
      running.status = 'error';
    }
    session.running = false;
    session.error = null;
    session.updatedAt = new Date();
    this.clearPersistTimer(session.key);
    void this.persist(session);
    this.emitUpdate(session);
  }

  /** 事件入口：待办采集 + 提问卡片 + 思考/文本流式增量，并向前端 SSE 推送快照 */
  private handleExecutorEvent(event: OpencodeEvent): void {
    if (!event.data || typeof event.data !== 'object') return;
    const data = event.data as Record<string, unknown>;
    const sessionId = typeof data.sessionID === 'string' ? data.sessionID : '';
    if (!sessionId) return;
    // question 事件有 v1（question.asked）与 v2（question.v2.asked）两套命名，统一处理
    const eventType = event.type.startsWith('question.v2.')
      ? event.type.replace('question.v2.', 'question.')
      : event.type;
    for (const session of this.sessions.values()) {
      if (
        session.sessionId !== sessionId ||
        session.context.executor.id !== event.executorId
      ) {
        continue;
      }
      let changed = false;
      // todowrite 的完整 todos 替换会话待办
      if (isTodoToolEvent(event.type, event.data)) {
        const todos = extractOpencodeTodos(event.data);
        if (todos) {
          session.todos = todos;
          session.updatedAt = new Date();
          changed = true;
        }
      }
      // 提问事件：仅本轮运行中才生成/更新卡片（停止后的提问已无法答复）
      if (session.running) {
        switch (eventType) {
          case 'question.asked': {
            const request = parseQuestionEvent(data);
            if (
              request &&
              upsertDebugQuestion(
                session.messages,
                request,
                sessionId,
                new Date().toISOString(),
              )
            ) {
              session.updatedAt = new Date();
              changed = true;
            }
            break;
          }
          case 'question.replied': {
            const requestId = questionEventRequestId(data);
            if (
              requestId &&
              settleDebugQuestion(
                session.messages,
                requestId,
                'answered',
                normalizeDebugAnswers(data.answers) ?? undefined,
              )
            ) {
              session.updatedAt = new Date();
              changed = true;
            }
            break;
          }
          case 'question.rejected': {
            const requestId = questionEventRequestId(data);
            if (
              requestId &&
              settleDebugQuestion(session.messages, requestId, 'rejected')
            ) {
              session.updatedAt = new Date();
              changed = true;
            }
            break;
          }
          default:
            break;
        }
      }
      // 文本/思考增量只落在本轮 running 的 assistant 消息上（事件串行，无并发轮次）
      if (session.running) {
        const message = runningAssistantOf(session.messages);
        if (message && applyDebugStreamEvent(message, event.type, data)) {
          session.updatedAt = new Date();
          changed = true;
        }
      }
      if (changed) {
        this.schedulePersist(session);
        this.emitUpdate(session);
      }
    }
  }

  /** 向该调试会话的所有 SSE 订阅者推送全量快照 */
  private emitUpdate(session: DebugSession): void {
    this.updates.emit(session.key, {
      type: 'snapshot',
      snapshot: this.toSnapshot(session),
    } satisfies DebugStreamPayload);
  }

  /** 调试会话 SSE：订阅即推当前快照，后续变更实时推送，20s 心跳保活 */
  stream(userId: number, workerId: number): Observable<MessageEvent> {
    const key = this.keyOf(userId, workerId);
    return new Observable<MessageEvent>((subscriber) => {
      let closed = false;
      const listener = (payload: DebugStreamPayload) => {
        if (!closed) subscriber.next({ data: payload });
      };
      this.updates.on(key, listener);
      this.snapshot(userId, workerId)
        .then((snapshot) => {
          if (!closed) {
            subscriber.next({
              data: { type: 'snapshot', snapshot } satisfies DebugStreamPayload,
            });
          }
        })
        .catch((error: Error) => {
          if (!closed) subscriber.error(error);
        });
      const keepalive = setInterval(() => {
        if (!closed) subscriber.next({ data: { type: 'ping' } });
      }, 20_000);
      return () => {
        closed = true;
        clearInterval(keepalive);
        this.updates.off(key, listener);
      };
    });
  }

  /** 首条提示：调试说明 + 用户消息（角色定义与技能由工位文件提供） */
  private buildFirstPrompt(text: string): string {
    return [
      '# 调试对话',
      '',
      '这是机器人的调试对话。机器人的 AGENTS.md 与技能已由工作目录提供；请结合前文直接回答用户，不要复述角色设定。',
      '',
      '# 用户消息',
      '',
      text,
    ].join('\n');
  }

  private async resolveContext(workerId: number): Promise<DebugContext> {
    const worker = await this.workers.findOne({ where: { id: workerId } });
    if (!worker || worker.kind !== WorkerKind.AGENT) {
      throw new NotFoundException('Agent 机器人不存在');
    }
    if (!worker.enabled) throw new BadRequestException('机器人已停用');
    if (worker.runtime !== WorkerRuntime.OPENCODE) {
      throw new BadRequestException('仅支持 opencode 机器人调试');
    }
    if (
      !worker.executorId ||
      !worker.providerId?.trim() ||
      !worker.modelId?.trim()
    ) {
      throw new BadRequestException('机器人未完整配置执行器、供应商与模型');
    }
    const executor = await this.executors.findOne({
      where: { id: worker.executorId },
    });
    if (!executor?.enabled || !executor.online) {
      throw new ServiceUnavailableException('机器人执行器离线或已停用');
    }
    const workdir = this.workersService.workdirOf(worker.id);
    if (!workdir) {
      throw new ServiceUnavailableException(
        '未配置 WORKER_BASE_DIR，无法创建调试工位',
      );
    }
    return {
      worker,
      executor,
      option: this.toOption(worker, executor),
      // 调试与正式任务分目录，避免调试工具调用污染任务工作区。
      workdir: `${workdir}/debug`,
    };
  }

  private toOption(worker: Worker, executor: Executor): WorkerDebugOption {
    return {
      id: worker.id,
      name: worker.name,
      intro: worker.intro,
      avatarUrl: worker.avatarUrl,
      executorName: executor.name,
      providerId: worker.providerId!,
      modelId: worker.modelId!,
    };
  }

  private newSession(
    userId: number,
    workerId: number,
    context: DebugContext,
  ): DebugSession {
    return {
      key: this.keyOf(userId, workerId),
      userId,
      workerId,
      rowId: null,
      context,
      client: new OpencodeClient(context.executor),
      sessionId: null,
      bound: null,
      initialized: false,
      running: false,
      interruptRequested: false,
      runSeq: 0,
      messages: [],
      todos: [],
      error: null,
      updatedAt: new Date(),
    };
  }

  /** 读取内存会话；未命中则从库恢复（超过 7 天不活跃视为过期） */
  private async findSession(
    userId: number,
    workerId: number,
    context: DebugContext,
  ): Promise<DebugSession | null> {
    const key = this.keyOf(userId, workerId);
    const existing = this.sessions.get(key);
    if (existing) {
      if (
        !existing.running &&
        Date.now() - existing.updatedAt.getTime() > SESSION_TTL_MS
      ) {
        this.sessions.delete(key);
        this.clearPersistTimer(key);
        if (existing.rowId) {
          void this.debugSessions
            .delete({ id: existing.rowId })
            .catch((error: Error) =>
              this.logger.warn(
                `清理过期调试会话失败（${key}）: ${error.message}`,
              ),
            );
        }
        return null;
      }
      return existing;
    }
    const row = await this.debugSessions.findOne({
      where: { userId, workerId },
    });
    if (!row) return null;
    if (Date.now() - row.updatedAt.getTime() > SESSION_TTL_MS) {
      await this.debugSessions
        .delete({ id: row.id })
        .catch((error: Error) =>
          this.logger.warn(`清理过期调试会话失败（${key}）: ${error.message}`),
        );
      return null;
    }
    const hadRunning = (row.messages ?? []).some(
      (message) => message.role === 'assistant' && message.status === 'running',
    );
    const session = this.newSession(userId, workerId, context);
    session.rowId = row.id;
    session.sessionId = row.sessionId;
    session.bound =
      row.executorId && row.providerId && row.modelId
        ? {
            executorId: row.executorId,
            providerId: row.providerId,
            modelId: row.modelId,
          }
        : null;
    session.initialized = Boolean(row.sessionId);
    session.messages = recoverDebugMessages(row.messages);
    session.todos = (row.todos ?? []).map((todo) => ({ ...todo }));
    session.error = row.error;
    session.updatedAt = row.updatedAt;
    this.sessions.set(key, session);
    if (hadRunning) {
      // 上一轮没来得及收尾（进程重启）：把中断状态落库
      void this.persist(session);
    }
    return session;
  }

  private bindingOf(context: DebugContext): DebugBinding {
    return {
      executorId: context.executor.id,
      providerId: context.worker.providerId!,
      modelId: context.worker.modelId!,
    };
  }

  private sameBinding(bound: DebugBinding, context: DebugContext): boolean {
    return (
      bound.executorId === context.executor.id &&
      bound.providerId === context.worker.providerId &&
      bound.modelId === context.worker.modelId
    );
  }

  /** 流式期间的落库防抖：每 2s 最多写一次，异常退出也能保留大部分输出 */
  private schedulePersist(session: DebugSession): void {
    if (this.persistTimers.has(session.key)) return;
    const timer = setTimeout(() => {
      this.persistTimers.delete(session.key);
      void this.persist(session);
    }, 2_000);
    timer.unref();
    this.persistTimers.set(session.key, timer);
  }

  private clearPersistTimer(key: string): void {
    const timer = this.persistTimers.get(key);
    if (!timer) return;
    clearTimeout(timer);
    this.persistTimers.delete(key);
  }

  /** 会话快照落库（同一 key 串行，避免并发插入唯一键冲突） */
  private persist(session: DebugSession): Promise<void> {
    const previous = this.persistQueues.get(session.key) ?? Promise.resolve();
    const next = previous
      .then(() => this.writeSession(session))
      .catch((error: Error) => {
        this.logger.warn(
          `保存调试会话失败（${session.key}）: ${error.message}`,
        );
      });
    this.persistQueues.set(session.key, next);
    void next.finally(() => {
      if (this.persistQueues.get(session.key) === next) {
        this.persistQueues.delete(session.key);
      }
    });
    return next;
  }

  private async writeSession(session: DebugSession): Promise<void> {
    const values = {
      userId: session.userId,
      workerId: session.workerId,
      executorId: session.bound?.executorId ?? session.context.executor.id,
      providerId:
        session.bound?.providerId ?? session.context.worker.providerId ?? null,
      modelId: session.bound?.modelId ?? session.context.worker.modelId ?? null,
      sessionId: session.sessionId,
      messages: session.messages,
      todos: session.todos,
      error: session.error,
    };
    if (session.rowId) {
      await this.debugSessions.update(session.rowId, values);
      return;
    }
    const saved = await this.debugSessions.save(
      this.debugSessions.create(values),
    );
    session.rowId = saved.id;
  }

  private emptySnapshot(worker: WorkerDebugOption): WorkerDebugSnapshot {
    return {
      worker,
      sessionId: null,
      status: 'idle',
      messages: [],
      todos: [],
      error: null,
      updatedAt: new Date().toISOString(),
    };
  }

  private toSnapshot(session: DebugSession): WorkerDebugSnapshot {
    return {
      worker: session.context.option,
      sessionId: session.sessionId,
      status: session.running ? 'running' : 'idle',
      messages: session.messages.map((message) => ({ ...message })),
      todos: session.todos.map((todo) => ({ ...todo })),
      error: session.error,
      updatedAt: session.updatedAt.toISOString(),
    };
  }

  private keyOf(userId: number, workerId: number): string {
    return `${userId}:${workerId}`;
  }

  private nextId(role: 'user' | 'assistant'): string {
    this.sequence += 1;
    return `${role}:${Date.now()}:${this.sequence}`;
  }

  private cleanupIdle(): void {
    const deadline = new Date(Date.now() - SESSION_TTL_MS);
    for (const [key, session] of this.sessions) {
      if (
        !session.running &&
        session.updatedAt.getTime() < deadline.getTime()
      ) {
        this.sessions.delete(key);
        this.clearPersistTimer(key);
      }
    }
    void this.debugSessions
      .delete({ updatedAt: LessThan(deadline) })
      .catch((error: Error) =>
        this.logger.warn(`清理过期调试会话失败: ${error.message}`),
      );
  }

  onModuleDestroy(): void {
    this.offEvent?.();
    this.updates.removeAllListeners();
    clearInterval(this.cleanupTimer);
    for (const session of this.sessions.values()) {
      session.interruptRequested = true;
      session.runSeq += 1;
      if (session.running && session.sessionId) {
        void session.client.interrupt(session.sessionId).catch(() => undefined);
      }
    }
    this.sessions.clear();
    for (const timer of this.persistTimers.values()) clearTimeout(timer);
    this.persistTimers.clear();
    this.persistQueues.clear();
  }
}

function isSessionMissing(error: unknown): boolean {
  return error instanceof OpencodeClientError && error.status === 404;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
