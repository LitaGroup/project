import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { In, IsNull, Repository, type FindOptionsWhere } from 'typeorm';
import {
  TaskStatus,
  TaskSubStatus,
  WorkerGithubPermission,
  WorkerLiveStatus,
  WorkerResourcePermission,
  WorkerRole,
  WorkerRuntime,
} from '../common/enums';
import { User } from '../auth/user.entity';
import { Task } from '../tasks/task.entity';
import { TaskTemplate } from '../tasks/task-template.entity';
import { Executor } from '../executors/executor.entity';
import {
  Worker,
  WorkerSkill,
  WorkerStandard,
  WorkerTaskDef,
} from './worker.entity';
import { WorkerDebugSession } from './worker-debug-session.entity';
import { FeishuBotConfig } from '../feishu-bot/feishu-bot-config.entity';
import { SYSTEM_WORKER_ID_LIMIT, isSystemWorkerId } from './system-workers';
import { ensureWorkerSequenceFloor } from './system-workers.service';
import { WorkerSkillCatalogService } from './worker-skill-catalog.service';
import { WorkerStandardCatalogService } from './worker-standard-catalog.service';

export interface CreateWorkerInput {
  name: string;
  intro?: string | null;
  avatarUrl?: string | null;
  role?: WorkerRole;
  runtime?: WorkerRuntime;
  executorId?: number | null;
  providerId?: string | null;
  modelId?: string | null;
  /** 默认思考等级（opencode variant id；空=模型默认） */
  variant?: string | null;
  prompt?: string | null;
  skills?: WorkerSkill[] | null;
  standards?: WorkerStandard[] | null;
  taskDefs?: WorkerTaskDef[] | null;
  ownerUserId?: number | null;
  enabled?: boolean;
  githubPermission?: WorkerGithubPermission;
  resourcePermission?: WorkerResourcePermission;
  /** 并行执行上限（仅 AI 机器人；1 表示串行，默认 3） */
  maxParallelTasks?: number;
}

export type UpdateWorkerInput = Partial<CreateWorkerInput>;

/**
 * 并行执行上限归一：仅接受 1-20 的整数；未传时默认 3，设 1 即恢复串行行为。
 * 只约束 AI 机器人，真人机器人不受此限制。
 */
function normalizeMaxParallelTasks(value: unknown): number {
  if (value === undefined || value === null || value === '') return 3;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 20) {
    throw new BadRequestException('并行上限必须是 1-20 的整数');
  }
  return parsed;
}

/** 头像归一：仅接受 POST /api/images 上传后返回的 /images/... 路径，空值清除 */
function normalizeAvatarUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim() || null;
  if (!trimmed) return null;
  if (!trimmed.startsWith('/images/') || trimmed.includes('..')) {
    throw new BadRequestException(
      '头像必须是图片上传接口返回的 /images/... 路径',
    );
  }
  return trimmed;
}

/**
 * GitHub 权限归一：开发权限 / 发布权限 / 无权限（未配置）均可设置，机器人类型不限制；
 * 未传时缺省为开发权限（真人机器人创建时显式从未配置起步）。
 */
function normalizeGithubPermission(value: unknown): WorkerGithubPermission {
  if (value === undefined || value === null || value === '') {
    return WorkerGithubPermission.DEVELOP;
  }
  if (
    value === WorkerGithubPermission.NONE ||
    value === WorkerGithubPermission.DEVELOP ||
    value === WorkerGithubPermission.RELEASE
  ) {
    return value;
  }
  throw new BadRequestException(
    'GitHub 权限仅支持 none（无权限）/ develop（开发权限）/ release（发布权限）',
  );
}

/**
 * 资源网关权限归一：write / read / none。
 * 未传时缺省为 none，安全优先；已有机器人需管理员显式授权。
 */
