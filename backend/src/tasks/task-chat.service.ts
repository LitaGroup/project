import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { filter, Observable, Subject, Subscription } from 'rxjs';
import { In, Repository } from 'typeorm';
import { User } from '../auth/user.entity';
import { WorkerRole } from '../common/enums';
import { Worker } from '../workers/worker.entity';
import { Task } from './task.entity';
import { TaskEvent } from './task-event.entity';
import type {
  TaskChatMessage,
  TaskChatSender,
  TaskChatSnapshot,
  TaskChatStreamMessage,
  TaskPipelineStage,
} from './task-chat.types';
import type { TaskRealtimeEvent } from './task-realtime.service';
import { TaskRealtimeService } from './task-realtime.service';

/** 实时消息内部结构：额外记录所属根任务，供多个详情页 SSE 分流 */
interface InternalChatMessage extends TaskChatMessage {
  rootTaskId: number;
}

interface InternalStreamEvent {
  rootTaskId: number;
  event: TaskChatStreamMessage;
}

interface SortedMessage {
  message: TaskChatMessage;
  at: number;
  seq: number;
}

/** 文本增量合并窗口：避免每个 token 都推一次 SSE */
const TEXT_FLUSH_MS = 60;

/** 任务事件触发的快照刷新合并窗口 */
const REFRESH_DEBOUNCE_MS = 300;

/**
 * 任务对话服务：把「任务事件 + 机器人执行流 + 最终产出」整理成统一聊天消息，
 * 并实时推送给任务详情页。任务可能由多个机器人（主任务 + 子任务）完成，
 * 每条消息都带发送方，前端据此展示不同头像与名称。
 */
@Injectable()
export class TaskChatService implements OnModuleDestroy {
  private readonly logger = new Logger(TaskChatService.name);

  /** rootTaskId → 流事件 */
  private readonly subject = new Subject<InternalStreamEvent>();

  /** taskId → (messageId → 实时消息) */
  private readonly live = new Map<number, Map<string, InternalChatMessage>>();

  /** taskId → 当前正在写入的助手消息 id */
  private readonly active = new Map<number, string>();

  /** taskId → 正在创建助手消息的 Promise（避免 started/delta 并发各建一条） */
  private readonly creating = new Map<number, Promise<InternalChatMessage>>();

  /** taskId → 当前消息内的工具序号 */
  private readonly toolSeq = new Map<number, number>();

  /** 文本增量合并定时器（messageId → timer） */
  private readonly flushTimers = new Map<string, NodeJS.Timeout>();

  /** 消息 id → rootTaskId（流式增量只带 messageId） */
  private readonly messageRoots = new Map<string, number>();

  /** taskId → rootTaskId（rootId 不会变化，可长期缓存） */
  private readonly rootCache = new Map<number, number>();

  constructor(
    @InjectRepository(Task)
    private readonly tasks: Repository<Task>,
    @InjectRepository(TaskEvent)
    private readonly events: Repository<TaskEvent>,
    @InjectRepository(Worker)
    private readonly workers: Repository<Worker>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly taskRealtime: TaskRealtimeService,
  ) {}

  onModuleDestroy(): void {
    for (const timer of this.flushTimers.values()) clearTimeout(timer);
    this.flushTimers.clear();
    this.creating.clear();
    this.subject.complete();
  }

