import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  TaskStatus,
  TaskSubStatus,
  WorkerLiveStatus,
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
  prompt?: string | null;
  skills?: WorkerSkill[] | null;
  standards?: WorkerStandard[] | null;
  taskDefs?: WorkerTaskDef[] | null;
  ownerUserId?: number | null;
  enabled?: boolean;
}

export type UpdateWorkerInput = Partial<CreateWorkerInput>;

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

/** 机器人视图：实体 + 工位路径 + 实时状态 + 当前任务（均不落库实时推导） */
export interface WorkerView extends Worker {
  /** 系统机器人（systemKey 或系统 ID 段，由代码内置，网页不可新增/删除） */
  system: boolean;
  /** 工位路径 {WORKER_BASE_DIR}/worker/{id}；未配置 WORKER_BASE_DIR 为 null */
  workdir: string | null;
  liveStatus: WorkerLiveStatus;
  /** 当前活跃任务（执行中/等待派发/待验收中最新一条） */
  activeTask: {
    id: number;
    code: string;
    title: string;
    status: string;
  } | null;
}

/** 未结束任务（互斥优先级：执行中 > 待验收 > 其他等待） */
const ACTIVE_STATUSES = [TaskStatus.WAITING, TaskStatus.RUNNING];

@Injectable()
export class WorkersService {
  /** 工位根目录（执行器机器上的路径约定，环境变量 WORKER_BASE_DIR） */
  private readonly workerBaseDir: string | null;

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
    private readonly skillCatalog: WorkerSkillCatalogService,
    private readonly standardCatalog: WorkerStandardCatalogService,
    config: ConfigService,
  ) {
    this.workerBaseDir = config.get<string>('WORKER_BASE_DIR')?.trim() || null;
  }

  /** 工位路径：{WORKER_BASE_DIR}/worker/{id}/（不落库实时计算） */
  workdirOf(id: number): string | null {
    if (!this.workerBaseDir) return null;
    return `${this.workerBaseDir.replace(/\/+$/, '')}/worker/${id}`;
  }

  /** 列表（role 筛选），附实时状态与工位路径 */
  async findAll(filter?: { role?: WorkerRole }): Promise<WorkerView[]> {
    const workers = await this.workers.find({
      where: {
        ...(filter?.role ? { role: filter.role } : {}),
      },
      order: { id: 'ASC' },
    });
    const live = await this.liveByWorker(workers);
    return workers.map((w) => this.toView(w, live));
  }

  async findOne(id: number): Promise<Worker> {
    const worker = await this.workers.findOne({ where: { id } });
    if (!worker) throw new NotFoundException(`Worker ${id} not found`);
    return worker;
  }

  async findOneView(id: number): Promise<WorkerView> {
    const worker = await this.findOne(id);
    const live = await this.liveByWorker([worker]);
    return this.toView(worker, live);
  }

  /**
   * 实时状态推导：工作者按名下任务 执行中 > 待验收 > 已派发（等待） > 空闲；
   * 调度机器人按正在识别（schedulerId）的任务显示工作中。
   */
  private async liveByWorker(
    workers: Worker[],
  ): Promise<Map<number, { status: WorkerLiveStatus; task: Task | null }>> {
    const map = new Map<
      number,
      { status: WorkerLiveStatus; task: Task | null }
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
          TaskSubStatus.PENDING_IDENTIFY,
          TaskSubStatus.PENDING_FEEDBACK,
          TaskSubStatus.IDENTIFYING,
        ].includes(t.subStatus),
      );
      const identifying =
        worker.role === WorkerRole.SCHEDULER
          ? activeTasks.find(
              (t) =>
                t.schedulerId === worker.id &&
                t.subStatus === TaskSubStatus.IDENTIFYING,
            )
          : undefined;
      const current = identifying ?? executing ?? accepting ?? waiting ?? null;
      const status = identifying
        ? WorkerLiveStatus.WORKING
        : executing
          ? WorkerLiveStatus.WORKING
          : accepting
            ? WorkerLiveStatus.ACCEPTING
            : waiting
              ? WorkerLiveStatus.WAITING
              : WorkerLiveStatus.IDLE;
      map.set(worker.id, { status, task: current });
    }
    return map;
  }

  private toView(
    worker: Worker,
    live: Map<number, { status: WorkerLiveStatus; task: Task | null }>,
  ): WorkerView {
    const entry = live.get(worker.id);
    return {
      ...worker,
      system: Boolean(worker.systemKey) || isSystemWorkerId(worker.id),
      workdir: this.workdirOf(worker.id),
      liveStatus: entry?.status ?? WorkerLiveStatus.IDLE,
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
      prompt: input.prompt?.trim() || null,
      skills,
      standards,
      taskDefs: input.taskDefs?.length ? input.taskDefs : null,
      enabled: input.enabled ?? true,
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
      input.runtime !== undefined &&
      input.runtime !== WorkerRuntime.OPENCODE
    ) {
      throw new BadRequestException('机器人运行时统一为 opencode');
    }
    worker.runtime = WorkerRuntime.OPENCODE;
    if (input.executorId !== undefined) {
      worker.executorId = input.executorId ?? null;
    }
    if (input.providerId !== undefined) {
      worker.providerId = input.providerId?.trim() || null;
    }
    if (input.modelId !== undefined) {
      worker.modelId = input.modelId?.trim() || null;
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
    await this.assertConfig(worker);
    if (input.ownerUserId !== undefined) {
      await this.resolveOwner(worker, input.ownerUserId ?? null);
    }
    await this.workers.save(worker);
    return this.findOneView(id);
  }

  /** 删除机器人（系统机器人不可删除；已分配未完结任务时会拒绝） */
  async remove(id: number): Promise<void> {
    const worker = await this.findOne(id);
    if (worker.systemKey || isSystemWorkerId(worker.id)) {
      throw new BadRequestException(
        '系统机器人由代码内置，不能在网页删除（可停用）',
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

  /** 配置校验：所有机器人统一走执行器（opencode），调度机器人也不例外；停用的机器人允许配置不完整 */
  private async assertConfig(worker: Worker): Promise<void> {
    if (worker.runtime !== WorkerRuntime.OPENCODE) {
      throw new BadRequestException('机器人运行时统一为 opencode');
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
}