function normalizeResourcePermission(value: unknown): WorkerResourcePermission {
  if (value === undefined || value === null || value === '') {
    return WorkerResourcePermission.NONE;
  }
  if (
    value === WorkerResourcePermission.NONE ||
    value === WorkerResourcePermission.READ ||
    value === WorkerResourcePermission.WRITE
  ) {
    return value;
  }
  throw new BadRequestException(
    '资源权限仅支持 none（无权限）/ read（仅只读资源）/ write（全部资源）',
  );
}

/** 机器人视图：实体 + 工位路径 + 实时状态 + 当前任务（均不落库实时推导） */
export interface WorkerView extends Worker {
  /** 系统机器人（systemKey 或系统 ID 段，由代码内置，网页不可新增/删除） */
  system: boolean;
  /** 工位路径：生产 {WORKER_BASE_DIR}/worker/{id}，开发 {WORKER_BASE_DIR}/worker-dev/{id}；未配置 WORKER_BASE_DIR 为 null */
  workdir: string | null;
  liveStatus: WorkerLiveStatus;
  /** 当前占用机器人的活跃任务（执行中/待接受/待反馈等待处理；待申请验收不占用） */
  activeTask: {
    id: number;
    code: string;
    title: string;
    status: string;
  } | null;
  /** 当前执行中的任务数（AI 机器人配合 maxParallelTasks 展示并行占用） */
  executingCount: number;
  /** 已绑定独立飞书应用（头像角标用；配置未启用也标记为已配置） */
  feishuBound: boolean;
}

/** 未结束任务（互斥优先级：执行中 > 待验收 > 其他等待） */
const ACTIVE_STATUSES = [TaskStatus.WAITING, TaskStatus.RUNNING];

@Injectable()
export class WorkersService implements OnApplicationBootstrap {
  private readonly logger = new Logger(WorkersService.name);
  /** 工位根目录（执行器机器上的路径约定，环境变量 WORKER_BASE_DIR） */
  private readonly workerBaseDir: string | null;
  /** 工位目录段：生产 worker、开发 worker-dev（由 NODE_ENV 决定） */
  private readonly workerDirSegment: 'worker' | 'worker-dev';

  /** 自定义机器人 ID 起点是否已校正（只调整一次序列） */
  private idFloorEnsured = false;

  constructor(
    @InjectRepository(Worker)
    private readonly workers: Repository<Worker>,
    @InjectRepository(Task)
    private readonly tasks: Repository<Task>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(Executor)
    private readonly executors: Repository<Executor>,
    @InjectRepository(TaskTemplate)
    private readonly taskTemplates: Repository<TaskTemplate>,
    @InjectRepository(WorkerDebugSession)
    private readonly debugSessions: Repository<WorkerDebugSession>,
    @InjectRepository(FeishuBotConfig)
    private readonly feishuConfigs: Repository<FeishuBotConfig>,
    private readonly skillCatalog: WorkerSkillCatalogService,
    private readonly standardCatalog: WorkerStandardCatalogService,
    config: ConfigService,
  ) {
    this.workerBaseDir = config.get<string>('WORKER_BASE_DIR')?.trim() || null;
    this.workerDirSegment =
      config.get<string>('NODE_ENV')?.trim() === 'production'
        ? 'worker'
        : 'worker-dev';
  }

  /** 启动时补齐真人机器人；通讯录同步可能在应用启动后继续创建新用户 */
  async onApplicationBootstrap(): Promise<void> {
    await this.ensureHumanWorkersForAllUsers().catch((error: Error) => {
      this.logger.error(`真人机器人初始化失败: ${error.message}`);
    });
  }

  /** 为用户系统全量用户补齐唯一的真人机器人 */
  async ensureHumanWorkersForAllUsers(): Promise<number> {
    const users = await this.users.find({
      select: { id: true, name: true, avatarUrl: true, enabled: true },
    });
    for (const user of users) {
      await this.ensureHumanWorker(user);
    }
    return users.length;
  }

