import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { In, Repository } from 'typeorm';
import {
  BacklogMemberRole,
  BacklogStatus,
  IterationStatus,
  WorkerRole,
} from '../common/enums';
import { beijingTime, mdFrontmatter } from '../common/frontmatter';
import { splitMemberNames } from '../common/names';
import { Document } from '../documents/document.entity';
import { Project } from '../projects/project.entity';
import { User } from '../auth/user.entity';
import { Task } from '../tasks/task.entity';
import { TasksService } from '../tasks/tasks.service';
import { SYSTEM_BACKLOG_DELIVERY_TASK_TEMPLATE_ID } from '../tasks/system-task-templates';
import { Ticket } from '../tickets/ticket.entity';
import { TicketWorkflowRun } from '../tickets/ticket-workflow-run.entity';
import { TicketsService } from '../tickets/tickets.service';
import { Worker } from '../workers/worker.entity';
import { WorkflowDefinition } from '../workflows/workflow-definition.entity';
import { RELEASE_TICKET_WORKFLOW } from '../workflows/system-workflows';
import { LlmService } from '../model-config/llm.service';
import { FeishuBotBacklogChatService } from '../feishu-bot/feishu-bot-backlog-chat.service';
import { Backlog, BacklogMember } from './backlog.entity';
import { BacklogDocument } from './backlog-document.entity';
import { BacklogEvent } from './backlog-event.entity';
import { Iteration } from './iteration.entity';
import {
  BacklogMemberInput,
  BacklogReleaseWorkflow,
  BacklogTaskSummary,
  BacklogTicketSummary,
  CreateBacklogItemInput,
  IterationActor,
} from './iteration.types';

/** 从需求人员 resources 推导成员候选（产品/技术），按姓名解析为平台用户 */
function autoMemberCandidates(
  resources: Project['resources'],
): Array<{ role: BacklogMemberRole; name: string }> {
  if (!resources) return [];
  const mapping: Array<[BacklogMemberRole, string | undefined]> = [
    [BacklogMemberRole.PRODUCT, resources.product],
    [BacklogMemberRole.FRONTEND, resources.frontend],
    [BacklogMemberRole.BACKEND, resources.backend],
    [BacklogMemberRole.QA, resources.qa],
    [BacklogMemberRole.CLIENT, resources.client],
  ];
  const out: Array<{ role: BacklogMemberRole; name: string }> = [];
  for (const [role, raw] of mapping) {
    for (const name of splitMemberNames(raw)) out.push({ role, name });
  }
  return out;
}

/**
 * 迭代项（Backlog）：从需求转入，指定负责人机器人（AI/真人）后自动创建交付任务；
 * 创建后自动建立飞书沟通群；状态由成员/管理员手动流转。
 */
@Injectable()
export class BacklogsService {
  private readonly logger = new Logger(BacklogsService.name);

  /** 进行中的标题生成（防重复调度） */
  private readonly titleNaming = new Set<number>();

  constructor(
    @InjectRepository(Backlog)
    private readonly backlogs: Repository<Backlog>,
    @InjectRepository(Iteration)
    private readonly iterations: Repository<Iteration>,
    @InjectRepository(Project)
    private readonly projects: Repository<Project>,
    @InjectRepository(Worker)
    private readonly workers: Repository<Worker>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(BacklogDocument)
    private readonly backlogDocuments: Repository<BacklogDocument>,
    @InjectRepository(BacklogEvent)
    private readonly backlogEvents: Repository<BacklogEvent>,
    @InjectRepository(Document)
    private readonly documents: Repository<Document>,
    @InjectRepository(Task)
    private readonly taskRows: Repository<Task>,
    @InjectRepository(Ticket)
    private readonly ticketRows: Repository<Ticket>,
    @InjectRepository(TicketWorkflowRun)
    private readonly ticketRunRows: Repository<TicketWorkflowRun>,
    @InjectRepository(WorkflowDefinition)
    private readonly workflowDefs: Repository<WorkflowDefinition>,
    private readonly ticketsService: TicketsService,
    private readonly tasks: TasksService,
    private readonly chat: FeishuBotBacklogChatService,
    private readonly llm: LlmService,
  ) {}

