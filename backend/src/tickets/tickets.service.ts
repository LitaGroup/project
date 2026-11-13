import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import type { User } from '../auth/user.entity';
import type { AuthedRequest } from '../auth/auth.guard';
import { TaskStatus, TaskSubStatus, WorkerRole } from '../common/enums';
import { beijingTime, mdFrontmatter } from '../common/frontmatter';
import { unescapeMarkdown } from '../common/markdown-escape';
import { TaskDispatchService } from '../tasks/task-dispatch.service';
import { TaskTemplate } from '../tasks/task-template.entity';
import { Task } from '../tasks/task.entity';
import { TasksService } from '../tasks/tasks.service';
import { TaskDocumentService } from '../tasks/task-document.service';
import { TaskMessage } from '../tasks/task-message.entity';
import { Worker } from '../workers/worker.entity';
import { findTicketCategory } from './ticket-categories';
import { TicketConfig } from './ticket-config.entity';
import { TicketDocumentsService } from './ticket-documents.service';
import { Ticket } from './ticket.entity';
import { TicketWorkflowRun } from './ticket-workflow-run.entity';
import {
  renderInputValues,
  type TicketCreateActor,
  TicketWorkflowRuntimeService,
} from './ticket-workflow-runtime.service';

export interface CreateTicketInput {
  title?: string;
  /** 工单配置：按起始节点字段创建工作流工单 */
  workflowDefinitionId?: number;
  inputValues?: Record<string, unknown>;
  /** 关联迭代项（backlogs.id，可空；迭代项提测入口创建时传入） */
  backlogId?: number;
}

export interface RouteTicketInput {
  templateId: number;
  title: string;
  content: string;
  outputSpec: string;
  workPlan: string;
}

export interface TicketView extends Ticket {
  /** 推导状态：待分配/待接受/待反馈/待继续/待申请验收/待验收/处理中/已完成/已失败/已取消 */
  status: string;
  task: Task | null;
  /** 工作流工单的运行视图；历史工单为空 */
  workflow?: Awaited<ReturnType<TicketWorkflowRuntimeService['workflowView']>>;
}

function markdownText(value: string | null | undefined): string {
  return value?.trim() || '（暂无）';
}

const NODE_KIND_LABEL: Record<string, string> = {
  start: '起始',
  operation: '操作',
  approval: '审批',
  acceptance: '验收',
  condition: '判断',
};

const OUTCOME_LABEL: Record<string, string> = {
  succeeded: '执行成功',
  failed: '执行失败',
  approved: '审批通过',
  rejected: '审批驳回',
};

const TICKET_STATUS_FAILED = '已失败';

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
}

/** 工单推导状态：保留工作流子状态，终态统一收敛为业务语义 */
export function deriveTicketStatus(task: Task | null): string {
  if (!task) return '已取消';
  if (task.status === TaskStatus.FINISHED) {
    if (task.subStatus === TaskSubStatus.COMPLETED) return '已完成';
    if (task.subStatus === TaskSubStatus.CANCELED) return '已取消';
    return '已失败';
  }
  if (task.status === TaskStatus.RUNNING) return '处理中';
  return task.subStatus;
}

/**
 * 工单：通过工单配置（工作流）创建，节点任务按任务定义派发；
 * 历史调度工单保留只读与转交通道，对话、验收、失败、取消全部复用任务中心。
 */
@Injectable()
export class TicketsService {
  private readonly logger = new Logger(TicketsService.name);
  private readonly apiUrl: string;

  constructor(
    @InjectRepository(Ticket)
    private readonly tickets: Repository<Ticket>,
    @InjectRepository(TicketWorkflowRun)
    private readonly workflowRuns: Repository<TicketWorkflowRun>,
    @InjectRepository(TicketConfig)
    private readonly configs: Repository<TicketConfig>,
    @InjectRepository(Task)
    private readonly tasks: Repository<Task>,
    @InjectRepository(TaskMessage)
    private readonly taskMessages: Repository<TaskMessage>,
    @InjectRepository(TaskTemplate)
    private readonly templates: Repository<TaskTemplate>,
    @InjectRepository(Worker)
    private readonly workers: Repository<Worker>,
    private readonly tasksService: TasksService,
    private readonly dispatchService: TaskDispatchService,
    private readonly taskDocuments: TaskDocumentService,
    private readonly ticketDocuments: TicketDocumentsService,
    private readonly workflowRuntime: TicketWorkflowRuntimeService,
    config: ConfigService,
  ) {
    this.apiUrl = (
      config.get<string>('API_URL') ?? 'http://localhost:3100/api'
    ).replace(/\/+$/, '');
  }

