import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { In, Repository } from 'typeorm';
import { mdFrontmatter } from '../common/frontmatter';
import { TaskStatus, TaskSubStatus, WorkerRole } from '../common/enums';
import { Worker } from '../workers/worker.entity';
import { Task } from './task.entity';
import { TaskMessage } from './task-message.entity';
import { TaskTemplate } from './task-template.entity';
import { TaskChatService } from './task-chat.service';
import type { TaskChatQuestionInfo } from './task-chat.types';
import { TaskDeliveryService } from './task-delivery.service';
import { TaskDispatchService } from './task-dispatch.service';
import { TaskNotifyService } from './task-notify.service';
import { TasksService } from './tasks.service';
import {
  actorName,
  assertTaskRequester,
  type TaskActor,
} from './task-requester';
import { TaskWorkerInboxService } from './task-worker-inbox.service';

export interface CreateSubtaskInput {
  templateId: number;
  title: string;
  description?: string | null;
  input?: string | null;
  outputSpec?: string | null;
}

export interface AskQuestionInput {
  questions: TaskChatQuestionInfo[];
}

export interface AnswerQuestionInput {
  answers?: string[][];
  reject?: boolean;
}

/** 多机器人协同动作：定义查询、子任务、接受/拒绝、project 提问与终态。 */
@Injectable()
export class TaskCollaborationService {
  constructor(
    @InjectRepository(Task)
    private readonly tasks: Repository<Task>,
    @InjectRepository(TaskTemplate)
    private readonly templates: Repository<TaskTemplate>,
    @InjectRepository(Worker)
    private readonly workers: Repository<Worker>,
    @InjectRepository(TaskMessage)
    private readonly messages: Repository<TaskMessage>,
    private readonly tasksService: TasksService,
    private readonly dispatchService: TaskDispatchService,
    private readonly deliveryService: TaskDeliveryService,
    private readonly taskChat: TaskChatService,
    private readonly taskNotify: TaskNotifyService,
    private readonly workerInbox: TaskWorkerInboxService,
  ) {}

  /** task-defines：仅返回当前确有启用处理机器人的任务定义。 */
  async definesMarkdown(): Promise<string> {
    const [templates, workers] = await Promise.all([
      this.templates.find({ order: { id: 'ASC' } }),
      this.workers.find({ where: { role: WorkerRole.WORKER, enabled: true } }),
    ]);
    const enabled = new Map(workers.map((worker) => [worker.id, worker]));
    const lines = [
      mdFrontmatter({ title: '可分发的任务定义' }),
      '# 可分发的任务定义',
      '',
      '创建子任务前，根据当前任务定义判断是否需要其他机器人协同；不要无目的拆分。',
      '',
    ];
    let count = 0;
    for (const template of templates) {
      const agents = (template.agentIds ?? [])
        .map((id) => enabled.get(id))
        .filter((worker): worker is Worker => Boolean(worker));
      if (agents.length === 0) continue;
      count += 1;
      lines.push(
        `## ${template.name}（ID=${template.id}）`,
        '',
        `- 类型：${template.type}`,
        `- 处理机器人：${agents.map((worker) => `${worker.name}#${worker.id}`).join('、')}`,
        '',
        template.description?.trim() || '（暂无任务定义描述）',
        '',
      );
    }
    if (count === 0) lines.push('当前没有可分发的任务定义。', '');
    lines.push(
      '## 创建子任务',
      '',
      '父任务执行机器人调用 `POST /api/tasks/{parentTaskId}/subtasks/create.md`，body：`{"templateId":1,"title":"子任务标题","input":"输入","outputSpec":"交付要求"}`。',
      '',
    );
    return lines.join('\n');
  }

