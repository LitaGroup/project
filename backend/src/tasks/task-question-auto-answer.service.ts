import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { beijingTime } from '../common/frontmatter';
import {
  TaskStatus,
  TaskSubStatus,
  WorkerRole,
  WorkerRuntime,
} from '../common/enums';
import { Executor } from '../executors/executor.entity';
import {
  OpencodeClient,
  type OpencodeQuestionInfo,
  type OpencodeQuestionRequest,
} from '../executors/opencode-client';
import { runOpencodePrompt } from '../executors/opencode-run';
import { Worker } from '../workers/worker.entity';
import { WorkersService } from '../workers/workers.service';
import { Task } from './task.entity';
import { TaskEvent } from './task-event.entity';
import { TaskMessage } from './task-message.entity';
import { TaskChatService } from './task-chat.service';
import { TaskNotifyService } from './task-notify.service';
import { TaskRealtimeService } from './task-realtime.service';

/** 父机器人一次咨询的最长耗时；失败后回退任务需求方人工回答 */
const AUTO_ANSWER_TIMEOUT_MS = 90_000;
const MAX_CONTEXT_EVENTS = 20;
const MAX_CONTEXT_MESSAGES = 20;
const MAX_CONTEXT_CHARS = 2_000;

interface AutoAnswerEndpoint {
  parent: Task;
  worker: Worker;
  executor: Executor;
  providerId: string;
  modelId: string;
  workdir: string | null;
}

interface AutoAnswerMeta {
  status: 'running' | 'answered' | 'failed';
  parentTaskId: number;
  parentAgentId: number;
  parentAgentName: string;
  startedAt: string;
  finishedAt?: string;
  answers?: string[][];
  error?: string;
}

function clip(value: string | null | undefined, limit: number): string {
  const text = value?.trim() ?? '';
  return text.length <= limit ? text : `${text.slice(0, limit)}\n…（已截断）`;
}

/**
 * 子任务提问自动答复：
 * 使用直接父任务的执行机器人创建一次性独立咨询会话，生成结构化 answers 后
 * 转发到子任务原 opencode 提问。根任务或无可用父机器人时回退需求方人工回答。
 *
 * 独立咨询会话不写入父任务 opencodeSessionId、不产生父任务事件文本，
 * 避免干扰父任务执行、result 与验收状态。
 */
@Injectable()
export class TaskQuestionAutoAnswerService {
  private readonly logger = new Logger(TaskQuestionAutoAnswerService.name);
  private readonly active = new Set<string>();

  constructor(
    @InjectRepository(Task)
    private readonly tasks: Repository<Task>,
    @InjectRepository(TaskEvent)
    private readonly events: Repository<TaskEvent>,
    @InjectRepository(TaskMessage)
    private readonly messages: Repository<TaskMessage>,
    @InjectRepository(Executor)
    private readonly executors: Repository<Executor>,
    @InjectRepository(Worker)
    private readonly workers: Repository<Worker>,
    private readonly workersService: WorkersService,
    private readonly taskChat: TaskChatService,
    private readonly taskNotify: TaskNotifyService,
    private readonly taskRealtime: TaskRealtimeService,
  ) {}

  /**
   * 尝试启动父机器人自动答复。
   * true=已接管或提问已处理（无需人工通知）；false=无可用父机器人（回退人工）。
   */
  async start(
    taskId: number,
    request: OpencodeQuestionRequest,
  ): Promise<boolean> {
    const question = this.taskChat.findQuestion(taskId, request.id);
    if (!question || question.state !== 'pending') return true;

    const key = `${taskId}:${request.id}`;
    if (this.active.has(key)) return true;
    const meta = this.taskChat.questionMeta(taskId, request.id)?.autoAnswer as
      AutoAnswerMeta | undefined;
    if (meta?.status === 'failed') return true;

    let endpoint: AutoAnswerEndpoint | null;
    try {
      endpoint = await this.resolveEndpoint(taskId);
    } catch (error) {
      this.logger.warn(
        `任务 #${taskId} 父机器人自动答复不可用：${(error as Error).message}`,
      );
      return false;
    }
    if (!endpoint) return false;

    this.active.add(key);
    void this.answer(taskId, request, endpoint, key);
    return true;
  }