  /** 工位路径：生产 {WORKER_BASE_DIR}/worker/{id}、开发 {WORKER_BASE_DIR}/worker-dev/{id}（不落库实时计算） */
  workdirOf(id: number): string | null {
    if (!this.workerBaseDir) return null;
    return `${this.workerBaseDir.replace(/\/+$/, '')}/${this.workerDirSegment}/${id}`;
  }

  /** 列表（role 筛选），附实时状态与工位路径；个人 AGENT 默认不进入对外机器人清单 */
  async findAll(filter?: {
    role?: WorkerRole;
    /** 仅管理员飞书配置使用：包含个人 AGENT */
    includePersonal?: boolean;
  }): Promise<WorkerView[]> {
    const where: FindOptionsWhere<Worker> = {};
    if (filter?.role) where.role = filter.role;
    // TypeORM 不接受 undefined 作为 where 条件值：按需拼装查询条件
    if (!filter?.includePersonal) where.personalAgentUserId = IsNull();
    const workers = await this.workers.find({
      where,
      order: { id: 'ASC' },
    });
    const live = await this.liveByWorker(workers);
    const feishuBound = await this.boundWorkerIds(workers.map((w) => w.id));
    return workers.map((w) => this.toView(w, live, feishuBound));
  }

  async findOne(id: number): Promise<Worker> {
    const worker = await this.workers.findOne({ where: { id } });
    if (!worker) throw new NotFoundException(`Worker ${id} not found`);
    return worker;
  }

  async findOneView(id: number): Promise<WorkerView> {
    const worker = await this.findOne(id);
    const live = await this.liveByWorker([worker]);
    const feishuBound = await this.boundWorkerIds([worker.id]);
    return this.toView(worker, live, feishuBound);
  }

  /**
   * 按机器人独立令牌查找启用中的机器人。
   * agentToken 为 select:false，内部显式查询，避免出现在普通机器人响应中。
   */
  async findByAgentToken(token: string): Promise<Worker | null> {
    if (!token) return null;
    return this.workers
      .createQueryBuilder('worker')
      .addSelect('worker.agentToken')
      .where('worker.agentToken = :token', { token })
      .andWhere('worker.enabled = true')
      .getOne();
  }

  /**
   * 确保机器人用于访问平台的工作令牌并返回明文。
   * 普通机器人使用自身独立令牌；个人 AGENT 使用其主人真人机器人的令牌，
   * 保证「我的 AI」以该用户真人机器人的身份访问平台。
   */
  async ensureWorkToken(workerId: number): Promise<string> {
    const worker = await this.workers.findOne({
      where: { id: workerId },
      select: { id: true, personalAgentUserId: true },
    });
    if (worker?.personalAgentUserId) {
      const human = await this.findByHumanUserId(worker.personalAgentUserId);
      if (human) return this.ensureAgentToken(human.id);
    }
    return this.ensureAgentToken(workerId);
  }

  /**
   * 确保机器人有独立令牌并返回明文（仅服务端内部使用）。
   * 首次派发时生成；之后直接复用，不轮换。
   */
  async ensureAgentToken(workerId: number): Promise<string> {
    const worker = await this.workers
      .createQueryBuilder('worker')
      .addSelect('worker.agentToken')
      .where('worker.id = :workerId', { workerId })
      .getOne();
    if (!worker) throw new NotFoundException(`Worker ${workerId} not found`);
    if (worker.agentToken) return worker.agentToken;

    const token = randomBytes(24).toString('hex');
    await this.workers.update({ id: workerId }, { agentToken: token });
    return token;
  }

