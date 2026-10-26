import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { WorkerKind, WorkerRuntime } from '../common/enums';
import { Executor } from '../executors/executor.entity';
import { OpencodeClient } from '../executors/opencode-client';
import { Worker } from './worker.entity';
import { WorkersService } from './workers.service';

export interface WorkerDebugOption {
  id: number;
  name: string;
  intro: string | null;
  executorName: string;
  providerId: string;
  modelId: string;
}

export interface WorkerDebugMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status: 'running' | 'complete' | 'error';
  createdAt: string;
}

export interface WorkerDebugSnapshot {
  worker: WorkerDebugOption;
  /** opencode 会话在首条消息发送时创建，同一调试会话的多轮消息始终复用它 */
  sessionId: string | null;
  status: 'idle' | 'running';
  messages: WorkerDebugMessage[];
  error: string | null;
  updatedAt: string;
}

interface DebugContext {
  worker: Worker;
  executor: Executor;
  option: WorkerDebugOption;
  workdir: string;
}

interface DebugSession {
  key: string;
  context: DebugContext;
  client: OpencodeClient;
  sessionId: string | null;
  initialized: boolean;
  running: boolean;
  interruptRequested: boolean;
  /** 每次发送/中断/重置递增，避免上一轮异步轮询收尾到新一轮会话 */
  runSeq: number;
  messages: WorkerDebugMessage[];
  error: string | null;
  updatedAt: Date;
}

const RUN_TIMEOUT_MS = 10 * 60_000;
const POLL_MS = 1_000;
const IDLE_TTL_MS = 2 * 60 * 60_000;
const CLEANUP_MS = 10 * 60_000;

/**
 * 机器人调试会话：进程内保存“登录用户 + 机器人”到 opencode 会话的绑定，不写数据库。
 * opencode 会话本身跨多轮持续存在；平台重启后新建调试会话，不冒充恢复历史。
 */
@Injectable()
export class WorkerDebugService implements OnModuleDestroy {
  private readonly logger = new Logger(WorkerDebugService.name);
  private readonly sessions = new Map<string, DebugSession>();
  private readonly cleanupTimer: NodeJS.Timeout;
  private sequence = 0;

  constructor(
    @InjectRepository(Worker)
    private readonly workers: Repository<Worker>,
    @InjectRepository(Executor)
    private readonly executors: Repository<Executor>,
    private readonly workersService: WorkersService,
  ) {
    this.cleanupTimer = setInterval(() => this.cleanupIdle(), CLEANUP_MS);
    this.cleanupTimer.unref();
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
    const session = this.sessions.get(this.keyOf(userId, workerId));
    if (!session) return this.emptySnapshot(context.option);
    // 机器人模型/执行器配置变更后，旧上下文不能继续沿用；重置后才能用新配置。
    return this.toSnapshot(session);
  }

  /** 启动一轮调试并立即返回 running 快照；前端轮询 snapshot 获取最终消息 */
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
    let session = this.sessions.get(key);
    if (session?.running) {
      throw new ConflictException('机器人正在回复，请等待完成或先中断');
    }
    if (!session) {
      session = this.newSession(key, context);
      this.sessions.set(key, session);
    } else {
      // 配置发生变化时保留旧会话的上下文语义，提示用户显式重置，避免静默切换模型。
      if (
        session.context.executor.id !== context.executor.id ||
        session.context.worker.providerId !== context.worker.providerId ||
        session.context.worker.modelId !== context.worker.modelId
      ) {
        throw new ConflictException('机器人执行配置已变更，请先重置调试会话');
      }
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
    session.running = true;
    session.interruptRequested = false;
    session.error = null;
    session.updatedAt = new Date();
    const runSeq = ++session.runSeq;
    void this.run(session, assistantId, text, runSeq);
    return this.toSnapshot(session);
  }

  /** 中断当前轮次；会话保留，之后仍可继续多轮对话 */
  async interrupt(
    userId: number,
    workerId: number,
  ): Promise<WorkerDebugSnapshot> {
    const context = await this.resolveContext(workerId);
    const session = this.sessions.get(this.keyOf(userId, workerId));
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
    if (previous) previous.runSeq += 1;
    if (previous?.running && previous.sessionId) {
      previous.interruptRequested = true;
      await previous.client
        .interrupt(previous.sessionId)
        .catch((error: Error) => {
          this.logger.warn(`重置时中断旧会话失败：${error.message}`);
        });
    }
    return this.emptySnapshot(context.option);
  }

