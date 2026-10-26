import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, IsNull, Repository } from 'typeorm';
import {
  DispatchPlanStatus,
  TaskStatus,
  TaskType,
  WorkerRole,
} from '../common/enums';
import { WorkerView, WorkersService } from '../workers/workers.service';
import { PiSchedulerService } from '../pi/pi-scheduler.service';
import { User } from '../auth/user.entity';
import { Worker } from '../workers/worker.entity';
import { DispatchPlan, DispatchPlanContent } from './dispatch-plan.entity';
import { Task, TaskMissingItem } from './task.entity';
import { TaskEvent } from './task-event.entity';
import { TaskDispatchService } from './task-dispatch.service';

export interface CreateTaskInput {
  title: string;
  type?: TaskType;
  description?: string | null;
  input?: string | null;
  outputSpec?: string | null;
  agentId?: number | null;
  schedulerId?: number | null;
  parentId?: number | null;
  createdById?: number | null;
}

export interface UpdateTaskInput {
  title?: string;
  type?: TaskType;
  description?: string | null;
  input?: string | null;
  outputSpec?: string | null;
  agentId?: number | null;
  result?: string | null;
  missingItems?: TaskMissingItem[] | null;
}

/** 概览统计（按状态计数） */
export interface TaskOverview {
  total: number;
  roots: number;
  statuses: Record<string, number>;
}