  /** 任务详情页初始快照：当前任务 + 根任务 PIPELINE + 聊天消息 */
  async snapshot(taskId: number): Promise<TaskChatSnapshot> {
    const task = await this.findTask(taskId);
    const rootTask = await this.findTask(task.rootId || task.id);
    const rootId = rootTask.id;
    const pipelineTasks = await this.tasks.find({
      where: [{ id: rootId }, { rootId }],
      order: { sortOrder: 'ASC', id: 'ASC' },
    });
    if (!pipelineTasks.some((item) => item.id === rootId)) {
      pipelineTasks.unshift(rootTask);
    }
    const pipeline = await Promise.all(
      pipelineTasks.map((item) => this.stageOf(item)),
    );
    const stageByTask = new Map(pipeline.map((item) => [item.task.id, item]));
    const ids = pipelineTasks.map((item) => item.id);
    const taskEvents =
      ids.length > 0
        ? await this.events.find({
            where: { taskId: In(ids) },
            order: { id: 'ASC' },
          })
        : [];

    const entries: SortedMessage[] = [];
    let seq = 0;
    let rootHasUserMessage = false;

    for (const item of pipelineTasks) {
      const stage = stageByTask.get(item.id) ?? {
        task: item,
        agent: null,
        scheduler: null,
      };
      const taskEventList = taskEvents.filter(
        (event) => event.taskId === item.id,
      );
      for (const event of taskEventList) {
        const message = this.eventMessage(stage, event, rootId);
        if (!message) continue;
        if (message.role === 'user' && item.id === rootId) {
          rootHasUserMessage = true;
        }
        entries.push({
          message,
          at: new Date(message.createdAt).getTime(),
          seq: seq++,
        });
      }

      // 未产生最终产出时，把进程内实时消息并入快照（刷新页面不丢当前对话）
      const liveMessages = this.live.get(item.id);
      if (liveMessages) {
        for (const message of liveMessages.values()) {
          if (!this.liveMessageVisible(item, message)) continue;
          entries.push({
            message: this.toPublic(message),
            at: new Date(message.createdAt).getTime(),
            seq: seq++,
          });
        }
      }

      if (item.result?.trim()) {
        const createdAt = (
          item.deliveredAt ??
          item.acceptedAt ??
          item.updatedAt ??
          new Date()
        ).toISOString();
        entries.push({
          message: {
            id: `result:${item.id}`,
            taskId: item.id,
            role: 'assistant',
            sender: stage.agent ?? stage.scheduler ?? this.systemSender(),
            content: item.result.trim(),
            createdAt,
            status: 'complete',
            kind: 'message',
          },
          at: new Date(createdAt).getTime(),
          seq: seq++,
        });
      }
    }

    // 没有创建 / 反馈事件的历史任务：用当前描述兜底一条用户消息
    if (!rootHasUserMessage && rootTask.id === rootId) {
      const content = rootTask.description?.trim() || rootTask.title;
      if (content) {
        entries.push({
          message: {
            id: `initial:${rootTask.id}`,
            taskId: rootTask.id,
            role: 'user',
            sender: await this.userSenderForTask(rootTask),
            content,
            createdAt: rootTask.createdAt.toISOString(),
            status: 'complete',
            kind: 'message',
          },
          at: rootTask.createdAt.getTime(),
          seq: seq++,
        });
      }
    }

    entries.sort((a, b) => a.at - b.at || a.seq - b.seq);
    return {
      task,
      rootTask,
      pipeline,
      messages: entries.map((item) => item.message),
    };
  }

  /** 任务聊天 SSE：初始 ready + 实时消息/阶段更新/快照刷新信号 */
  stream(taskId: number): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      let closed = false;
      let refreshTimer: NodeJS.Timeout | null = null;
      let taskSub: Subscription | null = null;
      const send = (data: TaskChatStreamMessage): void => {
        if (!closed) subscriber.next({ data });
      };

      const rootIdPromise = this.rootIdOf(taskId);
      let chatSub: Subscription | null = null;
      void rootIdPromise
        .then((rootId) => {
          if (closed) return;
          send({ type: 'ready', at: Date.now() });
          chatSub = this.subject
            .pipe(filter((item) => item.rootTaskId === rootId))
            .subscribe({
              next: (item) => send(item.event),
              error: (error: Error) => {
                if (!closed) subscriber.error(error);
              },
            });
          taskSub = this.taskRealtime.events$.subscribe({
            next: (event) => {
              void this.handleRealtime(rootId, event, send, () => {
                if (refreshTimer) return;
                refreshTimer = setTimeout(() => {
                  refreshTimer = null;
                  send({ type: 'refresh', at: Date.now() });
                }, REFRESH_DEBOUNCE_MS);
              }).catch((error: Error) => {
                this.logger.warn(
                  `任务聊天 SSE 推送失败（taskId=${taskId}）: ${error.message}`,
                );
              });
            },
          });
        })
        .catch((error: Error) => {
          if (!closed) subscriber.error(error);
        });

      const heartbeat = setInterval(() => {
        send({ type: 'ping', at: Date.now() });
      }, 20_000);