  /** 父任务机器人 → 独立会话生成答案 → 子任务提问 reply */
  private async answer(
    taskId: number,
    request: OpencodeQuestionRequest,
    endpoint: AutoAnswerEndpoint,
    key: string,
  ): Promise<void> {
    let consultationSessionId: string | null = null;
    const startedAt = new Date();
    const baseMeta: AutoAnswerMeta = {
      status: 'running',
      parentTaskId: endpoint.parent.id,
      parentAgentId: endpoint.worker.id,
      parentAgentName: endpoint.worker.name,
      startedAt: startedAt.toISOString(),
    };
    this.taskChat.setQuestionMeta(taskId, request.id, {
      autoAnswer: baseMeta,
    });

    try {
      const [child, events, messages] = await Promise.all([
        this.tasks.findOne({ where: { id: taskId } }),
        this.events.find({
          where: { taskId: endpoint.parent.id },
          order: { id: 'DESC' },
          take: MAX_CONTEXT_EVENTS,
        }),
        this.messages.find({
          where: { taskId: endpoint.parent.id },
          order: { id: 'DESC' },
          take: MAX_CONTEXT_MESSAGES,
        }),
      ]);
      if (!child) throw new Error('子任务不存在');
      const raw = await runOpencodePrompt(
        new OpencodeClient(endpoint.executor),
        {
          title: `父任务答复 ${endpoint.parent.code} → ${child.code}`.slice(
            0,
            100,
          ),
          model: { id: endpoint.modelId, providerID: endpoint.providerId },
          location: endpoint.workdir
            ? { directory: endpoint.workdir }
            : endpoint.executor.defaultLocation
              ? { directory: endpoint.executor.defaultLocation }
              : undefined,
          prompt: this.buildPrompt(endpoint, child, request, events, messages),
          timeoutMs: AUTO_ANSWER_TIMEOUT_MS,
          onSessionCreated: (sessionId) => {
            consultationSessionId = sessionId;
          },
        },
      );
      const answers = this.parseAnswers(raw, request.questions);
      await this.deliverAnswer(taskId, request, answers);
      const finishedAt = new Date();
      this.taskChat.setQuestionMeta(taskId, request.id, {
        autoAnswer: {
          ...baseMeta,
          status: 'answered',
          finishedAt: finishedAt.toISOString(),
          answers,
        } satisfies AutoAnswerMeta,
      });
      await this.addEvent(
        taskId,
        '系统',
        `父任务机器人「${endpoint.worker.name}」自动回答子任务提问`,
        {
          automatic: true,
          autoAnswer: true,
          questionId: request.id,
          parentTaskId: endpoint.parent.id,
          parentAgentId: endpoint.worker.id,
          answers,
        },
      );
    } catch (error) {
      await this.handleFailure(
        taskId,
        request,
        endpoint,
        baseMeta,
        error as Error,
      );
    } finally {
      this.active.delete(key);
      if (consultationSessionId) {
        await new OpencodeClient(endpoint.executor)
          .deleteSession(consultationSessionId)
          .catch((e: Error) =>
            this.logger.warn(
              `自动答复咨询会话 ${consultationSessionId} 清理失败：${e.message}`,
            ),
          );
      }
    }
  }

  private async deliverAnswer(
    taskId: number,
    request: OpencodeQuestionRequest,
    answers: string[][],
  ): Promise<void> {
    const task = await this.tasks.findOne({ where: { id: taskId } });
    if (
      !task ||
      task.status !== TaskStatus.RUNNING ||
      task.subStatus !== TaskSubStatus.EXECUTING ||
      !task.executorId ||
      !task.opencodeSessionId
    ) {
      throw new Error('子任务已离开执行中，自动答复取消');
    }
    const question = this.taskChat.findQuestion(taskId, request.id);
    if (!question || question.state !== 'pending') {
      throw new Error('提问已被人工处理，自动答复取消');
    }
    const executor = await this.executors.findOne({
      where: { id: task.executorId },
    });
    if (!executor?.online) throw new Error('子任务执行器离线');
    const client = new OpencodeClient(executor);
    const sessionId = request.sessionID || task.opencodeSessionId;
    const remote = await client.listQuestions(sessionId);
    if (!remote.some((item) => item.id === request.id)) {
      throw new Error('执行器侧提问已失效');
    }
    await client.replyQuestion(
      sessionId,
      request.id,
      answers,
      request.questions,
    );
    this.taskChat.questionSettled(taskId, request.id, 'answered', answers);
    this.taskRealtime.taskChanged(taskId);
  }