  /**
   * 批量转入：把选中的需求转为指定迭代的 backlog。
   * 每条需求必须指定负责人机器人；创建后自动建交付任务与飞书群（失败不阻断）。
   */
  async createBatch(
    iterationId: number,
    items: CreateBacklogItemInput[],
    actor: IterationActor,
  ): Promise<Backlog[]> {
    this.assertAdmin(actor, '仅管理员可将需求转入迭代');
    const iteration = await this.iterations.findOne({
      where: { id: iterationId },
    });
    if (!iteration) {
      throw new NotFoundException(`Iteration ${iterationId} not found`);
    }
    if (iteration.status === IterationStatus.CLOSED) {
      throw new BadRequestException('迭代已结束，不能再追加迭代项');
    }
    if (!Array.isArray(items) || items.length === 0) {
      throw new BadRequestException('请至少选择一个需求');
    }

    const projectIds = items.map((item) => item.projectId);
    const ownerIds = [...new Set(items.map((item) => item.ownerWorkerId))];
    if (new Set(projectIds).size !== projectIds.length) {
      throw new BadRequestException('同一需求不能重复转入');
    }
    for (const id of projectIds) {
      if (!Number.isInteger(id) || id <= 0) {
        throw new BadRequestException('需求 ID 非法');
      }
    }
    for (const id of ownerIds) {
      if (!Number.isInteger(id) || id <= 0) {
        throw new BadRequestException('负责人机器人 ID 非法');
      }
    }

    const projects = await this.projects.find({
      where: { id: In(projectIds) },
      select: { id: true, name: true, resources: true },
    });
    const projectMap = new Map(
      projects.map((project) => [project.id, project]),
    );
    for (const id of projectIds) {
      if (!projectMap.has(id)) {
        throw new NotFoundException(`需求 #${id} 不存在`);
      }
    }

    const existing = await this.backlogs.find({
      where: { projectId: In(projectIds) },
    });
    const activeDupes = existing.filter(
      (backlog) => backlog.status !== BacklogStatus.CANCELED,
    );
    if (activeDupes.length > 0) {
      throw new BadRequestException(
        `以下需求已存在未取消的迭代项：${activeDupes
          .map((backlog) => `#${backlog.projectId} ${backlog.title}`)
          .join('、')}`,
      );
    }

    const workers = await this.workers.find({ where: { id: In(ownerIds) } });
    const workerMap = new Map(workers.map((worker) => [worker.id, worker]));
    for (const id of ownerIds) {
      this.assertAssignableWorker(workerMap.get(id), id);
    }

    // 产品/技术成员从需求人员 resources 按姓名自动带入（找不到对应用户则跳过）
    const resourceNames = new Set<string>();
    for (const item of items) {
      const project = projectMap.get(item.projectId)!;
      for (const candidate of autoMemberCandidates(project.resources)) {
        resourceNames.add(candidate.name);
      }
    }
    const nameUsers = resourceNames.size
      ? await this.users.find({
          where: { name: In([...resourceNames]), enabled: true },
          select: { id: true, name: true },
        })
      : [];
    const userByName = new Map<string, User>();
    for (const user of nameUsers) {
      if (!userByName.has(user.name)) userByName.set(user.name, user);
    }

    const created: Backlog[] = [];
    for (const item of items) {
      const project = projectMap.get(item.projectId)!;
      const owner = workerMap.get(item.ownerWorkerId)!;
      const explicit = await this.normalizeMembers(item.members);
      const members = this.mergeMembers(
        explicit,
        autoMemberCandidates(project.resources),
        userByName,
      );

      let backlog = await this.backlogs.save(
        this.backlogs.create({
          code: `TMP-${randomBytes(8).toString('hex')}`,
          iterationId,
          projectId: project.id,
          title: project.name.slice(0, 200),
          status: BacklogStatus.WAITING,
          ownerWorkerId: owner.id,
          ownerName: owner.name,
          members: members.length ? members : null,
          taskId: null,
          statusBy: actor.userName,
          startedAt: null,
          testingAt: null,
          releasingAt: null,
          completedAt: null,
          canceledAt: null,
        }),
      );
      backlog.code = `BL-${String(backlog.id).padStart(4, '0')}`;
      backlog = await this.backlogs.save(backlog);

      // 负责人存在真人登录身份时创建交付任务并直接指派给该机器人。
      if (actor.userId !== null) {
        try {
          const task = await this.tasks.create({
            title: `迭代任务-${project.name}`.slice(0, 200),
            description: [
              `迭代：${iteration.code}（${iteration.name}）`,
              `原始需求：${project.name}（#${project.id}）`,
              '',
              `需求详情：GET /api/projects/${project.id}.md`,
            ].join('\n'),
            input: `原始需求：${project.name}`,
            projectId: project.id,
            templateId: SYSTEM_BACKLOG_DELIVERY_TASK_TEMPLATE_ID,
            agentId: owner.id,
            createdById: actor.userId,
            operatorName: actor.userName,
            titleNaming: true,
          });
          backlog.taskId = task.id;
          backlog = await this.backlogs.save(backlog);
        } catch (error) {
          this.logger.warn(
            `迭代项 ${backlog.code} 交付任务创建失败：${(error as Error).message}`,
          );
        }
      }

      try {
        await this.chat.ensureForBacklog(backlog.id);
      } catch (error) {
        this.logger.warn(
          `迭代项 ${backlog.code} 沟通群创建失败：${(error as Error).message}`,
        );
      }

      // 需求文档一并迁移到迭代项（backlog_documents 关联，迁移失败不阻断）
      let migratedDocuments = 0;
      try {
        migratedDocuments = await this.migrateProjectDocuments(
          backlog.id,
          project.id,
        );
      } catch (error) {
        this.logger.warn(
          `迭代项 ${backlog.code} 文档迁移失败：${(error as Error).message}`,
        );
      }

      await this.recordEvent(
        backlog.id,
        'created',
        {
          iteration: `${iteration.code} ${iteration.name}`,
          migratedDocuments,
          taskId: backlog.taskId ?? null,
        },
        actor.userName,
      );

      // 异步生成迭代项自己的标题（title-naming 场景；失败保留需求名兜底）
      this.scheduleTitleNaming(backlog.id, backlog.title, {
        requirement: project.name,
        iteration: `${iteration.code} ${iteration.name}`,
        owner: owner.name,
        description: `迭代交付任务：${project.name}`,
      });

      created.push(backlog);
    }
    return created;
  }

  /** 单条转入（T0 快速通道或指定 W1） */
  async createOne(
    iterationId: number,
    item: CreateBacklogItemInput,
    actor: IterationActor,
  ): Promise<Backlog> {
    const [created] = await this.createBatch(iterationId, [item], actor);
    return created;
  }

  async findOne(id: number): Promise<Backlog> {
    const backlog = await this.backlogs.findOne({ where: { id } });
    if (!backlog) throw new NotFoundException(`Backlog ${id} not found`);
    return backlog;
  }

  /** 手动流转状态：成员或管理员；终态不可再变更；备注可空，记入事件流 */
  async updateStatus(
    id: number,
    status: BacklogStatus,
    actor: IterationActor,
    remark?: string,
  ): Promise<Backlog> {
    const backlog = await this.findOne(id);
    if (!Object.values(BacklogStatus).includes(status)) {
      throw new BadRequestException(
        '迭代项状态仅允许：等待/执行/测试/发布/完成/取消',
      );
    }
    if (this.isTerminal(backlog.status)) {
      throw new BadRequestException('已结束的迭代项不可再变更状态');
    }
    if (backlog.status === status) return backlog;
    if (!actor.isAdmin && !this.isMember(backlog, actor.userId)) {
      throw new ForbiddenException('仅迭代项成员或管理员可推进状态');
    }

    const from = backlog.status;
    const updated = this.applyStatus(
      backlog,
      status,
      actor.userName,
      new Date(),
    );
    const saved = await this.backlogs.save(updated);

    await this.recordEvent(
      saved.id,
      'status',
      {
        from,
        to: status,
        remark: remark?.trim() || null,
      },
      actor.userName,
    );

    if (status === BacklogStatus.CANCELED && saved.taskId) {
      try {
        await this.tasks.cancel(saved.taskId, actor.userName);
      } catch (error) {
        this.logger.warn(
          `迭代项 ${saved.code} 取消联动交付任务失败：${(error as Error).message}`,
        );
      }
    }

    try {
      await this.chat.notifyBacklog(saved.id);
    } catch (error) {
      this.logger.warn(
        `迭代项 ${saved.code} 沟通群状态推送失败：${(error as Error).message}`,
      );
    }
    return saved;
  }

  /** 移动迭代项到另一个迭代（不重建交付任务与沟通群） */
  async move(
    id: number,
    iterationId: number,
    actor: IterationActor,
  ): Promise<Backlog> {
    this.assertAdmin(actor, '仅管理员可移动迭代项');
    const backlog = await this.findOne(id);
    if (this.isTerminal(backlog.status)) {
      throw new BadRequestException('已结束的迭代项不可移动');
    }
    if (!Number.isInteger(iterationId) || iterationId <= 0) {
      throw new BadRequestException('目标迭代 ID 非法');
    }
    const target = await this.iterations.findOne({
      where: { id: iterationId },
    });
    if (!target)
      throw new NotFoundException(`Iteration ${iterationId} not found`);
    if (target.status === IterationStatus.CLOSED) {
      throw new BadRequestException('目标迭代已结束');
    }
    if (backlog.iterationId === iterationId) return backlog;
    const fromIterationId = backlog.iterationId;
    backlog.iterationId = iterationId;
    const saved = await this.backlogs.save(backlog);
    await this.recordEvent(
      saved.id,
      'moved',
      {
        fromIterationId,
        toIterationId: iterationId,
        toIterationCode: target.code,
      },
      actor.userName,
    );
    return saved;
  }

  /** 更新迭代项属性（首期：预期上线时间）；成员或管理员 */
  async updateBacklog(
    id: number,
    dto: { expectedOnlineAt?: string | Date | null },
    actor: IterationActor,
  ): Promise<Backlog> {
    const backlog = await this.findOne(id);
    if (!actor.isAdmin && !this.isMember(backlog, actor.userId)) {
      throw new ForbiddenException('仅迭代项成员或管理员可编辑迭代项属性');
    }
    if (dto.expectedOnlineAt !== undefined) {
      if (dto.expectedOnlineAt === null || dto.expectedOnlineAt === '') {
        backlog.expectedOnlineAt = null;
      } else {
        const parsed =
          dto.expectedOnlineAt instanceof Date
            ? dto.expectedOnlineAt
            : new Date(String(dto.expectedOnlineAt));
        if (Number.isNaN(parsed.getTime())) {
          throw new BadRequestException('预期上线时间格式不正确');
        }
        backlog.expectedOnlineAt = parsed;
      }
    }
    return this.backlogs.save(backlog);
  }

  /** 详情视图：迭代项 + 提测工单工作流可用性（供前端提测按钮置灰） */
  async getDetail(
    id: number,
  ): Promise<Backlog & { releaseWorkflow: BacklogReleaseWorkflow | null }> {
    const backlog = await this.findOne(id);
    return { ...backlog, releaseWorkflow: await this.releaseWorkflowInfo() };
  }

  /** 提测工单工作流信息（code 固定 release-ticket） */
  async releaseWorkflowInfo(): Promise<BacklogReleaseWorkflow | null> {
    const definition = await this.workflowDefs.findOne({
      where: { code: RELEASE_TICKET_WORKFLOW.code },
    });
    if (!definition) return null;
    return {
      id: definition.id,
      enabled:
        definition.enabled && (definition.latestPublishedVersion ?? 0) > 0,
    };
  }

  /** 迭代项关联的文档（不含正文大字段） */
  async listDocuments(
    id: number,
  ): Promise<
    Array<
      Pick<
        Document,
        | 'id'
        | 'title'
        | 'type'
        | 'source'
        | 'description'
        | 'remark'
        | 'feishuUrl'
        | 'projectId'
        | 'createdAt'
        | 'updatedAt'
      >
    >
  > {
    const backlog = await this.findOne(id);
    const links = await this.backlogDocuments.find({
      where: { backlogId: backlog.id },
    });
    const docIds = [...new Set(links.map((link) => link.documentId))];
    if (docIds.length === 0) return [];
    const docs = await this.documents.find({
      where: { id: In(docIds) },
      select: {
        id: true,
        title: true,
        type: true,
        source: true,
        description: true,
        remark: true,
        feishuUrl: true,
        projectId: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return docs.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  /** 关联已有文档（须属于该迭代项的原始需求）；成员或管理员 */
  async addDocument(
    id: number,
    documentId: number,
    actor: IterationActor,
  ): Promise<{ linked: boolean }> {
    const backlog = await this.findOne(id);
    if (!actor.isAdmin && !this.isMember(backlog, actor.userId)) {
      throw new ForbiddenException('仅迭代项成员或管理员可管理迭代项文档');
    }
    if (!Number.isInteger(documentId) || documentId <= 0) {
      throw new BadRequestException('文档 ID 非法');
    }
    const doc = await this.documents.findOne({
      where: { id: documentId },
      select: { id: true, projectId: true },
    });
    if (!doc) throw new NotFoundException(`Document ${documentId} not found`);
    if (doc.projectId !== backlog.projectId) {
      throw new BadRequestException('文档须属于该迭代项的原始需求');
    }
    const existing = await this.backlogDocuments.findOne({
      where: { backlogId: backlog.id, documentId },
    });
    if (existing) return { linked: false };
    await this.backlogDocuments.save(
      this.backlogDocuments.create({ backlogId: backlog.id, documentId }),
    );
    return { linked: true };
  }

  /** 取消关联（不删除文档本体）；成员或管理员 */
  async removeDocument(
    id: number,
    documentId: number,
    actor: IterationActor,
  ): Promise<void> {
    const backlog = await this.findOne(id);
    if (!actor.isAdmin && !this.isMember(backlog, actor.userId)) {
      throw new ForbiddenException('仅迭代项成员或管理员可管理迭代项文档');
    }
    await this.backlogDocuments.delete({
      backlogId: backlog.id,
      documentId,
    });
  }

  /** 事件流（append-only，倒序，最近 100 条） */
  async listEvents(id: number): Promise<BacklogEvent[]> {
    const backlog = await this.findOne(id);
    return this.backlogEvents.find({
      where: { backlogId: backlog.id },
      order: { createdAt: 'DESC' },
      take: 100,
    });
  }

  /**
   * 任务与工单面板数据：
   * - tasks：交付任务为根的全部任务树（含所有子任务）；
   * - tickets：直接关联（backlogId）+ 任务树关联（tickets.taskId / ticket_workflow_runs.taskId）。
   */
  async relatedRecords(
    id: number,
  ): Promise<{ tasks: BacklogTaskSummary[]; tickets: BacklogTicketSummary[] }> {
    const backlog = await this.findOne(id);
    const taskRows = backlog.taskId
      ? await this.taskRows.find({
          where: [{ id: backlog.taskId }, { rootId: backlog.taskId }],
          select: {
            id: true,
            code: true,
            title: true,
            type: true,
            status: true,
            subStatus: true,
            parentId: true,
            rootId: true,
            projectId: true,
            agentId: true,
            templateName: true,
            sortOrder: true,
            createdAt: true,
            updatedAt: true,
          },
          order: { id: 'ASC' },
        })
      : [];
    const taskIds = taskRows.map((task) => task.id);

    const directTickets = await this.ticketRows.find({
      where: { backlogId: backlog.id },
    });
    const taskTickets = taskIds.length
      ? await this.ticketRows.find({ where: { taskId: In(taskIds) } })
      : [];
    const runs = taskIds.length
      ? await this.ticketRunRows.find({ where: { taskId: In(taskIds) } })
      : [];
    const runTicketIds = [...new Set(runs.map((run) => run.ticketId))];
    const runTickets = runTicketIds.length
      ? await this.ticketRows.find({ where: { id: In(runTicketIds) } })
      : [];

    const ticketMap = new Map<number, Ticket>();
    for (const ticket of [...directTickets, ...taskTickets, ...runTickets]) {
      ticketMap.set(ticket.id, ticket);
    }
    const tickets = [...ticketMap.values()]
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .map((ticket) => ({
        id: ticket.id,
        code: ticket.code,
        title: ticket.title,
        category: ticket.category,
        workflowStatus: ticket.workflowStatus,
        currentNodeName: ticket.currentNodeName,
        initiatorWorkerName: ticket.initiatorWorkerName,
        createdAt: ticket.createdAt,
        updatedAt: ticket.updatedAt,
      }));

    return {
      tasks: taskRows.map((task) => ({
        id: task.id,
        code: task.code,
        title: task.title,
        type: task.type,
        status: task.status,
        subStatus: task.subStatus,
        parentId: task.parentId,
        rootId: task.rootId,
        projectId: task.projectId,
        agentId: task.agentId,
        templateName: task.templateName,
        sortOrder: task.sortOrder,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
      })),
      tickets,
    };
  }

  /**
   * 提测：按系统「提测工单」工作流创建工单，自动填入迭代项上下文，
   * 人工可补充说明；创建成功后写 release-ticket 事件。
   * 提测不与迭代项/迭代状态绑定，同一迭代项可多次发起。
   */
  async createReleaseTicket(
    id: number,
    dto: { title?: string; supplement?: string },
    actor: IterationActor,
    creator: { user: unknown; worker: unknown },
  ): Promise<{ ticketId: number; ticketCode: string; title: string }> {
    const backlog = await this.findOne(id);
    if (!actor.isAdmin && !this.isMember(backlog, actor.userId)) {
      throw new ForbiddenException('仅迭代项成员或管理员可发起提测');
    }
    const workflow = await this.releaseWorkflowInfo();
    if (!workflow || !workflow.enabled) {
      throw new BadRequestException(
        '「提测工单」工作流未配置或未发布版本，暂不能提测',
      );
    }

    const iteration = await this.iterations.findOne({
      where: { id: backlog.iterationId },
    });
    const supplement = dto.supplement?.trim() || '';
    const title =
      dto.title?.trim() ||
      `提测-${backlog.code} ${backlog.title}`.slice(0, 200);
    const description = this.buildReleaseDescription(
      backlog,
      iteration,
      supplement,
    );

    const ticket = await this.ticketsService.create(
      {
        workflowDefinitionId: workflow.id,
        title,
        inputValues: { title, description },
        backlogId: backlog.id,
      },
      creator as Parameters<TicketsService['create']>[1],
    );

    await this.recordEvent(
      backlog.id,
      'release-ticket',
      {
        ticketId: ticket.id,
        ticketCode: ticket.code,
        title: ticket.title,
      },
      actor.userName,
    );
    return {
      ticketId: ticket.id,
      ticketCode: ticket.code,
      title: ticket.title,
    };
  }

  /** 提测工单描述：迭代项上下文自动填入 + 人工补充 */
  private buildReleaseDescription(
    backlog: Backlog,
    iteration: Iteration | null,
    supplement: string,
  ): string {
    const lines = [
      '## 迭代项提测信息',
      '',
      `- 迭代项：${backlog.code} ${backlog.title}（状态：${backlog.status}）`,
      `- 所属迭代：${
        iteration
          ? `${iteration.code} ${iteration.name}`
          : `#${backlog.iterationId}`
      }`,
      `- 原始需求：${backlog.title}（#${backlog.projectId}）｜ \`GET /api/projects/${backlog.projectId}.md\``,
      `- 负责人：${backlog.ownerName ?? '未指定'}`,
      `- 预期上线：${
        backlog.expectedOnlineAt
          ? `${beijingTime(backlog.expectedOnlineAt)}（北京时间）`
          : '未设置'
      }`,
      `- 交付任务：${
        backlog.taskId
          ? `#${backlog.taskId}｜\`GET /api/tasks/${backlog.taskId}.md\``
          : '（未创建）'
      }`,
      `- 迭代项详情：\`GET /api/backlogs/${backlog.id}.md\``,
      '',
      '## 补充说明',
      '',
      supplement || '（无）',
    ];
    return lines.join('\n');
  }

  /** 更新成员（仅管理员）；不自动同步已建群成员 */
  async updateMembers(
    id: number,
    members: BacklogMemberInput[],
    actor: IterationActor,
  ): Promise<Backlog> {
    this.assertAdmin(actor, '仅管理员可修改迭代项成员');
    const backlog = await this.findOne(id);
    const normalized = await this.normalizeMembers(members);
    backlog.members = normalized.length ? normalized : null;
    return this.backlogs.save(backlog);
  }

  async findOneMarkdown(id: number): Promise<string> {
    const backlog = await this.findOne(id);
    const iteration = await this.iterations.findOne({
      where: { id: backlog.iterationId },
    });
    const head = mdFrontmatter({
      update: backlog.updatedAt,
      title: backlog.title,
      code: backlog.code,
      status: backlog.status,
    });
    const meta = [
      `- 迭代项 ID：${backlog.id}`,
      `- 编号：${backlog.code}`,
      `- 原始需求：\`GET /api/projects/${backlog.projectId}.md\`（#${backlog.projectId}）`,
      `- 所属迭代：${
        iteration
          ? `${iteration.code} ${iteration.name}`
          : `#${backlog.iterationId}`
      }`,
      `- 状态：${backlog.status}`,
      `- 负责人：${backlog.ownerName ?? '-'}`,
      `- 预期上线：${
        backlog.expectedOnlineAt
          ? `${beijingTime(backlog.expectedOnlineAt)}（北京时间）`
          : '-'
      }`,
      `- 交付任务：${
        backlog.taskId
          ? `\`GET /api/tasks/${backlog.taskId}.md\``
          : '（未创建）'
      }`,
      `- 平台链接：/backlogs/${backlog.id}`,
    ];
    if (backlog.startedAt)
      meta.push(`- 开始执行：${beijingTime(backlog.startedAt)}`);
    if (backlog.testingAt)
      meta.push(`- 进入测试：${beijingTime(backlog.testingAt)}`);
    if (backlog.releasingAt)
      meta.push(`- 进入发布：${beijingTime(backlog.releasingAt)}`);
    if (backlog.completedAt)
      meta.push(`- 完成时间：${beijingTime(backlog.completedAt)}`);
    if (backlog.canceledAt)
      meta.push(`- 取消时间：${beijingTime(backlog.canceledAt)}`);

    const membersText = backlog.members?.length
      ? backlog.members
          .map((member) => `${member.role}：${member.name}`)
          .join('；')
      : '（暂无）';

    const [docs, events] = await Promise.all([
      this.listDocuments(backlog.id),
      this.listEvents(backlog.id),
    ]);
    const docsText = docs.length
      ? docs
          .map(
            (doc) =>
              `- ${doc.title}（${doc.type}｜\`GET /api/documents/${doc.id}.md\`）`,
          )
          .join('\n')
      : '（暂无）';
    const eventsText = events.length
      ? events
          .map((event) => {
            const payload = event.payload as {
              from?: string;
              to?: string;
              remark?: string;
            } | null;
            const detail =
              event.type === 'status'
                ? `（${payload?.from ?? '?'} → ${payload?.to ?? '?'}）`
                : '';
            const remark = payload?.remark ? `：${payload.remark}` : '';
            return `- ${beijingTime(event.createdAt)} ${event.operator ?? '系统'} ${event.type}${detail}${remark}`;
          })
          .join('\n')
      : '（暂无）';

    const sections = [
      '# 迭代项',
      '',
      ...meta,
      '',
      '## 成员',
      '',
      membersText,
      '',
      '## 文档',
      '',
      docsText,
      '',
      '## 最近事件',
      '',
      eventsText,
      '',
    ];
    return `${head}${sections.join('\n')}\n`;
  }

  /** 迁移需求的全部文档关联到迭代项，返回迁移数量 */
  private async migrateProjectDocuments(
    backlogId: number,
    projectId: number,
  ): Promise<number> {
    const docs = await this.documents.find({
      where: { projectId },
      select: { id: true },
    });
    if (docs.length === 0) return 0;
    await this.backlogDocuments
      .createQueryBuilder()
      .insert()
      .into(BacklogDocument)
      .values(docs.map((doc) => ({ backlogId, documentId: doc.id })))
      .orIgnore()
      .execute();
    return docs.length;
  }

  /** 追加事件（append-only）；失败只告警不阻断主流程 */
  private async recordEvent(
    backlogId: number,
    type: string,
    payload: Record<string, unknown> | null,
    operator?: string | null,
  ): Promise<void> {
    try {
      await this.backlogEvents.save(
        this.backlogEvents.create({
          backlogId,
          type,
          payload: payload ?? null,
          operator: operator ?? null,
        }),
      );
    } catch (error) {
      this.logger.warn(
        `迭代项 #${backlogId} 事件 ${type} 记录失败：${(error as Error).message}`,
      );
    }
  }

  /**
   * 后台生成迭代项标题：「BL-{id}」+ 模型生成的简洁标题。
   * 未配置模型场景时直接跳过；期间标题被人工修改（乐观条件不命中）则不覆盖。
   */
  private scheduleTitleNaming(
    backlogId: number,
    originalTitle: string,
    material: {
      requirement: string;
      iteration: string;
      owner: string;
      description?: string;
    },
  ): void {
    if (!backlogId || this.titleNaming.has(backlogId)) return;
    this.titleNaming.add(backlogId);
    void this.generateBacklogTitle(backlogId, originalTitle, material)
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`迭代项 #${backlogId} 标题生成失败：${message}`);
      })
      .finally(() => this.titleNaming.delete(backlogId));
  }

  private async generateBacklogTitle(
    backlogId: number,
    originalTitle: string,
    material: {
      requirement: string;
      iteration: string;
      owner: string;
      description?: string;
    },
  ): Promise<void> {
    const generated = await this.llm.generateTitle(
      [
        `需求：${material.requirement}`,
        `迭代：${material.iteration}`,
        `负责人：${material.owner}`,
        ...(material.description ? [`说明：${material.description}`] : []),
      ]
        .join('\n')
        .slice(0, 4000),
    );
    if (!generated) return;
    const title = `「BL-${backlogId}」${generated}`.slice(0, 200);
    const result = await this.backlogs
      .createQueryBuilder()
      .update(Backlog)
      .set({ title })
      .where('id = :id AND title = :original', {
        id: backlogId,
        original: originalTitle,
      })
      .execute();
    if (result.affected) {
      this.logger.log(`迭代项 #${backlogId} 标题已生成：${title}`);
    }
  }

  private applyStatus(
    backlog: Backlog,
    status: BacklogStatus,
    by: string,
    now: Date,
  ): Backlog {
    backlog.status = status;
    backlog.statusBy = by;
    switch (status) {
      case BacklogStatus.WAITING:
        backlog.startedAt = null;
        backlog.testingAt = null;
        backlog.releasingAt = null;
        backlog.completedAt = null;
        backlog.canceledAt = null;
        break;
      case BacklogStatus.EXECUTING:
        backlog.startedAt = backlog.startedAt ?? now;
        backlog.testingAt = null;
        backlog.releasingAt = null;
        backlog.completedAt = null;
        backlog.canceledAt = null;
        break;
      case BacklogStatus.TESTING:
        backlog.startedAt = backlog.startedAt ?? now;
        backlog.testingAt = now;
        backlog.releasingAt = null;
        backlog.completedAt = null;
        backlog.canceledAt = null;
        break;
      case BacklogStatus.RELEASING:
        backlog.startedAt = backlog.startedAt ?? now;
        backlog.testingAt = backlog.testingAt ?? now;
        backlog.releasingAt = now;
        backlog.completedAt = null;
        backlog.canceledAt = null;
        break;
      case BacklogStatus.COMPLETED:
        backlog.startedAt = backlog.startedAt ?? now;
        backlog.testingAt = backlog.testingAt ?? now;
        backlog.releasingAt = backlog.releasingAt ?? now;
        backlog.completedAt = now;
        backlog.canceledAt = null;
        break;
      case BacklogStatus.CANCELED:
        backlog.canceledAt = now;
        break;
      default:
        break;
    }
    return backlog;
  }

  private isTerminal(status: BacklogStatus): boolean {
    return (
      status === BacklogStatus.COMPLETED || status === BacklogStatus.CANCELED
    );
  }

  private isMember(backlog: Backlog, userId: number | null): boolean {
    if (userId === null) return false;
    return (backlog.members ?? []).some((member) => member.userId === userId);
  }

  private assertAssignableWorker(worker: Worker | undefined, id: number): void {
    if (!worker) throw new BadRequestException(`负责人机器人 #${id} 不存在`);
    if (!worker.enabled) {
      throw new BadRequestException(`负责人机器人「${worker.name}」已停用`);
    }
    if (worker.role === WorkerRole.SCHEDULER) {
      throw new BadRequestException(
        `「${worker.name}」为调度机器人，不承接交付任务`,
      );
    }
    if (worker.personalAgentUserId) {
      throw new BadRequestException(
        `「${worker.name}」为个人 AGENT，不承接迭代交付任务`,
      );
    }
  }

  private async normalizeMembers(
    input?: BacklogMemberInput[],
  ): Promise<BacklogMember[]> {
    if (!input || input.length === 0) return [];
    const validRoles = new Set<string>(Object.values(BacklogMemberRole));
    const seen = new Set<string>();
    const picks: BacklogMemberInput[] = [];
    for (const member of input) {
      if (!member || !validRoles.has(member.role)) {
        throw new BadRequestException(`成员角色非法：${String(member?.role)}`);
      }
      if (!Number.isInteger(member.userId) || member.userId <= 0) {
        throw new BadRequestException('成员用户 ID 非法');
      }
      const key = `${member.role}:${member.userId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      picks.push({ role: member.role, userId: member.userId });
    }
    const userIds = [...new Set(picks.map((pick) => pick.userId))];
    const users = await this.users.find({
      where: { id: In(userIds) },
      select: { id: true, name: true },
    });
    const userMap = new Map(users.map((user) => [user.id, user]));
    return picks.map((pick) => {
      const user = userMap.get(pick.userId);
      if (!user) {
        throw new BadRequestException(`成员用户 #${pick.userId} 不存在`);
      }
      return { role: pick.role, userId: user.id, name: user.name };
    });
  }

  /** 合并显式成员与自动带入成员，按「角色 + 用户」去重 */
  private mergeMembers(
    explicit: BacklogMember[],
    auto: Array<{ role: BacklogMemberRole; name: string }>,
    userByName: Map<string, User>,
  ): BacklogMember[] {
    const result = [...explicit];
    const keys = new Set(
      result.map((member) => `${member.role}:${member.userId}`),
    );
    for (const candidate of auto) {
      const user = userByName.get(candidate.name);
      if (!user) continue;
      const key = `${candidate.role}:${user.id}`;
      if (keys.has(key)) continue;
      keys.add(key);
      result.push({ role: candidate.role, userId: user.id, name: user.name });
    }
    return result;
  }

  private assertAdmin(actor: IterationActor, message: string): void {
    if (!actor.isAdmin) throw new ForbiddenException(message);
  }
}