/** 非终态（可取消） */
const CANCELABLE = [
  TaskStatus.DRAFT,
  TaskStatus.MISSING_MATERIALS,
  TaskStatus.PENDING_SCHEDULE,
  TaskStatus.PENDING_CONFIRM,
  TaskStatus.DISPATCHED,
  TaskStatus.EXECUTING,
  TaskStatus.PENDING_ACCEPT,
  TaskStatus.INTERNAL_DONE,
];

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    @InjectRepository(Task)
    private readonly tasks: Repository<Task>,
    @InjectRepository(TaskEvent)
    private readonly events: Repository<TaskEvent>,
    @InjectRepository(DispatchPlan)
    private readonly plans: Repository<DispatchPlan>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(Worker)
    private readonly workers: Repository<Worker>,
    private readonly workersService: WorkersService,
    private readonly piScheduler: PiSchedulerService,
    private readonly dispatchService: TaskDispatchService,
  ) {}

  /**
   * 任务列表（默认只返回根任务；q 匹配编号/标题，status/type 精确筛选；
   * rootOnly=false 时返回全部）。每个根任务附 children 树。
   */
  async findAll(params: {
    q?: string;
    status?: TaskStatus;
    type?: TaskType;
    rootOnly?: boolean;
  }): Promise<Array<Task & { children?: Task[] }>> {
    const qb = this.tasks.createQueryBuilder('t');
    if (params.rootOnly !== false) {
      qb.where('t.parentId IS NULL');
    }
    if (params.status)
      qb.andWhere('t.status = :status', { status: params.status });
    if (params.type) qb.andWhere('t.type = :type', { type: params.type });
    const q = params.q?.trim().toLowerCase();
    if (q) {
      qb.andWhere(
        new Brackets((w) => {
          w.where('LOWER(t.code) LIKE :q').orWhere('LOWER(t.title) LIKE :q');
        }),
      ).setParameter('q', `%${q}%`);
    }
    const roots = await qb.orderBy('t.updatedAt', 'DESC').getMany();
    // 子任务树（一层即够：调度拆解为单层）
    if (roots.length > 0 && params.rootOnly !== false) {
      const children = await this.tasks.find({
        where: { parentId: In(roots.map((r) => r.id)) },
        order: { sortOrder: 'ASC', id: 'ASC' },
      });
      const byParent = new Map<number, Task[]>();
      for (const c of children) {
        const list = byParent.get(c.parentId!) ?? [];
        list.push(c);
        byParent.set(c.parentId!, list);
      }
      return roots.map((r) =>
        Object.assign(r, { children: byParent.get(r.id) ?? [] }),
      );
    }
    return roots;
  }

  /** 详情：任务 + 子任务 + 事件时间线（倒序，上限 100）+ 实时输出行 */
  async findOneDetail(id: number): Promise<
    Task & {
      children: Task[];
      events: TaskEvent[];
      liveLines: string[];
    }
  > {
    const task = await this.mustFind(id);
    const [children, taskEvents] = await Promise.all([
      this.tasks.find({
        where: { parentId: id },
        order: { sortOrder: 'ASC', id: 'ASC' },
      }),
      this.events.find({
        where: { taskId: id },
        order: { id: 'DESC' },
        take: 100,
      }),
    ]);
    return Object.assign(task, {
      children,
      events: taskEvents,
      liveLines: this.dispatchService.liveLines(id),
    });
  }

  /** 概览统计：全量按状态计数 + 根任务数 */
  async overview(): Promise<TaskOverview> {
    const rows = await this.tasks
      .createQueryBuilder('t')
      .select('t.status', 'status')
      .addSelect('COUNT(*)', 'n')
      .groupBy('t.status')
      .getRawMany<{ status: string; n: string }>();
    const statuses: Record<string, number> = {};
    let total = 0;
    for (const row of rows) {
      statuses[row.status] = Number(row.n);
      total += Number(row.n);
    }
    const roots = await this.tasks.count({ where: { parentId: IsNull() } });
    return { total, roots, statuses };
  }

  async create(input: CreateTaskInput): Promise<Task> {
    const title = input.title?.trim();
    if (!title) throw new BadRequestException('标题不能为空');
    if (input.agentId) await this.assertWorker(input.agentId);
    const task = await this.tasks.save(
      this.tasks.create({
        title,
        type: input.type ?? TaskType.OTHER,
        description: input.description?.trim() || null,
        input: input.input?.trim() || null,
        outputSpec: input.outputSpec?.trim() || null,
        agentId: input.agentId ?? null,
        schedulerId: input.schedulerId ?? null,
        parentId: input.parentId ?? null,
        createdById: input.createdById ?? null,
        status: TaskStatus.DRAFT,
      }),
    );
    // 编号按 id 生成；根任务 rootId 指向自身
    task.code = `TK-${String(task.id).padStart(4, '0')}`;
    task.rootId = input.parentId
      ? (await this.mustFind(input.parentId)).rootId
      : task.id;
    const saved = await this.tasks.save(task);
    await this.addEvent(
      saved.id,
      '操作',
      `创建任务「${saved.title}」`,
      await this.operatorName(input.createdById ?? null),
    );
    return saved;
  }

  async update(
    id: number,
    input: UpdateTaskInput,
    operator: string | null,
  ): Promise<Task> {
    const task = await this.mustFind(id);
    if (input.title !== undefined) {
      const title = input.title.trim();
      if (!title) throw new BadRequestException('标题不能为空');
      task.title = title;
    }
    if (input.type !== undefined) task.type = input.type;
    if (input.description !== undefined) {
      task.description = input.description?.trim() || null;
    }
    if (input.input !== undefined) task.input = input.input?.trim() || null;
    if (input.outputSpec !== undefined) {
      task.outputSpec = input.outputSpec?.trim() || null;
    }
    if (input.agentId !== undefined) {
      if (input.agentId) await this.assertWorker(input.agentId);
      task.agentId = input.agentId ?? null;
    }
    if (input.result !== undefined) task.result = input.result;
    if (input.missingItems !== undefined) {
      task.missingItems = input.missingItems?.length
        ? input.missingItems
        : null;
    }
    const saved = await this.tasks.save(task);
    await this.addEvent(id, '操作', `更新任务信息`, operator);
    return saved;
  }

  /** 删除根任务：级联删子任务、事件、方案（无物理外键，应用层处理） */
  async remove(id: number, operator: string | null): Promise<void> {
    const task = await this.mustFind(id);
    if (task.status === TaskStatus.EXECUTING) {
      throw new BadRequestException('任务执行中，先中断或等待完成再删除');
    }
    const children = await this.tasks.find({ where: { rootId: id } });
    const ids = children.map((c) => c.id);
    if (ids.length > 0) {
      await this.events.delete({ taskId: In(ids) });
      await this.plans.delete({ taskId: In(ids) });
      await this.tasks.delete({ id: In(ids) });
    }
    await this.events.delete({ taskId: id });
    await this.plans.delete({ taskId: id });
    await this.tasks.delete({ id });
    this.logger.log(
      `任务 ${task.code} 已删除（operator=${operator ?? 'system'}，级联 ${ids.length} 子任务）`,
    );
  }

  // ===== 状态流转动作 =====

  /** 提交调度：草稿/待补材料 → 待调度（材料齐备） */
  async submitForSchedule(id: number, operator: string | null): Promise<Task> {
    const task = await this.mustFind(id);
    if (
      ![TaskStatus.DRAFT, TaskStatus.MISSING_MATERIALS].includes(task.status)
    ) {
      throw new BadRequestException(
        `任务 ${task.code} 当前状态「${task.status}」不可提交调度`,
      );
    }
    const from = task.status;
    task.status = TaskStatus.PENDING_SCHEDULE;
    const saved = await this.tasks.save(task);
    await this.addEvent(id, '状态变更', `状态变更：${from} → 待调度`, operator);
    return saved;
  }

  /** 标记待补材料（调度器材料审查产出） */
  async markMissing(
    id: number,
    items: TaskMissingItem[],
    schedulerId: number | null,
  ): Promise<Task> {
    const task = await this.mustFind(id);
    if (task.status !== TaskStatus.PENDING_SCHEDULE) {
      throw new BadRequestException(
        `任务 ${task.code} 当前状态「${task.status}」不可标记缺失`,
      );
    }
    task.status = TaskStatus.MISSING_MATERIALS;
    task.missingItems = items;
    const saved = await this.tasks.save(task);
    await this.addEvent(
      id,
      '状态变更',
      `状态变更：待调度 → 待补材料（缺失 ${items.length} 项：${items.map((i) => i.item).join('、')}）`,
      null,
      { schedulerId },
    );
    return saved;
  }

  /** 待补材料 → 待调度（补齐后清除缺失清单） */
  async resolveMissing(id: number, operator: string | null): Promise<Task> {
    const task = await this.mustFind(id);
    if (task.status !== TaskStatus.MISSING_MATERIALS) {
      throw new BadRequestException(`任务 ${task.code} 当前不在待补材料状态`);
    }
    task.status = TaskStatus.PENDING_SCHEDULE;
    task.missingItems = null;
    const saved = await this.tasks.save(task);
    await this.addEvent(
      id,
      '状态变更',
      '状态变更：待补材料 → 待调度（材料已补齐）',
      operator,
    );
    return saved;
  }

  /** 保存调度方案并转「待确认」（PI 调度产出；schedule 动作由 PiSchedulerService 调用） */
  async savePlan(
    taskId: number,
    content: DispatchPlanContent,
    schedulerId: number | null,
  ): Promise<DispatchPlan> {
    const task = await this.mustFind(taskId);
    if (task.status !== TaskStatus.PENDING_SCHEDULE) {
      throw new BadRequestException(
        `任务 ${task.code} 当前状态「${task.status}」不可生成调度方案`,
      );
    }
    const plan = await this.plans.save(
      this.plans.create({
        taskId,
        schedulerId,
        plan: content,
        status: DispatchPlanStatus.PENDING,
      }),
    );
    if (task.schedulerId !== schedulerId) {
      task.schedulerId = schedulerId;
      await this.tasks.save(task);
    }
    const summary = content.missingItems?.length
      ? `材料缺失 ${content.missingItems.length} 项`
      : `拆解 ${content.subtasks?.length ?? 0} 个子任务`;
    await this.addEvent(
      taskId,
      '系统',
      `调度方案已生成（${summary}），待确认`,
      null,
      {
        planId: plan.id,
      },
    );
    return plan;
  }

  /** 管理员确认方案：物化子任务并逐个派发 */
  async confirmPlan(planId: number, operator: string | null): Promise<Task> {
    const plan = await this.plans.findOne({ where: { id: planId } });
    if (!plan) throw new NotFoundException(`DispatchPlan ${planId} not found`);
    if (plan.status !== DispatchPlanStatus.PENDING) {
      throw new BadRequestException('该方案已被处理');
    }
    const task = await this.mustFind(plan.taskId);
    if (task.status !== TaskStatus.PENDING_CONFIRM) {
      throw new BadRequestException(
        `任务 ${task.code} 当前状态「${task.status}」不可确认方案`,
      );
    }
    plan.status = DispatchPlanStatus.CONFIRMED;
    plan.operator = operator;
    plan.operatedAt = new Date();
    await this.plans.save(plan);

    const subtasks = plan.plan.subtasks ?? [];
    await this.addEvent(
      task.id,
      '操作',
      `确认调度方案（${subtasks.length} 个子任务）`,
      operator,
      {
        planId: plan.id,
      },
    );

    // 单任务方案：直接分配根任务并派发
    if (subtasks.length <= 1) {
      const sub = subtasks[0];
      if (sub?.agentId) {
        task.agentId = sub.agentId;
      }
      // dispatch 接受待调度/执行中；调度器已完成分配，置待调度后直接派发
      task.status = TaskStatus.PENDING_SCHEDULE;
      await this.tasks.save(task);
      await this.addEvent(
        task.id,
        '状态变更',
        '状态变更：待确认 → 待调度（方案确认，准备派发）',
        operator,
      );
      return this.dispatchService.dispatch(task.id, operator);
    }

    // 多任务方案：物化子任务并逐个自动派发（派发失败停留在待调度，人工兜底）
    task.status = TaskStatus.DISPATCHED;
    await this.tasks.save(task);
    await this.addEvent(
      task.id,
      '状态变更',
      '状态变更：待确认 → 已派发',
      operator,
    );
    for (let i = 0; i < subtasks.length; i++) {
      const sub = subtasks[i];
      const type = (Object.values(TaskType) as string[]).includes(sub.type)
        ? (sub.type as TaskType)
        : TaskType.OTHER;
      const child = await this.create({
        title: sub.title,
        type,
        input: sub.input ?? null,
        outputSpec: sub.outputSpec ?? null,
        agentId: sub.agentId ?? null,
        parentId: task.id,
        createdById: null,
      });
      await this.addEvent(
        child.id,
        '系统',
        `由调度方案物化（方案 #${plan.id}）`,
        null,
      );
      if (!child.agentId) continue;
      // 物化后直接进入待调度再派发（调度器已完成分配，无需再次调度）
      child.status = TaskStatus.PENDING_SCHEDULE;
      await this.tasks.save(child);
      try {
        await this.dispatchService.dispatch(child.id, operator);
      } catch (e) {
        this.logger.warn(
          `子任务 ${child.code} 自动派发失败: ${(e as Error).message}`,
        );
        await this.addEvent(
          child.id,
          '系统',
          `自动派发失败：${(e as Error).message}（可人工重派）`,
          null,
        );
      }
    }
    return this.mustFind(task.id);
  }

  /** 驳回方案：打回待调度（可调整材料/分配后重新调度） */
  async rejectPlan(
    planId: number,
    reason: string,
    operator: string | null,
  ): Promise<Task> {
    const plan = await this.plans.findOne({ where: { id: planId } });
    if (!plan) throw new NotFoundException(`DispatchPlan ${planId} not found`);
    if (plan.status !== DispatchPlanStatus.PENDING) {
      throw new BadRequestException('该方案已被处理');
    }
    const task = await this.mustFind(plan.taskId);
    if (task.status !== TaskStatus.PENDING_CONFIRM) {
      throw new BadRequestException(
        `任务 ${task.code} 当前状态「${task.status}」不可驳回方案`,
      );
    }
    plan.status = DispatchPlanStatus.REJECTED;
    plan.operator = operator;
    plan.operatedAt = new Date();
    await this.plans.save(plan);
    task.status = TaskStatus.PENDING_SCHEDULE;
    await this.tasks.save(task);
    await this.addEvent(
      task.id,
      '操作',
      `驳回调度方案${reason ? `：${reason}` : ''}`,
      operator,
      {
        planId: plan.id,
      },
    );
    return this.mustFind(task.id);
  }

  /** 待确认方案的读取（任务详情页用） */
  async pendingPlan(taskId: number): Promise<DispatchPlan | null> {
    return (
      (await this.plans.findOne({
        where: { taskId, status: DispatchPlanStatus.PENDING },
        order: { id: 'DESC' },
      })) ?? null
    );
  }

  /** 验收：待验收 → 内部完成（责任人验收通过） */
  async accept(id: number, operator: string | null): Promise<Task> {
    const task = await this.mustFind(id);
    if (task.status !== TaskStatus.PENDING_ACCEPT) {
      throw new BadRequestException(
        `任务 ${task.code} 当前状态「${task.status}」不可验收`,
      );
    }
    task.status = TaskStatus.INTERNAL_DONE;
    task.acceptedAt = new Date();
    task.acceptedBy = operator;
    const saved = await this.tasks.save(task);
    await this.addEvent(
      id,
      '状态变更',
      '状态变更：待验收 → 内部完成',
      operator,
    );
    await this.maybeAdvanceParent(saved);
    return saved;
  }

  /** 交付：内部完成 → 已交付（可附最终产出） */
  async deliver(
    id: number,
    operator: string | null,
    result?: string,
  ): Promise<Task> {
    const task = await this.mustFind(id);
    if (task.status !== TaskStatus.INTERNAL_DONE) {
      throw new BadRequestException(
        `任务 ${task.code} 当前状态「${task.status}」不可交付`,
      );
    }
    task.status = TaskStatus.DELIVERED;
    task.deliveredAt = new Date();
    if (result !== undefined && result !== null && result.trim()) {
      task.result = result.trim();
    }
    const saved = await this.tasks.save(task);
    await this.addEvent(
      id,
      '状态变更',
      '状态变更：内部完成 → 已交付',
      operator,
    );
    await this.maybeAdvanceParent(saved);
    return saved;
  }

  /** 归档：已交付 → 维护中（终态） */
  async archive(id: number, operator: string | null): Promise<Task> {
    const task = await this.mustFind(id);
    if (task.status !== TaskStatus.DELIVERED) {
      throw new BadRequestException(
        `任务 ${task.code} 当前状态「${task.status}」不可归档`,
      );
    }
    task.status = TaskStatus.ARCHIVED;
    task.archivedAt = new Date();
    const saved = await this.tasks.save(task);
    await this.addEvent(
      id,
      '状态变更',
      '状态变更：已交付 → 维护中（终态）',
      operator,
    );
    await this.maybeAdvanceParent(saved);
    return saved;
  }

  /** 取消：非终态均可取消（执行中先中断会话） */
  async cancel(id: number, operator: string | null): Promise<Task> {
    const task = await this.mustFind(id);
    if (!CANCELABLE.includes(task.status)) {
      throw new BadRequestException(
        `任务 ${task.code} 当前状态「${task.status}」不可取消`,
      );
    }
    if (task.status === TaskStatus.EXECUTING) {
      await this.dispatchService.interrupt(id, operator).catch(() => undefined);
    }
    const from = task.status;
    task.status = TaskStatus.CANCELED;
    task.canceledAt = new Date();
    const saved = await this.tasks.save(task);
    await this.addEvent(id, '状态变更', `状态变更：${from} → 已取消`, operator);
    await this.maybeAdvanceParent(saved);
    return saved;
  }

  /**
   * AI 调度：待调度任务 → PI 调度器（识别/材料审查/拆解/分配）。
   * 有缺失 → 「待补材料」；否则方案落库 → 「待确认」（等管理员确认派发）。
   */
  async schedule(taskId: number, operator: string | null): Promise<Task> {
    const task = await this.mustFind(taskId);
    if (task.status !== TaskStatus.PENDING_SCHEDULE) {
      throw new BadRequestException(
        `任务 ${task.code} 当前状态「${task.status}」不可调度`,
      );
    }
    // 调度器：任务指定的优先，否则取唯一启用的调度器
    let scheduler: WorkerView | null = null;
    if (task.schedulerId) {
      scheduler = await this.workersService.findOneView(task.schedulerId);
    } else {
      const schedulers = await this.workersService.findAll({
        role: WorkerRole.SCHEDULER,
      });
      scheduler = schedulers.find((s) => s.enabled) ?? null;
    }
    if (!scheduler || !scheduler.enabled) {
      throw new BadRequestException('没有可用的调度器，请先在「调度器」页配置');
    }
    const roster = (
      await this.workersService.findAll({ role: WorkerRole.WORKER })
    ).filter((w) => w.enabled);
    if (roster.length === 0) {
      throw new BadRequestException('没有可用的机器人，请先在「机器人」页配置');
    }

    await this.addEvent(
      taskId,
      '系统',
      `开始 AI 调度（调度器：${scheduler.name}，候选机器人 ${roster.length} 个）`,
      operator,
    );
    const content = await this.piScheduler.schedule(task, scheduler, roster);

    if (content.missingItems?.length) {
      const saved = await this.markMissing(
        taskId,
        content.missingItems,
        scheduler.id,
      );
      return saved;
    }
    await this.savePlan(taskId, content, scheduler.id);
    task.status = TaskStatus.PENDING_CONFIRM;
    const saved = await this.tasks.save(task);
    await this.addEvent(
      taskId,
      '状态变更',
      '状态变更：待调度 → 待确认（AI 调度方案已产出）',
      null,
    );
    return saved;
  }

  /** 操作人姓名（登录用户 id → 姓名；可空） */
  private async operatorName(userId: number | null): Promise<string | null> {
    if (!userId) return null;
    const user = await this.users.findOne({
      where: { id: userId },
      select: { name: true },
    });
    return user?.name ?? null;
  }

  /**
   * 工作流聚合流转：子任务全部收尾（内部完成/已交付/维护中/已取消）后，
   * 父任务（已派发）自动进入「待验收」，由责任人验收整体工作流。
   */
  private async maybeAdvanceParent(child: Task): Promise<void> {
    if (!child.parentId) return;
    const parent = await this.tasks.findOne({ where: { id: child.parentId } });
    if (!parent || parent.status !== TaskStatus.DISPATCHED) return;
    const siblings = await this.tasks.find({
      where: { parentId: parent.id },
      select: { id: true, status: true },
    });
    const done = new Set<string>([
      TaskStatus.INTERNAL_DONE,
      TaskStatus.DELIVERED,
      TaskStatus.ARCHIVED,
      TaskStatus.CANCELED,
    ]);
    if (siblings.some((s) => !done.has(s.status))) return;
    parent.status = TaskStatus.PENDING_ACCEPT;
    await this.tasks.save(parent);
    await this.addEvent(
      parent.id,
      '状态变更',
      '状态变更：已派发 → 待验收（子任务全部完成，待整体验收）',
      null,
    );
  }

  private async assertWorker(agentId: number): Promise<void> {
    const worker = await this.workers.findOne({ where: { id: agentId } });
    if (!worker) throw new BadRequestException('机器人不存在');
    if (!worker.enabled) throw new BadRequestException('机器人已停用');
    if (worker.role === WorkerRole.SCHEDULER) {
      throw new BadRequestException('调度器不承接任务，请分配给工作者');
    }
  }

  async addEvent(
    taskId: number,
    type: string,
    content: string,
    operator: string | null,
    meta?: Record<string, unknown>,
  ): Promise<void> {
    return this.dispatchService.addEvent(taskId, type, content, operator, meta);
  }

  async mustFind(id: number): Promise<Task> {
    const task = await this.tasks.findOne({ where: { id } });
    if (!task) throw new NotFoundException(`Task ${id} not found`);
    return task;
  }
}
