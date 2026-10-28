import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleInit,
} from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter } from 'events';
import { Observable } from 'rxjs';
import { Repository } from 'typeorm';
import {
  TaskStatus,
  TaskSubStatus,
  WorkerRole,
  WorkerRuntime,
} from '../common/enums';
import { Executor } from '../executors/executor.entity';
import {
  OpencodeClient,
  OpencodeClientError,
  formEventToQuestionEvent,
  isFreshOutcome,
  type OpencodeQuestionRequest,
} from '../executors/opencode-client';
import {
  OpencodeEvent,
  OpencodeEventHub,
} from '../executors/opencode-event-hub.service';
import { Worker } from '../workers/worker.entity';
import { WorkersService } from '../workers/workers.service';
import { Task } from './task.entity';
import { TaskEvent } from './task-event.entity';
import { TaskTemplate } from './task-template.entity';
import { TaskChatService } from './task-chat.service';
import { TaskDocumentService } from './task-document.service';
import type { TaskDocumentResult } from './task-document.service';
import { TaskNotifyService } from './task-notify.service';
import { TaskRealtimeService } from './task-realtime.service';

export interface TaskAcceptanceApplication {
  task: Task;
  handoff: TaskDocumentResult;
}

/** 终态快照预留：实时输出缓冲在进程内保留（P1 不做 TTL 清理，重启后由任务历史承担） */

/** 任务会话绑定保留期：7 天不活跃后解除（执行中任务不清理） */
const TASK_SESSION_TTL_MS = 7 * 24 * 60 * 60_000;

/** 每个任务的实时输出缓冲（行数组 + 变更事件） */
interface LiveTaskStream {
  lines: string[];
  emitter: EventEmitter;
}

/**
 * 任务派发执行引擎：机器人（runtime=opencode）在执行器上干活。
 * 链路：mkdir 工位 → 复用/建 opencode 会话（一个任务固定一个会话）→ 发任务输入/输出要求
 * → 订阅执行器事件流（按 sessionId 路由）→ 终态（execution.completed）取最终回复 → 「待验收」+ 通知责任人。
 * 机器人定义与技能由工位 AGENTS.md / .opencode/skills 提供，不在任务 prompt 中重复注入。
 */