  /** task-create：父任务当前执行机器人为子任务需求方。 */
  async createSubtask(
    parentId: number,
    worker: Worker,
    input: CreateSubtaskInput,
  ): Promise<Task> {
    const parent = await this.mustFind(parentId);
    if (
      parent.status !== TaskStatus.RUNNING ||
      parent.subStatus !== TaskSubStatus.EXECUTING ||
      parent.agentId !== worker.id
    ) {
      throw new ForbiddenException('仅父任务当前执行机器人可以创建子任务');
    }
    if (!Number.isInteger(input.templateId) || input.templateId < 1) {
      throw new BadRequestException('templateId 必须为正整数');
    }
    const template = await this.templates.findOne({
      where: { id: input.templateId },
    });
    if (!template) throw new BadRequestException('任务定义不存在');
    const enabledWorkers = await this.workers.find({
      where: { id: In(template.agentIds ?? []), enabled: true },
    });
    if (enabledWorkers.length === 0) {
      throw new BadRequestException('该任务定义当前没有启用的处理机器人');
    }
    const child = await this.tasksService.create({
      title: input.title,
      description: input.description ?? input.input ?? null,
      input: input.input ?? null,
      outputSpec: input.outputSpec ?? null,
      templateId: template.id,
      parentId: parent.id,
      createdById: parent.createdById,
      requesterType: 'worker',
      requesterId: worker.id,
      operatorName: worker.name,
    });
    await this.tasksService.addEvent(
      parent.id,
      '操作',
      `创建子任务 ${child.code}「${child.title}」（任务定义：${template.name}）`,
      worker.name,
      { childTaskId: child.id, templateId: template.id },
    );
    return child;
  }

  /** task-accept：只有负责机器人且机器人空闲时可接受。 */
  async accept(taskId: number, worker: Worker): Promise<Task> {
    const task = await this.mustFind(taskId);
    this.assertAgent(task, worker);
    if (
      task.status !== TaskStatus.WAITING ||
      task.subStatus !== TaskSubStatus.PENDING_ACCEPTANCE
    ) {
      throw new BadRequestException(
        `任务 ${task.code} 当前状态「${task.status}-${task.subStatus}」不可接受`,
      );
    }
    const claimed = await this.dispatchService.claimExecution(
      taskId,
      TaskSubStatus.PENDING_ACCEPTANCE,
    );
    if (!claimed) {
      throw new ConflictException('机器人已有进行中的任务，请稍后接受');
    }
    await this.tasksService.addEvent(
      taskId,
      '状态变更',
      '状态变更：等待中-待接受 → 进行中-执行中（机器人接受任务）',
      worker.name,
      { workerId: worker.id },
    );
    return claimed;
  }

  /** task-refuse：机器人认为任务不匹配时结束并给出分发建议。 */
  async refuse(
    taskId: number,
    worker: Worker,
    reason: string,
    suggestion?: string,
  ): Promise<Task> {
    const task = await this.mustFind(taskId);
    this.assertAgent(task, worker);
    const text = reason.trim();
    if (!text) throw new BadRequestException('拒绝理由 reason 不能为空');
    if (
      task.status !== TaskStatus.WAITING ||
      task.subStatus !== TaskSubStatus.PENDING_ACCEPTANCE
    ) {
      throw new BadRequestException(
        `任务 ${task.code} 当前状态「${task.status}-${task.subStatus}」不可拒绝承接`,
      );
    }
    const updated = await this.tasks.update(
      {
        id: task.id,
        status: TaskStatus.WAITING,
        subStatus: TaskSubStatus.PENDING_ACCEPTANCE,
      },
      {
        status: TaskStatus.FINISHED,
        subStatus: TaskSubStatus.REFUSED,
        refusedAt: new Date(),
        refusedBy: worker.name,
        refusalReason: text,
        dispatchSuggestion: suggestion?.trim() || null,
      },
    );
    if (!updated.affected) throw new ConflictException('任务状态已变化');
    const saved = await this.mustFind(task.id);
    await this.tasksService.addEvent(
      taskId,
      '状态变更',
      `状态变更：等待中-待接受 → 已结束-已拒绝（${text}）`,
      worker.name,
      {
        workerId: worker.id,
        reason: text,
        suggestion: saved.dispatchSuggestion,
      },
    );
    await this.workerInbox.enqueue(saved, 'refused');
    return saved;
  }

