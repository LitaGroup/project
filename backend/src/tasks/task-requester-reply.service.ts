import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TaskStatus, WorkerRole, WorkerRuntime } from '../common/enums';
import { Executor } from '../executors/executor.entity';
import { OpencodeClient } from '../executors/opencode-client';
import { runOpencodePrompt } from '../executors/opencode-run';
import { Worker } from '../workers/worker.entity';
import { agentTokenShell } from '../workers/worker-env';
import { WorkersService } from '../workers/workers.service';
import {
  nextInboxRetryDelay,
  TASK_INBOX_MAX_ATTEMPTS,
} from './task-loop.rules';
import { TaskMessage } from './task-message.entity';
import { Task } from './task.entity';
import { TaskNotifyService } from './task-notify.service';
import type { TaskWorkerInbox } from './task-worker-inbox.entity';
import { TaskWorkerInboxService } from './task-worker-inbox.service';
import { TasksService } from './tasks.service';

/** 根任务需求方机器人回复会话最长耗时 */
const REPLY_TIMEOUT_MS = 180_000;
/** 提示词里任务描述和单条消息的截断长度 */
const MAX_CONTEXT_CHARS = 4_000;
const MAX_MESSAGE_CHARS = 1_000;
const MAX_HISTORY_MESSAGES = 12;

interface ReplyEndpoint {
  worker: Worker;
  executor: Executor;
  providerId: string;
  modelId: string;
  variant: string | null;
  workdir: string;
}

function clip(value: string | null | undefined, limit: number): string {
  const text = value?.trim() ?? '';
  return text.length <= limit ? text : `${text.slice(0, limit)}\n…（已截断）`;
}

function payloadText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * 根任务机器人需求方消息回复：
 * 根任务没有父任务会话可唤醒，平台使用需求方机器人自己的执行器创建一次性会话，
 * 读取最近对话并调用 messages/reply.md 回复执行方，不改变任务状态。
 * 会话结束仍未回复时按收件箱退避重试，连续超过阈值后通知负责人转人工处理。
 * 子任务仍由父任务收件箱唤醒其执行机器人，不走本服务。
 */
@Injectable()
export class TaskRequesterReplyService {
  private readonly logger = new Logger(TaskRequesterReplyService.name);
  /** 正在生成需求方回复的任务 */
  private readonly activeTasks = new Set<number>();
  /** 正在被回复会话占用的需求方机器人（同一机器人一次只处理一个任务） */
  private readonly activeWorkers = new Set<number>();
  private readonly apiUrl: string;

  constructor(
    @InjectRepository(Task)
    private readonly tasks: Repository<Task>,
    @InjectRepository(TaskMessage)
    private readonly messages: Repository<TaskMessage>,
    @InjectRepository(Executor)
    private readonly executors: Repository<Executor>,
    @InjectRepository(Worker)
    private readonly workers: Repository<Worker>,
    private readonly workersService: WorkersService,
    private readonly tasksService: TasksService,
    private readonly taskNotify: TaskNotifyService,
    private readonly workerInbox: TaskWorkerInboxService,
    config: ConfigService,
  ) {
    this.apiUrl = (
      config.get<string>('API_URL') ?? 'http://localhost:3100/api'
    ).replace(/\/+$/, '');
  }

  isActive(taskId: number): boolean {
    return this.activeTasks.has(taskId);
  }