  /** 实时状态：执行中按并行数展示；待接受/待反馈等待处理 > 空闲。待申请验收/待验收不占用执行容量。 */
  private async liveByWorker(
    workers: Worker[],
  ): Promise<
    Map<
      number,
      { status: WorkerLiveStatus; task: Task | null; executingCount: number }
    >
  > {
    const map = new Map<
      number,
      { status: WorkerLiveStatus; task: Task | null; executingCount: number }
    >();
    if (workers.length === 0) return map;
    const ids = workers.map((w) => w.id);
    const activeTasks = await this.tasks.find({
      where: [
        { agentId: In(ids), status: In(ACTIVE_STATUSES) },
        { schedulerId: In(ids), status: In(ACTIVE_STATUSES) },
      ],
      order: { updatedAt: 'DESC' },
    });
    for (const worker of workers) {
      const own = activeTasks.filter((t) => t.agentId === worker.id);
      const executing = own.find(
        (t) => t.subStatus === TaskSubStatus.EXECUTING,
      );
      const accepting = own.find(
        (t) => t.subStatus === TaskSubStatus.PENDING_ACCEPT,
      );
      const waiting = own.find((t) =>
        [
          TaskSubStatus.PENDING_ASSIGNMENT,
          TaskSubStatus.PENDING_ACCEPTANCE,
          TaskSubStatus.PENDING_FEEDBACK,
          TaskSubStatus.PENDING_RESUME,
        ].includes(t.subStatus),
      );
      const current = executing ?? accepting ?? waiting ?? null;
      const executingCount = own.filter(
        (t) => t.subStatus === TaskSubStatus.EXECUTING,
      ).length;
      const status = executing
        ? WorkerLiveStatus.WORKING
        : accepting
          ? WorkerLiveStatus.ACCEPTING
          : waiting
            ? WorkerLiveStatus.WAITING
            : WorkerLiveStatus.IDLE;
      map.set(worker.id, { status, task: current, executingCount });
    }
    return map;
  }

  private toView(
    worker: Worker,
    live: Map<
      number,
      { status: WorkerLiveStatus; task: Task | null; executingCount: number }
    >,
    feishuBound: Set<number> = new Set(),
  ): WorkerView {
    const entry = live.get(worker.id);
    return {
      ...worker,
      system: Boolean(worker.systemKey) || isSystemWorkerId(worker.id),
      workdir: this.workdirOf(worker.id),
      liveStatus: entry?.status ?? WorkerLiveStatus.IDLE,
      feishuBound: feishuBound.has(worker.id),
      executingCount: entry?.executingCount ?? 0,
      activeTask: entry?.task
        ? {
            id: entry.task.id,
            code: entry.task.code,
            title: entry.task.title,
            status: entry.task.status,
          }
        : null,
    };
  }

  /** 已绑定飞书应用的机器人 id 集合（头像角标） */
  private async boundWorkerIds(ids: number[]): Promise<Set<number>> {
    if (ids.length === 0) return new Set();
    const rows = await this.feishuConfigs.find({
      where: { kind: 'worker', workerId: In(ids) },
      select: { workerId: true },
    });
    return new Set(
      rows
        .map((row) => row.workerId)
        .filter((id): id is number => typeof id === 'number'),
    );
  }