  private async handleFailure(
    taskId: number,
    request: OpencodeQuestionRequest,
    endpoint: AutoAnswerEndpoint,
    meta: AutoAnswerMeta,
    error: Error,
  ): Promise<void> {
    this.logger.warn(`任务 #${taskId} 父机器人自动答复失败：${error.message}`);
    const question = this.taskChat.findQuestion(taskId, request.id);
    if (!question || question.state !== 'pending') return;
    this.taskChat.setQuestionMeta(taskId, request.id, {
      autoAnswer: {
        ...meta,
        status: 'failed',
        finishedAt: new Date().toISOString(),
        error: error.message,
      } satisfies AutoAnswerMeta,
    });
    const child = await this.tasks.findOne({ where: { id: taskId } });
    if (!child || child.status === TaskStatus.FINISHED) return;
    await this.addEvent(
      taskId,
      '系统',
      `父任务机器人「${endpoint.worker.name}」自动答复失败，转任务需求方回答：${error.message}`,
      {
        automatic: true,
        autoAnswer: true,
        autoAnswerFailed: true,
        questionId: request.id,
        parentTaskId: endpoint.parent.id,
        parentAgentId: endpoint.worker.id,
        error: error.message,
      },
    );
    await this.taskNotify.notifyTaskRequester(
      child,
      'notice',
      `任务等待回答：${child.code} ${child.title}`,
      `父任务机器人自动答复失败，请到任务详情回答：${request.questions[0]?.question ?? request.id}`,
    );
  }

