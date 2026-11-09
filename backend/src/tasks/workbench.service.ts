import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { Observable } from 'rxjs';
import { FindOptionsWhere, In, IsNull, Repository } from 'typeorm';
import type { User } from '../auth/user.entity';
import { TaskStatus, TaskSubStatus } from '../common/enums';
import { WorkerRuntime } from '../common/enums';
import { Worker } from '../workers/worker.entity';
import type {
  WorkerDebugAttachment,
  WorkerDebugModelCatalog,
  WorkerDebugModelSelection,
  WorkerDebugSnapshot,
} from '../workers/worker-debug.types';
import {
  PersonalAgentInfo,
  PersonalAgentsService,
} from '../workers/personal-agents.service';
import { WorkersService } from '../workers/workers.service';
import { Task } from './task.entity';
import type { WorkbenchHandoffPayload } from './task-delivery-report';
import { parseWorkbenchHandoff } from './task-delivery-report';
import { TaskChatService } from './task-chat.service';
import type { TaskChatQuestionInfo } from './task-chat.types';
import { TaskCollaborationService } from './task-collaboration.service';
import { TaskDeliveryService } from './task-delivery.service';
import type {
  TaskHandoffDocument,
  TaskHandoffUpdateInput,
} from './task-document.service';
import { TaskDispatchService } from './task-dispatch.service';
import { type TaskActor, workerRequesterActor } from './task-requester';
import { TasksService } from './tasks.service';
import { deriveWorkbenchRoles, type WorkbenchRole } from './workbench-roles';

export type { WorkbenchRole } from './workbench-roles';

/** 操作台任务项：任务本体 + 当前用户可扮演的角色与下一步动作 */
export interface WorkbenchTask extends Task {
  /**
   * agent=我的真人机器人执行；requester=我（含历史个人 AGENT 需求方）是需求方；
   * responsible=我负责的机器人/已接管任务。responsible 仅用于任务可见与管理提示，
   * 不参与任务沟通（沟通仅限需求方与当前真人执行机器人）。
   */
  workbenchRoles: WorkbenchRole[];
  /** 当前需要当前用户处理的动作；空表示等待其他参与方 */
  workbenchAction: string | null;
}

export interface WorkbenchSummary {
  worker: Worker;
  /** 当前用户的个人 AI AGENT（工作台「我的 AGENT」TAB） */
  agent: PersonalAgentInfo;
  tasks: WorkbenchTask[];
}

const WORKBENCH_STATUSES = [
  TaskStatus.WAITING,
  TaskStatus.RUNNING,
  TaskStatus.FINISHED,
];
/** 操作台单次返回上限：等待/进行通常很少；已完成只保留最近记录，避免清单无限增长 */
const WORKBENCH_TASK_LIMIT = 300;

/** 详情页「我的 AI」可用的页面类型 */
export type AgentPageContextType = 'document' | 'script' | 'project';

/** 详情页上下文入参（query/body 原始值） */
export interface AgentPageContextInput {
  type?: string;
  id?: string;
  title?: string;
  summary?: string;
  readUrl?: string;
}

/** 规范化后的详情页 AI 上下文 */
export interface AgentPageContext {
  type: AgentPageContextType;
  id: string;
  title?: string;
  summary?: string;
  readUrl?: string;
}

const AGENT_PAGE_TYPES = new Set<AgentPageContextType>([
  'document',
  'script',
  'project',
]);
const AGENT_PAGE_LABELS: Record<AgentPageContextType, string> = {
  document: '文档',
  script: '脚本',
  project: '项目',
};

/**
 * 校验并规范化详情页上下文。
 * 未提供 type 时返回 null（沿用任务/通用会话）；提供了 type 但缺 id 视为非法。
 */
