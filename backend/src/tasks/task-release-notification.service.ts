import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WorkerRole, WorkerRuntime } from '../common/enums';
import { Executor } from '../executors/executor.entity';
import { OpencodeClient } from '../executors/opencode-client';
import { runOpencodePrompt } from '../executors/opencode-run';
import { Worker } from '../workers/worker.entity';
import { agentTokenShell } from '../workers/worker-env';
import { WorkersService } from '../workers/workers.service';
import { nextInboxRetryDelay } from './task-loop.rules';
import { Task } from './task.entity';
import type { TaskWorkerInbox } from './task-worker-inbox.entity';
import { TaskWorkerInboxService } from './task-worker-inbox.service';

/** 提测通知一次性会话最长耗时 */
const RELEASE_NOTIFY_TIMEOUT_MS = 240_000;
/** 提示词里任务字段的截断长度 */
const MAX_TASK_CONTEXT_CHARS = 2_000;

interface ReleaseNotifyEndpoint {
  worker: Worker;
  executor: Executor;
  providerId: string;
  modelId: string;
  variant: string | null;
  workdir: string;
}

function clip(value: unknown, limit = MAX_TASK_CONTEXT_CHARS): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return '—';
  return text.length <= limit ? text : `${text.slice(0, limit)}\n…（已截断）`;
}