      return () => {
        closed = true;
        clearInterval(heartbeat);
        if (refreshTimer) clearTimeout(refreshTimer);
        chatSub?.unsubscribe();
        taskSub?.unsubscribe();
      };
    });
  }

  /** 机器人开始输出文本：复用当前未完成的助手消息（可能是工具调用气泡） */
  async beginText(taskId: number): Promise<void> {
    const message = await this.ensureActiveMessage(taskId);
    if (message.status !== 'running') {
      message.status = 'running';
      this.broadcastMessage(message);
    }
  }

  /** 追加文本增量（合并后推送） */
  async appendText(taskId: number, delta: string): Promise<void> {
    if (!delta) return;
    const message = await this.ensureActiveMessage(taskId);
    message.content += delta;
    this.scheduleFlush(message);
  }

  /** 文本输出完成：结束当前助手消息 */
  endText(taskId: number): void {
    const message = this.activeMessage(taskId);
    if (!message) return;
    message.status = 'complete';
    this.flushNow(message);
    this.active.delete(taskId);
  }

  /** 工具开始：记到当前助手消息（没有则新建「工具调用」气泡） */
  async toolStarted(taskId: number, toolName: string): Promise<void> {
    const message = await this.ensureActiveMessage(taskId);
    const seq = (this.toolSeq.get(taskId) ?? 0) + 1;
    this.toolSeq.set(taskId, seq);
    if (!message.tools) message.tools = [];
    message.tools.push({
      id: `${message.id}:tool:${seq}`,
      name: toolName || '工具',
      status: 'running',
    });
    this.broadcastMessage(message);
  }

  /** 工具结束：标记最近一个运行中的工具 */
  toolFinished(taskId: number, ok: boolean, detail?: string): void {
    const message = this.activeMessage(taskId);
    if (!message?.tools?.length) return;
    const tool = [...message.tools]
      .reverse()
      .find((item) => item.status === 'running');
    if (!tool) return;
    tool.status = ok ? 'success' : 'error';
    if (detail) tool.detail = detail;
    this.broadcastMessage(message);
  }

  /** 记录一条机器人错误/提示消息 */
  async note(taskId: number, content: string): Promise<void> {
    if (!content.trim()) return;
    const rootTaskId = await this.rootIdOf(taskId);
    const sender = await this.senderForTask(taskId);
    const message: InternalChatMessage = {
      id: `chat:${taskId}:note:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`,
      taskId,
      rootTaskId,
      role: 'assistant',
      sender,
      content: content.trim(),
      createdAt: new Date().toISOString(),
      status: 'error',
      kind: 'message',
    };
    this.store(message);
    this.broadcastMessage(message);
  }

  /** 会话执行失败：把当前正在输出的助手消息标记为 error，停止「正在执行」状态 */
  async failTask(taskId: number, content: string): Promise<void> {
    const message = this.activeMessage(taskId);
    if (!message) {
      await this.note(taskId, content);
      return;
    }
    if (!message.content.trim()) message.content = content.trim();
    message.status = 'error';
    this.flushNow(message);
    this.active.delete(taskId);
  }

  /** 会话结束：收尾当前消息并通知前端刷新快照（拿最终产出） */
  async finishTask(taskId: number): Promise<void> {
    const messages = this.live.get(taskId);
    if (messages) {
      for (const message of messages.values()) {
        if (message.status !== 'running') continue;
        message.status = 'complete';
        this.flushNow(message);
      }
    }
    this.active.delete(taskId);
    const rootTaskId = await this.rootIdOf(taskId);
    this.subject.next({
      rootTaskId,
      event: { type: 'refresh', at: Date.now() },
    });
  }

  // ===== 内部：消息组装 =====

  private eventMessage(
    stage: TaskPipelineStage,
    event: TaskEvent,
    rootId: number,
  ): TaskChatMessage | null {
    const meta = event.meta ?? {};
    const base = {
      id: `event:${event.id}`,
      taskId: event.taskId,
      createdAt: event.createdAt.toISOString(),
      status: 'complete' as const,
    };

    // 创建任务：只有根任务的创建事件是「用户提出了什么」，子任务由调度机器人产生
    if (
      event.type === '操作' &&
      event.content.startsWith('创建任务') &&
      stage.task.id === rootId
    ) {
      const description =
        typeof meta.description === 'string' ? meta.description.trim() : '';
      return {
        ...base,
        role: 'user',
        sender: this.userSender(event.operator),
        content:
          description || stage.task.description?.trim() || stage.task.title,
        kind: 'message',
      };
    }

    // 用户反馈：进入对话流，而非时间线
    if (event.type === '反馈') {
      return {
        ...base,
        role: 'user',
        sender: this.userSender(event.operator),
        content: event.content,
        kind: 'message',
        meta,
      };
    }

    // 调度机器人识别完成：作为调度机器人的助手回复，附上工作计划
    if (
      event.type === '系统' &&
      (event.content.startsWith('识别完成') ||
        typeof meta.workPlan === 'string')
    ) {
      const workPlan =
        typeof meta.workPlan === 'string' ? meta.workPlan.trim() : '';
      return {
        ...base,
        role: 'assistant',
        sender: stage.scheduler ?? this.systemSender(),
        content: workPlan
          ? `${event.content}\n\n**工作计划**\n\n${workPlan}`
          : event.content,
        kind: 'message',
        meta,
      };
    }

    // 其余都是时间线事件；操作事件保留操作人，便于前端展示「谁做了什么」
    return {
      ...base,
      role: 'system',
      sender: event.operator
        ? this.userSender(event.operator)
        : event.type === '系统' && typeof meta.schedulerId === 'number'
          ? (stage.scheduler ?? this.systemSender())
          : this.systemSender(),
      content: event.content,
      kind: 'event',
      meta,
    };
  }

  private async stageOf(task: Task): Promise<TaskPipelineStage> {
    const [agent, scheduler] = await Promise.all([
      task.agentId ? this.workerSender(task.agentId) : Promise.resolve(null),
      task.schedulerId
        ? this.workerSender(task.schedulerId)
        : Promise.resolve(null),
    ]);
    return { task, agent, scheduler };
  }

  private async workerSender(workerId: number): Promise<TaskChatSender | null> {
    const worker = await this.workers.findOne({ where: { id: workerId } });
    if (!worker) return null;
    return this.workerToSender(worker);
  }

  private workerToSender(worker: Worker): TaskChatSender {
    const scheduler = worker.role === WorkerRole.SCHEDULER;
    return {
      id: `${scheduler ? 'scheduler' : 'worker'}:${worker.id}`,
      name: worker.name,
      kind: scheduler ? 'scheduler' : 'worker',
      workerId: worker.id,
      roleLabel: scheduler ? '调度器' : '机器人',
    };
  }

  private async senderForTask(taskId: number): Promise<TaskChatSender> {
    const task = await this.tasks.findOne({
      where: { id: taskId },
      select: { id: true, agentId: true, schedulerId: true },
    });
    if (!task) return this.systemSender();
    if (task.agentId) {
      return (await this.workerSender(task.agentId)) ?? this.systemSender();
    }
    if (task.schedulerId) {
      return (await this.workerSender(task.schedulerId)) ?? this.systemSender();
    }
    return this.systemSender();
  }

  private async userSenderForTask(task: Task): Promise<TaskChatSender> {
    if (task.createdById) {
      const user = await this.users.findOne({
        where: { id: task.createdById },
        select: { id: true, name: true },
      });
      if (user?.name) return this.userSender(user.name);
    }
    return this.userSender(null);
  }

  private userSender(name: string | null | undefined): TaskChatSender {
    const userName = name?.trim() || '用户';
    return {
      id: `user:${userName}`,
      name: userName,
      kind: 'user',
      roleLabel: '用户',
    };
  }

  private systemSender(): TaskChatSender {
    return { id: 'system', name: '系统', kind: 'system', roleLabel: '系统' };
  }

  // ===== 内部：实时消息 =====

  private async ensureActiveMessage(
    taskId: number,
  ): Promise<InternalChatMessage> {
    const current = this.activeMessage(taskId);
    if (current && current.status === 'running') return current;
    const pending = this.creating.get(taskId);
    if (pending) return pending;

    const promise = this.createActiveMessage(taskId);
    this.creating.set(taskId, promise);
    try {
      return await promise;
    } finally {
      this.creating.delete(taskId);
    }
  }

  private async createActiveMessage(
    taskId: number,
  ): Promise<InternalChatMessage> {
    const rootTaskId = await this.rootIdOf(taskId);
    const sender = await this.senderForTask(taskId);
    const message: InternalChatMessage = {
      id: `chat:${taskId}:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`,
      taskId,
      rootTaskId,
      role: 'assistant',
      sender,
      content: '',
      createdAt: new Date().toISOString(),
      status: 'running',
      kind: 'message',
      tools: [],
    };
    this.store(message);
    this.active.set(taskId, message.id);
    this.broadcastMessage(message);
    return message;
  }

  private activeMessage(taskId: number): InternalChatMessage | null {
    const id = this.active.get(taskId);
    if (!id) return null;
    const messages = this.live.get(taskId);
    return messages?.get(id) ?? null;
  }

  private store(message: InternalChatMessage): void {
    let messages = this.live.get(message.taskId);
    if (!messages) {
      messages = new Map();
      this.live.set(message.taskId, messages);
    }
    messages.set(message.id, message);
    this.messageRoots.set(message.id, message.rootTaskId);
    // 单任务保留最近 200 条实时消息，避免进程内存无限增长
    if (messages.size > 200) {
      const oldest = messages.keys().next();
      if (!oldest.done) {
        messages.delete(oldest.value);
        this.messageRoots.delete(oldest.value);
      }
    }
  }

  private scheduleFlush(message: InternalChatMessage): void {
    if (this.flushTimers.has(message.id)) return;
    const timer = setTimeout(() => {
      this.flushTimers.delete(message.id);
      this.broadcastMessage(message);
    }, TEXT_FLUSH_MS);
    this.flushTimers.set(message.id, timer);
  }

  private flushNow(message: InternalChatMessage): void {
    const timer = this.flushTimers.get(message.id);
    if (timer) {
      clearTimeout(timer);
      this.flushTimers.delete(message.id);
    }
    this.broadcastMessage(message);
  }

  private broadcastMessage(message: InternalChatMessage): void {
    const rootTaskId =
      message.rootTaskId ?? this.messageRoots.get(message.id) ?? 0;
    if (!rootTaskId) return;
    this.subject.next({
      rootTaskId,
      event: {
        type: 'message.upsert',
        message: this.toPublic(message),
        at: Date.now(),
      },
    });
  }

  private toPublic(message: InternalChatMessage): TaskChatMessage {
    return {
      id: message.id,
      taskId: message.taskId,
      role: message.role,
      sender: message.sender,
      content: message.content,
      createdAt: message.createdAt,
      status: message.status,
      kind: message.kind,
      tools: message.tools
        ? message.tools.map((tool) => ({ ...tool }))
        : undefined,
      meta: message.meta,
    };
  }

  /** 有最终产出时只保留新一轮执行中的消息，避免与 result/历史消息重复 */
  private liveMessageVisible(
    task: Task,
    message: InternalChatMessage,
  ): boolean {
    if (!task.result?.trim()) return true;
    if (message.status === 'running') return true;
    return (
      new Date(message.createdAt).getTime() > new Date(task.updatedAt).getTime()
    );
  }

  // ===== 内部：任务 / 根任务 =====

  private async findTask(taskId: number): Promise<Task> {
    const task = await this.tasks.findOne({ where: { id: taskId } });
    if (!task) throw new NotFoundException(`Task ${taskId} not found`);
    return task;
  }

  private async rootIdOf(taskId: number): Promise<number> {
    const cached = this.rootCache.get(taskId);
    if (cached) return cached;
    const task = await this.tasks.findOne({
      where: { id: taskId },
      select: { id: true, rootId: true },
    });
    if (!task) throw new NotFoundException(`Task ${taskId} not found`);
    const rootId = task.rootId || task.id;
    this.rootCache.set(taskId, rootId);
    return rootId;
  }

  private async handleRealtime(
    rootId: number,
    event: TaskRealtimeEvent,
    send: (data: TaskChatStreamMessage) => void,
    scheduleRefresh: () => void,
  ): Promise<void> {
    if (event.type === 'line') return;
    if (event.type === 'deleted') {
      send({
        type: 'stage.delete',
        ids: [...new Set(event.ids)],
        at: Date.now(),
      });
      return;
    }
    const task = await this.tasks.findOne({ where: { id: event.taskId } });
    if (!task || (task.id !== rootId && task.rootId !== rootId)) return;
    send({
      type: 'stage.upsert',
      stage: await this.stageOf(task),
      at: Date.now(),
    });
    scheduleRefresh();
  }
}