  async create(input: CreateWorkerInput): Promise<WorkerView> {
    const name = input.name?.trim();
    if (!name) throw new BadRequestException('名称不能为空');
    if (input.role === WorkerRole.SCHEDULER) {
      throw new BadRequestException(
        '调度机器人为系统机器人，只能通过代码内置，网页不能创建',
      );
    }
    if (input.runtime && input.runtime !== WorkerRuntime.OPENCODE) {
      throw new BadRequestException('机器人运行时统一为 opencode');
    }
    const exists = await this.workers.findOne({ where: { name } });
    if (exists) throw new BadRequestException(`名称「${name}」已存在`);
    await this.ensureCustomWorkerIdFloor();
    const skills = this.skillCatalog.normalizeSkills(input.skills) ?? null;
    const standards =
      this.standardCatalog.normalizeStandards(input.standards) ?? null;
    const worker = this.workers.create({
      name,
      intro: input.intro?.trim() || null,
      avatarUrl: normalizeAvatarUrl(input.avatarUrl),
      role: WorkerRole.WORKER,
      runtime: WorkerRuntime.OPENCODE,
      executorId: input.executorId ?? null,
      providerId: input.providerId?.trim() || null,
      modelId: input.modelId?.trim() || null,
      variant: input.variant?.trim() || null,
      prompt: input.prompt?.trim() || null,
      skills,
      standards,
      taskDefs: input.taskDefs?.length ? input.taskDefs : null,
      enabled: input.enabled ?? true,
      githubPermission: normalizeGithubPermission(input.githubPermission),
      resourcePermission: normalizeResourcePermission(input.resourcePermission),
      maxParallelTasks: normalizeMaxParallelTasks(input.maxParallelTasks),
    });
    await this.assertConfig(worker);
    await this.resolveOwner(worker, input.ownerUserId ?? null);
    const saved = await this.workers.save(worker);
    if (saved.id < SYSTEM_WORKER_ID_LIMIT) {
      // 理论上 ensureCustomWorkerIdFloor 已保证；兜底避免自定义机器人占用系统 ID 段
      await this.workers.delete({ id: saved.id });
      throw new BadRequestException(
        `自定义机器人 ID 必须从 ${SYSTEM_WORKER_ID_LIMIT} 开始，请稍后重试`,
      );
    }
    return this.findOneView(saved.id);
  }

  /** 首次创建自定义机器人前，把自增起点抬到系统 ID 段之外 */
  private async ensureCustomWorkerIdFloor(): Promise<void> {
    if (this.idFloorEnsured) return;
    await ensureWorkerSequenceFloor(this.workers);
    this.idFloorEnsured = true;
  }

  async update(id: number, input: UpdateWorkerInput): Promise<WorkerView> {
    const worker = await this.findOne(id);
    if (input.name !== undefined && input.name.trim() !== worker.name) {
      const name = input.name.trim();
      if (!name) throw new BadRequestException('名称不能为空');
      const exists = await this.workers.findOne({ where: { name } });
      if (exists) throw new BadRequestException(`名称「${name}」已存在`);
      worker.name = name;
    }
    if (input.intro !== undefined) worker.intro = input.intro?.trim() || null;
    if (input.avatarUrl !== undefined) {
      worker.avatarUrl = normalizeAvatarUrl(input.avatarUrl);
    }
    if (input.role !== undefined && input.role !== worker.role) {
      throw new BadRequestException('机器人角色由系统维护，不能修改');
    }
    if (
      !worker.humanUserId &&
      input.runtime !== undefined &&
      input.runtime !== WorkerRuntime.OPENCODE
    ) {
      throw new BadRequestException('机器人运行时统一为 opencode');
    }
    if (!worker.humanUserId) worker.runtime = WorkerRuntime.OPENCODE;
    if (!worker.humanUserId && input.executorId !== undefined) {
      worker.executorId = input.executorId ?? null;
    }
    if (
      worker.humanUserId &&
      (input.providerId !== undefined ||
        input.modelId !== undefined ||
        input.variant !== undefined)
    ) {
      throw new BadRequestException(
        '真人机器人不能配置 AI 供应商/模型/思考等级',
      );
    }
    if (input.providerId !== undefined) {
      worker.providerId = input.providerId?.trim() || null;
    }
    if (input.modelId !== undefined) {
      worker.modelId = input.modelId?.trim() || null;
    }
    if (input.variant !== undefined) {
      worker.variant = input.variant?.trim() || null;
    }
    if (input.prompt !== undefined)
      worker.prompt = input.prompt?.trim() || null;
    if (input.skills !== undefined) {
      worker.skills = this.skillCatalog.normalizeSkills(input.skills) ?? null;
    }
    if (input.standards !== undefined) {
      worker.standards =
        this.standardCatalog.normalizeStandards(input.standards) ?? null;
    }
    if (input.taskDefs !== undefined) {
      worker.taskDefs = input.taskDefs?.length ? input.taskDefs : null;
    }
    if (input.enabled !== undefined) worker.enabled = input.enabled;
    if (input.githubPermission !== undefined) {
      worker.githubPermission = normalizeGithubPermission(
        input.githubPermission,
      );
    }
    if (input.resourcePermission !== undefined) {
      worker.resourcePermission = normalizeResourcePermission(
        input.resourcePermission,
      );
    }
    if (input.maxParallelTasks !== undefined && !worker.humanUserId) {
      worker.maxParallelTasks = normalizeMaxParallelTasks(
        input.maxParallelTasks,
      );
    }
    await this.assertConfig(worker);
    if (input.ownerUserId !== undefined) {
      await this.resolveOwner(worker, input.ownerUserId ?? null);
    }
    await this.workers.save(worker);
    return this.findOneView(id);
  }