function payloadText(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

/** 提测事件发给机器人的提示词；导出便于单测断言关键上下文。 */
export function releaseNotificationPrompt(
  entry: TaskWorkerInbox,
  worker: Worker,
  task: Task | null,
  apiUrl = '/api',
): string {
  const api = apiUrl.replace(/\/+$/, '');
  const payload = entry.payload ?? {};
  const releaseId = Number(payload.releaseId ?? 0);
  const projectId = Number(payload.projectId ?? 0);
  const projectName = payloadText(payload, 'projectName') || `#${projectId}`;
  const fromStatus = payloadText(payload, 'fromStatus') || '未知';
  const toStatus = payloadText(payload, 'toStatus') || '未知';
  const verifier = payloadText(payload, 'verifier');
  const testers = Array.isArray(payload.testers)
    ? payload.testers.filter((item): item is string => typeof item === 'string')
    : [];
  const sourceTaskId = Number(payload.sourceTaskId ?? task?.id ?? 0);

  const nextStep =
    toStatus === '未通过'
      ? [
          '- 重点读取该提测关联的缺陷清单，确认失败原因；可修复项安排修复，修复后重新提测。',
          '- 创建后续任务前先确认是否已有进行中的修复任务，避免重复派单。',
        ]
      : toStatus === '已通过'
        ? [
            '- 提测已通过，不要重复提测；结合来源任务与项目现状判断是否还需要交付收尾或发布准备。',
            '- 如无待处理事项，给出简要结论即可。',
          ]
        : ['- 测试仍在推进，无需紧急动作；可按需准备可能的修复或发布事项。'];

  return [
    `你是提测机器人「${worker.name}」。项目提测状态发生变化，请阅读事件并决定下一步。`,
    '',
    '# 提测事件',
    '',
    `- 项目：${projectName}（#${projectId}）`,
    `- 提测记录：#${releaseId}`,
    `- 状态变化：${fromStatus} → ${toStatus}`,
    `- 判定人：${verifier || '—'}`,
    `- 测试人员：${testers.length > 0 ? testers.join('、') : '—'}`,
    `- 事件收件箱 ID：${entry.id}`,
    '',
    '# 建议阅读',
    '',
    `- 项目详情：GET ${api}/projects/${projectId}.md`,
    `- 提测记录：GET ${api}/releases.md?projectId=${projectId}`,
    releaseId
      ? `- 关联缺陷：GET ${api}/defects.md?projectId=${projectId}&releaseId=${releaseId}`
      : null,
    sourceTaskId ? `- 来源任务：GET ${api}/tasks/${sourceTaskId}.md` : null,
    '',
    '# 来源任务',
    '',
    task
      ? [
          `- 编号：${task.code}`,
          `- 标题：${task.title}`,
          `- 状态：${task.status}-${task.subStatus}`,
          `- 任务描述：${clip(task.description)}`,
          `- 需求内容：${clip(task.content)}`,
          `- 输出要求：${clip(task.outputSpec)}`,
          `- 工作计划：${clip(task.workPlan)}`,
        ].join('\n')
      : '（机器人提测时没有关联执行中的任务）',
    '',
    '# 处理要求',
    '',
    ...nextStep,
    '- 先读取必要信息再决策，不要臆测状态；同一事项已有进行中任务/缺陷时不要重复创建。',
    '- 本事件是通知型事件，没有固定回执接口；会话正常结束后平台会视为已送达。',
    '- 只输出文字结论、不调用平台接口也可以；需要推进事项时再使用项目/任务/缺陷接口。',
    '',
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

/**
 * 提测状态变化通知：
 * ReleasesService 把 release 事件写入机器人收件箱，LOOP 在这里消费。
 * 事件不改变原任务状态；不占用任务的执行容量，收到事件即用其执行器创建一次性会话
 * （进程内按机器人防重入）。
 * 会话正常结束即视为送达并关闭事件；失败按收件箱退避持续重试，不转移任务身份。
 */
@Injectable()
export class TaskReleaseNotificationService {
  private readonly logger = new Logger(TaskReleaseNotificationService.name);
  /** 正在被一次性提测通知占用的机器人 */
  private readonly activeWorkers = new Set<number>();
  private readonly apiUrl: string;

  constructor(
    @InjectRepository(Task)
    private readonly tasks: Repository<Task>,
    @InjectRepository(Executor)
    private readonly executors: Repository<Executor>,
    @InjectRepository(Worker)
    private readonly workers: Repository<Worker>,
    private readonly workersService: WorkersService,
    private readonly workerInbox: TaskWorkerInboxService,
    config: ConfigService,
  ) {
    this.apiUrl = (
      config.get<string>('API_URL') ?? 'http://localhost:3100/api'
    ).replace(/\/+$/, '');
  }

  async handle(entry: TaskWorkerInbox): Promise<void> {
    if (entry.kind !== 'release') {
      await this.workerInbox.markDead(entry.id);
      return;
    }
    if (this.activeWorkers.has(entry.workerId)) return;
    const worker = await this.workers.findOne({
      where: { id: entry.workerId },
    });
    // 真人/个人 AGENT 不是自动任务机器人，通知事件直接关闭；
    // 普通机器人停用时不再重试，避免状态变化反复触发无效会话。
    if (
      !worker ||
      !worker.enabled ||
      worker.role !== WorkerRole.WORKER ||
      worker.personalAgentUserId ||
      worker.runtime === WorkerRuntime.HUMAN
    ) {
      await this.workerInbox.markDone(entry.id);
      return;
    }
    const endpoint = await this.resolveEndpoint(worker);
    if (!endpoint) {
      await this.recordFailure(entry, worker, '机器人执行器离线或缺少可用模型');
      return;
    }

    const task = await this.loadSourceTask(entry);
    this.activeWorkers.add(entry.workerId);
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
      await runOpencodePrompt(client, {
        title: `提测状态通知 ${projectLabel(entry)}`.slice(0, 100),
        model: {
          id: endpoint.modelId,
          providerID: endpoint.providerId,
          ...(endpoint.variant ? { variant: endpoint.variant } : {}),
        },
        location: { directory: endpoint.workdir },
        prompt: releaseNotificationPrompt(
          entry,
          endpoint.worker,
          task,
          this.apiUrl,
        ),
        timeoutMs: RELEASE_NOTIFY_TIMEOUT_MS,
        onSessionCreated: (id) => {
          sessionId = id;
        },
      });
      // 通知型事件没有固定回执接口，机器人已获得完整上下文即可关闭。
      await this.workerInbox.markDone(entry.id);
    } catch (error) {
      await this.recordFailure(entry, worker, (error as Error).message);
    } finally {
      this.activeWorkers.delete(entry.workerId);
      if (sessionId) {
        await client
          .deleteSession(sessionId)
          .catch((e: Error) =>
            this.logger.warn(
              `提测通知会话 ${sessionId} 清理失败：${e.message}`,
            ),
          );
      }
    }
  }

  private async loadSourceTask(entry: TaskWorkerInbox): Promise<Task | null> {
    const taskId = Number(entry.childTaskId ?? 0);
    if (!Number.isInteger(taskId) || taskId <= 0) return null;
    return this.tasks.findOne({
      where: { id: taskId },
      select: {
        id: true,
        code: true,
        title: true,
        status: true,
        subStatus: true,
        description: true,
        content: true,
        outputSpec: true,
        workPlan: true,
      },
    });
  }

  /** 机器人必须启用、有执行器与可用模型；否则按失败退避。 */
  private async resolveEndpoint(
    worker: Worker,
  ): Promise<ReleaseNotifyEndpoint | null> {
    if (worker.runtime !== WorkerRuntime.OPENCODE || !worker.executorId) {
      return null;
    }
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

  /** 记录一次失败并退避；事件保持开放并持续重试，不转移任务身份。 */
  private async recordFailure(
    entry: TaskWorkerInbox,
    worker: Worker,
    reason: string,
  ): Promise<void> {
    this.logger.warn(`提测通知 #${entry.id} 处理失败：${reason}`);
    await this.workerInbox.defer(
      entry.id,
      new Date(Date.now() + nextInboxRetryDelay(entry.attempts ?? 0)),
      reason,
    );
    if (worker.ownerName) {
      this.logger.warn(
        `提测通知 #${entry.id} 将继续重试（机器人负责人：${worker.ownerName}）`,
      );
    }
  }
}

function projectLabel(entry: TaskWorkerInbox): string {
  const payload = entry.payload ?? {};
  const projectId = Number(payload.projectId ?? 0);
  return payloadText(payload, 'projectName') || `#${projectId}`;
}