  /** 直接父任务机器人及其执行器/模型；不可用时返回 null（回退需求方） */
  private async resolveEndpoint(
    taskId: number,
  ): Promise<AutoAnswerEndpoint | null> {
    const child = await this.tasks.findOne({ where: { id: taskId } });
    if (!child?.parentId) return null;
    const parent = await this.tasks.findOne({ where: { id: child.parentId } });
    if (!parent?.agentId) return null;
    const worker = await this.workers.findOne({
      where: { id: parent.agentId },
    });
    if (
      !worker ||
      !worker.enabled ||
      worker.role !== WorkerRole.WORKER ||
      worker.runtime !== WorkerRuntime.OPENCODE ||
      !worker.executorId
    ) {
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
    return {
      parent,
      worker,
      executor,
      providerId,
      modelId,
      workdir: this.workersService.workdirOf(worker.id),
    };
  }

  private buildPrompt(
    endpoint: AutoAnswerEndpoint,
    child: Task,
    request: OpencodeQuestionRequest,
    events: TaskEvent[],
    messages: TaskMessage[],
  ): string {
    const parent = endpoint.parent;
    const eventLines = events.length
      ? [...events]
          .reverse()
          .map(
            (event) =>
              `- ${beijingTime(event.createdAt)} [${event.type}] ${clip(event.content, 500)}`,
          )
      : ['（无事件记录）'];
    const messageLines = messages.length
      ? [...messages]
          .reverse()
          .map(
            (message) =>
              `- ${beijingTime(message.createdAt)} [${message.sender?.name ?? message.role}] ${clip(message.content, 800)}`,
          )
      : ['（无对话记录）'];
    const questions = request.questions
      .map((question, index) => {
        const options =
          question.options?.map((option) => option.label).join(' / ') || '无';
        return [
          `${index + 1}. ${question.header || `问题 ${index + 1}`}`,
          `   - 内容：${question.question}`,
          `   - 选项：${options}`,
          `   - 多选：${question.multiple === true ? '是' : '否'}`,
          `   - 允许自由输入：${question.custom === false ? '否' : '是'}`,
        ].join('\n');
      })
      .join('\n');
    return [
      '你是父任务的执行机器人，现在需要替父任务回答子任务机器人提出的问题。',
      '只依据给出的父子任务事实回答；不要调用工具、不要修改任务、不要输出解释或 Markdown 代码围栏。',
      '',
      '# 父任务',
      '',
      `- 编号：${parent.code}`,
      `- 标题：${parent.title}`,
      `- 状态：${parent.status}-${parent.subStatus}`,
      `- 原始输入：${clip(parent.input || parent.description, MAX_CONTEXT_CHARS)}`,
      `- 整理后需求：${clip(parent.content || parent.description, MAX_CONTEXT_CHARS)}`,
      `- 输出要求：${clip(parent.outputSpec, MAX_CONTEXT_CHARS)}`,
      `- 工作计划：${clip(parent.workPlan, MAX_CONTEXT_CHARS)}`,
      `- 当前产出：${clip(parent.result, MAX_CONTEXT_CHARS)}`,
      '',
      '## 父任务最近事件',
      '',
      ...eventLines,
      '',
      '## 父任务最近对话',
      '',
      ...messageLines,
      '',
      '# 子任务',
      '',
      `- 编号：${child.code}`,
      `- 标题：${child.title}`,
      `- 原始输入：${clip(child.input || child.description, MAX_CONTEXT_CHARS)}`,
      `- 整理后需求：${clip(child.content || child.description, MAX_CONTEXT_CHARS)}`,
      `- 输出要求：${clip(child.outputSpec, MAX_CONTEXT_CHARS)}`,
      '',
      '# 待回答的问题',
      '',
      questions,
      '',
      '# 输出格式',
      '',
      '严格输出 JSON（不要代码围栏、不要前后说明）：',
      '{"answers":[["答案1"],["答案2"]]}',
      '',
      '要求：',
      '- answers 数量必须与问题数量一致，顺序一一对应。',
      '- 每个问题至少一个非空答案；单选只能一个，多选可多个。',
      '- 不允许自由输入时，答案必须严格使用给定选项 label。',
      '- 信息不足时，选择最保守的选项并明确说明需要父任务补充的信息。',
    ].join('\n');
  }

  private parseAnswers(
    raw: string,
    questions: OpencodeQuestionInfo[],
  ): string[][] {
    const text = raw
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) {
      throw new Error('父机器人未返回 JSON 答案');
    }
    let payload: unknown;
    try {
      payload = JSON.parse(text.slice(start, end + 1));
    } catch {
      throw new Error('父机器人返回的 JSON 答案无法解析');
    }
    const rawAnswers =
      payload && typeof payload === 'object' && 'answers' in payload
        ? (payload as { answers?: unknown }).answers
        : null;
    if (!Array.isArray(rawAnswers)) {
      throw new Error('父机器人答案缺少 answers 数组');
    }
    if (rawAnswers.length !== questions.length) {
      throw new Error('父机器人答案数量与问题数量不一致');
    }
    const answers = rawAnswers.map((row, index) => {
      if (!Array.isArray(row)) {
        throw new Error(`第 ${index + 1} 个问题答案格式不正确`);
      }
      const values = row
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter(Boolean);
      if (values.length === 0) {
        throw new Error(`第 ${index + 1} 个问题没有有效答案`);
      }
      const question = questions[index];
      if (question.multiple !== true && values.length > 1) {
        throw new Error(`第 ${index + 1} 个问题为单选，不能返回多个答案`);
      }
      if (question.custom === false && question.options?.length) {
        const labels = new Set(question.options.map((option) => option.label));
        if (values.some((value) => !labels.has(value))) {
          throw new Error(`第 ${index + 1} 个问题答案不在选项中`);
        }
      }
      return values;
    });
    return answers;
  }

  private async addEvent(
    taskId: number,
    type: string,
    content: string,
    meta?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.events.save(
        this.events.create({
          taskId,
          type,
          content,
          operator: null,
          meta: meta ?? null,
        }),
      );
      this.taskRealtime.taskChanged(taskId);
    } catch (error) {
      this.logger.warn(
        `任务 #${taskId} 自动答复事件写入失败：${(error as Error).message}`,
      );
    }
  }
}