export function normalizeAgentPageContext(
  input?: AgentPageContextInput | null,
): AgentPageContext | null {
  const type = input?.type?.trim();
  if (!type) return null;
  if (!AGENT_PAGE_TYPES.has(type as AgentPageContextType)) {
    throw new BadRequestException('不支持的 AI 页面上下文类型');
  }
  const id = input?.id?.trim();
  if (!id) throw new BadRequestException('缺少 AI 页面上下文 ID');
  if (id.length > 500) {
    throw new BadRequestException('AI 页面上下文 ID 过长');
  }
  const title = input?.title?.trim().slice(0, 200) || undefined;
  const summary = input?.summary?.trim().slice(0, 2000) || undefined;
  const readUrl = input?.readUrl?.trim();
  return {
    type: type as AgentPageContextType,
    id,
    title,
    summary,
    // 仅透传站内只读接口，避免把任意 URL 带进提示词
    ...(readUrl?.startsWith('/api/') ? { readUrl: readUrl.slice(0, 500) } : {}),
  };
}

/** 每个详情页一个稳定且较短的会话范围（路径等长 ID 先取哈希） */
function agentPageScope(context: AgentPageContext): string {
  const hash = createHash('sha1')
    .update(`${context.type}:${context.id}`)
    .digest('hex')
    .slice(0, 20);
  return `agent:page:${context.type}:${hash}`;
}

/** 详情页上下文仅作为本轮提示词前缀，不写入用户气泡 */
function buildAgentPagePrompt(context: AgentPageContext): string {
  return [
    '# 当前详情页',
    '',
    `- 页面类型：${AGENT_PAGE_LABELS[context.type]}`,
    `- 标题：${context.title ?? context.id}`,
    ...(context.summary ? [`- 概要：${context.summary}`] : []),
    ...(context.readUrl ? [`- 内容读取接口：${context.readUrl}`] : []),
    '',
    '回答或操作前先读取当前页面对应的内容，不要假设页面之外的上下文。',
  ].join('\n');
}

/**
 * 操作台：真人通过自己的绑定机器人参与任务。
 * 所有方法都先校验“当前登录用户 === 任务执行机器人绑定的用户”，
 * 再复用任务中心的机器人协同/交付服务，避免为真人另建一套状态机。
 */
@Injectable()
export class WorkbenchService {
  constructor(
    @InjectRepository(Task)
    private readonly tasks: Repository<Task>,
    @InjectRepository(Worker)
    private readonly workers: Repository<Worker>,
    private readonly workersService: WorkersService,
    private readonly personalAgents: PersonalAgentsService,
    private readonly collaboration: TaskCollaborationService,
    private readonly deliveryService: TaskDeliveryService,
    private readonly dispatchService: TaskDispatchService,
    private readonly taskChat: TaskChatService,
    private readonly tasksService: TasksService,
  ) {}

  /** 单个任务在当前用户视角下的工作台角色与下一步动作 */
  async taskDetail(user: User, taskId: number): Promise<WorkbenchTask> {
    const worker = await this.workersService.mustHumanWorker(user.id);
    const personalAgent = await this.personalAgents.findForUser(user.id);
    const ownedWorkers = await this.workers.find({
      where: { ownerUserId: user.id, personalAgentUserId: IsNull() },
      select: { id: true },
    });
    const task = await this.tasks.findOne({ where: { id: taskId } });
    if (!task) throw new BadRequestException('任务不存在');
    return this.toWorkbenchTask(
      task,
      worker,
      user,
      personalAgent?.id ?? null,
      ownedWorkers.map((item) => item.id),
    );
  }