  /** 删除机器人（系统/真人机器人不可删除；已分配未完结任务时会拒绝） */
  async remove(id: number): Promise<void> {
    const worker = await this.findOne(id);
    if (worker.systemKey || isSystemWorkerId(worker.id)) {
      throw new BadRequestException(
        '系统机器人由代码内置，不能在网页删除（可停用）',
      );
    }
    if (worker.humanUserId) {
      throw new BadRequestException('真人机器人与用户一一绑定，不能删除');
    }
    if (worker.personalAgentUserId) {
      throw new BadRequestException(
        '个人 AGENT 与用户一一绑定，不能删除（可停用或编辑配置）',
      );
    }
    const active = await this.tasks.count({
      where: { agentId: id, status: In(ACTIVE_STATUSES) },
    });
    if (active > 0) {
      throw new BadRequestException(
        `该机器人还有 ${active} 个未完结任务，先处理任务再删除`,
      );
    }
    // 任务定义中的默认处理机器人随机器人删除解绑（无物理外键）
    const templates = await this.taskTemplates.find();
    for (const template of templates) {
      if (!(template.agentIds ?? []).includes(id)) continue;
      template.agentIds = template.agentIds.filter((agentId) => agentId !== id);
      await this.taskTemplates.save(template);
    }
    // 调试会话绑定随机器人删除清理（opencode 会话本身保留在执行器上）
    await this.debugSessions.delete({ workerId: id });
    await this.workers.remove(worker);
  }

  /** 配置校验：AI 机器人统一走执行器（opencode）；真人机器人由绑定用户执行，不需要执行器配置 */
  private async assertConfig(worker: Worker): Promise<void> {
    if (worker.humanUserId) {
      if (worker.runtime !== WorkerRuntime.HUMAN) {
        throw new BadRequestException('绑定用户的机器人运行时必须为 human');
      }
      if (
        worker.executorId ||
        worker.providerId ||
        worker.modelId ||
        worker.variant
      ) {
        throw new BadRequestException(
          '真人机器人不能配置 AI 执行器/供应商/模型/思考等级',
        );
      }
      return;
    }
    if (worker.runtime !== WorkerRuntime.OPENCODE) {
      throw new BadRequestException('AI 机器人运行时统一为 opencode');
    }
    if (worker.executorId) {
      const executor = await this.executors.findOne({
        where: { id: worker.executorId },
      });
      if (!executor) {
        throw new BadRequestException('执行器不存在');
      }
    } else if (worker.enabled) {
      throw new BadRequestException('启用中的机器人须选择执行器');
    }
    if (
      worker.enabled &&
      (!worker.modelId?.trim() || !worker.providerId?.trim())
    ) {
      throw new BadRequestException('启用中的机器人须选择供应商与模型');
    }
  }

