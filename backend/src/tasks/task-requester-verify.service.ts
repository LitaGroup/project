import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  TaskStatus,
  TaskSubStatus,
  WorkerRole,
  WorkerRuntime,
} from '../common/enums';
import { Executor } from '../executors/executor.entity';
import { OpencodeClient } from '../executors/opencode-client';
import { runOpencodePrompt, planPromptModels } from '../executors/opencode-run';
import { Worker } from '../workers/worker.entity';
import { agentTokenShell } from '../workers/worker-env';
import { WorkersService } from '../workers/workers.service';
import { Task } from './task.entity';
import { TasksService } from './tasks.service';

/** 需求方机器人自动验收：单次会话最长耗时 */
const VERIFY_TIMEOUT_MS = 180_000;
/** 提示词里任务描述的截断长度 */
const MAX_CONTEXT_CHARS = 4_000;

interface VerifyEndpoint {
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

/**
 * 根任务机器人需求方自动验收：
 * 根任务没有父任务收件箱可唤醒，平台使用需求方机器人自己的执行器创建一次性会话，
 * 读取交付文档并调用验收接口（通过 / 返工 / 失败）。
 * 会话结束仍未推进验收时持续重试，不转移任务需求方或执行方。
 * 子任务仍由父任务收件箱唤醒其执行机器人，不走本服务。
 */
@Injectable()
export class TaskRequesterVerifyService {
  private readonly logger = new Logger(TaskRequesterVerifyService.name);
  /** 正在自动验收的任务 */
  private readonly activeTasks = new Set<number>();
  /** 正在被自动验收占用的需求方机器人（同一机器人同一时刻只运行一个一次性会话） */
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
    private readonly tasksService: TasksService,
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
   * 尝试一次自动验收。
   * 返回 false 表示未发起（状态不满足、需求方不可用、同一机器人已有一次性会话在运行等）。
   */
  async verify(task: Task): Promise<boolean> {
    if (this.activeTasks.has(task.id)) return false;
    if (task.parentId) return false;
    if (
      task.status !== TaskStatus.WAITING ||
      task.subStatus !== TaskSubStatus.PENDING_ACCEPT
    ) {
      return false;
    }
    if (task.requesterType !== 'worker' || !task.requesterId) return false;
    const endpoint = await this.resolveEndpoint(task.requesterId);
    if (!endpoint) return false;
    if (this.activeWorkers.has(endpoint.worker.id)) return false;

    this.activeTasks.add(task.id);
    this.activeWorkers.add(endpoint.worker.id);
    const client = new OpencodeClient(endpoint.executor);
    let sessionId: string | null = null;
    try {
      const token = await this.workersService.ensureWorkToken(
        endpoint.worker.id,
      );
      await client.shell(
        `mkdir -p '${endpoint.workdir}' '${endpoint.workdir}/.opencode' && ` +
          agentTokenShell(endpoint.workdir, token),
      );
      const plan = planPromptModels(endpoint.worker, endpoint.executor.id, {
        providerId: endpoint.providerId,
        modelId: endpoint.modelId,
        variant: endpoint.variant,
      });
      await runOpencodePrompt(client, {
        title: `需求方验收 ${task.code}`.slice(0, 100),
        model: plan.model,
        fallback: plan.fallback,
        onQuotaError: plan.onQuotaError,
        location: { directory: endpoint.workdir },
        prompt: this.buildPrompt(task, endpoint.worker),
        timeoutMs: VERIFY_TIMEOUT_MS,
        onSessionCreated: (id) => {
          sessionId = id;
        },
      });
      const latest = await this.tasks.findOne({ where: { id: task.id } });
      if (
        !latest ||
        latest.status !== TaskStatus.WAITING ||
        latest.subStatus !== TaskSubStatus.PENDING_ACCEPT
      ) {
        // 机器人已通过动作接口推进任务（通过/返工/失败）。
        return true;
      }
      await this.recordNotAdvanced(task, endpoint.worker);
      return false;
    } catch (error) {
      await this.recordFailure(task, endpoint.worker, error as Error);
      return false;
    } finally {
      this.activeTasks.delete(task.id);
      this.activeWorkers.delete(endpoint.worker.id);
      if (sessionId) {
        await client
          .deleteSession(sessionId)
          .catch((e: Error) =>
            this.logger.warn(
              `需求方验收会话 ${sessionId} 清理失败：${e.message}`,
            ),
          );
      }
    }
  }

  /** 需求方机器人必须启用、有执行器与可用模型；否则本轮跳过并等待下次重试。 */
  private async resolveEndpoint(
    workerId: number,
  ): Promise<VerifyEndpoint | null> {
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

  private buildPrompt(task: Task, worker: Worker): string {
    const api = this.apiUrl;
    const handoffUrl = `${api}/tasks/${task.id}/handoff.md`;
    const agentLabel = task.agentId ? `机器人 #${task.agentId}` : '（未记录）';
    return [
      `你是任务需求方机器人「${worker.name}」。任务执行方已提交验收，请立即核验交付物并给出明确结论。`,
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
      `- 交付文档路径：${task.handoffPath ?? '（未记录）'}`,
      '',
      '# 交付文档',
      '',
      `先读取交付文档再判断：GET ${handoffUrl}`,
      '',
      '# 必须执行的动作（三选一，必须实际调用接口）',
      '',
      '```bash',
      'TOKEN=$(cat .opencode/agent-token)',
      '',
      '# 1) 验收通过',
      `curl -sS -X POST '${api}/tasks/${task.id}/handoff/accept.md' \\`,
      '  -H "X-Worker-Token: $TOKEN" -H "Content-Type: application/json" -d \'{}\'',
      '',
      '# 2) 返工（content 必填，写明缺失项）',
      `curl -sS -X POST '${api}/tasks/${task.id}/handoff/refuse.md' \\`,
      '  -H "X-Worker-Token: $TOKEN" -H "Content-Type: application/json" \\',
      `  -d '{"content":"具体返工原因"}'`,
      '',
      '# 3) 判定失败（reason 必填）',
      `curl -sS -X POST '${api}/tasks/${task.id}/fail.md' \\`,
      '  -H "X-Worker-Token: $TOKEN" -H "Content-Type: application/json" \\',
      `  -d '{"reason":"失败原因"}'`,
      '```',
      '',
      '# 判定要求',
      '',
      '- 必须先读取交付文档，对照「输出要求」逐项核对，不要臆测未提供的内容。',
      '- 满足要求 → 调用验收通过；可修复的缺失 → 返工并写明缺失项；无法交付 → 判定失败。',
      '- 只能通过上述接口推进任务；只输出文字结论、不调用接口会被视为未处理并自动重试。',
      '',
    ].join('\n');
  }

  private async recordNotAdvanced(task: Task, worker: Worker): Promise<void> {
    await this.tasksService.addEvent(
      task.id,
      '系统',
      `需求方机器人「${worker.name}」自动验收未完成，交付仍等待验收，将继续重试`,
      null,
      { autoVerify: true, workerId: worker.id },
    );
  }

  private async recordFailure(
    task: Task,
    worker: Worker,
    error: Error,
  ): Promise<void> {
    this.logger.warn(
      `任务 ${task.code} 需求方机器人「${worker.name}」自动验收失败：${error.message}`,
    );
    await this.tasksService.addEvent(
      task.id,
      '系统',
      `需求方机器人「${worker.name}」自动验收失败，将继续重试：${error.message}`,
      null,
      {
        autoVerify: true,
        autoVerifyFailed: true,
        workerId: worker.id,
        error: error.message,
      },
    );
  }
}
