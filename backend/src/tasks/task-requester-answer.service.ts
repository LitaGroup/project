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
import type { TaskChatQuestionInfo } from './task-chat.types';
import { nextInboxRetryDelay } from './task-loop.rules';
import { TaskRequesterSessionService } from './task-requester-session.service';
import { TaskMessage } from './task-message.entity';
import { Task } from './task.entity';
import type { TaskWorkerInbox } from './task-worker-inbox.entity';
import { TaskWorkerInboxService } from './task-worker-inbox.service';
import { TasksService } from './tasks.service';

/** 根任务/父任务不可唤醒时，需求方机器人答问一次性会话最长耗时 */
const ANSWER_TIMEOUT_MS = 180_000;
/** 提示词里任务描述的截断长度 */
const MAX_CONTEXT_CHARS = 4_000;

interface AnswerEndpoint {
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
 * 机器人需求方答问：
 * 根任务、父任务已结束或需求方不是父任务执行方时，父任务收件箱无法唤醒需求方，
 * 平台使用需求方机器人自己的执行器创建一次性会话，读取待答问题并调用
 * messages 答复接口（questions/{id}/answer.md），不改变执行方归属。
 * 会话结束仍未答复时按收件箱退避持续重试，不转移任务需求方或执行方。
 */
@Injectable()
export class TaskRequesterAnswerService {
  private readonly logger = new Logger(TaskRequesterAnswerService.name);
  /** 正在自动答问的任务 */
  private readonly activeTasks = new Set<number>();
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
    private readonly workerInbox: TaskWorkerInboxService,
    private readonly requesterSessions: TaskRequesterSessionService,
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
   * 尝试答复一条待反馈提问。
   * 返回 false 表示本次未完成（机器人不可用、同一机器人已有一次性会话在运行、
   * 会话未调用答复接口等）；事件保持开放并按退避继续重试。
   */
  async answer(task: Task, entry?: TaskWorkerInbox | null): Promise<boolean> {
    if (this.activeTasks.has(task.id)) return false;
    if (
      task.status !== TaskStatus.WAITING ||
      task.subStatus !== TaskSubStatus.PENDING_FEEDBACK
    ) {
      if (entry) await this.workerInbox.markDone(entry.id);
      return true;
    }
    if (task.requesterType !== 'worker' || !task.requesterId) {
      if (entry) await this.workerInbox.markDead(entry.id);
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
      if (entry) await this.workerInbox.markDead(entry.id);
      return false;
    }
    // 真人需求方在操作台自行处理，个人 AGENT 不承接任务协作。
    if (
      requester.runtime === WorkerRuntime.HUMAN ||
      requester.personalAgentUserId
    ) {
      if (entry) await this.workerInbox.markDone(entry.id);
      return true;
    }

    const questionRow = await this.findPendingQuestion(task.id);
    if (!questionRow?.question) {
      if (entry) await this.workerInbox.markDone(entry.id);
      return true;
    }
    const endpoint = await this.resolveEndpoint(task.requesterId);
    if (!endpoint) {
      await this.recordNotAnswered(
        task,
        entry ?? null,
        null,
        questionRow.question.id,
        '需求方机器人未启用、执行器离线或缺少可用模型',
      );
      return false;
    }
    if (!this.requesterSessions.tryAcquire(endpoint.worker.id)) return false;

    this.activeTasks.add(task.id);
    const client = new OpencodeClient(endpoint.executor);
    let sessionId: string | null = null;
    try {
      if (entry) await this.workerInbox.markEventDelivered(entry.id);
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
        title: `需求方答问 ${task.code}`.slice(0, 100),
        model: plan.model,
        fallback: plan.fallback,
        onQuotaError: plan.onQuotaError,
        location: { directory: endpoint.workdir },
        prompt: this.buildPrompt(task, endpoint.worker, questionRow),
        timeoutMs: ANSWER_TIMEOUT_MS,
        onSessionCreated: (id) => {
          sessionId = id;
        },
      });
      const [latest, latestQuestion] = await Promise.all([
        this.tasks.findOne({ where: { id: task.id } }),
        this.messages.findOne({ where: { id: questionRow.id } }),
      ]);
      if (
        !latestQuestion?.question ||
        latestQuestion.question.state !== 'pending' ||
        !latest ||
        latest.status === TaskStatus.FINISHED ||
        latest.subStatus !== TaskSubStatus.PENDING_FEEDBACK
      ) {
        // 机器人已调用答复接口（或管理员/任务流程已处理该提问）。
        if (entry) await this.workerInbox.markDone(entry.id);
        return true;
      }
      await this.recordNotAnswered(
        task,
        entry ?? null,
        endpoint.worker,
        questionRow.question.id,
        '自动答问会话已结束，但需求方未调用答复接口',
      );
      return false;
    } catch (error) {
      await this.recordNotAnswered(
        task,
        entry ?? null,
        endpoint.worker,
        questionRow.question.id,
        (error as Error).message,
      );
      return false;
    } finally {
      this.activeTasks.delete(task.id);
      this.requesterSessions.release(endpoint.worker.id);
      if (sessionId) {
        await client
          .deleteSession(sessionId)
          .catch((e: Error) =>
            this.logger.warn(
              `需求方答问会话 ${sessionId} 清理失败：${e.message}`,
            ),
          );
      }
    }
  }

  /** 最新的待答复 project 提问（规则与 LOOP 孤儿修复扫描一致）。 */
  private async findPendingQuestion(
    taskId: number,
  ): Promise<TaskMessage | null> {
    const rows = await this.messages.find({
      where: { taskId, kind: 'question' },
      order: { id: 'DESC' },
    });
    return (
      rows.find(
        (row) => row.question?.state === 'pending' && row.question.id,
      ) ?? null
    );
  }

  /** 需求方机器人必须启用、有执行器与可用模型；否则退避重试。 */
  private async resolveEndpoint(
    workerId: number,
  ): Promise<AnswerEndpoint | null> {
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

  private questionLines(questions: TaskChatQuestionInfo[]): string[] {
    const lines: string[] = [];
    questions.forEach((question, index) => {
      const options = (question.options ?? [])
        .map((option) =>
          option.description
            ? `${option.label}（${option.description}）`
            : option.label,
        )
        .join(' / ');
      lines.push(
        `${index + 1}. ${question.header || `问题 ${index + 1}`}`,
        `   - 内容：${question.question || '（见任务详情）'}`,
        `   - 选项：${options || '无'}`,
        `   - 回答方式：${question.multiple === true ? '多选' : '单选'}；${
          question.custom === false ? '仅限选项' : '允许自由输入'
        }`,
      );
    });
    return lines;
  }

  private buildPrompt(
    task: Task,
    worker: Worker,
    questionRow: TaskMessage,
  ): string {
    const api = this.apiUrl;
    const question = questionRow.question!;
    const agentLabel = task.agentId ? `机器人 #${task.agentId}` : '（未记录）';
    const answerExample = JSON.stringify({
      answers: question.questions.map(() => ['答案']),
    });
    return [
      `你是任务需求方机器人「${worker.name}」。任务执行方正在等待你的澄清答复，请立即以需求方身份明确答复。`,
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
      '# 待回答问题',
      '',
      ...this.questionLines(question.questions),
      '',
      '# 必须执行的动作',
      '',
      '```bash',
      'TOKEN=$(cat .opencode/agent-token)',
      `curl -sS -X POST '${api}/tasks/${task.id}/questions/${encodeURIComponent(
        question.id,
      )}/answer.md' \\`,
      '  -H "X-Worker-Token: $TOKEN" \\',
      '  -H "Content-Type: application/json" \\',
      `  -d '${answerExample}'`,
      '```',
      '',
      '# 答复要求',
      '',
      '- answers 外层长度必须与问题数量一致，每个问题的答案放在对应内层数组。',
      '- 不允许自由输入时必须使用给定选项 label；允许多选时可填写多个 label。',
      '- 信息不足或确实无法回答时可传 `{"reject":true}` 跳过本次提问（不算答复，但会解除阻塞）。',
      '- 只输出文字、不调用答复接口会被视为未处理并自动重试。',
      '',
    ].join('\n');
  }

  /**
   * 记录一次未完成并退避；事件保持开放并持续重试，不转人工。
   */
  private async recordNotAnswered(
    task: Task,
    entry: TaskWorkerInbox | null,
    worker: Worker | null,
    questionId: string,
    reason: string,
  ): Promise<void> {
    const attempts = (entry?.attempts ?? 0) + 1;
    const delay = nextInboxRetryDelay(entry?.attempts ?? 0);
    const workerLabel = worker ? `「${worker.name}」` : '';
    if (entry) {
      await this.workerInbox.defer(
        entry.id,
        new Date(Date.now() + delay),
        reason,
      );
    }
    await this.tasksService.addEvent(
      task.id,
      '系统',
      `需求方机器人${workerLabel}自动答问未完成，将在 ${Math.round(delay / 60_000)} 分钟后继续重试：${reason}`,
      null,
      {
        autoAnswer: true,
        autoAnswerFailed: true,
        questionId,
        attempt: attempts,
        workerId: worker?.id ?? task.requesterId,
        error: reason,
      },
    );
  }
}