@Injectable()
export class TaskDispatchService
  implements OnModuleInit, OnApplicationBootstrap
{
  private readonly logger = new Logger(TaskDispatchService.name);
  private readonly apiUrl: string;

  constructor(
    @InjectRepository(Task)
    private readonly tasks: Repository<Task>,
    @InjectRepository(TaskEvent)
    private readonly events: Repository<TaskEvent>,
    @InjectRepository(Executor)
    private readonly executors: Repository<Executor>,
    @InjectRepository(Worker)
    private readonly workers: Repository<Worker>,
    @InjectRepository(TaskTemplate)
    private readonly taskTemplates: Repository<TaskTemplate>,
    private readonly workersService: WorkersService,
    private readonly eventHub: OpencodeEventHub,
    private readonly taskNotify: TaskNotifyService,
    private readonly taskRealtime: TaskRealtimeService,
    private readonly taskChat: TaskChatService,
    private readonly taskDocuments: TaskDocumentService,
    config: ConfigService,
  ) {
    this.apiUrl = (
      config.get<string>('API_URL') ?? 'http://localhost:3100/api'
    ).replace(/\/+$/, '');
  }

  /** opencodeSessionId → taskId 路由缓存（未命中回库查） */
  private readonly sessionRoutes = new Map<string, number>();

  /** taskId → 实时输出缓冲 */
  private readonly live = new Map<number, LiveTaskStream>();

  /** taskId → 会话文本增量累积（按 assistantMessageID 分组；完成后作为 result 来源） */
  private readonly textBuffers = new Map<number, Map<string, string>>();

  /** 已提醒过权限请求的任务（避免重复通知） */
  private readonly permissionNotified = new Set<number>();

  /** 已提醒过的提问（taskId:requestId，避免同一提问重复通知） */
  private readonly questionNotified = new Set<string>();

  /** taskId → 上次提问对账时间（页面快照触发时按任务节流） */
  private readonly questionSyncedAt = new Map<number, number>();

  /** 派发中的任务（对账时避免释放刚占用的连接） */
  private readonly dispatching = new Set<number>();

  /** 会话已完成但机器人尚未调用验收申请的任务（对账只补一次产出） */
  private readonly finishedAwaitingApply = new Set<number>();

  /** taskId → 已占用事件流连接的执行器 id（retain/release 配对） */
  private readonly hubRetained = new Map<number, number>();

  /** 启动时先对账一次：恢复执行中任务的事件流订阅并补推进漏收终态 */
  async onApplicationBootstrap(): Promise<void> {
    await this.reconcileExecuting().catch((error: Error) => {
      this.logger.warn(`启动对账失败: ${error.message}`);
    });
  }

  onModuleInit(): void {
    this.eventHub.onEvent((event) => {
      void this.handleEvent(event).catch((e: Error) => {
        this.logger.warn(
          `处理执行器事件失败（${event.type || event.id}）: ${e.message}`,
        );
      });
    });
  }

  /**
   * 派发：平台识别分配完成的「进行中-识别中」任务，或执行中的重新派发。
   * 链路：建工位 → 复用/建会话（一个任务固定一个会话）→ 发 prompt；
   * 成功后任务进入「进行中-执行中」。
   */
  async dispatch(
    taskId: number,
    operator: string | null,
    userMessage?: string,
  ): Promise<Task> {
    const task = await this.mustFind(taskId);
    const continuing = Boolean(userMessage?.trim());
    const canContinue =
      continuing &&
      task.status === TaskStatus.WAITING &&
      task.subStatus === TaskSubStatus.PENDING_ACCEPT;
    if (
      !canContinue &&
      (task.status !== TaskStatus.RUNNING ||
        ![TaskSubStatus.IDENTIFYING, TaskSubStatus.EXECUTING].includes(
          task.subStatus,
        ))
    ) {
      throw new NotFoundException(
        `任务 ${task.code} 当前状态「${task.status}-${task.subStatus}」不可派发`,
      );
    }
    const fromLabel = `${task.status}-${task.subStatus}`;
    const wasExecuting = task.subStatus === TaskSubStatus.EXECUTING;
    if (!task.agentId)
      throw new NotFoundException(`任务 ${task.code} 未分配机器人`);
    const worker = await this.workers.findOne({ where: { id: task.agentId } });
    if (!worker || !worker.enabled) {
      throw new NotFoundException(`机器人 #${task.agentId} 不存在或已停用`);
    }
    if (worker.runtime !== WorkerRuntime.OPENCODE) {
      throw new NotFoundException('仅支持 runtime=opencode 的机器人派发');
    }
    if (!worker.executorId || !worker.providerId || !worker.modelId) {
      throw new NotFoundException('机器人未配置完整（执行器/供应商/模型）');
    }
    const executor = await this.executors.findOne({
      where: { id: worker.executorId },
    });
    if (!executor || !executor.online) {
      throw new NotFoundException(`执行器 #${worker.executorId} 离线或不存在`);
    }
    const workdir = this.workersService.workdirOf(worker.id);
    if (!workdir) {
      throw new NotFoundException('未配置 WORKER_BASE_DIR，无法确定工位目录');
    }
    // 机器人独立令牌只在工位文件与数据库中出现，不进入任务 Prompt/聊天/日志
    const workerToken = await this.workersService.ensureAgentToken(worker.id);
    const client = new OpencodeClient(executor);
    this.dispatching.add(task.id);
    try {
      // 1. 工位目录与机器人令牌（幂等；路径单引号包裹防注入）
      await client.shell(
        `mkdir -p '${workdir}' '${workdir}/.opencode' && ` +
          `printf '%s' '${workerToken}' > '${workdir}/.opencode/agent-token' && ` +
          `chmod 600 '${workdir}/.opencode/agent-token'`,
      );

      // 2. 固定绑定：一个任务只对应一个 opencode 会话。
      //    同一执行器上复用既有会话；执行器变更或会话已不存在时才新建。
      const previousExecutorId = task.executorId;
      const previousSessionId = task.opencodeSessionId;
      let sessionId =
        previousSessionId && previousExecutorId === executor.id
          ? previousSessionId
          : null;
      if (sessionId) {
        try {
          await client.session(sessionId);
        } catch (error) {
          if (!(error instanceof OpencodeClientError) || error.status !== 404) {
            throw error;
          }
          this.logger.warn(
            `任务 ${task.code} 的会话 ${sessionId} 已不存在，重新创建`,
          );
          sessionId = null;
        }
      }
      const reused = Boolean(sessionId);
      if (!sessionId) {
        // 执行器变更：旧会话在新执行器上不可达，尽力在旧执行器上中断，避免继续空跑
        if (
          previousSessionId &&
          previousExecutorId &&
          previousExecutorId !== executor.id
        ) {
          const oldExecutor = await this.executors.findOne({
            where: { id: previousExecutorId },
          });
          if (oldExecutor) {
            await new OpencodeClient(oldExecutor)
              .interrupt(previousSessionId)
              .catch((e: Error) =>
                this.logger.warn(
                  `旧执行器会话 ${previousSessionId} 中断失败: ${e.message}`,
                ),
              );
          }
        }
        const created = await client.createSession({
          title: `${task.code} ${task.title}`,
          model: { id: worker.modelId, providerID: worker.providerId },
          location: { directory: workdir },
        });
        sessionId = created.id;
        task.executorId = executor.id;
        task.opencodeSessionId = sessionId;
        await this.tasks.save(task);
        // 执行器/会话发生更换时清掉旧路由，避免旧会话事件误投到本任务
        if (previousExecutorId && previousSessionId) {
          this.sessionRoutes.delete(
            `${previousExecutorId}:${previousSessionId}`,
          );
        }
      } else if (wasExecuting) {
        // 同一会话内重新派发：先中断仍在跑的本轮
        await client
          .interrupt(sessionId)
          .catch((e: Error) =>
            this.logger.warn(`会话 ${sessionId} 中断失败: ${e.message}`),
          );
      }

      // 3. 占用执行器事件流（有执行中的任务才保持连接；结束/中断后释放）
      this.retainTask(task.id, executor);

      // 4. 新一轮清空输出缓冲与去重标记（结果只取本轮文本）
      this.textBuffers.delete(task.id);
      this.finishedAwaitingApply.delete(task.id);
      this.failedReconciled.delete(task.id);
      this.permissionNotified.delete(task.id);
      this.questionSyncedAt.delete(task.id);
      for (const key of this.questionNotified) {
        if (key.startsWith(`${task.id}:`)) this.questionNotified.delete(key);
      }

      const bindLabel = reused ? '复用会话' : '新建会话';
      await this.addEvent(
        task.id,
        '操作',
        continuing
          ? `继续对话（机器人：${worker.name}，${bindLabel}：${sessionId}）`
          : `派发给「${worker.name}」（执行器：${executor.name}，${bindLabel}：${sessionId}）`,
        operator,
        { executorId: executor.id, sessionId, reused, continued: continuing },
      );
      this.sessionRoutes.set(`${executor.id}:${sessionId}`, task.id);
      this.pushLine(
        task.id,
        continuing
          ? `▶ 已继续对话（${bindLabel} ${sessionId}）`
          : `▶ 已派发给 ${worker.name}（${bindLabel} ${sessionId}）`,
      );

      // 5. 发任务指令（角色定义与技能已由工位文件提供；历史上下文由会话自身维持）
      const prompt = await this.buildPrompt(task);
      const text = continuing
        ? reused
          ? userMessage!.trim()
          : `${prompt}\n\n# 用户消息\n\n${userMessage!.trim()}`
        : prompt;
      await client.prompt(sessionId, { text });
      this.pushLine(task.id, '▶ 任务指令已下发');

      // 6. 执行中
      task.status = TaskStatus.RUNNING;
      task.subStatus = TaskSubStatus.EXECUTING;
      const saved = await this.tasks.save(task);
      if (!wasExecuting) {
        await this.addEvent(
          task.id,
          '状态变更',
          continuing
            ? `状态变更：${fromLabel} → 进行中-执行中（继续对话）`
            : '状态变更：进行中-识别中 → 进行中-执行中',
          null,
        );
      }
      return saved;
    } catch (error) {
      this.releaseTask(task.id);
      throw error;
    } finally {
      this.dispatching.delete(task.id);
    }
  }

  /**
   * 在已有任务会话中继续多轮对话。待验收任务会重新进入执行中，
   * 会话缺失/更换执行器时由 dispatch 新建会话并携带任务上下文。
   */
  async continueConversation(
    taskId: number,
    content: string,
    operator: string | null,
  ): Promise<Task> {
    const task = await this.mustFind(taskId);
    if (task.status === TaskStatus.FINISHED) {
      throw new BadRequestException(`任务 ${task.code} 已结束，不能继续对话`);
    }
    // 识别阶段的消息走补充需求重新识别；待验收任务允许继续对话并重新派发
    const needsIdentify =
      (task.status === TaskStatus.WAITING &&
        task.subStatus !== TaskSubStatus.PENDING_ACCEPT) ||
      (task.status === TaskStatus.RUNNING &&
        task.subStatus === TaskSubStatus.IDENTIFYING);
    if (needsIdentify) {
      throw new BadRequestException('当前任务应先补充需求并重新识别');
    }
    if (this.taskChat.isRunning(taskId)) {
      throw new BadRequestException('机器人正在回复，请稍后再发送');
    }
    if (!task.agentId) {
      throw new BadRequestException('任务尚未分配机器人，请先分配');
    }
    const text = content.trim();
    if (!text) throw new BadRequestException('消息内容不能为空');
    await this.taskChat.archiveResult(taskId);
    await this.addEvent(taskId, '反馈', text, operator, {
      intervention: true,
      chat: true,
    });
    return this.dispatch(taskId, operator, text);
  }

  /**
   * 人工分配机器人：识别/待反馈阶段仅更新分配；执行中先中断旧会话，
   * 待验收则直接换机器人重新执行，旧会话事件不会再命中新绑定。
   */
  async assign(
    taskId: number,
    agentId: number,
    operator: string | null,
  ): Promise<Task> {
    if (!Number.isInteger(agentId) || agentId < 1) {
      throw new BadRequestException('机器人 ID 必须为正整数');
    }
    const task = await this.mustFind(taskId);
    if (task.status === TaskStatus.FINISHED) {
      throw new BadRequestException(`任务 ${task.code} 已结束，不能分配`);
    }
    const worker = await this.workers.findOne({ where: { id: agentId } });
    if (!worker) throw new BadRequestException('机器人不存在');
    if (!worker.enabled) throw new BadRequestException('机器人已停用');
    if (worker.role === WorkerRole.SCHEDULER) {
      throw new BadRequestException('调度机器人不承接任务，请分配给工作者');
    }
    if (task.agentId === agentId) return task;

    const oldAgent = task.agentId
      ? await this.workers.findOne({ where: { id: task.agentId } })
      : null;
    const shouldRerun =
      (task.status === TaskStatus.RUNNING &&
        task.subStatus === TaskSubStatus.EXECUTING) ||
      (task.status === TaskStatus.WAITING &&
        task.subStatus === TaskSubStatus.PENDING_ACCEPT);
    const previousExecutorId = task.executorId;
    const previousSessionId = task.opencodeSessionId;
    if (shouldRerun) await this.taskChat.archiveResult(taskId);

    if (
      task.status === TaskStatus.RUNNING &&
      task.subStatus === TaskSubStatus.EXECUTING
    ) {
      await this.interrupt(taskId, operator, false);
    }
    if (shouldRerun) {
      if (previousExecutorId && previousSessionId) {
        this.sessionRoutes.delete(`${previousExecutorId}:${previousSessionId}`);
      }
      this.releaseTask(taskId);
      task.executorId = null;
      task.opencodeSessionId = null;
      task.status = TaskStatus.RUNNING;
      task.subStatus = TaskSubStatus.EXECUTING;
    }
    task.agentId = agentId;
    const saved = await this.tasks.save(task);
    await this.addEvent(
      taskId,
      '分配',
      `分配：${oldAgent?.name ?? '未分配'} → ${worker.name}${shouldRerun ? '（重新执行）' : ''}`,
      operator,
      {
        intervention: true,
        fromAgentId: oldAgent?.id ?? null,
        toAgentId: worker.id,
        rerun: shouldRerun,
      },
    );
    if (shouldRerun) return this.dispatch(taskId, operator);
    return saved;
  }

  /** 中断执行（会话 interrupt + 事件；任务保持执行中，可重新派发或取消） */
  async interrupt(
    taskId: number,
    operator: string | null,
    intervention = true,
  ): Promise<Task> {
    const task = await this.mustFind(taskId);
    if (
      task.status !== TaskStatus.RUNNING ||
      task.subStatus !== TaskSubStatus.EXECUTING
    ) {
      throw new NotFoundException(
        `任务 ${task.code} 当前状态「${task.status}-${task.subStatus}」不在执行中`,
      );
    }
    if (task.opencodeSessionId && task.executorId) {
      const executor = await this.executors.findOne({
        where: { id: task.executorId },
      });
      if (executor) {
        await new OpencodeClient(executor)
          .interrupt(task.opencodeSessionId)
          .catch((e: Error) =>
            this.logger.warn(
              `会话 ${task.opencodeSessionId} 中断失败: ${e.message}`,
            ),
          );
      }
    }
    this.pushLine(taskId, '■ 已人工中断');
    await this.addEvent(taskId, '操作', '人工中断执行', operator, {
      intervention,
    });
    await this.taskChat.finishTask(taskId);
    this.releaseTask(taskId);
    return this.mustFind(taskId);
  }

  /**
   * 验收后销毁原任务会话并解除平台绑定。
   * 尽力而为：执行器离线/删除失败只告警，不影响验收结果；总结报告使用独立会话。
   */
  async destroyAcceptedSession(taskId: number): Promise<void> {
    const task = await this.tasks.findOne({
      where: { id: taskId },
      select: {
        id: true,
        code: true,
        status: true,
        subStatus: true,
        executorId: true,
        opencodeSessionId: true,
      },
    });
    if (
      !task?.opencodeSessionId ||
      task.status !== TaskStatus.FINISHED ||
      task.subStatus !== TaskSubStatus.COMPLETED
    ) {
      return;
    }
    const sessionId = task.opencodeSessionId;
    const executorId = task.executorId;
    if (executorId) {
      this.sessionRoutes.delete(`${executorId}:${sessionId}`);
    }
    this.releaseTask(taskId);

    let destroyed = false;
    let failure = '';
    try {
      const executor = executorId
        ? await this.executors.findOne({ where: { id: executorId } })
        : null;
      if (!executor) {
        failure = '执行器不存在';
      } else {
        await new OpencodeClient(executor).deleteSession(sessionId);
        destroyed = true;
      }
    } catch (error) {
      if (error instanceof OpencodeClientError && error.status === 404) {
        // 执行器侧已不存在，视为销毁完成
        destroyed = true;
      } else {
        failure = error instanceof Error ? error.message : String(error);
      }
    }

    try {
      await this.tasks.update(taskId, { opencodeSessionId: null });
      await this.addEvent(
        taskId,
        '系统',
        destroyed
          ? `已销毁执行器会话（${sessionId}）`
          : `销毁执行器会话失败，已解除平台绑定（${sessionId}）：${failure || '未知错误'}`,
        null,
        {
          executorId,
          sessionId,
          sessionDestroyed: destroyed,
        },
      );
    } catch (error) {
      this.logger.warn(
        `任务 ${task.code} 会话销毁后清理失败：${(error as Error).message}`,
      );
    }
    if (!destroyed) {
      this.logger.warn(
        `任务 ${task.code} 执行器会话 ${sessionId} 销毁失败：${failure || '未知错误'}`,
      );
    }
  }

  /**
   * 回答/跳过机器人提问：转发到 opencode question 接口，
   * 本地卡片同步为回执（事件到达时会再次幂等校准）。
   */
  async replyQuestion(
    taskId: number,
    questionId: string,
    input: { answers?: unknown; reject?: boolean },
    operator: string | null,
  ): Promise<{ ok: true }> {
    const task = await this.mustFind(taskId);
    const question = this.taskChat.findQuestion(taskId, questionId);
    if (!question || question.state !== 'pending') {
      throw new NotFoundException(`提问 ${questionId} 不存在或已处理`);
    }
    if (!task.executorId || !task.opencodeSessionId) {
      throw new NotFoundException('任务没有可用的执行器会话');
    }
    const executor = await this.executors.findOne({
      where: { id: task.executorId },
    });
    if (!executor) throw new NotFoundException('执行器不存在');
    const client = new OpencodeClient(executor);
    // 提问可能来自 opencode 子会话（task 工具），优先用提问自带的会话
    const sessionId = question.sessionId || task.opencodeSessionId;

    if (input.reject) {
      try {
        await client.rejectQuestion(sessionId, questionId);
      } catch (e) {
        throw this.questionSubmitError(e);
      }
      this.taskChat.questionSettled(taskId, questionId, 'rejected');
      this.questionNotified.delete(`${taskId}:${questionId}`);
      this.pushLine(taskId, '❓ 已跳过提问');
      await this.addEvent(taskId, '操作', '跳过机器人提问', operator, {
        questionId,
        intervention: true,
      });
      return { ok: true };
    }

    const answers = this.normalizeAnswers(input.answers);
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
      await client.replyQuestion(
        sessionId,
        questionId,
        answers,
        question.questions,
      );
    } catch (e) {
      throw this.questionSubmitError(e);
    }
    this.taskChat.questionSettled(taskId, questionId, 'answered', answers);
    this.questionNotified.delete(`${taskId}:${questionId}`);
    this.pushLine(
      taskId,
      `❓ 已回答提问：${question.questions
        .map(
          (item, index) =>
            `${item.header || item.question} → ${
              answers[index].join(' / ') || '（空）'
            }`,
        )
        .join('；')}`,
    );
    await this.addEvent(taskId, '操作', '回答机器人提问', operator, {
      questionId,
      answers,
      intervention: true,
    });
    return { ok: true };
  }

  private questionSubmitError(error: unknown): Error {
    if (error instanceof OpencodeClientError) {
      return new BadRequestException(`提问提交失败：${error.message}`);
    }
    return error instanceof Error ? error : new Error(String(error));
  }

  private normalizeAnswers(value: unknown): string[][] | null {
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

  /**
   * 提问对账：补齐漏收的 question.asked（服务重启/断线），
   * 并把 opencode 侧已不存在的本地待答卡片置为「已失效」。
   * 打开任务对话时触发（按任务节流 30s），也用于 2 分钟执行中对账。
   */
  async syncPendingQuestions(taskId: number): Promise<void> {
    const now = Date.now();
    if (now - (this.questionSyncedAt.get(taskId) ?? 0) < 30_000) return;
    this.questionSyncedAt.set(taskId, now);
    try {
      const task = await this.tasks.findOne({
        where: { id: taskId },
        select: {
          id: true,
          status: true,
          subStatus: true,
          executorId: true,
          opencodeSessionId: true,
        },
      });
      if (
        !task ||
        task.status !== TaskStatus.RUNNING ||
        task.subStatus !== TaskSubStatus.EXECUTING ||
        !task.executorId ||
        !task.opencodeSessionId
      ) {
        return;
      }
      const executor = await this.executors.findOne({
        where: { id: task.executorId },
      });
      if (!executor?.online) return;
      const requests = await new OpencodeClient(executor).listQuestions(
        task.opencodeSessionId,
      );
      const remote = new Set(requests.map((request) => request.id));
      let created = false;
      for (const request of requests) {
        const isNew = await this.taskChat.questionAsked(task.id, request);
        if (isNew) {
          created = true;
          await this.recordQuestionAskedEvent(task.id, request);
        }
      }
      for (const pending of this.taskChat.pendingQuestions(task.id)) {
        if (!remote.has(pending.id)) {
          this.taskChat.questionSettled(task.id, pending.id, 'cancelled');
        }
      }
      // 补建的提问可能早于页面 SSE 订阅推送，发一次刷新信号让前端重取快照
      if (created) this.taskRealtime.taskChanged(task.id);
    } catch (e) {
      this.logger.debug(
        `任务 #${taskId} 提问对账失败: ${(e as Error).message}`,
      );
    }
  }

  /** 任务详情附带的实时输出行（历史页/详情兜底） */
  liveLines(taskId: number): string[] {
    return this.live.get(taskId)?.lines ?? [];
  }

  /**
   * 任务实时输出流（SSE）：先推已有行，随后增量推送执行器事件行与状态；
   * 任务离开活跃状态后完成流（终态快照保留 TTL 供晚订阅）。
   */
  stream(taskId: number): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      let sent = 0;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearInterval(poll);
        off();
        subscriber.complete();
      };
      const pushPending = () => {
        const buf = this.live.get(taskId);
        if (!buf) return;
        while (sent < buf.lines.length) {
          subscriber.next({ data: { line: buf.lines[sent] } });
          sent++;
        }
      };
      const entry =
        this.live.get(taskId) ??
        this.live
          .set(taskId, { lines: [], emitter: new EventEmitter() })
          .get(taskId)!;
      const onLine = () => pushPending();
      entry.emitter.on('line', onLine);
      const off = () => entry.emitter.off('line', onLine);
      pushPending();

      // 兜底轮询任务状态：离开活跃状态（待验收等）即完成流
      const poll = setInterval(() => {
        void this.tasks
          .findOne({
            where: { id: taskId },
            select: { status: true, subStatus: true },
          })
          .then((task) => {
            if (done) return;
            subscriber.next({
              data: {
                status: task ? `${task.status}-${task.subStatus}` : null,
              },
            });
            if (!task || task.subStatus !== TaskSubStatus.EXECUTING) finish();
          })
          .catch(() => finish());
      }, 2000);
      // 保守兜底：30 分钟未结束自动断流（前端可重连）
      const maxDuration = setTimeout(finish, 30 * 60_000);
      return () => {
        done = true;
        clearInterval(poll);
        clearTimeout(maxDuration);
        off();
      };
    });
  }

  /** 执行器事件入口：按 sessionId 路由到任务并转成终端行 */
  private async handleEvent(event: OpencodeEvent): Promise<void> {
    const sessionId = this.sessionIdOf(event);
    if (!sessionId) return;
    const taskId = await this.resolveTask(event.executorId, sessionId);
    if (!taskId) return;
    const data = (event.data ?? {}) as Record<string, unknown>;
    const str = (key: string): string =>
      typeof data[key] === 'string' ? data[key] : '';
    const messageId = str('assistantMessageID');
    // question 事件有 v1（question.v2.asked）、v2（question.asked）与 form（form.*）三套协议，统一处理
    const legacyQuestionType = event.type.startsWith('question.v2.')
      ? event.type.replace('question.v2.', 'question.')
      : event.type;
    const formEvent = formEventToQuestionEvent(event.type, data);
    const eventType = formEvent?.type ?? legacyQuestionType;
    const questionData = formEvent?.data ?? data;

    switch (true) {
      case event.type === 'session.execution.started': {
        this.pushLine(taskId, '▶ 会话开始执行');
        break;
      }
      case event.type === 'session.step.started': {
        const model = data.model as
          { providerID?: string; id?: string } | undefined;
        this.pushLine(
          taskId,
          `● step agent=${str('agent') || '?'} model=${model ? `${model.providerID}/${model.id}` : '?'}`,
        );
        break;
      }
      case event.type === 'session.tool.input.started': {
        this.pushLine(taskId, `🔧 调用工具 ${str('name') || '?'}`);
        await this.taskChat.toolStarted(taskId, str('name') || '工具');
        break;
      }
      case event.type === 'session.tool.success': {
        this.pushLine(taskId, '✓ 工具执行成功');
        this.taskChat.toolFinished(taskId, true);
        break;
      }
      case event.type === 'session.tool.failed': {
        this.pushLine(taskId, '✗ 工具执行失败');
        this.taskChat.toolFinished(taskId, false);
        break;
      }
      case event.type === 'session.reasoning.started': {
        await this.taskChat.beginReasoning(taskId);
        break;
      }
      case event.type === 'session.reasoning.delta': {
        await this.taskChat.appendReasoning(taskId, str('delta'));
        break;
      }
      case event.type === 'session.reasoning.ended': {
        this.taskChat.endReasoning(taskId);
        break;
      }
      case event.type === 'session.text.started': {
        this.bufferOf(taskId).set(messageId, '');
        await this.taskChat.beginText(taskId);
        break;
      }
      case event.type === 'session.text.delta': {
        const buffers = this.bufferOf(taskId);
        buffers.set(messageId, (buffers.get(messageId) ?? '') + str('delta'));
        await this.taskChat.appendText(taskId, str('delta'));
        break;
      }
      case event.type === 'session.text.ended': {
        const text = this.bufferOf(taskId).get(messageId)?.trim();
        if (text) {
          const clipped = text.length > 4000 ? `${text.slice(0, 4000)}…` : text;
          this.pushLine(taskId, `💬 ${clipped.replace(/\n/g, '\n💬 ')}`);
        }
        this.taskChat.endText(taskId);
        break;
      }
      case event.type === 'session.step.failed': {
        const error = data.error as { message?: string } | undefined;
        this.pushLine(taskId, `✗ step-failed ${error?.message ?? '未知错误'}`);
        break;
      }
      case eventType === 'question.asked': {
        await this.handleQuestionAsked(taskId, questionData);
        break;
      }
      case eventType === 'question.replied': {
        this.handleQuestionReplied(taskId, questionData);
        break;
      }
      case eventType === 'question.rejected': {
        this.handleQuestionRejected(taskId, questionData);
        break;
      }
      case event.type.startsWith('permission'): {
        this.pushLine(taskId, `⚠ 权限请求：${event.type}`);
        await this.notifyPermission(taskId, event.type);
        break;
      }
      case event.type === 'session.execution.succeeded':
      case event.type === 'session.execution.completed': {
        await this.finalizeSuccess(taskId);
        break;
      }
      case event.type === 'session.execution.failed': {
        const error = data.error as
          { type?: string; message?: string } | undefined;
        this.pushLine(taskId, `✗ 执行失败：${error?.message ?? event.type}`);
        await this.taskChat.failTask(
          taskId,
          `执行失败：${[error?.type, error?.message].filter(Boolean).join(' ') || event.type}`,
        );
        await this.addEvent(
          taskId,
          '系统',
          `会话执行失败：${error?.type ?? ''} ${error?.message ?? ''}`.trim(),
          null,
        );
        // 本轮已结束，释放事件流占用（等待重派发/取消）
        this.releaseTask(taskId);
        break;
      }
      default:
        break;
    }
  }

  private bufferOf(taskId: number): Map<string, string> {
    let buffers = this.textBuffers.get(taskId);
    if (!buffers) {
      buffers = new Map();
      this.textBuffers.set(taskId, buffers);
    }
    return buffers;
  }

  /** question.asked：生成问答卡片 + 提醒责任人 */
  private async handleQuestionAsked(
    taskId: number,
    data: Record<string, unknown>,
  ): Promise<void> {
    const request = this.questionRequestOf(data);
    if (!request) {
      this.pushLine(taskId, '❓ 收到提问事件（无法解析，已忽略）');
      return;
    }
    const first = request.questions[0];
    this.pushLine(
      taskId,
      `❓ 机器人提问：${first?.header || first?.question || request.id}`,
    );
    const created = await this.taskChat.questionAsked(taskId, request);
    if (created) await this.recordQuestionAskedEvent(taskId, request);
    await this.notifyQuestion(taskId, request);
  }

  /** 机器人提问写入任务事件时间线（同一 questionId 仅记录一次） */
  private async recordQuestionAskedEvent(
    taskId: number,
    request: OpencodeQuestionRequest,
  ): Promise<void> {
    const first = request.questions[0];
    const summary = first?.header || first?.question || `提问 ${request.id}`;
    await this.addEvent(taskId, '提问', `机器人提问：${summary}`, null, {
      questionId: request.id,
      summary,
    });
  }

  /** question.replied：把卡片同步为已回答（事件补偿/其他客户端作答） */
  private handleQuestionReplied(
    taskId: number,
    data: Record<string, unknown>,
  ): void {
    const requestId = this.strOf(data, 'requestID');
    if (!requestId) return;
    const answers = Array.isArray(data.answers)
      ? (data.answers as unknown[])
          .filter((row): row is unknown[] => Array.isArray(row))
          .map((row) =>
            row.filter((value): value is string => typeof value === 'string'),
          )
      : undefined;
    this.taskChat.questionSettled(taskId, requestId, 'answered', answers);
  }

  /** question.rejected：把卡片同步为已跳过 */
  private handleQuestionRejected(
    taskId: number,
    data: Record<string, unknown>,
  ): void {
    const requestId = this.strOf(data, 'requestID');
    if (!requestId) return;
    this.taskChat.questionSettled(taskId, requestId, 'rejected');
  }

  /** 提问事件 → opencode QuestionRequest（事件 data 直接是 request 结构） */
  private questionRequestOf(
    data: Record<string, unknown>,
  ): OpencodeQuestionRequest | null {
    const raw = (data.request ?? data) as Partial<OpencodeQuestionRequest> & {
      questions?: unknown;
    };
    if (typeof raw.id !== 'string' || !Array.isArray(raw.questions)) {
      return null;
    }
    return {
      id: raw.id,
      sessionID: typeof raw.sessionID === 'string' ? raw.sessionID : '',
      questions: raw.questions,
      tool: raw.tool,
    };
  }

  /** 提问提醒：同一 request 只通知一次 */
  private async notifyQuestion(
    taskId: number,
    request: OpencodeQuestionRequest,
  ): Promise<void> {
    const key = `${taskId}:${request.id}`;
    if (this.questionNotified.has(key)) return;
    this.questionNotified.add(key);
    try {
      const task = await this.mustFind(taskId);
      const first = request.questions[0];
      await this.taskNotify.notifyTaskOwner(
        task,
        'notice',
        `任务等待回答：${task.code} ${task.title}`,
        `机器人提问：${first?.question ?? '请到任务详情回答'}`,
      );
    } catch (e) {
      this.logger.warn(`任务 #${taskId} 提问通知失败: ${(e as Error).message}`);
    }
  }

  private strOf(data: Record<string, unknown>, key: string): string {
    const value = data[key];
    return typeof value === 'string' ? value : '';
  }

  /**
   * 收集本轮执行产出：优先实时文本缓冲，缺失时从执行器消息详情兜底。
   * 只读取，不改变任务状态。
   */
  private async collectResult(task: Task): Promise<string | null> {
    const buffers = this.textBuffers.get(task.id);
    const accumulated = [...(buffers?.values() ?? [])]
      .map((t) => t.trim())
      .filter(Boolean)
      .join('\n\n');
    if (accumulated) return accumulated;
    if (!task.executorId || !task.opencodeSessionId) return null;
    const executor = await this.executors.findOne({
      where: { id: task.executorId },
    });
    if (!executor) return null;
    return new OpencodeClient(executor)
      .lastAssistantText(task.opencodeSessionId)
      .catch((e: Error) => {
        this.logger.warn(
          `取会话 ${task.opencodeSessionId} 最终回复失败: ${e.message}`,
        );
        return null;
      });
  }

  /**
   * 机器人主动申请验收：保存本轮产出并把任务推进到「等待中-待验收」。
   * 仅允许当前绑定的执行机器人调用；会话结束不会自动申请验收。
   */
  async applyForAcceptance(
    taskId: number,
    worker: Worker,
  ): Promise<TaskAcceptanceApplication> {
    const task = await this.mustFind(taskId);
    if (task.agentId !== worker.id) {
      throw new ForbiddenException(
        `任务 ${task.code} 的执行机器人不是「${worker.name}」`,
      );
    }
    if (
      task.status !== TaskStatus.RUNNING ||
      task.subStatus !== TaskSubStatus.EXECUTING
    ) {
      throw new BadRequestException(
        `任务 ${task.code} 当前状态「${task.status}-${task.subStatus}」不可申请验收`,
      );
    }
    const resultText = await this.collectResult(task);
    const now = new Date();
    // 交付文档是验收申请的前置条件：写入失败时任务保持执行中，可修复后重试
    const handoff = await this.taskDocuments.upsertHandoff({
      task,
      result: resultText ?? task.result,
      worker,
      appliedAt: now,
    });
    task.status = TaskStatus.WAITING;
    task.subStatus = TaskSubStatus.PENDING_ACCEPT;
    task.result = resultText ?? task.result;
    task.remindCount = 1;
    task.firstRemindedAt = now;
    task.lastRemindedAt = now;
    const saved = await this.tasks.save(task);
    this.finishedAwaitingApply.add(taskId);
    this.pushLine(taskId, `✔ 机器人已申请验收，交付文档：${handoff.path}`);
    await this.addEvent(
      taskId,
      '状态变更',
      `状态变更：进行中-执行中 → 等待中-待验收（执行机器人申请验收，交付文档：${handoff.path}）`,
      worker.name,
      {
        workerId: worker.id,
        deliveryApply: true,
        handoffPath: handoff.path,
        handoffUrl: handoff.url,
      },
    );
    await this.taskChat.finishTask(taskId);
    this.releaseTask(taskId);
    await this.taskNotify.notifyTaskRequester(
      saved,
      'accept',
      `任务待验收：${saved.code} ${saved.title}`,
      `执行机器人已提交验收申请，交付文档：${handoff.path}`,
    );
    return { task: saved, handoff };
  }

  /**
   * 执行器会话成功：只保存产出并释放事件流，任务保持「进行中-执行中」。
   * 必须由执行机器人显式调用验收申请接口后才进入「等待中-待验收」。
   */
  private async finalizeSuccess(taskId: number): Promise<void> {
    const task = await this.mustFind(taskId);
    this.releaseTask(taskId);
    if (
      task.status !== TaskStatus.RUNNING ||
      task.subStatus !== TaskSubStatus.EXECUTING
    )
      return;
    if (this.finishedAwaitingApply.has(taskId)) return;
    const resultText = await this.collectResult(task);
    task.result = resultText ?? task.result;
    await this.tasks.save(task);
    this.finishedAwaitingApply.add(taskId);
    this.pushLine(taskId, '✔ 会话执行完成，等待机器人申请验收');
    await this.addEvent(
      taskId,
      '系统',
      `执行器会话已完成，任务保持进行中-执行中；等待执行机器人调用 POST ${this.apiUrl}/tasks/${taskId}/deliver/apply.md 申请验收`,
      null,
      { waitingDeliveryApply: true },
    );
    await this.taskChat.finishTask(taskId);
  }

  /**
   * 执行中任务兜底对账（每 2 分钟）：事件流漏收（服务重启/断线期间完成）时，
   * 直接查会话 outcome 补齐产出；不自动申请验收，仍等待机器人显式调用申请接口。
   */
  @Cron('20 */2 * * * *')
  async reconcileExecuting(): Promise<void> {
    const running = await this.tasks.find({
      where: { status: TaskStatus.RUNNING, subStatus: TaskSubStatus.EXECUTING },
      select: { id: true, executorId: true, opencodeSessionId: true },
    });
    // 已不在执行中的任务（人工改状态/删除等）释放事件流占用
    const runningIds = new Set(running.map((task) => task.id));
    for (const taskId of [...this.hubRetained.keys()]) {
      if (!runningIds.has(taskId) && !this.dispatching.has(taskId)) {
        this.releaseTask(taskId);
      }
    }
    for (const task of running) {
      if (!task.executorId || !task.opencodeSessionId) continue;
      const executor = await this.executors.findOne({
        where: { id: task.executorId },
      });
      if (!executor?.online) continue;
      // 已记录失败的任务等待人工处理，不再占用事件流
      if (this.failedReconciled.has(task.id)) {
        this.releaseTask(task.id);
        continue;
      }
      // 会话已完成但机器人尚未申请验收：产出已补齐，不再重复对账
      if (this.finishedAwaitingApply.has(task.id)) {
        this.releaseTask(task.id);
        continue;
      }
      // 服务重启/断线后恢复订阅（有执行中的任务才保持连接）
      this.retainTask(task.id, executor);
      // 补齐漏收的提问（服务重启/断线期间 question.asked 可能丢失）
      await this.syncPendingQuestions(task.id);
      try {
        const client = new OpencodeClient(executor);
        const info = await client.session(task.opencodeSessionId);
        if (
          (info.outcome === 'succeeded' || info.outcome === 'failed') &&
          // outcome/time.idle 具有粘性（保留上一轮结果）：只采信晚于本轮用户消息结束的运行，
          // 避免重派发后对账把上一轮的结果误判为本轮完成
          !(await this.isCurrentRunOutcome(
            client,
            info,
            task.opencodeSessionId,
          ))
        ) {
          continue;
        }
        if (info.outcome === 'succeeded') {
          this.pushLine(
            task.id,
            '↻ 对账补偿：会话已完成，补齐产出并等待机器人申请验收',
          );
          await this.finalizeSuccess(task.id);
        } else if (info.outcome === 'failed') {
          if (this.failedReconciled.has(task.id)) continue;
          this.failedReconciled.add(task.id);
          this.releaseTask(task.id);
          this.pushLine(task.id, '↻ 对账补偿：会话执行失败');
          await this.addEvent(
            task.id,
            '系统',
            '对账补偿：会话执行失败（可中断后重新派发）',
            null,
          );
        }
      } catch (e) {
        this.logger.debug(`任务 #${task.id} 对账失败: ${(e as Error).message}`);
      }
    }
  }

  /** 对账已记录失败的会话（避免重复事件） */
  private readonly failedReconciled = new Set<number>();

  /**
   * 会话终态是否属于本轮运行：prompt 为异步接口且 outcome/time.idle 具有粘性
   * （保留上一轮运行结果），只采信结束时间（time.idle，执行器时钟）晚于
   * 本轮用户消息创建时间的终态；取不到基准时退回旧行为直接采信。
   */
  private async isCurrentRunOutcome(
    client: OpencodeClient,
    info: { outcome?: string | null; time?: { idle?: number | null } },
    sessionId: string,
  ): Promise<boolean> {
    const afterMs = await client
      .lastUserMessageCreatedAt(sessionId)
      .catch(() => 0);
    return isFreshOutcome(info, afterMs);
  }

  /**
   * 任务会话保留期清理（每天 04:15）：7 天不活跃的已结束/等待任务解除会话绑定。
   * 执行中任务不清理（仍在跑或等待人工处理）；opencode 侧历史会话本身保留。
   */
  @Cron('0 15 4 * * *')
  async cleanupIdleSessions(): Promise<void> {
    const deadline = new Date(Date.now() - TASK_SESSION_TTL_MS);
    const result = await this.tasks
      .createQueryBuilder()
      .update(Task)
      .set({ opencodeSessionId: null, executorId: null })
      .where('"opencodeSessionId" IS NOT NULL')
      .andWhere('"updatedAt" < :deadline', { deadline })
      .andWhere('NOT ("status" = :running AND "subStatus" = :executing)', {
        running: TaskStatus.RUNNING,
        executing: TaskSubStatus.EXECUTING,
      })
      .execute();
    if (result.affected) {
      this.logger.log(`已清理 ${result.affected} 个 7 天未活跃任务的会话绑定`);
    }
  }

  /** prompt 组装：任务编号/标题/类型/任务定义/输入/需求内容/输出要求；角色与技能由工位文件提供 */
  private async buildPrompt(task: Task): Promise<string> {
    const template = task.templateId
      ? await this.taskTemplates.findOne({ where: { id: task.templateId } })
      : null;
    const sections: string[] = [];
    sections.push(
      [
        '# 任务',
        '',
        `- 编号：${task.code}`,
        `- 标题：${task.title}`,
        `- 类型：${task.type}`,
        template
          ? `\n# 任务定义\n\n${template.name}${
              template.description?.trim()
                ? `\n\n${template.description.trim()}`
                : ''
            }`
          : '',
        task.description?.trim()
          ? `\n# 任务描述\n\n${task.description.trim()}`
          : '',
        task.input?.trim() ? `\n# 任务输入\n\n${task.input.trim()}` : '',
        task.content?.trim() ? `\n# 需求内容\n\n${task.content.trim()}` : '',
        task.outputSpec?.trim()
          ? `\n# 输出要求\n\n${task.outputSpec.trim()}`
          : '',
        task.workPlan?.trim()
          ? `\n# 工作计划\n\n${task.workPlan.trim()}\n\n请按计划执行；如需调整，请在最终产出中说明原因。`
          : '',
      ].join('\n'),
    );
    sections.push(
      [
        '# 完成与验收',
        '',
        '完成并自检后，必须主动申请验收；会话结束不会自动进入待验收，未调用申请接口时任务会一直保持「进行中-执行中」。',
        '',
        '1. 先完成交付物和交付说明，确保最终产出已经写入回复或项目文档。',
        '2. 在工位目录执行以下命令申请验收（机器人令牌不要写入聊天或文档）：',
        '',
        '```bash',
        'TOKEN=$(cat .opencode/agent-token)',
        `curl -sS -X POST '${this.apiUrl}/tasks/${task.id}/deliver/apply.md' \\`,
        '  -H "X-Worker-Token: $TOKEN"',
        '```',
        '',
        '3. 申请成功后任务进入「等待中-待验收」，由任务需求方决定通过或拒绝。',
        '4. 需求方拒绝后，平台会把反馈意见发回当前会话，按反馈修改后再次申请验收。',
      ].join('\n'),
    );
    return sections.join('\n\n---\n\n');
  }

  /** 事件 data 里的会话 id（各事件统一放 data.sessionID） */
  private sessionIdOf(event: OpencodeEvent): string | null {
    const data = event.data as { sessionID?: string } | null;
    return data?.sessionID ?? null;
  }

  /** 占用执行器事件流（同一任务只占一次；执行器变化时先释放旧连接） */
  private retainTask(taskId: number, executor: Executor): void {
    const retained = this.hubRetained.get(taskId);
    if (retained === executor.id) return;
    if (retained !== undefined) this.releaseTask(taskId);
    this.hubRetained.set(taskId, executor.id);
    this.eventHub.retain(executor);
  }

  /** 释放执行器事件流占用（幂等；归零后由事件中心延迟断开） */
  private releaseTask(taskId: number): void {
    const executorId = this.hubRetained.get(taskId);
    if (executorId === undefined) return;
    this.hubRetained.delete(taskId);
    this.eventHub.release(executorId);
  }

  /** sessionId → 任务（缓存未命中回库查并回填） */
  private async resolveTask(
    executorId: number,
    sessionId: string,
  ): Promise<number | null> {
    const key = `${executorId}:${sessionId}`;
    const cached = this.sessionRoutes.get(key);
    if (cached) return cached;
    const task = await this.tasks.findOne({
      where: { executorId, opencodeSessionId: sessionId },
      select: { id: true },
    });
    if (task) this.sessionRoutes.set(key, task.id);
    return task?.id ?? null;
  }

  /** 权限请求：记事件 + 通知责任人（每任务只通知一次） */
  private async notifyPermission(taskId: number, type: string): Promise<void> {
    if (this.permissionNotified.has(taskId)) return;
    this.permissionNotified.add(taskId);
    const task = await this.mustFind(taskId);
    await this.addEvent(
      taskId,
      '系统',
      `会话请求权限（${type}），请在平台批复`,
      null,
    );
    await this.taskNotify.notifyTaskOwner(
      task,
      'notice',
      `任务等待授权：${task.code} ${task.title}`,
      '执行中会话请求工具权限，请到任务详情批复',
    );
  }

  /** 追加一行实时输出并广播 */
  private pushLine(taskId: number, line: string): void {
    const entry =
      this.live.get(taskId) ??
      this.live
        .set(taskId, { lines: [], emitter: new EventEmitter() })
        .get(taskId)!;
    entry.lines.push(line);
    entry.emitter.emit('line');
    this.taskRealtime.lineAppended(taskId, line);
    // 终态后 TTL 清理由 stream 轮询触发；此处对超长缓冲截断
    if (entry.lines.length > 2000) entry.lines.splice(0, 500);
  }

  async addEvent(
    taskId: number,
    type: string,
    content: string,
    operator: string | null,
    meta?: Record<string, unknown>,
  ): Promise<void> {
    await this.events.save(
      this.events.create({
        taskId,
        type,
        content,
        operator,
        meta: meta ?? null,
      }),
    );
    // 任务字段/状态通常在记事件前已落库，这里统一广播一次最新快照
    this.taskRealtime.taskChanged(taskId);
  }

  async mustFind(taskId: number): Promise<Task> {
    const task = await this.tasks.findOne({ where: { id: taskId } });
    if (!task) throw new NotFoundException(`Task ${taskId} not found`);
    return task;
  }
}