  private async run(
    session: DebugSession,
    assistantId: string,
    text: string,
    runSeq: number,
  ): Promise<void> {
    try {
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
        session.updatedAt = new Date();
      }
      if (session.interruptRequested || session.runSeq !== runSeq) return;
      const prompt = session.initialized
        ? text
        : this.buildFirstPrompt(session.context.worker, text);
      await session.client.prompt(session.sessionId, { text: prompt });
      session.initialized = true;

      const deadline = Date.now() + RUN_TIMEOUT_MS;
      while (Date.now() < deadline) {
        if (session.interruptRequested || session.runSeq !== runSeq) return;
        const info = await session.client.session(session.sessionId);
        if (info.outcome === 'succeeded') {
          let output: string | null = null;
          // 会话终态可能略早于消息可读，做短重试避免误报空输出。
          for (let attempt = 0; attempt < 3 && !output; attempt++) {
            output = await session.client.lastAssistantText(session.sessionId);
            if (!output && attempt < 2) await sleep(500);
          }
          if (!output?.trim())
            throw new Error('执行完成，但机器人没有文本输出');
          if (session.interruptRequested || session.runSeq !== runSeq) return;
          this.finishSuccess(session, assistantId, output.trim());
          return;
        }
        if (info.outcome === 'failed') {
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
    }
  }

  private finishSuccess(
    session: DebugSession,
    assistantId: string,
    output: string,
  ): void {
    const message = session.messages.find((item) => item.id === assistantId);
    if (message) {
      message.content = output;
      message.status = 'complete';
    }
    session.running = false;
    session.error = null;
    session.updatedAt = new Date();
  }

  private finishError(
    session: DebugSession,
    assistantId: string,
    reason: string,
  ): void {
    const message = session.messages.find((item) => item.id === assistantId);
    if (message) {
      message.content = `执行失败：${reason}`;
      message.status = 'error';
    }
    session.running = false;
    session.error = reason;
    session.updatedAt = new Date();
  }

  private finishInterrupted(session: DebugSession): void {
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
  }

  private buildFirstPrompt(worker: Worker, text: string): string {
    const sections: string[] = [];
    if (worker.prompt?.trim()) sections.push(worker.prompt.trim());
    if (worker.skills?.length) {
      sections.push(
        `# 技能\n\n${worker.skills
          .map((skill) => `## 技能：${skill.name}\n\n${skill.content}`)
          .join('\n\n')}`,
      );
    }
    sections.push(
      [
        '# 调试对话',
        '',
        '这是机器人的调试对话。以上角色定义与技能在本次会话持续生效；请结合前文直接回答用户，不要复述角色设定。',
        '',
        '# 用户消息',
        '',
        text,
      ].join('\n'),
    );
    return sections.join('\n\n---\n\n');
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
      executorName: executor.name,
      providerId: worker.providerId!,
      modelId: worker.modelId!,
    };
  }

  private newSession(key: string, context: DebugContext): DebugSession {
    return {
      key,
      context,
      client: new OpencodeClient(context.executor),
      sessionId: null,
      initialized: false,
      running: false,
      interruptRequested: false,
      runSeq: 0,
      messages: [],
      error: null,
      updatedAt: new Date(),
    };
  }

  private emptySnapshot(worker: WorkerDebugOption): WorkerDebugSnapshot {
    return {
      worker,
      sessionId: null,
      status: 'idle',
      messages: [],
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
    const deadline = Date.now() - IDLE_TTL_MS;
    for (const [key, session] of this.sessions) {
      if (!session.running && session.updatedAt.getTime() < deadline) {
        this.sessions.delete(key);
      }
    }
  }

  onModuleDestroy(): void {
    clearInterval(this.cleanupTimer);
    for (const session of this.sessions.values()) {
      session.interruptRequested = true;
      session.runSeq += 1;
      if (session.running && session.sessionId) {
        void session.client.interrupt(session.sessionId).catch(() => undefined);
      }
    }
    this.sessions.clear();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