  /**
   * 尝试回复一条根任务执行方消息。
   * 返回 false 表示本次未完成（机器人不可用、忙碌、会话未调用回复接口等）。
   */
  async reply(task: Task, entry: TaskWorkerInbox): Promise<boolean> {
    if (this.activeTasks.has(task.id)) return false;
    if (task.parentId || entry.kind !== 'message') {
      await this.workerInbox.markDead(entry.id);
      return false;
    }
    if (task.status === TaskStatus.FINISHED) {
      await this.workerInbox.markDone(entry.id);
      return true;
    }
    if (task.requesterType !== 'worker' || !task.requesterId) {
      await this.workerInbox.markDead(entry.id);
      return false;
    }
    const requester = await this.workers.findOne({
      where: { id: task.requesterId },
      select: {
        id: true,
        runtime: true,
        personalAgentUserId: true,
      },
    });
    if (!requester) {
      await this.workerInbox.markDead(entry.id);
      return false;
    }
    // 真人需求方在操作台自行处理，个人 AGENT 不承接任务协作。
    if (
      requester.runtime === WorkerRuntime.HUMAN ||
      requester.personalAgentUserId
    ) {
      await this.workerInbox.markDone(entry.id);
      return true;
    }

    const endpoint = await this.resolveEndpoint(task.requesterId);
    if (!endpoint) {
      await this.recordNotReplied(
        task,
        entry,
        null,
        '需求方机器人未启用、执行器离线或缺少可用模型',
      );
      return false;
    }
    if (this.activeWorkers.has(endpoint.worker.id)) return false;

    const content = payloadText(entry.payload?.content);
    if (!content) {
      await this.workerInbox.markDead(entry.id);
      return false;
    }

    this.activeTasks.add(task.id);
    this.activeWorkers.add(endpoint.worker.id);
    const client = new OpencodeClient(endpoint.executor);
    let sessionId: string | null = null;
    try {
      await this.workerInbox.markEventDelivered(entry.id);
      const token = await this.workersService.ensureWorkToken(
        endpoint.worker.id,
      );
      await client.shell(
        `mkdir -p '${endpoint.workdir}' '${endpoint.workdir}/.opencode' && ` +
          agentTokenShell(endpoint.workdir, token),
      );
      const conversation = await this.loadConversation(task.id);
      await runOpencodePrompt(client, {
        title: `需求方回复 ${task.code}`.slice(0, 100),
        model: {
          id: endpoint.modelId,
          providerID: endpoint.providerId,
          ...(endpoint.variant ? { variant: endpoint.variant } : {}),
        },
        location: { directory: endpoint.workdir },
        prompt: this.buildPrompt(task, endpoint.worker, content, conversation),
        timeoutMs: REPLY_TIMEOUT_MS,
        onSessionCreated: (id) => {
          sessionId = id;
        },
      });
      const [latest, latestEntry] = await Promise.all([
        this.tasks.findOne({ where: { id: task.id } }),
        this.workerInbox.findById(entry.id),
      ]);
      if (!latestEntry || latestEntry.status === 'done') {
        return true;
      }
      if (!latest || latest.status === TaskStatus.FINISHED) {
        await this.workerInbox.markDone(entry.id);
        return true;
      }
      await this.recordNotReplied(
        task,
        entry,
        endpoint.worker,
        '自动回复会话已结束，但需求方未调用回复接口',
      );
      return false;
    } catch (error) {
      await this.recordNotReplied(
        task,
        entry,
        endpoint.worker,
        (error as Error).message,
      );
      return false;
    } finally {
      this.activeTasks.delete(task.id);
      this.activeWorkers.delete(endpoint.worker.id);
      if (sessionId) {
        await client
          .deleteSession(sessionId)
          .catch((e: Error) =>
            this.logger.warn(
              `需求方回复会话 ${sessionId} 清理失败：${e.message}`,
            ),
          );
      }
    }
  }

  /** 需求方机器人必须启用、有执行器与可用模型；否则回退人工通知。 */
  private async resolveEndpoint(
    workerId: number,
  ): Promise<ReplyEndpoint | null> {
    const worker = await this.workers.findOne({ where: { id: workerId } });
    if (
      !worker ||
      !worker.enabled ||
      worker.role !== WorkerRole.WORKER ||
      worker.runtime !== WorkerRuntime.OPENCODE ||
      worker.personalAgentUserId
    ) {
      return null;
    }
    if (!worker.executorId) return null;
    const executor = await this.executors.findOne({
      where: { id: worker.executorId },
    });
    if (!executor?.online) return null;

    let providerId = worker.providerId?.trim() || '';
    let modelId = worker.modelId?.trim() || '';
    if (!providerId || !modelId) {
      const provider = executor.providersCache?.find(
        (item) => item.models.length > 0,
      );
      providerId ||= provider?.id ?? '';
      modelId ||= provider?.models[0]?.id ?? '';
    }
    if (!providerId || !modelId) return null;
    const workdir = this.workersService.workdirOf(worker.id);
    if (!workdir) return null;
    return {
      worker,
      executor,
      providerId,
      modelId,
      variant: worker.variant ?? null,
      workdir,
    };
  }