  /** 当前用户的工作台任务清单：进行中 + 等待中 + 最近已完成 */
  async summary(user: User): Promise<WorkbenchSummary> {
    const worker = await this.workersService.mustHumanWorker(user.id);
    const agent = await this.personalAgents
      .infoForUser(user)
      .catch((error: Error) => ({
        worker: null,
        available: false,
        reason: `个人 AGENT 加载失败：${error.message}`,
      }));
    const personalAgentId = agent.worker?.id ?? null;
    const ownedWorkers = await this.workers.find({
      where: { ownerUserId: user.id, personalAgentUserId: IsNull() },
      select: { id: true },
    });
    const ownedWorkerIds = ownedWorkers.map((item) => item.id);
    const where: FindOptionsWhere<Task>[] = [
      { agentId: worker.id, status: In(WORKBENCH_STATUSES) },
      {
        requesterType: 'worker' as const,
        requesterId: worker.id,
        status: In(WORKBENCH_STATUSES),
      },
      {
        requesterType: 'user' as const,
        requesterId: user.id,
        status: In(WORKBENCH_STATUSES),
      },
      {
        ownerTakeoverUserId: user.id,
        status: In(WORKBENCH_STATUSES),
      },
    ];
    if (personalAgentId) {
      // 个人 AGENT 不再执行任务；仅保留历史任务（需求方=个人 AGENT）的兼容查询，
      // 这些任务对外仍以真人身份参与。
      where.push({
        requesterType: 'worker' as const,
        requesterId: personalAgentId,
        status: In(WORKBENCH_STATUSES),
      });
    }
    if (ownedWorkerIds.length > 0) {
      where.push({
        agentId: In(ownedWorkerIds),
        status: In(WORKBENCH_STATUSES),
      });
    }
    const rows = await this.tasks.find({
      where,
      order: { updatedAt: 'DESC' },
      take: WORKBENCH_TASK_LIMIT,
    });
    const byId = new Map<number, Task>();
    for (const row of rows) byId.set(row.id, row);
    const tasks = [...byId.values()].map((task) =>
      this.toWorkbenchTask(task, worker, user, personalAgentId, ownedWorkerIds),
    );
    // 默认兜底排序；前端会按“分配到自己机器人”的时间分三组倒序展示。
    tasks.sort((a, b) => {
      const actionA = a.workbenchAction ? 0 : 1;
      const actionB = b.workbenchAction ? 0 : 1;
      if (actionA !== actionB) return actionA - actionB;
      const assignedA = a.assignedAt ?? a.updatedAt;
      const assignedB = b.assignedAt ?? b.updatedAt;
      return new Date(assignedB).getTime() - new Date(assignedA).getTime();
    });
    return { worker, agent, tasks };
  }

  /** 当前用户必须是其个人机器人，且该机器人是任务执行方 */
  private async agentWorker(
    user: User,
    taskId: number,
  ): Promise<{ worker: Worker; task: Task }> {
    const worker = await this.workersService.mustHumanWorker(user.id);
    if (worker.runtime !== WorkerRuntime.HUMAN) {
      throw new BadRequestException('当前用户绑定的不是真人机器人');
    }
    const task = await this.tasks.findOne({ where: { id: taskId } });
    if (!task) throw new BadRequestException('任务不存在');
    if (task.agentId !== worker.id) {
      throw new ForbiddenException('仅任务的真人执行机器人可以操作');
    }
    return { worker, task };
  }

  /** 真人接受任务 */
  acceptTask(user: User, taskId: number): Promise<Task> {
    return this.withAgentWorker(user, taskId, (worker) =>
      this.collaboration.accept(taskId, worker),
    );
  }

  /** 真人拒绝任务（必须给理由与分发建议） */
  refuseTask(
    user: User,
    taskId: number,
    reason: string,
    suggestion?: string,
  ): Promise<Task> {
    return this.withAgentWorker(user, taskId, (worker) =>
      this.collaboration.refuse(taskId, worker, reason, suggestion),
    );
  }

  /** 真人执行回复：直接落库并实时推送，不进入 opencode 队列 */
  async sendMessage(
    user: User,
    taskId: number,
    content: string,
  ): Promise<Task> {
    const { worker, task } = await this.agentWorker(user, taskId);
    const text = content.trim();
    if (!text) throw new BadRequestException('消息内容不能为空');
    // 只有已结束任务不能再发消息；其余状态（含待验收）都可继续对话。
    if (task.status === TaskStatus.FINISHED) {
      throw new BadRequestException('任务已结束，不能发送消息');
    }
    const message = await this.taskChat.postAssistantMessage(taskId, text, {
      meta: {
        humanWorkerMessage: true,
        workerId: worker.id,
        perspective: 'responsible',
      },
    });
    await this.dispatchService.addEvent(
      taskId,
      '操作',
      `真人机器人在操作台回复`,
      worker.name,
      { humanWorker: true },
    );
    // 子任务需求方是 AI 机器人时进入收件箱，由 LOOP 唤醒父机器人回复。
    await this.dispatchService.notifyRequesterWorkerMessage(
      task,
      text,
      message.id,
    );
    return this.tasks.findOneOrFail({ where: { id: taskId } });
  }

