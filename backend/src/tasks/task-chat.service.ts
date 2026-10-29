import {
  BadRequestException,
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
import { TaskMessage } from './task-message.entity';
import type {
  TaskChatMessage,
  TaskChatQuestion,
  TaskChatQuestionInfo,
  TaskChatQuestionState,
  TaskChatSender,
  TaskChatSnapshot,
  TaskChatStreamMessage,
  TaskChatTool,
  TaskPipelineStage,
  TaskQueuedUserMessage,
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

/** 已展示的机器人文本消息（快照内用于最终产出去重比对） */
interface DisplayedAssistantText {
  id: string;
  content: string;
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

  /** taskId → 等待投递给机器人的用户消息（FIFO） */
  private readonly queuedUsers = new Map<number, TaskQueuedUserMessage[]>();

  /** 队列消息 id → 实际发给模型的 Prompt（展示内容保持用户原始输入） */
  private readonly queuedPrompts = new Map<string, string>();

  constructor(
    @InjectRepository(Task)
    private readonly tasks: Repository<Task>,
    @InjectRepository(TaskEvent)
    private readonly events: Repository<TaskEvent>,
    @InjectRepository(TaskMessage)
    private readonly messages: Repository<TaskMessage>,
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
    this.queuedUsers.clear();
    this.queuedPrompts.clear();
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
    const pipeline = await this.stagesOf(pipelineTasks);
    const stageByTask = new Map(pipeline.map((item) => [item.task.id, item]));
    const ids = pipelineTasks.map((item) => item.id);
    const [taskEvents, persistedMessages] = await Promise.all([
      ids.length > 0
        ? this.events.find({
            where: { taskId: In(ids) },
            order: { id: 'ASC' },
          })
        : Promise.resolve([] as TaskEvent[]),
      ids.length > 0
        ? this.messages.find({
            where: { taskId: In(ids) },
            order: { id: 'ASC' },
          })
        : Promise.resolve([] as TaskMessage[]),
    ]);
    const persistedByTask = new Map<number, TaskMessage[]>();
    for (const message of persistedMessages) {
      const list = persistedByTask.get(message.taskId) ?? [];
      list.push(message);
      persistedByTask.set(message.taskId, list);
    }

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

      // 已展示的机器人文本消息（按时间序）：只统计机器人回复本体（kind=message），
      // 事件还原出的调度消息与问答卡片不参与最终产出的去重比对
      const assistantTexts: DisplayedAssistantText[] = [];
      const persisted = persistedByTask.get(item.id) ?? [];
      const persistedKeys = new Set(persisted.map((row) => row.messageKey));
      for (const row of persisted) {
        const message = this.persistedMessage(row);
        entries.push({
          message,
          at: new Date(message.createdAt).getTime(),
          seq: seq++,
        });
        if (
          message.role === 'assistant' &&
          message.kind === 'message' &&
          message.content.trim()
        ) {
          assistantTexts.push({
            id: message.id,
            content: message.content.trim(),
          });
        }
      }

      // 尚未落库的进程内实时消息并入快照（刷新页面不丢当前对话）
      const liveMessages = this.live.get(item.id);
      if (liveMessages) {
        for (const message of liveMessages.values()) {
          if (persistedKeys.has(message.id)) continue;
          if (!this.liveMessageVisible(item, message)) continue;
          entries.push({
            message: this.toPublic(message),
            at: new Date(message.createdAt).getTime(),
            seq: seq++,
          });
          if (
            message.role === 'assistant' &&
            message.kind === 'message' &&
            message.content.trim()
          ) {
            assistantTexts.push({
              id: message.id,
              content: message.content.trim(),
            });
          }
        }
      }

      if (item.result?.trim()) {
        const result = item.result.trim();
        // 最终产出可能就是已展示的机器人回复（单条相同，或末尾多条按 \n\n 顺序拼接）：
        // 完全覆盖时不再生成 result 消息；仅前缀覆盖（执行收尾时尾部增量只进了
        // result、未落到聊天消息）则折叠为一条完整 result 消息，避免同一段答复展示两遍
        const covered = this.resultCoveredCount(result, assistantTexts);
        if (covered > 0) {
          const coveredRows = assistantTexts.slice(-covered);
          if (coveredRows.map((row) => row.content).join('\n\n') === result) {
            continue;
          }
          const coveredIds = new Set(coveredRows.map((row) => row.id));
          for (let i = entries.length - 1; i >= 0; i -= 1) {
            if (coveredIds.has(entries[i].message.id)) entries.splice(i, 1);
          }
        }
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
            content: result,
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
    const requesterType =
      task.requesterType ?? (task.createdById ? 'user' : null);
    const requesterId =
      task.requesterId ?? task.createdById ?? rootTask.createdById;
    const [requester, agent] = await Promise.all([
      requesterId && requesterType
        ? requesterType === 'worker'
          ? this.workers.findOne({
              where: { id: requesterId },
              select: { id: true, name: true },
            })
          : this.users.findOne({
              where: { id: requesterId },
              select: { id: true, name: true },
            })
        : Promise.resolve(null),
      task.agentId
        ? this.workers.findOne({
            where: { id: task.agentId },
            select: { id: true, ownerName: true },
          })
        : Promise.resolve(null),
    ]);
    const currentEvents = taskEvents
      .filter((event) => event.taskId === task.id)
      .sort((a, b) => b.id - a.id)
      .slice(0, 200);
    return {
      task,
      rootTask,
      pipeline,
      messages: entries.map((item) => item.message),
      queuedMessages: this.queuedUserMessages(taskId),
      requesterName: requester?.name ?? null,
      agentOwnerName: agent?.ownerName ?? null,
      interventionCount: currentEvents.filter(
        (event) => event.meta?.intervention === true,
      ).length,
      hasAcceptanceApplication: taskEvents.some(
        (event) =>
          event.taskId === task.id && event.meta?.deliveryApply === true,
      ),
      events: currentEvents,
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

  /** 文本输出完成：结束当前助手消息并落库 */
  endText(taskId: number): void {
    const message = this.activeMessage(taskId);
    if (!message) return;
    message.status = 'complete';
    this.flushNow(message);
    this.active.delete(taskId);
    void this.persistMessage(message);
  }

  /** 机器人开始思考：复用当前助手消息，思考内容与文本同气泡展示 */
  async beginReasoning(taskId: number): Promise<void> {
    const message = await this.ensureActiveMessage(taskId);
    if (message.status !== 'running') {
      message.status = 'running';
      this.broadcastMessage(message);
    }
  }

  /** 追加思考增量（与文本一样合并推送） */
  async appendReasoning(taskId: number, delta: string): Promise<void> {
    if (!delta) return;
    const message = await this.ensureActiveMessage(taskId);
    message.reasoning = (message.reasoning ?? '') + delta;
    this.scheduleFlush(message);
  }

  /** 思考结束：持久化当前快照 */
  endReasoning(taskId: number): void {
    const message = this.activeMessage(taskId);
    if (!message?.reasoning?.trim()) return;
    this.flushNow(message);
    void this.persistMessage(message);
  }

  /** 当前任务是否有机器人在回复（用于续聊并发保护） */
  isRunning(taskId: number): boolean {
    return this.activeMessage(taskId)?.status === 'running';
  }

  /** 当前任务的待发送消息（副本，避免调用方直接修改进程内队列） */
  queuedUserMessages(taskId: number): TaskQueuedUserMessage[] {
    return (this.queuedUsers.get(taskId) ?? []).map((message) => ({
      ...message,
      sender: { ...message.sender },
    }));
  }

  hasQueuedUserMessages(taskId: number): boolean {
    return (this.queuedUsers.get(taskId)?.length ?? 0) > 0;
  }

  /** 入队一条执行中的用户消息；opencode 接受后再落任务事件并移出队列 */
  async enqueueUserMessage(
    taskId: number,
    content: string,
    operator: string | null,
    prompt?: string,
  ): Promise<TaskQueuedUserMessage> {
    const text = content.trim();
    if (!text) throw new BadRequestException('消息内容不能为空');
    const message: TaskQueuedUserMessage = {
      id: `queue:${taskId}:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`,
      taskId,
      sender: this.userSender(operator),
      content: text,
      createdAt: new Date().toISOString(),
      status: 'queued',
    };
    const modelText = prompt?.trim();
    if (modelText && modelText !== text) {
      this.queuedPrompts.set(message.id, modelText);
    }
    const queue = this.queuedUsers.get(taskId) ?? [];
    queue.push(message);
    this.queuedUsers.set(taskId, queue);
    await this.broadcastQueueMessage(message);
    return { ...message, sender: { ...message.sender } };
  }

  /** 标记队首正在投递；失败时由 restore 恢复为 queued */
  async markQueuedUserMessageSending(
    taskId: number,
    messageId: string,
  ): Promise<TaskQueuedUserMessage | null> {
    const message = (this.queuedUsers.get(taskId) ?? []).find(
      (item) => item.id === messageId,
    );
    if (!message) return null;
    message.status = 'sending';
    delete message.error;
    await this.broadcastQueueMessage(message);
    return { ...message, sender: { ...message.sender } };
  }

  /** 投递失败：恢复队首状态并记录原因，等待下次触发 */
  async restoreQueuedUserMessage(
    taskId: number,
    messageId: string,
    error: string,
  ): Promise<void> {
    const message = (this.queuedUsers.get(taskId) ?? []).find(
      (item) => item.id === messageId,
    );
    if (!message) return;
    message.status = 'queued';
    message.error = error;
    await this.broadcastQueueMessage(message);
  }

  /** 队列消息实际发给模型的 Prompt（未单独指定时由调用方回退展示内容） */
  queuedUserMessagePrompt(taskId: number, messageId: string): string | null {
    const exists = (this.queuedUsers.get(taskId) ?? []).some(
      (message) => message.id === messageId,
    );
    return exists ? (this.queuedPrompts.get(messageId) ?? null) : null;
  }

  /** opencode 已接受：移出队列（随后任务事件会生成正式用户气泡） */
  async removeQueuedUserMessage(
    taskId: number,
    messageId: string,
  ): Promise<void> {
    const queue = this.queuedUsers.get(taskId) ?? [];
    const next = queue.filter((message) => message.id !== messageId);
    if (next.length === 0) this.queuedUsers.delete(taskId);
    else this.queuedUsers.set(taskId, next);
    this.queuedPrompts.delete(messageId);
    await this.broadcastQueueDelete(taskId, [messageId]);
  }

  /** 清空任务队列（取消/删除等不再继续发送的场景） */
  async discardQueuedUserMessages(taskId: number): Promise<void> {
    const queue = this.queuedUsers.get(taskId) ?? [];
    if (queue.length === 0) return;
    this.queuedUsers.delete(taskId);
    for (const message of queue) this.queuedPrompts.delete(message.id);
    await this.broadcastQueueDelete(
      taskId,
      queue.map((message) => message.id),
    );
  }

  private async broadcastQueueMessage(
    message: TaskQueuedUserMessage,
  ): Promise<void> {
    const rootTaskId = await this.rootIdOf(message.taskId);
    this.subject.next({
      rootTaskId,
      event: {
        type: 'queue.upsert',
        message: { ...message, sender: { ...message.sender } },
        at: Date.now(),
      },
    });
  }

  private async broadcastQueueDelete(
    taskId: number,
    ids: string[],
  ): Promise<void> {
    const rootTaskId = await this.rootIdOf(taskId);
    this.subject.next({
      rootTaskId,
      event: { type: 'queue.delete', ids, at: Date.now() },
    });
  }

  /**
   * 在开始新一轮执行前归档上一轮最终产出，避免 task.result 被覆盖后
   * 旧任务（未产生实时消息）的历史交付从对话中消失。
   */
  async archiveResult(taskId: number): Promise<void> {
    const task = await this.tasks.findOne({ where: { id: taskId } });
    const result = task?.result?.trim();
    if (!task || !result) return;
    const duplicate = await this.messages.findOne({
      where: { taskId, role: 'assistant', content: result },
    });
    if (duplicate) return;
    const createdAt = (
      task.deliveredAt ??
      task.acceptedAt ??
      task.updatedAt ??
      new Date()
    ).toISOString();
    void this.persistMessage({
      id: `result:${taskId}:${task.updatedAt.getTime()}`,
      taskId,
      rootTaskId: await this.rootIdOf(taskId),
      role: 'assistant',
      sender: await this.senderForTask(taskId),
      content: result,
      createdAt,
      status: 'complete',
      kind: 'message',
    });
  }

  /** 工具开始：记到当前助手消息（没有则新建「工具调用」气泡） */
  async toolStarted(
    taskId: number,
    tool: { name: string; toolCallId?: string; argsText?: string },
  ): Promise<void> {
    const message = await this.ensureActiveMessage(taskId);
    const seq = (this.toolSeq.get(taskId) ?? 0) + 1;
    this.toolSeq.set(taskId, seq);
    if (!message.tools) message.tools = [];
    const id = tool.toolCallId || `${message.id}:tool:${seq}`;
    const existing = message.tools.find((item) => item.id === id);
    if (existing) {
      existing.name = tool.name || existing.name;
      if (tool.argsText) existing.argsText = tool.argsText;
      this.broadcastMessage(message);
      return;
    }
    message.tools.push({
      id,
      name: tool.name || '工具',
      status: 'running',
      ...(tool.argsText ? { argsText: tool.argsText } : {}),
      startedAt: new Date().toISOString(),
    });
    this.broadcastMessage(message);
  }

  /** 工具输入更新（流式参数可能在 started 之后才完整） */
  toolUpdated(
    taskId: number,
    update: { name?: string; toolCallId?: string; argsText?: string },
  ): void {
    const message = this.activeMessage(taskId);
    if (!message?.tools?.length) return;
    const tool = this.toolOf(message, update.toolCallId);
    if (!tool) return;
    if (update.name) tool.name = update.name;
    if (update.argsText) tool.argsText = update.argsText;
    this.broadcastMessage(message);
  }

  /** 工具结束：优先按调用 ID 匹配，旧协议回退最近一个运行中的工具 */
  toolFinished(
    taskId: number,
    ok: boolean,
    update: {
      toolCallId?: string;
      name?: string;
      result?: string;
      detail?: string;
    } = {},
  ): void {
    const message = this.activeMessage(taskId);
    if (!message) return;
    const tools = (message.tools ??= []);
    let tool = this.toolOf(message, update.toolCallId);
    if (
      !tool &&
      update.name &&
      !tools.some((item) => item.id === update.toolCallId)
    ) {
      tool = {
        id:
          update.toolCallId ??
          `${message.id}:tool:${(this.toolSeq.get(taskId) ?? 0) + 1}`,
        name: update.name,
        status: 'running',
        startedAt: new Date().toISOString(),
      };
      tools.push(tool);
    }
    if (!tool) return;
    tool.status = ok ? 'success' : 'error';
    if (update.result) tool.result = update.result;
    if (update.detail) tool.detail = update.detail;
    tool.finishedAt = new Date().toISOString();
    this.broadcastMessage(message);
  }

  /**
   * 会话终止兜底：工具终态事件可能缺失或晚于会话终态，遗留的 running
   * 会让前端一直显示运行中。仅结算仍为 running 的工具，不覆盖已收到的结果。
   */
  private settleRunningTools(
    message: InternalChatMessage,
    status: 'success' | 'error',
    detail: string,
  ): boolean {
    let changed = false;
    for (const tool of message.tools ?? []) {
      if (tool.status !== 'running') continue;
      tool.status = status;
      tool.detail ??= detail;
      tool.finishedAt = new Date().toISOString();
      changed = true;
    }
    return changed;
  }

  private toolOf(
    message: InternalChatMessage,
    toolCallId?: string,
  ): TaskChatTool | undefined {
    if (toolCallId)
      return message.tools?.find((item) => item.id === toolCallId);
    return [...(message.tools ?? [])]
      .reverse()
      .find((item) => item.status === 'running');
  }

  /**
   * 机器人发起提问：生成一张待回答卡片（同一 request 幂等，事件重放/对账不重复插入）。
   * 提问独立成消息，不打断当前助手气泡的文本流。
   */
  async questionAsked(
    taskId: number,
    request: {
      id: string;
      sessionID: string;
      questions: TaskChatQuestionInfo[];
      tool?: { callID?: string };
    },
  ): Promise<boolean> {
    const id = this.questionMessageId(taskId, request.id);
    const existing = this.live.get(taskId)?.get(id);
    if (existing) return false;
    const persisted = await this.messages.findOne({
      where: { taskId, messageKey: id },
    });
    if (persisted) {
      if (persisted.question?.state !== 'pending') return false;
      // 服务重启/页面刷新后把已持久化的待答提问重新挂到实时内存，保证仍可作答
      const rootTaskId = await this.rootIdOf(taskId);
      this.store({
        id: persisted.messageKey,
        taskId: persisted.taskId,
        rootTaskId,
        role: persisted.role,
        sender: persisted.sender,
        content: persisted.content,
        reasoning: persisted.reasoning || undefined,
        createdAt: persisted.createdAt.toISOString(),
        status: persisted.status,
        kind: persisted.kind,
        tools: persisted.tools ?? undefined,
        question: persisted.question ?? undefined,
        meta: persisted.meta ?? undefined,
      });
      this.broadcastMessage(this.live.get(taskId)!.get(id)!);
      return false;
    }
    const rootTaskId = await this.rootIdOf(taskId);
    const sender = await this.senderForTask(taskId);
    const message: InternalChatMessage = {
      id,
      taskId,
      rootTaskId,
      role: 'assistant',
      sender,
      content: '',
      createdAt: new Date().toISOString(),
      status: 'running',
      kind: 'question',
      question: {
        id: request.id,
        sessionId: request.sessionID,
        questions: (request.questions ?? []).map((question) => ({
          ...question,
          options: question.options?.map((option) => ({ ...option })),
        })),
        state: 'pending',
        askedAt: new Date().toISOString(),
        toolCallId: request.tool?.callID,
      },
    };
    this.store(message);
    this.broadcastMessage(message);
    // project 提问创建后可能立即被需求方答复，先确保可从数据库恢复。
    await this.persistMessage(message);
    return true;
  }

  /** 提问已被回答/跳过/失效：就地更新卡片为回执 */
  questionSettled(
    taskId: number,
    requestId: string,
    state: Exclude<TaskChatQuestionState, 'pending'>,
    answers?: string[][],
  ): void {
    const message = this.live
      .get(taskId)
      ?.get(this.questionMessageId(taskId, requestId));
    if (!message?.question || message.question.state !== 'pending') return;
    message.question = {
      ...message.question,
      state,
      answers: answers?.map((answer) => [...answer]),
    };
    message.status = 'complete';
    this.broadcastMessage(message);
    void this.persistMessage(message);
  }

  /** 更新提问消息的附加信息（如父机器人自动答复状态），保留原 meta 其他字段 */
  setQuestionMeta(
    taskId: number,
    requestId: string,
    meta: Record<string, unknown>,
  ): void {
    const message = this.live
      .get(taskId)
      ?.get(this.questionMessageId(taskId, requestId));
    if (!message?.question) return;
    message.meta = { ...message.meta, ...meta };
    this.broadcastMessage(message);
    void this.persistMessage(message);
  }

  /** 提问消息的附加信息（自动答复恢复判断用） */
  questionMeta(
    taskId: number,
    requestId: string,
  ): Record<string, unknown> | undefined {
    return this.live.get(taskId)?.get(this.questionMessageId(taskId, requestId))
      ?.meta;
  }

  /** 指定任务的待回答提问（对账/答复校验用） */
  pendingQuestions(taskId: number): TaskChatQuestion[] {
    const messages = this.live.get(taskId);
    if (!messages) return [];
    return [...messages.values()]
      .map((message) => message.question)
      .filter(
        (question): question is TaskChatQuestion =>
          question?.state === 'pending',
      );
  }

  /** 单个提问（含已结算状态；答复前校验用） */
  findQuestion(taskId: number, requestId: string): TaskChatQuestion | null {
    return (
      this.live.get(taskId)?.get(this.questionMessageId(taskId, requestId))
        ?.question ?? null
    );
  }

  private questionMessageId(taskId: number, requestId: string): string {
    return `chat:${taskId}:question:${requestId}`;
  }

  /**
   * 追加一条平台生成的助手消息（如任务总结报告）。
   * 使用固定 messageId 时按幂等 upsert 覆盖同一条消息，并照常经 SSE 推送。
   */
  async postAssistantMessage(
    taskId: number,
    content: string,
    options?: {
      messageId?: string;
      status?: 'running' | 'complete' | 'error';
      meta?: Record<string, unknown>;
    },
  ): Promise<TaskChatMessage> {
    const text = content.trim();
    if (!text) throw new BadRequestException('消息内容不能为空');
    const rootTaskId = await this.rootIdOf(taskId);
    const sender = await this.senderForTask(taskId);
    const message: InternalChatMessage = {
      id:
        options?.messageId ??
        `chat:${taskId}:assistant:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`,
      taskId,
      rootTaskId,
      role: 'assistant',
      sender,
      content: text,
      createdAt: new Date().toISOString(),
      status: options?.status ?? 'complete',
      kind: 'message',
      meta: options?.meta,
    };
    this.store(message);
    this.broadcastMessage(message);
    void this.persistMessage(message);
    return this.toPublic(message);
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
    void this.persistMessage(message);
  }

  /** 会话执行失败：把当前正在输出的助手消息标记为 error，停止「正在执行」状态 */
  async failTask(taskId: number, content: string): Promise<void> {
    // 失败的会话不再接受回答，未答提问直接失效
    const messages = this.live.get(taskId);
    if (messages) {
      for (const message of messages.values()) {
        if (message.question?.state !== 'pending') continue;
        // project 提问由任务状态机管理，执行器本轮失败不等于问题失效。
        if (message.question.id.startsWith('project-')) continue;
        message.question = { ...message.question, state: 'cancelled' };
        message.status = 'complete';
        this.flushNow(message);
        void this.persistMessage(message);
      }
    }
    for (const item of this.live.get(taskId)?.values() ?? []) {
      if (
        this.settleRunningTools(item, 'error', '会话失败，未收到工具终态事件')
      ) {
        this.flushNow(item);
        void this.persistMessage(item);
      }
    }
    const message = this.activeMessage(taskId);
    if (!message) {
      await this.note(taskId, content);
      return;
    }
    if (!message.content.trim()) message.content = content.trim();
    message.status = 'error';
    this.flushNow(message);
    this.active.delete(taskId);
    void this.persistMessage(message);
  }

  /** 会话结束：收尾当前消息并通知前端刷新；project 待反馈提问可按需保留。 */
  async finishTask(
    taskId: number,
    options?: {
      preserveProjectQuestions?: boolean;
      toolStatus?: 'success' | 'error';
      toolDetail?: string;
    },
  ): Promise<void> {
    const messages = this.live.get(taskId);
    if (messages) {
      for (const message of messages.values()) {
        let changed = this.settleRunningTools(
          message,
          options?.toolStatus ?? 'success',
          options?.toolDetail ?? '会话已结束，未收到工具终态事件',
        );
        if (
          message.question?.state === 'pending' &&
          !(
            options?.preserveProjectQuestions &&
            message.question.id.startsWith('project-')
          )
        ) {
          message.question = { ...message.question, state: 'cancelled' };
          changed = true;
        }
        if (message.status === 'running') {
          message.status = 'complete';
          changed = true;
        }
        if (changed) {
          this.flushNow(message);
          void this.persistMessage(message);
        }
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

    // 创建任务：只有根任务的创建事件是「用户提出了什么」，子任务由平台拆解产生
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

    // 需求方反馈：进入对话流，而非时间线；父机器人需求方也保留机器人身份。
    if (event.type === '反馈') {
      const actorWorkerId =
        typeof meta.actorWorkerId === 'number' ? meta.actorWorkerId : null;
      const sender =
        meta.actorType === 'worker' && actorWorkerId
          ? {
              id: `worker:${actorWorkerId}`,
              name: event.operator ?? '需求方机器人',
              kind: 'worker' as const,
              workerId: actorWorkerId,
              roleLabel: '需求方机器人',
            }
          : this.userSender(event.operator);
      return {
        ...base,
        role: 'user',
        sender,
        content: event.content,
        kind: 'message',
        meta,
      };
    }

    // 历史识别完成事件：作为调度机器人的助手回复，附上工作计划
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

    // 其余为时间线事件（状态变更/派发/分配/提醒等），只进右侧「任务事件」面板，不进入对话流
    return null;
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

  /** 快照批量取阶段发送方：一次查出全部 agent/scheduler，避免每阶段两次 N+1 查询 */
  private async stagesOf(tasks: Task[]): Promise<TaskPipelineStage[]> {
    const ids = [
      ...new Set(
        tasks
          .flatMap((item) => [item.agentId, item.schedulerId])
          .filter((id): id is number => typeof id === 'number'),
      ),
    ];
    const rows = ids.length
      ? await this.workers.find({ where: { id: In(ids) } })
      : [];
    const byId = new Map(rows.map((worker) => [worker.id, worker]));
    return tasks.map((task) => ({
      task,
      agent: task.agentId ? this.senderOfMap(byId, task.agentId) : null,
      scheduler: task.schedulerId
        ? this.senderOfMap(byId, task.schedulerId)
        : null,
    }));
  }

  private senderOfMap(
    byId: Map<number, Worker>,
    workerId: number,
  ): TaskChatSender | null {
    const worker = byId.get(workerId);
    return worker ? this.workerToSender(worker) : null;
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
      avatarUrl: worker.avatarUrl,
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
      reasoning: message.reasoning || undefined,
      createdAt: message.createdAt,
      status: message.status,
      kind: message.kind,
      tools: message.tools
        ? message.tools.map((tool) => ({ ...tool }))
        : undefined,
      question: message.question
        ? {
            ...message.question,
            questions: message.question.questions.map((question) => ({
              ...question,
              options: question.options?.map((option) => ({ ...option })),
            })),
            answers: message.question.answers?.map((answer) => [...answer]),
          }
        : undefined,
      meta: message.meta,
    };
  }

  /**
   * 快照内的数据库消息：优先取进程内实时副本（内容与状态最新）。
   * 数据库里遗留的 running 说明会话早已结束或服务重启过，
   * 按完成展示并回写，避免任务详情一直显示「正在执行」。
   */
  private persistedMessage(row: TaskMessage): TaskChatMessage {
    const live = this.live.get(row.taskId)?.get(row.messageKey);
    if (live) return this.toPublic(live);

    let changed = false;
    if (row.status === 'running') {
      row.status = 'complete';
      changed = true;
    }
    for (const tool of row.tools ?? []) {
      if (tool.status !== 'running') continue;
      tool.status = 'success';
      tool.detail ??= '会话已结束，未收到工具终态事件';
      tool.finishedAt = new Date().toISOString();
      changed = true;
    }
    if (changed) {
      void this.messages
        .update(
          { taskId: row.taskId, messageKey: row.messageKey },
          { status: row.status, tools: row.tools },
        )
        .catch((error: Error) =>
          this.logger.warn(
            `修正任务消息 ${row.messageKey} 状态失败：${error.message}`,
          ),
        );
    }
    return this.persistedToPublic(row);
  }

  /** 数据库消息还原为前端消息结构（id 使用 messageKey，与实时消息一致） */
  private persistedToPublic(row: TaskMessage): TaskChatMessage {
    return {
      id: row.messageKey,
      taskId: row.taskId,
      role: row.role,
      sender: row.sender,
      content: row.content,
      reasoning: row.reasoning || undefined,
      createdAt: row.createdAt.toISOString(),
      status: row.status,
      kind: row.kind,
      tools: row.tools ?? undefined,
      question: row.question ?? undefined,
      meta: row.meta ?? undefined,
    };
  }

  /** 消息落库（按 taskId + messageKey 幂等 upsert；失败只告警不阻断对话） */
  private persistMessage(message: InternalChatMessage): Promise<void> {
    return this.messages
      .upsert(
        {
          taskId: message.taskId,
          messageKey: message.id,
          role: message.role,
          sender: message.sender,
          content: message.content,
          reasoning: message.reasoning || null,
          status: message.status,
          kind: message.kind,
          tools: message.tools ?? null,
          question: message.question ?? null,
          meta: (message.meta ?? null) as never,
          createdAt: new Date(message.createdAt),
          updatedAt: new Date(),
        },
        ['taskId', 'messageKey'],
      )
      .then(() => undefined)
      .catch((error: Error) => {
        this.logger.warn(
          `任务消息落库失败（taskId=${message.taskId}）: ${error.message}`,
        );
      });
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

  /**
   * 最终产出被末尾连续 k 条已展示机器人文本覆盖的最大 k（0 = 无覆盖）。
   * 拼接规则与执行完成时一致（多条文本按 \n\n 顺序连接），并用前缀匹配
   * 兼容尾部增量因事件乱序只进入 result、未落到聊天消息的场景。
   */
  private resultCoveredCount(
    result: string,
    texts: DisplayedAssistantText[],
  ): number {
    let joined = '';
    let best = 0;
    for (let count = 1; count <= texts.length; count += 1) {
      const text = texts[texts.length - count].content;
      joined = joined ? `${text}\n\n${joined}` : text;
      if (joined.length > result.length) break;
      if (result.startsWith(joined)) {
        best = count;
        if (joined === result) break;
      }
    }
    return best;
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
