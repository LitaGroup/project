import {
  BadRequestException,
  Injectable,
  Logger,
  MessageEvent,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Observable } from 'rxjs';
import { Brackets, In, IsNull, Repository } from 'typeorm';
import {
  TaskStatus,
  TaskSubStatus,
  TaskType,
  WorkerRole,
} from '../common/enums';
import { WorkerView, WorkersService } from '../workers/workers.service';
import { User } from '../auth/user.entity';
import { Worker } from '../workers/worker.entity';
import { Task, TaskMissingItem } from './task.entity';
import { TaskEvent } from './task-event.entity';
import { TaskDispatchService } from './task-dispatch.service';
import {
  TaskRealtimeEvent,
  TaskRealtimeService,
} from './task-realtime.service';

export interface CreateTaskInput {
  /** 标题（可空：按任务描述首行推导，调度机器人识别后会覆盖） */
  title?: string;
  type?: TaskType;
  description?: string | null;
  input?: string | null;
  outputSpec?: string | null;
  agentId?: number | null;
  schedulerId?: number | null;
  parentId?: number | null;
  createdById?: number | null;
  /** 兼容旧客户端字段：新流程创建后始终进入「等待中-待识别」 */
  submitForScheduling?: boolean;
}

/** 无标题新建时，从任务描述首个有效行推导临时标题（去掉常见 Markdown 标记，最长 200 字） */
function deriveTaskTitle(description: string): string {
  for (const raw of description.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^[-*_=]{3,}$/.test(line)) continue;
    const plain = line
      .replace(/^#{1,6}\s*/, '')
      .replace(/^>\s*/, '')
      .replace(/^[-*+]\s+/, '')
      .replace(/^\d+[.)]\s+/, '')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[*_`~]/g, '')
      .trim();
    if (plain && !/^[-*_=]+$/.test(plain)) return plain.slice(0, 200);
  }
  return '';
}

export interface UpdateTaskInput {
  title?: string;
  type?: TaskType;
  description?: string | null;
  input?: string | null;
  outputSpec?: string | null;
  workPlan?: string | null;
  agentId?: number | null;
  result?: string | null;
  missingItems?: TaskMissingItem[] | null;
}

/** 概览统计（按主状态与子状态计数） */
export interface TaskOverview {
  total: number;
  roots: number;
  statuses: Record<string, number>;
  subStatuses: Record<string, number>;
}

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    @InjectRepository(Task)
    private readonly tasks: Repository<Task>,
    @InjectRepository(TaskEvent)
    private readonly events: Repository<TaskEvent>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(Worker)
    private readonly workers: Repository<Worker>,
    private readonly workersService: WorkersService,
    private readonly dispatchService: TaskDispatchService,
    private readonly taskRealtime: TaskRealtimeService,
  ) {}

  /**
   * 任务列表（默认只返回根任务；q 匹配编号/标题，status/subStatus/type 精确筛选；
   * rootOnly=false 时返回全部）。每个根任务附 children 树。
   */
  async findAll(params: {
    q?: string;
    status?: TaskStatus;
    subStatus?: TaskSubStatus;
    type?: TaskType;
    rootOnly?: boolean;
  }): Promise<Array<Task & { children?: Task[] }>> {
    const qb = this.tasks.createQueryBuilder('t');
    if (params.rootOnly !== false) {
      qb.where('t.parentId IS NULL');
    }
    if (params.status)
      qb.andWhere('t.status = :status', { status: params.status });
    if (params.subStatus)
      qb.andWhere('t.subStatus = :subStatus', {
        subStatus: params.subStatus,
      });
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
      return roots.map((r) => {
        const children = byParent.get(r.id) ?? [];
        for (const child of children) {
          Object.assign(child, { liveLines: this.recentLiveLines(child.id) });
        }
        return Object.assign(r, {
          children,
          liveLines: this.recentLiveLines(r.id),
        });
      });
    }
    // 平铺列表（看板用）：附带执行中任务的实时输出，避免前端逐个拉详情
    return roots.map((r) =>
      Object.assign(r, { liveLines: this.recentLiveLines(r.id) }),
    );
  }

  /** 单个任务列表快照（SSE 任务变更推送用，不含详情事件时间线） */
  async findOneForList(
    id: number,
  ): Promise<(Task & { liveLines: string[] }) | null> {
    const task = await this.tasks.findOne({ where: { id } });
    if (!task) return null;
    return Object.assign(task, { liveLines: this.recentLiveLines(id) });
  }

  /** 列表快照只保留最近 60 行输出，完整输出仍走详情/任务级 SSE */
  private recentLiveLines(id: number): string[] {
    const lines = this.dispatchService.liveLines(id);
    return lines.length > 60 ? lines.slice(-60) : lines;
  }

  /**
   * 任务看板 SSE：连接后先推全量快照，随后按事件推任务快照、实时输出增量与删除。
   * 断线重连会重新收到快照，因此不依赖前端定时补偿。
   */
  streamBoard(): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      let closed = false;
      let ready = false;
      let draining = false;
      const queue: TaskRealtimeEvent[] = [];

      const send = (data: Record<string, unknown>): void => {
        if (!closed) subscriber.next({ data });
      };

      const handle = async (event: TaskRealtimeEvent): Promise<void> => {
        try {
          if (event.type === 'line') {
            send({
              type: 'task.line',
              taskId: event.taskId,
              line: event.line,
              at: Date.now(),
            });
            return;
          }
          if (event.type === 'deleted') {
            send({
              type: 'task.delete',
              ids: [...new Set(event.ids)],
              at: Date.now(),
            });
            return;
          }
          const task = await this.findOneForList(event.taskId);
          if (task) {
            send({ type: 'task.upsert', task, at: Date.now() });
          } else {
            send({
              type: 'task.delete',
              ids: [event.taskId],
              at: Date.now(),
            });
          }
        } catch (e) {
          this.logger.warn(
            `任务看板 SSE 推送失败（taskId=${'taskId' in event ? event.taskId : event.ids.join(',')}）: ${(e as Error).message}`,
          );
        }
      };

      const drain = async (): Promise<void> => {
        if (draining || !ready) return;
        draining = true;
        try {
          while (queue.length > 0 && !closed) {
            const event = queue.shift();
            if (event) await handle(event);
          }
        } finally {
          draining = false;
        }
      };

      const enqueue = (event: TaskRealtimeEvent): void => {
        if (closed) return;
        queue.push(event);
        if (ready) void drain();
      };

      const eventsSub = this.taskRealtime.events$.subscribe({
        next: enqueue,
        error: (e: Error) => {
          if (!closed) subscriber.error(e);
        },
      });
      const heartbeat = setInterval(() => {
        send({ type: 'ping', at: Date.now() });
      }, 20_000);

      void (async () => {
        try {
          const tasks = await this.findAll({ rootOnly: false });
          if (closed) return;
          send({ type: 'snapshot', tasks, at: Date.now() });
          ready = true;
          void drain();
        } catch (e) {
          if (!closed) subscriber.error(e);
        }
      })();

      return () => {
        closed = true;
        clearInterval(heartbeat);
        eventsSub.unsubscribe();
        queue.length = 0;
      };
    });
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

  /** 概览统计：按主状态与子状态计数 + 根任务数 */
  async overview(): Promise<TaskOverview> {
    const [rows, subRows] = await Promise.all([
      this.tasks
        .createQueryBuilder('t')
        .select('t.status', 'status')
        .addSelect('COUNT(*)', 'n')
        .groupBy('t.status')
        .getRawMany<{ status: string; n: string }>(),
      this.tasks
        .createQueryBuilder('t')
        .select('t.subStatus', 'subStatus')
        .addSelect('COUNT(*)', 'n')
        .groupBy('t.subStatus')
        .getRawMany<{ subStatus: string; n: string }>(),
    ]);
    const statuses: Record<string, number> = {};
    let total = 0;
    for (const row of rows) {
      statuses[row.status] = Number(row.n);
      total += Number(row.n);
    }
    const subStatuses: Record<string, number> = {};
    for (const row of subRows) {
      subStatuses[row.subStatus] = Number(row.n);
    }
    const roots = await this.tasks.count({ where: { parentId: IsNull() } });
    return { total, roots, statuses, subStatuses };
  }

  async create(input: CreateTaskInput): Promise<Task> {
    const description = input.description?.trim() || null;
    // 未填标题时取描述首行作为临时标题；调度机器人识别成功后会覆盖
    const title =
      input.title?.trim() ||
      (description ? deriveTaskTitle(description) : '') ||
      (description ? '新任务' : '');
    if (!title) throw new BadRequestException('标题或任务描述不能为空');
    if (input.agentId) await this.assertWorker(input.agentId);
    const task = await this.tasks.save(
      this.tasks.create({
        title,
        type: input.type ?? TaskType.OTHER,
        description,
        input: input.input?.trim() || null,
        outputSpec: input.outputSpec?.trim() || null,
        agentId: input.agentId ?? null,
        schedulerId: input.schedulerId ?? null,
        parentId: input.parentId ?? null,
        createdById: input.createdById ?? null,
        status: TaskStatus.WAITING,
        subStatus: TaskSubStatus.PENDING_IDENTIFY,
      }),
    );
    // 编号按 id 生成；根任务 rootId 指向自身
    task.code = `TK-${String(task.id).padStart(4, '0')}`;
    task.rootId = input.parentId
      ? (await this.mustFind(input.parentId)).rootId
      : task.id;
    const operator = await this.operatorName(input.createdById ?? null);
    const saved = await this.tasks.save(task);
    await this.addEvent(
      saved.id,
      '操作',
      `创建任务「${saved.title}」，进入等待中-待识别`,
      operator,
      {
        title: saved.title,
        description: saved.description,
      },
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
    if (input.workPlan !== undefined) {
      task.workPlan = input.workPlan?.trim() || null;
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
    await this.addEvent(id, '操作', '更新任务信息', operator);
    return saved;
  }

  /** 删除根任务：级联删子任务、事件、方案（无物理外键，应用层处理） */
  async remove(id: number, operator: string | null): Promise<void> {
    const task = await this.mustFind(id);
    if (task.status === TaskStatus.RUNNING) {
      throw new BadRequestException('任务进行中，先中断/取消或等待完成再删除');
    }
    const children = await this.tasks.find({ where: { rootId: id } });
    const ids = children.map((c) => c.id);
    if (ids.length > 0) {
      await this.events.delete({ taskId: In(ids) });
      await this.tasks.delete({ id: In(ids) });
    }
    await this.events.delete({ taskId: id });
    await this.tasks.delete({ id });
    this.logger.log(
      `任务 ${task.code} 已删除（operator=${operator ?? 'system'}，级联 ${ids.length} 子任务）`,
    );
    this.taskRealtime.tasksDeleted([...new Set([id, ...ids])]);
  }

  // ===== 等待中状态的人工动作 =====

  /** 重新识别：等待中-待反馈 → 等待中-待识别（LOOP 下一轮自动处理） */
  async requeueForIdentify(id: number, operator: string | null): Promise<Task> {
    const task = await this.mustFind(id);
    if (
      task.status !== TaskStatus.WAITING ||
      task.subStatus !== TaskSubStatus.PENDING_FEEDBACK
    ) {
      throw new BadRequestException(
        `任务 ${task.code} 当前状态「${task.status}-${task.subStatus}」不可重新识别`,
      );
    }
    task.subStatus = TaskSubStatus.PENDING_IDENTIFY;
    task.missingItems = null;
    task.remindCount = 0;
    task.lastRemindedAt = null;
    const saved = await this.tasks.save(task);
    await this.addEvent(
      id,
      '操作',
      '状态变更：等待中-待反馈 → 等待中-待识别（重新识别）',
      operator,
    );
    return saved;
  }

  /**
   * 提交用户反馈并重新识别：反馈正文追加到任务描述（下次识别的输入），
   * 清空待反馈清单并回到待识别。
   */
  async provideFeedback(
    id: number,
    content: string | null,
    operator: string | null,
  ): Promise<Task> {
    const task = await this.mustFind(id);
    if (
      task.status !== TaskStatus.WAITING ||
      task.subStatus !== TaskSubStatus.PENDING_FEEDBACK
    ) {
      throw new BadRequestException(
        `任务 ${task.code} 当前状态「${task.status}-${task.subStatus}」不可提交反馈`,
      );
    }
    const text = content?.trim();
    if (text) {
      task.description = [task.description?.trim(), text]
        .filter(Boolean)
        .join('\n\n');
    }
    task.subStatus = TaskSubStatus.PENDING_IDENTIFY;
    task.missingItems = null;
    task.remindCount = 0;
    task.lastRemindedAt = null;
    const saved = await this.tasks.save(task);
    if (text) {
      await this.addEvent(id, '反馈', text, operator, { feedback: text });
    }
    await this.addEvent(
      id,
      '操作',
      text ? '提交反馈并重新识别' : '重新提交识别',
      operator,
    );
    return saved;
  }

  /** 人工标记待反馈（调度机器人自动识别失败时由 LOOP 内部调用，也可人工补充） */
  async markMissing(
    id: number,
    items: TaskMissingItem[],
    schedulerId: number | null,
  ): Promise<Task> {
    const task = await this.mustFind(id);
    if (task.status !== TaskStatus.WAITING) {
      throw new BadRequestException(
        `任务 ${task.code} 当前状态「${task.status}-${task.subStatus}」不可标记待反馈`,
      );
    }
    task.subStatus = TaskSubStatus.PENDING_FEEDBACK;
    task.missingItems = items;
    task.remindCount = 0;
    task.lastRemindedAt = null;
    if (schedulerId) task.schedulerId = schedulerId;
    const saved = await this.tasks.save(task);
    await this.addEvent(
      id,
      '状态变更',
      `状态变更：等待中-待识别 → 等待中-待反馈（需反馈 ${items.length} 项：${items.map((i) => i.item).join('、')}）`,
      null,
      { schedulerId },
    );
    return saved;
  }

  /** 验收：等待中-待验收 → 已结束-完成 */
  async accept(id: number, operator: string | null): Promise<Task> {
    const task = await this.mustFind(id);
    if (
      task.status !== TaskStatus.WAITING ||
      task.subStatus !== TaskSubStatus.PENDING_ACCEPT
    ) {
      throw new BadRequestException(
        `任务 ${task.code} 当前状态「${task.status}-${task.subStatus}」不可验收`,
      );
    }
    const now = new Date();
    task.status = TaskStatus.FINISHED;
    task.subStatus = TaskSubStatus.COMPLETED;
    task.acceptedAt = now;
    task.acceptedBy = operator;
    task.deliveredAt = now;
    const saved = await this.tasks.save(task);
    await this.addEvent(
      id,
      '状态变更',
      '状态变更：等待中-待验收 → 已结束-完成',
      operator,
    );
    return saved;
  }

  /** 取消：任意未结束任务可取消（执行中先中断会话） */
  async cancel(id: number, operator: string | null): Promise<Task> {
    const task = await this.mustFind(id);
    if (task.status === TaskStatus.FINISHED) {
      throw new BadRequestException(
        `任务 ${task.code} 当前状态「${task.status}-${task.subStatus}」不可取消`,
      );
    }
    if (
      task.status === TaskStatus.RUNNING &&
      task.subStatus === TaskSubStatus.EXECUTING
    ) {
      await this.dispatchService.interrupt(id, operator).catch(() => undefined);
    }
    const from = `${task.status}-${task.subStatus}`;
    task.status = TaskStatus.FINISHED;
    task.subStatus = TaskSubStatus.CANCELED;
    task.canceledAt = new Date();
    const saved = await this.tasks.save(task);
    await this.addEvent(
      id,
      '状态变更',
      `状态变更：${from} → 已结束-取消`,
      operator,
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

  private async assertWorker(agentId: number): Promise<void> {
    const worker = await this.workers.findOne({ where: { id: agentId } });
    if (!worker) throw new BadRequestException('机器人不存在');
    if (!worker.enabled) throw new BadRequestException('机器人已停用');
    if (worker.role === WorkerRole.SCHEDULER) {
      throw new BadRequestException('调度机器人不承接任务，请分配给工作者');
    }
  }

  /** 系统调度机器人候选（LOOP 使用；指定优先，否则取第一个启用的调度机器人） */
  async findScheduler(candidateId: number | null): Promise<WorkerView | null> {
    if (candidateId) {
      try {
        const scheduler = await this.workersService.findOneView(candidateId);
        if (scheduler?.enabled) return scheduler;
      } catch {
        // 指定调度机器人已被删除：回退到第一个启用的调度机器人
      }
    }
    const schedulers = await this.workersService.findAll({
      role: WorkerRole.SCHEDULER,
    });
    return schedulers.find((s) => s.enabled) ?? null;
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