  /** 工作台读取交付文档；参与者可看，编辑权限在更新时单独校验。 */
  async getHandoff(user: User, taskId: number): Promise<TaskHandoffDocument> {
    await this.handoffTaskAccess(user, taskId);
    return this.deliveryService.getHandoff(taskId);
  }

  /** 需求方或真人执行者维护交付文档（版本冲突由服务层返回 409）。 */
  async updateHandoff(
    user: User,
    taskId: number,
    input: TaskHandoffUpdateInput,
  ): Promise<TaskHandoffDocument> {
    const { isRequester, isAgent } = await this.handoffTaskAccess(user, taskId);
    if (!isRequester && !isAgent) {
      throw new ForbiddenException('仅任务需求方或真人执行方可以编辑交付文档');
    }
    return this.deliveryService.updateHandoffByUser(taskId, user, input);
  }

  /** 工作台可见性：需求方、当前真人执行者、机器人负责人或接管人。 */
  private async handoffTaskAccess(
    user: User,
    taskId: number,
  ): Promise<{ task: Task; isRequester: boolean; isAgent: boolean }> {
    const worker = await this.workersService.mustHumanWorker(user.id);
    const personalAgent = await this.personalAgents.findForUser(user.id);
    const task = await this.tasks.findOne({ where: { id: taskId } });
    if (!task) throw new BadRequestException('任务不存在');
    const isRequester =
      (task.requesterType === 'worker' &&
        (task.requesterId === worker.id ||
          task.requesterId === personalAgent?.id)) ||
      (task.requesterType === 'user' && task.requesterId === user.id) ||
      (!task.requesterType && task.createdById === user.id);
    const isAgent = task.agentId === worker.id;
    const agent = task.agentId
      ? await this.workers.findOne({
          where: { id: task.agentId },
          select: { id: true, ownerUserId: true },
        })
      : null;
    const isOwner =
      agent?.ownerUserId === user.id || task.ownerTakeoverUserId === user.id;
    if (!isRequester && !isAgent && !isOwner) {
      throw new ForbiddenException('无权访问该任务的交付文档');
    }
    return { task, isRequester, isAgent };
  }

  /** 真人向需求方提问 */
  askQuestion(
    user: User,
    taskId: number,
    questions: TaskChatQuestionInfo[],
  ): Promise<{ task: Task; questionId: string }> {
    return this.withAgentWorker(user, taskId, (worker) =>
      this.collaboration.ask(taskId, worker, { questions }),
    );
  }

  /** 真人申请验收：交付内容以任务交付文档为准，不再随申请弹窗提交。 */
  applyHandoff(
    user: User,
    taskId: number,
    input: WorkbenchHandoffPayload = {},
  ): Promise<Task> {
    const report = parseWorkbenchHandoff(input);
    return this.withAgentWorker(user, taskId, async (worker) => {
      const applied = await this.dispatchService.applyForAcceptance(
        taskId,
        worker,
        {
          requesterName: user.name ?? worker.name,
          report: report ?? undefined,
        },
      );
      return applied.task;
    });
  }

  /** 真人撤销交付：任务回到执行中，旧验收申请失效 */
  revokeHandoff(user: User, taskId: number): Promise<Task> {
    return this.withAgentWorker(user, taskId, (worker) =>
      this.dispatchService.revokeAcceptance(taskId, worker),
    );
  }