  /** task-question-ask：project 生成问题 id 并接管任务状态，不再依赖 opencode 提问。 */
  async ask(
    taskId: number,
    worker: Worker,
    input: AskQuestionInput,
  ): Promise<{ task: Task; questionId: string }> {
    const task = await this.mustFind(taskId);
    this.assertAgent(task, worker);
    if (
      task.status !== TaskStatus.RUNNING ||
      task.subStatus !== TaskSubStatus.EXECUTING
    ) {
      throw new BadRequestException('仅执行中的任务可以提问');
    }
    const questions = (input.questions ?? []).map((question) => ({
      ...question,
      header: question.header?.trim() || '请确认',
      question: question.question?.trim() || '',
    }));
    if (
      questions.length === 0 ||
      questions.length > 20 ||
      questions.some((question) => !question.question)
    ) {
      throw new BadRequestException('questions 须包含 1-20 个非空问题');
    }
    const existing = await this.messages.find({
      where: { taskId, kind: 'question' },
    });
    if (existing.some((row) => row.question?.state === 'pending')) {
      throw new ConflictException('当前任务已有待答复提问');
    }
    const questionId = `project-${randomUUID()}`;
    await this.taskChat.questionAsked(taskId, {
      id: questionId,
      sessionID: task.opencodeSessionId ?? `project-task-${taskId}`,
      questions,
    });
    const updated = await this.tasks.update(
      {
        id: taskId,
        status: TaskStatus.RUNNING,
        subStatus: TaskSubStatus.EXECUTING,
      },
      {
        status: TaskStatus.WAITING,
        subStatus: TaskSubStatus.PENDING_FEEDBACK,
        missingItems: questions.map((question) => ({
          item: question.question,
          reason: question.header,
        })),
        remindCount: 0,
        firstRemindedAt: null,
        lastRemindedAt: null,
        resumePrompt: null,
      },
    );
    if (!updated.affected) {
      this.taskChat.questionSettled(taskId, questionId, 'cancelled');
      throw new ConflictException('任务状态已变化，请刷新后重试');
    }
    const saved = await this.mustFind(taskId);
    await this.tasksService.addEvent(
      taskId,
      '状态变更',
      `状态变更：进行中-执行中 → 等待中-待反馈（project 提问 ${questionId}）`,
      worker.name,
      { questionId, questions },
    );
    await this.workerInbox.enqueue(saved, 'question', {
      referenceId: questionId,
      payload: { questions },
    });
    await this.taskNotify.notifyTaskRequester(
      saved,
      'feedback',
      `任务待反馈：${saved.code} ${saved.title}`,
      questions.map((question) => question.question).join('；'),
    );
    return { task: saved, questionId };
  }

  /** task-question-answer：人或机器人需求方答复，统一进入待继续由 LOOP 恢复。 */
  async answer(
    taskId: number,
    questionId: string,
    actor: TaskActor,
    input: AnswerQuestionInput,
  ): Promise<Task> {
    const task = await this.mustFind(taskId);
    assertTaskRequester(task, actor);
    if (
      task.status !== TaskStatus.WAITING ||
      task.subStatus !== TaskSubStatus.PENDING_FEEDBACK
    ) {
      throw new BadRequestException('仅等待中-待反馈任务可以答复提问');
    }
    const messageKey = `chat:${taskId}:question:${questionId}`;
    const row = await this.messages.findOne({ where: { taskId, messageKey } });
    if (!row?.question || row.question.state !== 'pending') {
      throw new NotFoundException('提问不存在或已答复');
    }
    const rejected = input.reject === true;
    const answers = rejected
      ? undefined
      : (input.answers ?? []).map((answer) => [...answer]);
    if (!rejected && answers?.length !== row.question.questions.length) {
      throw new BadRequestException('answers 数量必须与问题数量一致');
    }
    row.question = {
      ...row.question,
      state: rejected ? 'rejected' : 'answered',
      answers,
    };
    row.status = 'complete';
    await this.messages.save(row);
    await this.taskChat.questionAsked(taskId, {
      id: questionId,
      sessionID: row.question.sessionId,
      questions: row.question.questions,
    });
    this.taskChat.questionSettled(
      taskId,
      questionId,
      rejected ? 'rejected' : 'answered',
      answers,
    );
    const answerText = rejected
      ? '需求方跳过本次提问。'
      : row.question.questions
          .map(
            (question, index) =>
              `问：${question.question}\n答：${(answers?.[index] ?? []).join('、') || '（空）'}`,
          )
          .join('\n\n');
    const updated = await this.tasks.update(
      {
        id: taskId,
        status: TaskStatus.WAITING,
        subStatus: TaskSubStatus.PENDING_FEEDBACK,
      },
      {
        subStatus: TaskSubStatus.PENDING_RESUME,
        resumePrompt: `# 提问答复（${questionId}）\n\n${answerText}`,
        missingItems: null,
        remindCount: 0,
        firstRemindedAt: null,
        lastRemindedAt: null,
      },
    );
    if (!updated.affected) throw new ConflictException('任务状态已变化');
    const saved = await this.mustFind(taskId);
    await this.tasksService.addEvent(
      taskId,
      '反馈',
      answerText,
      actorName(actor),
      {
        questionId,
        answers: answers ?? null,
        rejected,
        actorType: actor.type,
        actorName: actorName(actor),
        actorWorkerId: actor.type === 'worker' ? actor.worker.id : null,
      },
    );
    await this.tasksService.addEvent(
      taskId,
      '状态变更',
      '状态变更：等待中-待反馈 → 等待中-待继续（需求方已答复）',
      actorName(actor),
      { questionId },
    );
    await this.workerInbox.completeForChild(taskId, 'question', questionId);
    return saved;
  }