  /** 责任人解析：须为用户系统内用户，姓名做快照 */
  private async resolveOwner(
    worker: Worker,
    ownerUserId: number | null,
  ): Promise<void> {
    if (ownerUserId === null) {
      worker.ownerUserId = null;
      worker.ownerName = null;
      return;
    }
    const user = await this.users.findOne({
      where: { id: ownerUserId },
      select: { id: true, name: true, feishuOpenId: true },
    });
    if (!user) throw new BadRequestException('责任人不存在于用户系统');
    worker.ownerUserId = user.id;
    worker.ownerName = user.name;
  }

  /** 责任人的飞书 open_id（任务通知用） */
  async ownerOpenId(worker: Worker): Promise<string | null> {
    if (!worker.ownerUserId) return null;
    const user = await this.users.findOne({
      where: { id: worker.ownerUserId },
      select: { feishuOpenId: true },
    });
    return user?.feishuOpenId ?? null;
  }

  /** 按绑定用户查真人机器人 */
  async findByHumanUserId(userId: number): Promise<Worker | null> {
    if (userId <= 0) return null;
    return this.workers.findOne({ where: { humanUserId: userId } });
  }

  /** 当前绑定用户的真人机器人（供任务动作/操作台校验执行人） */
  async mustHumanWorker(userId: number): Promise<Worker> {
    const worker = await this.findByHumanUserId(userId);
    if (!worker) {
      throw new NotFoundException('当前用户尚未绑定真人机器人');
    }
    return worker;
  }

  /**
   * 确保每个用户都有唯一的真人机器人：通讯录同步、登录和迁移共用入口。
   * 真人机器人是“用户在机器人协作体系中的执行器”，不需要 opencode 工位与模型配置。
   */
  async ensureHumanWorker(
    user: Pick<User, 'id' | 'name' | 'enabled'> & {
      avatarUrl?: string | null;
    },
  ): Promise<Worker> {
    const existing = await this.findByHumanUserId(user.id);
    if (existing) {
      const patch: Partial<Worker> = {};
      const name = await this.humanWorkerName(user);
      if (existing.name !== name) patch.name = name;
      if (existing.humanUserName !== user.name) {
        patch.humanUserName = user.name;
      }
      if (existing.avatarUrl !== (user.avatarUrl ?? null)) {
        patch.avatarUrl = user.avatarUrl ?? null;
      }
      if (existing.enabled !== user.enabled) patch.enabled = user.enabled;
      if (Object.keys(patch).length > 0) {
        await this.workers.update({ id: existing.id }, patch);
        Object.assign(existing, patch);
      }
      return existing;
    }

    await this.ensureCustomWorkerIdFloor();
    const name = await this.humanWorkerName(user);
    const worker = this.workers.create({
      name: name,
      intro: `真人机器人：由「${user.name}」在操作台执行任务`,
      avatarUrl: user.avatarUrl ?? null,
      role: WorkerRole.WORKER,
      runtime: WorkerRuntime.HUMAN,
      executorId: null,
      providerId: null,
      modelId: null,
      prompt: null,
      skills: null,
      standards: null,
      taskDefs: null,
      humanUserId: user.id,
      humanUserName: user.name,
      enabled: user.enabled,
      githubPermission: WorkerGithubPermission.DEVELOP,
      resourcePermission: WorkerResourcePermission.NONE,
    });
    const saved = await this.workers.save(worker);
    this.logger.log(
      `已为用户「${user.name}」#${user.id} 创建真人机器人 #${saved.id}`,
    );
    return saved;
  }

  /** 真人机器人展示名：使用用户飞书中文名称，冲突时稳定追加用户 ID */
  private async humanWorkerName(
    user: Pick<User, 'id' | 'name'>,
  ): Promise<string> {
    const base = (user.name?.trim() || `用户#${user.id}`).slice(0, 100);
    const row = await this.workers.findOne({
      where: { name: base },
      select: { id: true, humanUserId: true },
    });
    if (!row || row.humanUserId === user.id) return base;
    const suffix = `#${user.id}`;
    return `${base.slice(0, 100 - suffix.length)}${suffix}`;
  }
}