  /** 「我的工单」参与身份：用户的真人机器人与个人 AGENT */
  private async participantWorkerIds(userId: number): Promise<number[]> {
    const rows = await this.workers.find({
      where: [{ humanUserId: userId }, { personalAgentUserId: userId }],
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  async findAll(params: {
    category?: string;
    status?: string;
    q?: string;
    workflowDefinitionId?: number;
    /** 用户 ID：仅返回该用户参与的工单（「我的工单」） */
    participantUserId?: number;
  }): Promise<TicketView[]> {
    const qb = this.tickets.createQueryBuilder('t');
    if (params.participantUserId !== undefined) {
      const workerIds = await this.participantWorkerIds(
        params.participantUserId,
      );
      let runTicketIds: number[] = [];
      let joinedTaskIds: number[] = [];
      if (workerIds.length) {
        const [runs, joinedTasks] = await Promise.all([
          this.workflowRuns.find({
            where: { agentId: In(workerIds) },
            select: { ticketId: true },
          }),
          this.tasks.find({
            where: [
              { agentId: In(workerIds) },
              { requesterType: 'worker', requesterId: In(workerIds) },
              { requesterType: 'user', requesterId: params.participantUserId },
              { ownerTakeoverUserId: params.participantUserId },
            ],
            select: { id: true },
          }),
        ]);
        runTicketIds = [...new Set(runs.map((run) => run.ticketId))];
        joinedTaskIds = joinedTasks.map((task) => task.id);
      }
      // 参与身份：创建人 / 历史工单直接处理人 / 经我的机器人发起、处理节点或承接关联任务
      const conditions = [
        't.createdById = :participantUserId',
        "(t.assigneeType = 'user' AND t.assigneeId = :participantUserId)",
      ];
      const bindings: Record<string, unknown> = {
        participantUserId: params.participantUserId,
      };
      if (workerIds.length) {
        conditions.push('t.initiatorWorkerId IN (:...participantWorkerIds)');
        bindings.participantWorkerIds = workerIds;
      }
      if (runTicketIds.length) {
        conditions.push('t.id IN (:...runTicketIds)');
        bindings.runTicketIds = runTicketIds;
      }
      if (joinedTaskIds.length) {
        conditions.push('t.taskId IN (:...joinedTaskIds)');
        bindings.joinedTaskIds = joinedTaskIds;
      }
      qb.andWhere(`(${conditions.join(' OR ')})`, bindings);
    }
    if (params.workflowDefinitionId) {
      qb.andWhere('t.workflowDefinitionId = :workflowDefinitionId', {
        workflowDefinitionId: params.workflowDefinitionId,
      });
    } else if (params.category) {
      const category = findTicketCategory(params.category);
      if (!category) return [];
      qb.andWhere('t.category = :category', { category });
    }
    const q = params.q?.trim().toLowerCase();
    if (q) {
      qb.andWhere('(LOWER(t.code) LIKE :q OR LOWER(t.title) LIKE :q)', {
        q: `%${q}%`,
      });
    }
    const rows = await qb
      .orderBy('t.createdAt', 'DESC')
      .addOrderBy('t.id', 'DESC')
      .getMany();
    const tasks = rows.some((row) => row.taskId)
      ? await this.tasks.find({
          where: {
            id: In(
              rows
                .map((row) => row.taskId)
                .filter((id): id is number => Boolean(id)),
            ),
          },
        })
      : [];
    const taskById = new Map(tasks.map((task) => [task.id, task]));
    // 历史工单的处理机器人若是个人 AGENT，对外统一显示其主人姓名
    const agentIds = [...new Set(rows.map((row) => row.assigneeId))];
    const agents = agentIds.length
      ? await this.workers.find({
          where: { id: In(agentIds) },
          select: {
            id: true,
            name: true,
            ownerName: true,
            personalAgentUserId: true,
          },
        })
      : [];
    const agentById = new Map(agents.map((agent) => [agent.id, agent]));
    const status = params.status?.trim();
    const views = await Promise.all(
      rows.map(async (ticket) => {
        const task = ticket.taskId
          ? (taskById.get(ticket.taskId) ?? null)
          : null;
        const agent = agentById.get(ticket.assigneeId);
        const assigneeName =
          agent?.personalAgentUserId && agent.ownerName
            ? agent.ownerName
            : ticket.assigneeName;
        const workflow = ticket.workflowDefinitionId
          ? await this.workflowRuntime.workflowView(ticket)
          : null;
        const workflowStatus = workflow?.status;
        return {
          ...ticket,
          assigneeName,
          task,
          status: workflowStatus ?? deriveTicketStatus(task),
          workflow,
        };
      }),
    );
    return views.filter((ticket) => !status || ticket.status === status);
  }

  async findOne(id: number): Promise<TicketView> {
    const ticket = await this.mustFind(id);
    const workflow = ticket.workflowDefinitionId
      ? await this.workflowRuntime.workflowView(ticket)
      : null;
    const task = ticket.taskId
      ? await this.tasks.findOne({ where: { id: ticket.taskId } })
      : null;
    // 历史工单的处理机器人若是个人 AGENT，对外统一显示其主人姓名
    const assignee = await this.workers.findOne({
      where: { id: ticket.assigneeId },
      select: { id: true, ownerName: true, personalAgentUserId: true },
    });
    const assigneeName =
      assignee?.personalAgentUserId && assignee.ownerName
        ? assignee.ownerName
        : ticket.assigneeName;
    return {
      ...ticket,
      assigneeName,
      task,
      status: workflow?.status ?? deriveTicketStatus(task),
      workflow,
    };
  }

  async create(
    input: CreateTicketInput,
    actor: TicketCreateActor,
  ): Promise<TicketView> {
    if (!input.workflowDefinitionId) {
      // 旧调度模型（category + 默认调度任务定义）已随 ID 10-15 定义一并退役
      throw new BadRequestException(
        '旧版工单类别创建已下线，请通过工单配置（工作流）创建工单',
      );
    }
    const ticket = await this.workflowRuntime.create(
      {
        workflowDefinitionId: input.workflowDefinitionId,
        title: input.title,
        inputValues: input.inputValues ?? {},
        backlogId: input.backlogId,
      },
      actor,
    );
    const workflow = await this.workflowRuntime.workflowView(ticket);
    return {
      ...ticket,
      task: null,
      status: ticket.workflowStatus ?? '处理中',
      workflow,
    };
  }

  /** 工作流工单验收（通过/驳回）；历史工单由运行时拒绝 */
  async acceptWorkflow(
    id: number,
    outcome: 'approved' | 'rejected',
    req: AuthedRequest,
    remark?: string,
  ): Promise<TicketView> {
    const ticket = await this.workflowRuntime.acceptNode(
      id,
      outcome,
      { user: req.user ?? null, worker: req.worker ?? null },
      remark,
    );
    const workflow = await this.workflowRuntime.workflowView(ticket);
    return {
      ...ticket,
      task: null,
      status: ticket.workflowStatus ?? '处理中',
      workflow,
    };
  }

  /**
   * 当前审批节点通过/驳回（真人处理人）：完成任务并推进工单，
   * 不生成交付文档与复盘文档；驳回意见必填。
   */
  async approveWorkflow(
    id: number,
    user: User,
    remark?: string,
  ): Promise<TicketView> {
    const ticket = await this.workflowRuntime.approveNodeByUser(
      id,
      user,
      remark,
    );
    return this.toTicketView(ticket);
  }

  async rejectApprovalWorkflow(
    id: number,
    user: User,
    remark: string,
  ): Promise<TicketView> {
    const ticket = await this.workflowRuntime.rejectNodeByUser(
      id,
      user,
      remark,
    );
    return this.toTicketView(ticket);
  }

  /** 按节点任务定位工单后审批通过（任务详情/飞书卡片入口） */
  async approveTaskApproval(
    taskId: number,
    user: User,
    remark?: string,
  ): Promise<TicketView> {
    const ticket = await this.ticketDocuments.resolveTicketForTask(
      await this.mustFindTask(taskId),
    );
    await this.assertCurrentApprovalTask(ticket, taskId);
    const updated = await this.workflowRuntime.approveNodeByUser(
      ticket.id,
      user,
      remark,
    );
    return this.toTicketView(updated);
  }

  /** 按节点任务定位工单后驳回审批（驳回意见必填） */
  async rejectTaskApproval(
    taskId: number,
    user: User,
    remark: string,
  ): Promise<TicketView> {
    const ticket = await this.ticketDocuments.resolveTicketForTask(
      await this.mustFindTask(taskId),
    );
    await this.assertCurrentApprovalTask(ticket, taskId);
    const updated = await this.workflowRuntime.rejectNodeByUser(
      ticket.id,
      user,
      remark,
    );
    return this.toTicketView(updated);
  }

  /** 审批动作必须来自工单当前节点的任务，避免旧卡片/旧任务审批新节点 */
  private async assertCurrentApprovalTask(
    ticket: Ticket,
    taskId: number,
  ): Promise<void> {
    if (!ticket.currentNodeKey) {
      throw new BadRequestException('工单流程已结束，没有可审批的当前节点');
    }
    const run = await this.workflowRuns.findOne({
      where: { ticketId: ticket.id, nodeKey: ticket.currentNodeKey },
      order: { id: 'DESC' },
    });
    if (!run?.taskId || run.taskId !== taskId) {
      throw new BadRequestException(
        '该审批任务已处理或不是工单当前节点任务，请刷新工单',
      );
    }
  }

  private async toTicketView(ticket: Ticket): Promise<TicketView> {
    const workflow = await this.workflowRuntime.workflowView(ticket);
    return {
      ...ticket,
      task: null,
      status: ticket.workflowStatus ?? '处理中',
      workflow,
    };
  }

  private async pickEnabledAgent(ids: number[]): Promise<Worker | null> {
    if (!ids?.length) return null;
    const rows = await this.workers.find({ where: { id: In(ids) } });
    const byId = new Map(rows.map((worker) => [worker.id, worker]));
    for (const id of ids) {
      const worker = byId.get(id);
      // 个人 AGENT 只承载「我的 AI」对话，不承接任务/工单
      if (
        worker?.enabled &&
        worker.role === WorkerRole.WORKER &&
        !worker.personalAgentUserId
      ) {
        return worker;
      }
    }
    return null;
  }

  /**
   * 调度机器人转交后续任务定义：更新识别结果与定义快照后，结束当前会话并重新进入接受流程。
   * 任务、编号和原始需求方保持不变。
   */
  async routeFromTask(
    taskId: number,
    worker: Worker,
    input: RouteTicketInput,
  ): Promise<Task> {
    const task = await this.mustFindTask(taskId);
    if (task.agentId !== worker.id) {
      throw new ForbiddenException('仅当前执行机器人可以转交工单');
    }
    if (
      task.status !== TaskStatus.RUNNING ||
      task.subStatus !== TaskSubStatus.EXECUTING
    ) {
      throw new BadRequestException('仅执行中的工单任务可以转交');
    }
    const ticket = await this.tickets.findOne({ where: { taskId } });
    if (!ticket) throw new NotFoundException('该任务不是工单任务');
    const config = await this.mustFindConfig(ticket.category);
    const templateId = Number(input.templateId);
    if (!Number.isInteger(templateId) || templateId < 1) {
      throw new BadRequestException('templateId 必须为正整数');
    }
    if (!(config.allowedTemplateIds ?? []).includes(templateId)) {
      throw new BadRequestException('该任务定义不在当前工单的可转派清单中');
    }
    const template = await this.templates.findOne({
      where: { id: templateId },
    });
    if (!template) throw new BadRequestException('任务定义不存在');
    const agent = await this.pickEnabledAgent(template.agentIds ?? []);
    if (!agent) {
      throw new BadRequestException(
        `任务定义「${template.name}」没有启用的处理机器人`,
      );
    }
    const title = input.title?.trim()
      ? unescapeMarkdown(input.title.trim())
      : '';
    if (!title) throw new BadRequestException('标题不能为空');
    if (title.length > 200)
      throw new BadRequestException('标题不能超过 200 字');
    const content = input.content?.trim();
    const outputSpec = input.outputSpec?.trim();
    const workPlan = input.workPlan?.trim();
    if (!content) throw new BadRequestException('需求内容不能为空');
    if (!outputSpec) throw new BadRequestException('交付要求不能为空');
    if (!workPlan) throw new BadRequestException('工作计划不能为空');

    task.title = title;
    task.content = content;
    task.outputSpec = outputSpec;
    task.workPlan = workPlan;
    task.templateId = template.id;
    task.templateName = template.name;
    await this.tasks.save(task);

    const routed = await this.dispatchService.assign(
      task.id,
      agent.id,
      worker.name,
      { force: true },
    );
    await this.tasksService.addEvent(
      task.id,
      '操作',
      `工单转交任务定义「${template.name}」（ID=${template.id}），` +
        `处理机器人：${worker.name} → ${agent.name}`,
      worker.name,
      {
        ticketId: ticket.id,
        ticketCode: ticket.code,
        templateId: template.id,
        templateName: template.name,
        agentId: agent.id,
        agentName: agent.name,
        routed: true,
      },
    );
    return routed;
  }

  /** 机器人读取工单上下文、可转派定义和调用方式 */
  async taskTicketMarkdown(taskId: number): Promise<string> {
    const task = await this.mustFindTask(taskId);
    const ticket = await this.ticketDocuments.findTicketForTask(task);
    if (!ticket) {
      return [
        mdFrontmatter({ update: task.updatedAt, title: task.title }),
        '# 非工单任务',
        '',
        `任务 ${task.code} 未关联工单，请按普通任务流程处理。`,
        '',
      ].join('\n');
    }
    if (ticket.workflowDefinitionId) {
      return this.workflowTaskTicketMarkdown(task, ticket);
    }
    const config = await this.mustFindConfig(ticket.category);
    // 历史工单的处理机器人若是个人 AGENT，对外统一显示其主人姓名
    const assignee = await this.workers.findOne({
      where: { id: ticket.assigneeId },
      select: { id: true, ownerName: true, personalAgentUserId: true },
    });
    const assigneeName =
      assignee?.personalAgentUserId && assignee.ownerName
        ? assignee.ownerName
        : ticket.assigneeName;
    const templates = config.allowedTemplateIds?.length
      ? await this.templates.find({
          where: { id: In(config.allowedTemplateIds) },
        })
      : [];
    const orderedTemplates = (config.allowedTemplateIds ?? [])
      .map((id) => templates.find((template) => template.id === id))
      .filter((template): template is TaskTemplate => Boolean(template));
    const lines = [
      mdFrontmatter({ update: task.updatedAt, title: ticket.title }),
      `# ${ticket.code} ${ticket.title}`,
      '',
      '## 工单信息',
      '',
      `- 编号：${ticket.code}`,
      `- 类型：${ticket.category}`,
      `- 处理机器人：${assigneeName}（由工单绑定任务定义自动分配）`,
      `- 创建人：${ticket.createdByName}`,
      `- 创建时间：${beijingTime(ticket.createdAt)}`,
      `- 关联任务：${task.code}（${task.status}-${task.subStatus}）`,
      `- 当前任务定义：${task.templateName ?? '未设置'}`,
      '',
      '## 工单描述',
      '',
      markdownText(ticket.description),
      '',
      '## 工单文档',
      '',
      `- 文档清单与调用示例：\`GET ${this.apiUrl}/tasks/${task.id}/ticket-documents.md\``,
      `- 交付链接或正文：\`POST ${this.apiUrl}/tasks/${task.id}/ticket-documents.md\`（url 与 content 二选一）`,
      `- 更新或删除：\`POST ${this.apiUrl}/tasks/${task.id}/ticket-documents/{documentId}/update.md\` / \`delete.md\``,
      '- 只有本任务当前执行机器人可以交付；只能维护本任务交付的文档。',
      '',
      '## 当前识别结果',
      '',
      `### 标题`,
      '',
      markdownText(task.title),
      '',
      '### 需求内容',
      '',
      markdownText(task.content),
      '',
      '### 交付要求',
      '',
      markdownText(task.outputSpec),
      '',
      '### 工作计划',
      '',
      markdownText(task.workPlan),
      '',
      '## 可转派任务定义',
      '',
    ];
    if (orderedTemplates.length === 0) {
      lines.push(
        '当前未配置后续任务定义，请联系管理员在「管理 → 工单配置」维护。',
        '',
      );
    } else {
      lines.push(
        '| ID | 名称 |',
        '| --- | --- |',
        ...orderedTemplates.map(
          (template) => `| ${template.id} | ${escapeCell(template.name)} |`,
        ),
        '',
      );
    }
    lines.push(
      '## 转交工单',
      '',
      '信息明确后调用以下接口，任务将更新识别结果并转交给目标任务定义的机器人；调用后结束本轮，不要申请验收：',
      '',
      '```bash',
      'TOKEN=$(cat .opencode/agent-token)',
      `curl -sS -X POST '${this.apiUrl}/tasks/${task.id}/ticket-route.md' \\`,
      '  -H "X-Worker-Token: $TOKEN" \\',
      '  -H "Content-Type: application/json" \\',
      '  -d \'{"templateId":1001,"title":"明确后的标题","content":"澄清后的需求内容","outputSpec":"交付要求","workPlan":"工作计划"}\'',
      '```',
      '',
      '信息不足时调用 `POST /api/tasks/{taskId}/questions/ask.md` 向需求方提问。',
      '',
    );
    return lines.join('\n');
  }

  /** 工作流节点任务的工单上下文与文档操作指引 */
  private workflowTaskTicketMarkdown(task: Task, ticket: Ticket): string {
    const currentNode =
      ticket.currentNodeKey && ticket.currentNodeName
        ? `${ticket.currentNodeName}（key=${ticket.currentNodeKey}）`
        : '流程已结束';
    return [
      mdFrontmatter({ update: task.updatedAt, title: ticket.title }),
      `# ${ticket.code} ${ticket.title}`,
      '',
      '## 工单信息',
      '',
      `- 编号：${ticket.code}`,
      `- 类型：${ticket.category}`,
      `- 状态：${ticket.workflowStatus ?? '处理中'}`,
      `- 当前节点：${currentNode}`,
      `- 发起机器人：${ticket.initiatorWorkerName ?? ticket.createdByName}`,
      `- 关联任务：${task.code}（${task.status}-${task.subStatus}）`,
      `- 当前任务定义：${task.templateName ?? '未设置'}`,
      '',
      '## 工单描述',
      '',
      markdownText(ticket.description),
      '',
      '## 工单文档',
      '',
      `- 文档清单与调用示例：\`GET ${this.apiUrl}/tasks/${task.id}/ticket-documents.md\``,
      `- 交付链接：\`POST ${this.apiUrl}/tasks/${task.id}/ticket-documents.md\`，body \`{"title":"文档标题","url":"https://... 或 /api/docs/detail/..."}\``,
      `- 交付正文：同一接口，body \`{"title":"文档标题","content":"# Markdown 正文"}\``,
      `- 更新：\`POST ${this.apiUrl}/tasks/${task.id}/ticket-documents/{documentId}/update.md\``,
      `- 删除：\`POST ${this.apiUrl}/tasks/${task.id}/ticket-documents/{documentId}/delete.md\``,
      '- 只有本任务当前执行机器人可以交付；只能更新、删除本任务交付的文档。',
      '- 任务自身文档先通过 `GET /api/tasks/{taskId}/documents.md` 查看；链接形态不会复制源文档，正文形态保存独立副本。',
      '',
      '## 其它操作',
      '',
      `- 完整工单上下文：\`GET ${this.apiUrl}/tickets/${ticket.id}.md\``,
      `- 向需求方提问：\`POST ${this.apiUrl}/tasks/${task.id}/questions/ask.md\``,
      ticket.currentNodeKey
        ? `- 拒绝当前节点：\`POST ${this.apiUrl}/tickets/${ticket.id}/reject.md\`，body \`{"nodeKey":"${ticket.currentNodeKey}","reason":"拒绝原因"}\``
        : '',
      '',
    ].join('\n');
  }

  /**
   * AI 读取工单完整上下文：工单信息、需求正文、工单输入、流程进度、
   * 每一步节点任务的输入/输出与用户补充输入。
   */
  async ticketMarkdown(id: number): Promise<string> {
    const ticket = await this.mustFind(id);
    const workflow = ticket.workflowDefinitionId
      ? await this.workflowRuntime.workflowView(ticket)
      : null;
    const lines: string[] = [
      mdFrontmatter({
        update: ticket.updatedAt,
        title: `${ticket.code} ${ticket.title}`,
        filename: ticket.code,
      }),
      `# ${ticket.code} ${ticket.title}`,
      '',
      '## 工单信息',
      '',
      `- 编号：${ticket.code}`,
      `- 标题：${ticket.title}`,
      `- 类型：${ticket.category}`,
    ];
    if (workflow) {
      lines.push(
        `- 工单配置：${workflow.definitionName} v${workflow.version}`,
        `- 状态：${workflow.status}`,
        `- 当前节点：${
          workflow.currentNodeName
            ? `${workflow.currentNodeName}（key=${workflow.currentNodeKey}）`
            : '流程已结束'
        }`,
        `- 发起机器人：${ticket.initiatorWorkerName ?? ticket.createdByName}`,
      );
    } else {
      lines.push(`- 状态：${ticket.workflowStatus ?? '-'}`);
    }
    lines.push(
      `- 创建人：${ticket.createdByName}`,
      `- 创建时间：${beijingTime(ticket.createdAt)}`,
      `- 更新时间：${beijingTime(ticket.updatedAt)}`,
      '',
      '## 需求正文',
      '',
      markdownText(ticket.description),
      '',
      await this.ticketDocuments.renderTicketSection(ticket),
      '',
    );

    if (!workflow) {
      lines.push(
        '## 关联任务',
        '',
        ticket.taskId
          ? `历史工单按普通任务流程处理，任务上下文请读取 \`GET ${this.apiUrl}/tasks/${ticket.taskId}.md\`。`
          : '工单没有关联任务。',
        '',
      );
      return lines.join('\n');
    }

    const startFields =
      workflow.nodes.find((node) => node.kind === 'start')?.inputFields ?? [];
    lines.push(
      '## 工单输入（起始节点）',
      '',
      renderInputValues(startFields, workflow.inputValues),
      '',
      '## 流程进度',
      '',
      '| 顺序 | 节点 | 类型 | 处理机器人 | 状态 | 结果 | 任务 | 开始时间 | 结束时间 |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    );
    const nodeTaskIds = workflow.runs
      .map((run) => run.taskId)
      .filter((taskId): taskId is number => Boolean(taskId));
    const nodeTasks = nodeTaskIds.length
      ? await this.tasks.find({ where: { id: In(nodeTaskIds) } })
      : [];
    const taskById = new Map(nodeTasks.map((task) => [task.id, task]));
    workflow.runs.forEach((run, index) => {
      const task = run.taskId ? taskById.get(run.taskId) : null;
      lines.push(
        `| ${index + 1} | ${escapeCell(run.nodeName)} | ${
          NODE_KIND_LABEL[run.nodeKind] ?? run.nodeKind
        } | ${escapeCell(run.agentName ?? '-')} | ${run.status} | ${
          run.outcome ? (OUTCOME_LABEL[run.outcome] ?? run.outcome) : '-'
        } | ${task ? escapeCell(task.code) : '-'} | ${
          run.startedAt ? beijingTime(run.startedAt) : '-'
        } | ${run.finishedAt ? beijingTime(run.finishedAt) : '-'} |`,
      );
    });
    lines.push('');

    // 每一步节点任务的输入与输出（含用户补充输入）
    lines.push('## 节点输入与输出', '');
    for (const [index, run] of workflow.runs.entries()) {
      const task = run.taskId ? taskById.get(run.taskId) : null;
      lines.push(
        `### ${index + 1}. ${run.nodeName}（第 ${run.attempt} 次 · ${
          NODE_KIND_LABEL[run.nodeKind] ?? run.nodeKind
        }）`,
        '',
        `- 运行状态：${run.status}${
          run.outcome
            ? `（结果：${OUTCOME_LABEL[run.outcome] ?? run.outcome}）`
            : ''
        }`,
        `- 处理机器人：${run.agentName ?? '-'}`,
        task
          ? `- 节点任务：${task.code}（${task.status}-${task.subStatus}）`
          : '- 节点任务：无（自动完成）',
        '',
      );
      if (!task) continue;
      lines.push(
        '#### 节点输入',
        '',
        '**需求内容**',
        '',
        markdownText(task.content),
        '',
        '**交付要求**',
        '',
        markdownText(task.outputSpec),
        '',
      );
      if (task.workPlan?.trim()) {
        lines.push('**工作计划**', '', task.workPlan, '');
      }
      const supplements = await this.taskMessages.find({
        where: { taskId: task.id, role: 'user', kind: 'message' },
        order: { id: 'ASC' },
      });
      lines.push('#### 用户补充输入', '');
      if (supplements.length === 0) {
        lines.push('（暂无用户补充）', '');
      } else {
        for (const message of supplements) {
          lines.push(
            `- ${beijingTime(message.createdAt)} ${message.sender?.name ?? '发起人'}：${message.content.replace(/\s*\n\s*/g, ' ')}`,
          );
        }
        lines.push('');
      }
      const pendingQuestions = await this.taskMessages.find({
        where: { taskId: task.id, kind: 'question' },
        order: { id: 'ASC' },
      });
      const unanswered = pendingQuestions.filter(
        (message) => message.question?.state === 'pending',
      );
      if (unanswered.length > 0) {
        lines.push('#### 待回答问题', '');
        for (const message of unanswered) {
          for (const item of message.question?.questions ?? []) {
            lines.push(`- ${item.question}`);
          }
        }
        lines.push('');
      }
      lines.push('#### 节点输出', '');
      if (task.status === TaskStatus.FINISHED && task.failureReason?.trim()) {
        lines.push('**失败原因**', '', task.failureReason, '');
      }
      const handoff = await this.taskDocuments.readHandoff(task);
      if (handoff.exists && handoff.content.trim()) {
        lines.push(
          `**交付文档**（${handoff.path}，v${handoff.version}）`,
          '',
          handoff.content,
          '',
        );
      } else if (!task.failureReason?.trim()) {
        lines.push('（暂无节点输出）', '');
      }
    }

    // 当前节点的 AI 操作指引
    const currentNode = workflow.nodes.find(
      (node) => node.key === workflow.currentNodeKey,
    );
    const currentRun = workflow.currentNodeKey
      ? [...workflow.runs]
          .filter((run) => run.nodeKey === workflow.currentNodeKey)
          .reduce<(typeof workflow.runs)[number] | null>(
            (latest, run) => (!latest || run.id > latest.id ? run : latest),
            null,
          )
      : null;
    const currentTask =
      currentRun?.taskId != null
        ? (taskById.get(currentRun.taskId) ?? null)
        : null;
    lines.push('## AI 操作', '');
    if (
      currentNode &&
      (currentNode.kind === 'operation' || currentNode.kind === 'approval') &&
      currentTask
    ) {
      lines.push(
        '### 拒绝当前节点',
        '',
        `当前工单处于节点「${currentNode.name}」（key=${currentNode.key}）。若确认需求不符合要求、当前节点无法完成，调用以下接口拒绝（当前节点任务将置为失败，工作流按「failed/rejected」流转）：`,
        '',
        '```bash',
        'TOKEN=$(cat .opencode/agent-token)',
        `curl -sS -X POST '${this.apiUrl}/tickets/${ticket.id}/reject.md' \\`,
        '  -H "X-Worker-Token: $TOKEN" \\',
        '  -H "Content-Type: application/json" \\',
        `  -d '{"nodeKey":"${currentNode.key}","reason":"拒绝原因（必填，说明为何不符合要求）"}'`,
        '```',
        '',
        '校验规则：调用者必须是当前节点的处理机器人（X-Worker-Token），`nodeKey` 必须与当前节点一致。',
        '',
        '### 向需求方提问',
        '',
        '缺少信息时优先提问而不是拒绝：',
        '',
        '```bash',
        `curl -sS -X POST '${this.apiUrl}/tasks/${currentTask.id}/questions/ask.md' \\`,
        '  -H "X-Worker-Token: $TOKEN" \\',
        '  -H "Content-Type: application/json" \\',
        `  -d '{"questions":[{"title":"问题标题","custom":true}]}'`,
        '```',
        '',
      );
    }
    lines.push(
      '### 其它',
      '',
      `- 重新读取本工单：\`GET ${this.apiUrl}/tickets/${ticket.id}.md\``,
      currentTask
        ? `- 读取当前节点交付文档：\`GET ${this.apiUrl}/tasks/${currentTask.id}/handoff.md\``
        : '',
      '',
    );
    return lines.join('\n');
  }

  /** 机器人拒绝当前节点（工作流工单）；返回操作结果 Markdown */
  async rejectMarkdown(
    id: number,
    worker: Worker,
    input: { nodeKey?: string; reason?: string },
  ): Promise<string> {
    const { ticket, node, task, outcome } =
      await this.workflowRuntime.rejectNodeByWorker(
        id,
        worker,
        String(input?.nodeKey ?? ''),
        String(input?.reason ?? ''),
      );
    const flowResult =
      ticket.workflowStatus === TICKET_STATUS_FAILED
        ? '工单已失败（该节点没有可用流转）'
        : ticket.currentNodeName
          ? `流程推进到下一节点「${ticket.currentNodeName}」（key=${ticket.currentNodeKey}）`
          : `工单${ticket.workflowStatus ?? '已结束'}`;
    return [
      mdFrontmatter({
        update: ticket.updatedAt,
        title: `${ticket.code} 节点已拒绝`,
      }),
      '# 工单节点已拒绝',
      '',
      `- 工单：${ticket.code} ${ticket.title}（状态：${ticket.workflowStatus ?? '-'}）`,
      `- 拒绝节点：「${node.name}」（key=${node.key} · ${NODE_KIND_LABEL[node.kind] ?? node.kind}）`,
      `- 节点任务：${task.code} → 已结束-失败`,
      `- 拒绝原因：${task.failureReason ?? '-'}`,
      `- 流转结果：${flowResult}（节点结果：${OUTCOME_LABEL[outcome] ?? outcome}）`,
      '',
      '请结束本轮，不要继续执行原任务或申请验收；工作流已按拒绝结果自动推进，若回到当前节点会收到新的任务邀约。',
      '',
    ].join('\n');
  }

  async routeMarkdown(
    taskId: number,
    worker: Worker,
    input: RouteTicketInput,
  ): Promise<string> {
    const task = await this.routeFromTask(taskId, worker, input);
    return [
      mdFrontmatter({ update: task.updatedAt, title: task.title }),
      '# 工单已转交',
      '',
      `- 任务：${task.code}「${task.title}」`,
      `- 任务定义：${task.templateName ?? '-'}（ID=${task.templateId ?? '-'}）`,
      `- 新处理机器人：#${task.agentId ?? '-'}`,
      `- 状态：${task.status}-${task.subStatus}`,
      '',
      '平台已结束当前会话并通知新机器人接受任务。请结束本轮，不要继续执行或申请验收。',
      '',
    ].join('\n');
  }

  private async mustFind(id: number): Promise<Ticket> {
    const ticket = await this.tickets.findOne({ where: { id } });
    if (!ticket) throw new NotFoundException(`Ticket ${id} not found`);
    return ticket;
  }

  private async mustFindTask(taskId: number): Promise<Task> {
    const task = await this.tasks.findOne({ where: { id: taskId } });
    if (!task) throw new NotFoundException(`Task ${taskId} not found`);
    return task;
  }

  private async mustFindConfig(category: string): Promise<TicketConfig> {
    const config = await this.configs.findOne({ where: { category } });
    if (!config) throw new NotFoundException('工单配置不存在');
    return config;
  }
}
