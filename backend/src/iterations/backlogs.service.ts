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
import { Project } from '../projects/project.entity';
import { User } from '../auth/user.entity';
import { TasksService } from '../tasks/tasks.service';
import { SYSTEM_BACKLOG_DELIVERY_TASK_TEMPLATE_ID } from '../tasks/system-task-templates';
import { Worker } from '../workers/worker.entity';
import { FeishuBotBacklogChatService } from '../feishu-bot/feishu-bot-backlog-chat.service';
import { Backlog, BacklogMember } from './backlog.entity';
import { Iteration } from './iteration.entity';
import {
  BacklogMemberInput,
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
    private readonly tasks: TasksService,
    private readonly chat: FeishuBotBacklogChatService,
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

  /** 手动流转状态：成员或管理员；终态不可再变更 */
  async updateStatus(
    id: number,
    status: BacklogStatus,
    actor: IterationActor,
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

    const updated = this.applyStatus(
      backlog,
      status,
      actor.userName,
      new Date(),
    );
    const saved = await this.backlogs.save(updated);

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
    backlog.iterationId = iterationId;
    return this.backlogs.save(backlog);
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
    const sections = [
      '# 迭代项',
      '',
      ...meta,
      '',
      '## 成员',
      '',
      membersText,
      '',
    ];
    return `${head}${sections.join('\n')}\n`;
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