  /** 真人作为父任务需求方或执行方创建子任务 */
  async createSubtask(
    user: User,
    taskId: number,
    input: {
      /** 双角色用户按当前 Tab 明确指定身份；未传时保留旧的自动判断 */
      perspective?: 'requester' | 'responsible';
      templateId: number;
      title: string;
      description?: string | null;
      input?: string | null;
      outputSpec?: string | null;
    },
  ): Promise<Task> {
    const worker = await this.workersService.mustHumanWorker(user.id);
    const task = await this.tasks.findOne({ where: { id: taskId } });
    if (!task) throw new BadRequestException('任务不存在');
    let actor: TaskActor;
    if (input.perspective === 'requester') {
      actor = (await this.requesterTask(user, taskId)).actor;
    } else if (input.perspective === 'responsible') {
      if (task.agentId !== worker.id) {
        throw new ForbiddenException(
          '仅任务的执行机器人可以以执行方身份创建子任务',
        );
      }
      actor = { type: 'worker', worker };
    } else {
      actor =
        task.agentId === worker.id
          ? { type: 'worker', worker }
          : (await this.requesterTask(user, taskId)).actor;
    }
    return this.collaboration.createSubtaskForActor(taskId, actor, input);
  }

  /** 停止任务：发起者或管理员；级联取消全部未结束子任务 */
  async cancelTask(user: User, taskId: number): Promise<Task> {
    return this.tasksService.cancelForUser(taskId, user);
  }

  /** 需求方身份：优先真人机器人 / 个人 AGENT，历史数据回退用户本人 */
  private requesterActor(
    task: Task,
    user: User,
    worker: Worker,
    personalAgent: Worker | null,
  ): TaskActor {
    if (task.requesterType === 'worker') {
      if (task.requesterId === worker.id) {
        return workerRequesterActor(worker);
      }
      // 历史任务需求方是个人 AGENT：后续由主人的真人机器人操作，
      // 同时保留个人 AGENT Worker ID 作为需求方归属校验别名。
      if (personalAgent && task.requesterId === personalAgent.id) {
        return workerRequesterActor(worker, personalAgent);
      }
    }
    return { type: 'user', user };
  }

  /** 确认当前用户/其机器人/其个人 AGENT 是任务需求方 */
  private async requesterTask(
    user: User,
    taskId: number,
  ): Promise<{ worker: Worker; task: Task; actor: TaskActor }> {
    const worker = await this.workersService.mustHumanWorker(user.id);
    const personalAgent = await this.personalAgents.findForUser(user.id);
    const task = await this.tasks.findOne({ where: { id: taskId } });
    if (!task) throw new BadRequestException('任务不存在');
    const isWorkerRequester =
      task.requesterType === 'worker' &&
      (task.requesterId === worker.id ||
        task.requesterId === personalAgent?.id);
    const isLegacyUserRequester =
      task.requesterType === 'user' && task.requesterId === user.id;
    const isLegacyCreator = !task.requesterType && task.createdById === user.id;
    if (!isWorkerRequester && !isLegacyUserRequester && !isLegacyCreator) {
      throw new ForbiddenException('仅任务需求方可以操作');
    }
    return {
      worker,
      task,
      actor: this.requesterActor(task, user, worker, personalAgent),
    };
  }

  /** 验收通过 */
  acceptHandoff(user: User, taskId: number): Promise<Task> {
    return this.withRequesterTask(user, taskId, ({ actor }) =>
      this.deliveryService.acceptHandoff(taskId, actor),
    );
  }

  /** 验收不通过/返工 */
  rejectHandoff(user: User, taskId: number, content: string): Promise<Task> {
    return this.withRequesterTask(user, taskId, ({ actor }) =>
      this.deliveryService.refuseHandoff(taskId, actor, content),
    );
  }

  /** 判定失败 */
  failTask(user: User, taskId: number, reason: string): Promise<Task> {
    return this.withRequesterTask(user, taskId, ({ actor }) =>
      this.collaboration.fail(taskId, actor, reason),
    );
  }

