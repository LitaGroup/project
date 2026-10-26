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
  WorkerKind,
  WorkerLiveStatus,
  WorkerRole,
  WorkerRuntime,
} from '../common/enums';
import { User } from '../auth/user.entity';
import { Task } from '../tasks/task.entity';
import { TaskTemplate } from '../tasks/task-template.entity';
import { Executor } from '../executors/executor.entity';
import { Worker, WorkerSkill, WorkerTaskDef } from './worker.entity';

export interface CreateWorkerInput {
  name: string;
  intro?: string | null;
  kind?: WorkerKind;
  role?: WorkerRole;
  runtime?: WorkerRuntime;
  executorId?: number | null;
  providerId?: string | null;
  modelId?: string | null;
  prompt?: string | null;
  skills?: WorkerSkill[] | null;
  taskDefs?: WorkerTaskDef[] | null;
  ownerUserId?: number | null;
  materials?: string | null;
  enabled?: boolean;
}

export type UpdateWorkerInput = Partial<CreateWorkerInput>;

/** 机器人视图：实体 + 工位路径 + 实时状态 + 当前任务（均不落库实时推导） */
export interface WorkerView extends Worker {
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

/** 活跃状态（互斥优先级：执行中 > 待验收 > 已派发等待） */
const ACTIVE_STATUSES = [
  TaskStatus.DISPATCHED,
  TaskStatus.EXECUTING,
  TaskStatus.PENDING_ACCEPT,
];

@Injectable()
export class WorkersService {
  /** 工位根目录（执行器机器上的路径约定，环境变量 WORKER_BASE_DIR） */
  private readonly workerBaseDir: string | null;

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
    config: ConfigService,
  ) {
    this.workerBaseDir = config.get<string>('WORKER_BASE_DIR')?.trim() || null;
  }

  /** 工位路径：{WORKER_BASE_DIR}/worker/{id}/（不落库实时计算） */
  workdirOf(id: number): string | null {
    if (!this.workerBaseDir) return null;
    return `${this.workerBaseDir.replace(/\/+$/, '')}/worker/${id}`;
  }

  /** 列表（kind/role 筛选），附实时状态与工位路径 */
  async findAll(filter?: {
    kind?: WorkerKind;
    role?: WorkerRole;
  }): Promise<WorkerView[]> {
    const workers = await this.workers.find({
      where: {
        ...(filter?.kind ? { kind: filter.kind } : {}),
        ...(filter?.role ? { role: filter.role } : {}),
      },
      order: { id: 'ASC' },
    });
    const live = await this.liveByWorker(workers.map((w) => w.id));
    return workers.map((w) => this.toView(w, live));
  }

  async findOne(id: number): Promise<Worker> {
    const worker = await this.workers.findOne({ where: { id } });
    if (!worker) throw new NotFoundException(`Worker ${id} not found`);
    return worker;
  }

  async findOneView(id: number): Promise<WorkerView> {
    const worker = await this.findOne(id);
    const live = await this.liveByWorker([id]);
    return this.toView(worker, live);
  }

  /** 实时状态推导：执行中 > 待验收 > 已派发（等待） > 空闲 */
  private async liveByWorker(
    ids: number[],
  ): Promise<Map<number, { status: WorkerLiveStatus; task: Task | null }>> {
    const map = new Map<
      number,
      { status: WorkerLiveStatus; task: Task | null }
    >();
    if (ids.length === 0) return map;
    const activeTasks = await this.tasks.find({
      where: { agentId: In(ids), status: In(ACTIVE_STATUSES) },
      order: { updatedAt: 'DESC' },
    });
    for (const id of ids) {
      const own = activeTasks.filter((t) => t.agentId === id);
      const executing = own.find((t) => t.status === TaskStatus.EXECUTING);
      const accepting = own.find((t) => t.status === TaskStatus.PENDING_ACCEPT);
      const dispatched = own.find((t) => t.status === TaskStatus.DISPATCHED);
      const current = executing ?? accepting ?? dispatched ?? null;
      const status = executing
        ? WorkerLiveStatus.WORKING
        : accepting
          ? WorkerLiveStatus.ACCEPTING
          : dispatched
            ? WorkerLiveStatus.WAITING
            : WorkerLiveStatus.IDLE;
      map.set(id, { status, task: current });
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
      workdir:
        worker.kind === WorkerKind.AGENT ? this.workdirOf(worker.id) : null,
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
    const exists = await this.workers.findOne({ where: { name } });
    if (exists) throw new BadRequestException(`名称「${name}」已存在`);
    const worker = this.workers.create({
      name,
      intro: input.intro?.trim() || null,
      kind: input.kind ?? WorkerKind.AGENT,
      role: input.role ?? WorkerRole.WORKER,
      runtime: input.runtime ?? WorkerRuntime.OPENCODE,
      executorId: input.executorId ?? null,
      providerId: input.providerId?.trim() || null,
      modelId: input.modelId?.trim() || null,
      prompt: input.prompt?.trim() || null,
      skills: input.skills?.length ? input.skills : null,
      taskDefs: input.taskDefs?.length ? input.taskDefs : null,
      materials: input.materials?.trim() || null,
      enabled: input.enabled ?? true,
    });
    await this.assertConfig(worker);
    await this.resolveOwner(worker, input.ownerUserId ?? null);
    const saved = await this.workers.save(worker);
    return this.findOneView(saved.id);
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
    if (input.kind !== undefined) worker.kind = input.kind;
    if (input.role !== undefined) worker.role = input.role;
    if (input.runtime !== undefined) worker.runtime = input.runtime;
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
      worker.skills = input.skills?.length ? input.skills : null;
    }
    if (input.taskDefs !== undefined) {
      worker.taskDefs = input.taskDefs?.length ? input.taskDefs : null;
    }
    if (input.materials !== undefined) {
      worker.materials = input.materials?.trim() || null;
    }
    if (input.enabled !== undefined) worker.enabled = input.enabled;
    await this.assertConfig(worker);
    if (input.ownerUserId !== undefined) {
      await this.resolveOwner(worker, input.ownerUserId ?? null);
    }
    await this.workers.save(worker);
    return this.findOneView(id);
  }

  /** 删除机器人（已分配未完结任务时会拒绝） */
  async remove(id: number): Promise<void> {
    const worker = await this.findOne(id);
    const active = await this.tasks.count({
      where: { agentId: id, status: In(ACTIVE_STATUSES) },
    });
    if (active > 0) {
      throw new BadRequestException(
        `该机器人还有 ${active} 个未完结任务，先处理任务再删除`,
      );
    }
    // 任务包中的默认处理机器人随机器人删除解绑（无物理外键）
    await this.taskTemplates.update({ agentId: id }, { agentId: null });
    await this.workers.remove(worker);
  }

  /** 配置校验：按 runtime 区分（调度器 P1 固定走 PI） */
  private async assertConfig(worker: Worker): Promise<void> {
    if (worker.role === WorkerRole.SCHEDULER) {
      // 调度器跑平台进程内 PI，供应商/模型走 PI 侧
      worker.runtime = WorkerRuntime.PI;
    }
    if (worker.runtime === WorkerRuntime.OPENCODE) {
      if (!worker.executorId) {
        throw new BadRequestException('runtime=opencode 须选择执行器');
      }
      const executor = await this.executors.findOne({
        where: { id: worker.executorId },
      });
      if (!executor) {
        throw new BadRequestException('执行器不存在');
      }
    }
    if (!worker.modelId?.trim() || !worker.providerId?.trim()) {
      throw new BadRequestException('须选择供应商与模型');
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