  /** 最近对话供一次性会话理解上下文，避免只看到最后一条消息。 */
  private async loadConversation(taskId: number): Promise<string[]> {
    const rows = await this.messages.find({
      where: { taskId, kind: 'message' },
      order: { id: 'DESC' },
      take: MAX_HISTORY_MESSAGES,
    });
    return rows.reverse().map((row) => {
      const label = row.role === 'assistant' ? '执行方' : '需求方';
      const sender = row.sender?.name ? `（${row.sender.name}）` : '';
      return `- ${label}${sender}：${clip(row.content, MAX_MESSAGE_CHARS)}`;
    });
  }

  private buildPrompt(
    task: Task,
    worker: Worker,
    content: string,
    conversation: string[],
  ): string {
    const api = this.apiUrl;
    const agentLabel = task.agentId ? `机器人 #${task.agentId}` : '（未记录）';
    return [
      `你是任务需求方机器人「${worker.name}」。任务执行方在操作台发来一条消息，请以需求方身份明确答复。`,
      '',
      '# 任务',
      '',
      `- 编号：${task.code}`,
      `- 标题：${task.title}`,
      `- 状态：${task.status}-${task.subStatus}`,
      `- 执行机器人：${agentLabel}`,
      `- 任务描述：${clip(task.description, MAX_CONTEXT_CHARS)}`,
      `- 需求内容：${clip(task.content, MAX_CONTEXT_CHARS)}`,
      `- 输出要求：${clip(task.outputSpec, MAX_CONTEXT_CHARS)}`,
      `- 工作计划：${clip(task.workPlan, MAX_CONTEXT_CHARS)}`,
      `- 任务详情：GET ${api}/tasks/${task.id}.md`,
      '',
      '# 最近对话',
      '',
      ...(conversation.length > 0 ? conversation : ['（暂无历史消息）']),
      '',
      '# 最新执行方消息',
      '',
      content,
      '',
      '# 必须执行的动作',
      '',
      '```bash',
      'TOKEN=$(cat .opencode/agent-token)',
      `curl -sS -X POST '${api}/tasks/${task.id}/messages/reply.md' \\`,
      '  -H "X-Worker-Token: $TOKEN" \\',
      '  -H "Content-Type: application/json" \\',
      '  -d \'{"content":"回复内容"}\'',
      '```',
      '',
      '# 回复要求',
      '',
      '- 直接回答执行方最新消息，必要时给出补充信息或明确处理结论，不要复述本提示词。',
      '- 只回复消息，不改变任务状态，也不要代替执行方调用接受、提问或申请验收接口。',
      '- 只输出文字、不调用回复接口会被视为未处理并自动重试。',
      '',
    ].join('\n');
  }

  /**
   * 记录一次未完成并退避；达到上限后关闭事件并通知需求方机器人负责人。
   * 先 markDead 再通知，避免下一轮 LOOP 立即重复启动会话。
   */
  private async recordNotReplied(
    task: Task,
    entry: TaskWorkerInbox,
    worker: Worker | null,
    reason: string,
  ): Promise<void> {
    const count = (entry.attempts ?? 0) + 1;
    const workerLabel = worker ? `「${worker.name}」` : '';
    if (count >= TASK_INBOX_MAX_ATTEMPTS) {
      await this.workerInbox.markDead(entry.id);
      await this.tasksService.addEvent(
        task.id,
        '系统',
        `需求方机器人${workerLabel}连续 ${count} 次未能回复执行方消息，已转负责人人工处理：${reason}`,
        null,
        {
          autoReply: true,
          autoReplyFailed: true,
          attempt: count,
          workerId: worker?.id ?? task.requesterId,
          error: reason,
        },
      );
      await this.taskNotify.notifyTaskRequester(
        task,
        'notice',
        `任务消息待回复：${task.code} ${task.title}`,
        `需求方机器人${workerLabel}连续 ${count} 次未能回复执行方消息，已转负责人人工处理。`,
        { fallbackToRequesterOwner: true },
      );
      return;
    }

    const delay = nextInboxRetryDelay(entry.attempts ?? 0);
    await this.workerInbox.defer(
      entry.id,
      new Date(Date.now() + delay),
      reason,
    );
    await this.tasksService.addEvent(
      task.id,
      '系统',
      `需求方机器人${workerLabel}自动回复未完成（第 ${count} 次），将在 ${Math.round(delay / 60_000)} 分钟后重试：${reason}`,
      null,
      {
        autoReply: true,
        attempt: count,
        workerId: worker?.id ?? task.requesterId,
        error: reason,
      },
    );
  }
}