  /** 答复或跳过真人/AI 机器人的提问 */
  replyQuestion(
    user: User,
    taskId: number,
    questionId: string,
    input: { answers?: string[][]; reject?: boolean },
  ): Promise<Task> {
    return this.withRequesterTask(user, taskId, ({ actor }) =>
      this.collaboration.answer(taskId, questionId, actor, input),
    );
  }

  /** 我的 AGENT：可用状态（工作台 TAB 头部/异常态） */
  agentInfo(user: User): Promise<PersonalAgentInfo> {
    return this.personalAgents.infoForUser(user);
  }

  /** 我的 AGENT：对话快照（任务或详情页独立会话） */
  agentSnapshot(
    user: User,
    taskId?: number | null,
    pageContext?: AgentPageContext | null,
  ): Promise<WorkerDebugSnapshot> {
    return this.personalAgents.snapshot(
      user,
      taskId,
      pageContext ? agentPageScope(pageContext) : null,
    );
  }

  /** 我的 AGENT：对话 SSE（任务或详情页独立会话） */
  agentStream(
    user: User,
    taskId?: number | null,
    pageContext?: AgentPageContext | null,
  ): Observable<MessageEvent> {
    return this.personalAgents.stream(
      user,
      taskId,
      pageContext ? agentPageScope(pageContext) : null,
    );
  }

  /** 我的 AGENT：发送消息；可携带当前任务或详情页作为上下文 */
  async agentSend(
    user: User,
    content: string,
    taskId?: number | null,
    files?: WorkerDebugAttachment[],
    pageContext?: AgentPageContext | null,
  ): Promise<WorkerDebugSnapshot> {
    const text = content.trim();
    if (!text && !files?.length) {
      throw new BadRequestException('消息内容不能为空');
    }
    let taskContext: string | null = null;
    if (taskId) {
      const task = await this.tasks.findOne({ where: { id: Number(taskId) } });
      if (!task) throw new BadRequestException('任务不存在');
      const worker = await this.workersService.mustHumanWorker(user.id);
      const personalAgent = await this.personalAgents.findForUser(user.id);
      const ownedWorkers = await this.workers.find({
        where: { ownerUserId: user.id, personalAgentUserId: IsNull() },
        select: { id: true },
      });
      const roles = deriveWorkbenchRoles(task, user, {
        humanWorker: worker,
        personalAgentId: personalAgent?.id ?? null,
        ownedWorkerIds: ownedWorkers.map((item) => item.id),
      });
      // 任务详情网页对登录用户可见，个人 AGENT 也按同一可见范围提供上下文；
      // 无参与角色时只作为查看者，写操作仍由任务中心现有权限校验拦截。
      taskContext = [
        '# 当前任务',
        '',
        `- 任务 ID：${task.id}`,
        `- 编号：${task.code}`,
        `- 标题：${task.title}`,
        `- 状态：${task.status}-${task.subStatus}`,
        `- 你在该任务中的角色：${roles.length > 0 ? roles.join(' / ') : '查看者（只读）'}`,
        `- 详情接口：GET /api/tasks/${task.id}.md`,
        '',
        roles.length > 0
          ? '如需操作该任务，先读取详情确认最新状态，再按个人 AGENT 角色定义中的接口执行。'
          : '你当前不是该任务的需求方、执行方或负责方，只能查看和解释任务信息，不要调用会修改任务状态或文档的接口。',
      ].join('\n');
    } else if (pageContext) {
      taskContext = buildAgentPagePrompt(pageContext);
    }
    return this.personalAgents.send(user, text, {
      taskId,
      scope: pageContext ? agentPageScope(pageContext) : null,
      taskContext,
      files,
    });
  }

  /** 我的 AGENT：模型与思考等级清单 */
  agentModels(
    user: User,
    taskId?: number | null,
    pageContext?: AgentPageContext | null,
  ): Promise<WorkerDebugModelCatalog> {
    return this.personalAgents.models(
      user,
      taskId,
      pageContext ? agentPageScope(pageContext) : null,
    );
  }