  /** task-fail：仅需求方在待验收阶段判定失败。 */
  async fail(taskId: number, actor: TaskActor, reason: string): Promise<Task> {
    const task = await this.mustFind(taskId);
    assertTaskRequester(task, actor);
    const text = reason.trim();
    if (!text) throw new BadRequestException('失败原因 reason 不能为空');
    if (
      task.status !== TaskStatus.WAITING ||
      task.subStatus !== TaskSubStatus.PENDING_ACCEPT
    ) {
      throw new BadRequestException('仅等待中-待验收任务可以判定失败');
    }
    const updated = await this.tasks.update(
      {
        id: task.id,
        status: TaskStatus.WAITING,
        subStatus: TaskSubStatus.PENDING_ACCEPT,
      },
      {
        status: TaskStatus.FINISHED,
        subStatus: TaskSubStatus.FAILED,
        failedAt: new Date(),
        failedBy: actorName(actor),
        failureReason: text,
      },
    );
    if (!updated.affected) throw new ConflictException('任务状态已变化');
    const saved = await this.mustFind(task.id);
    await this.tasksService.addEvent(
      taskId,
      '状态变更',
      `状态变更：等待中-待验收 → 已结束-失败（${text}）`,
      actorName(actor),
      { reason: text },
    );
    await this.workerInbox.completeForChild(taskId, 'handoff');
    await this.dispatchService.discardQueuedConversations(taskId);
    void this.dispatchService
      .destroyAcceptedSession(taskId)
      .catch(() => undefined);
    return saved;
  }

  acceptHandoff(taskId: number, actor: TaskActor): Promise<Task> {
    return this.deliveryService.acceptHandoff(taskId, actor);
  }

  refuseHandoff(
    taskId: number,
    actor: TaskActor,
    content: string,
  ): Promise<Task> {
    return this.deliveryService.refuseHandoff(taskId, actor, content);
  }

  actionMarkdown(title: string, task: Task, extra?: string[]): string {
    return [
      mdFrontmatter({ update: task.updatedAt, title }),
      `# ${title}`,
      '',
      `- ID：${task.id}`,
      `- 编号：${task.code}`,
      `- 状态：${task.status}-${task.subStatus}`,
      ...(extra ?? []),
      '',
    ].join('\n');
  }

  private assertAgent(task: Task, worker: Worker): void {
    if (task.agentId !== worker.id) {
      throw new ForbiddenException(
        `任务 ${task.code} 的执行机器人不是「${worker.name}」`,
      );
    }
  }

  private async mustFind(id: number): Promise<Task> {
    const task = await this.tasks.findOne({ where: { id } });
    if (!task) throw new NotFoundException(`Task ${id} not found`);
    return task;
  }
}