  /** 我的 AGENT：切换模型/思考等级 */
  agentSetModel(
    user: User,
    input: WorkerDebugModelSelection,
    taskId?: number | null,
    pageContext?: AgentPageContext | null,
  ): Promise<WorkerDebugSnapshot> {
    return this.personalAgents.setModel(
      user,
      input,
      taskId,
      pageContext ? agentPageScope(pageContext) : null,
    );
  }

  /** 我的 AGENT：中断当前轮次 */
  agentInterrupt(
    user: User,
    taskId?: number | null,
    pageContext?: AgentPageContext | null,
  ): Promise<WorkerDebugSnapshot> {
    return this.personalAgents.interrupt(
      user,
      taskId,
      pageContext ? agentPageScope(pageContext) : null,
    );
  }

  /** 我的 AGENT：回答/跳过提问 */
  agentReplyQuestion(
    user: User,
    questionId: string,
    input: { answers?: string[][]; reject?: boolean },
    taskId?: number | null,
    pageContext?: AgentPageContext | null,
  ): Promise<WorkerDebugSnapshot> {
    return this.personalAgents.replyQuestion(
      user,
      questionId,
      input,
      taskId,
      pageContext ? agentPageScope(pageContext) : null,
    );
  }

  /** 我的 AGENT：重置会话 */
  agentReset(
    user: User,
    taskId?: number | null,
    pageContext?: AgentPageContext | null,
  ): Promise<WorkerDebugSnapshot> {
    return this.personalAgents.reset(
      user,
      taskId,
      pageContext ? agentPageScope(pageContext) : null,
    );
  }

  private async withAgentWorker<T>(
    user: User,
    taskId: number,
    fn: (worker: Worker) => Promise<T>,
  ): Promise<T> {
    const { worker } = await this.agentWorker(user, taskId);
    return fn(worker);
  }

  private async withRequesterTask<T>(
    user: User,
    taskId: number,
    fn: (context: {
      worker: Worker;
      task: Task;
      actor: TaskActor;
    }) => Promise<T>,
  ): Promise<T> {
    const context = await this.requesterTask(user, taskId);
    return fn(context);
  }

  private toWorkbenchTask(
    task: Task,
    worker: Worker,
    user: User,
    personalAgentId: number | null,
    ownedWorkerIds: number[] = [],
  ): WorkbenchTask {
    const roles = deriveWorkbenchRoles(task, user, {
      humanWorker: worker,
      personalAgentId,
      ownedWorkerIds,
    });
    return {
      ...task,
      workbenchRoles: roles,
      workbenchAction: this.actionOf(task, roles),
    };
  }

  private actionOf(task: Task, roles: WorkbenchRole[]): string | null {
    if (roles.includes('agent')) {
      if (
        task.status === TaskStatus.WAITING &&
        task.subStatus === TaskSubStatus.PENDING_ACCEPTANCE
      ) {
        return '接受任务';
      }
      if (
        task.status === TaskStatus.RUNNING &&
        task.subStatus === TaskSubStatus.EXECUTING
      ) {
        return '继续执行';
      }
      if (
        task.status === TaskStatus.WAITING &&
        task.subStatus === TaskSubStatus.PENDING_RESUME
      ) {
        return '恢复执行';
      }
    }
    if (roles.includes('requester')) {
      if (
        task.status === TaskStatus.WAITING &&
        task.subStatus === TaskSubStatus.PENDING_FEEDBACK
      ) {
        return '答复提问';
      }
      if (
        task.status === TaskStatus.WAITING &&
        task.subStatus === TaskSubStatus.PENDING_ACCEPT
      ) {
        return '验收交付';
      }
    }
    if (roles.includes('responsible')) {
      if (
        task.status === TaskStatus.WAITING &&
        task.subStatus === TaskSubStatus.PENDING_FEEDBACK
      ) {
        return '提供反馈';
      }
    }
    return null;
  }
}
