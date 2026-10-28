import {
  BadRequestException,
  Injectable,
  Logger,
  MessageEvent,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { Observable } from 'rxjs';
import { Brackets, In, IsNull, Repository } from 'typeorm';
import { TaskStatus, TaskSubStatus, WorkerRole } from '../common/enums';
import { beijingTime, mdFrontmatter } from '../common/frontmatter';
import { TaskTypesService } from '../task-types/task-types.service';
import { TASK_TYPE_DEFAULT } from '../task-types/task-type.entity';
import { WorkerView, WorkersService } from '../workers/workers.service';
import { User } from '../auth/user.entity';
import { Worker } from '../workers/worker.entity';
import { Task, TaskMissingItem } from './task.entity';
import { TaskEvent } from './task-event.entity';
import { TaskMessage } from './task-message.entity';
import { TaskTemplate } from './task-template.entity';
import { TaskDispatchService } from './task-dispatch.service';
import { TaskWorkerInboxService } from './task-worker-inbox.service';
import {
  TaskRealtimeEvent,
  TaskRealtimeService,
} from './task-realtime.service';

export interface CreateTaskInput {
  /** 标题（可空：按任务描述首行推导） */
  title?: string;
  /** 任务类型（task_types.name；须为已配置类型，缺省为「其它」） */
  type?: string;
  description?: string | null;
  input?: string | null;
  outputSpec?: string | null;
  agentId?: number | null;
  schedulerId?: number | null;
  parentId?: number | null;
  createdById?: number | null;
  /** 需求方；缺省时人类创建任务为 createdById，机器人子任务为父任务机器人 */
  requesterType?: 'user' | 'worker' | null;
  requesterId?: number | null;
  /** 操作人快照（机器人创建子任务时使用） */
  operatorName?: string;
  /** 任务定义（task_templates.id，可空） */
  templateId?: number | null;
  /** 兼容旧客户端字段：新流程创建后始终进入「等待中-待分配」 */
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
  /** 任务类型（task_types.name；须为已配置类型，不可为空） */
  type?: string;
  description?: string | null;
  input?: string | null;
  outputSpec?: string | null;
  workPlan?: string | null;
  agentId?: number | null;
  result?: string | null;
  missingItems?: TaskMissingItem[] | null;
}

/** 任务识别更新入参（AI 技能 task-recognize-update；只保存，不改状态、不派发） */
export interface RecognizeTaskInput {
  /** 任务标题（必填） */
  title: string;
  /** 用户的原始需求；不传保留原值，传空值/null 清除 */
  input?: string | null;
  /** 需求内容（必填，Agent AI 分析整理后的需求，含需求澄清与补充的详细信息） */
  content: string;
  /** 交付方式（必填，即任务输出要求 outputSpec） */
  outputSpec: string;
  /** 工作计划（必填，Markdown） */
  workPlan: string;
  /** 执行机器人；不传保留原分配，传 null 清除，传 ID 时须为启用中的工作者 */
  agentId?: number | null;
}

/** 概览统计（按主状态与子状态计数） */
export interface TaskOverview {
  total: number;
  roots: number;
  statuses: Record<string, number>;
  subStatuses: Record<string, number>;
}

/** Markdown 正文段：空值用占位符，避免 AI 误读为缺失字段 */
function markdownText(value: string | null | undefined): string {
  return value?.trim() || '（暂无）';
}

/** Markdown 表格单元格转义（换行折叠为空格、竖线转义） */
function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
}

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    @InjectRepository(Task)
    private readonly tasks: Repository<Task>,
    @InjectRepository(TaskEvent)
    private readonly events: Repository<TaskEvent>,
    @InjectRepository(TaskMessage)
    private readonly taskMessages: Repository<TaskMessage>,
    @InjectRepository(TaskTemplate)
    private readonly taskTemplates: Repository<TaskTemplate>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(Worker)
    private readonly workers: Repository<Worker>,
    private readonly workersService: WorkersService,
    private readonly taskTypes: TaskTypesService,
    private readonly dispatchService: TaskDispatchService,
    private readonly workerInbox: TaskWorkerInboxService,
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
    type?: string;
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
    // 未填标题时取描述首行作为临时标题；直接识别分配不会改写标题
    const title =
      input.title?.trim() ||
      (description ? deriveTaskTitle(description) : '') ||
      (description ? '新任务' : '');
    if (!title) throw new BadRequestException('标题或任务描述不能为空');
    if (input.agentId) await this.assertWorker(input.agentId);
    const template = input.templateId
      ? await this.taskTemplates.findOne({ where: { id: input.templateId } })
      : null;
    if (input.templateId && !template) {
      throw new BadRequestException('任务定义不存在');
    }
    const typeName = input.type
      ? await this.taskTypes.assertExists(input.type)
      : template
        ? await this.taskTypes.assertExists(template.type)
        : null;
    // 父任务先校验，避免插入后才因父任务不存在留下孤儿记录
    const parent = input.parentId ? await this.mustFind(input.parentId) : null;
    const requesterType =
      input.requesterType ??
      (input.createdById ? 'user' : parent?.agentId ? 'worker' : null);
    const requesterId =
      input.requesterId ??
      (requesterType === 'user'
        ? (input.createdById ?? null)
        : requesterType === 'worker'
          ? (parent?.agentId ?? null)
          : null);
    if (!requesterType || requesterId === null) {
      throw new BadRequestException('任务需求方不能为空');
    }
    // code 按自增 id 生成、根任务 rootId 指向自身，都必须插入后才知道；
    // 但两列 NOT NULL 且无默认值，先用唯一临时值占位，拿到 id 后再回填正式值。
    const task = await this.tasks.save(
      this.tasks.create({
        code: `TMP-${randomBytes(8).toString('hex')}`,
        rootId: parent ? parent.rootId : 0,
        title,
        type: typeName ?? TASK_TYPE_DEFAULT,
        templateId: template?.id ?? null,
        templateName: template?.name ?? null,
        description,
        input: input.input?.trim() || null,
        outputSpec: input.outputSpec?.trim() || null,
        agentId: input.agentId ?? null,
        schedulerId: input.schedulerId ?? null,
        parentId: input.parentId ?? null,
        createdById: input.createdById ?? null,
        requesterType,
        requesterId,
        status: TaskStatus.WAITING,
        subStatus: TaskSubStatus.PENDING_ASSIGNMENT,
      }),
    );
    task.code = `TK-${String(task.id).padStart(4, '0')}`;
    task.rootId = parent ? parent.rootId : task.id;
    const operator =
      input.operatorName ??
      (await this.operatorName(input.createdById ?? null));
    const saved = await this.tasks.save(task);
    await this.addEvent(
      saved.id,
      '操作',
      `创建任务「${saved.title}」，进入等待中-待分配`,
      operator,
      {
        title: saved.title,
        description: saved.description,
        ...(saved.templateId
          ? { templateId: saved.templateId, templateName: saved.templateName }
          : {}),
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
    if (input.type !== undefined) {
      const typeName = await this.taskTypes.assertExists(input.type);
      if (!typeName) throw new BadRequestException('任务类型不能为空');
      task.type = typeName;
    }
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
    await this.addEvent(id, '操作', '更新任务信息', operator, {
      intervention: true,
    });
    return saved;
  }

  /** 启用中的工作者机器人（识别上下文的候选清单；排除调度机器人与停用机器人） */
  private async enabledWorkerRoster(): Promise<WorkerView[]> {
    return (
      await this.workersService.findAll({ role: WorkerRole.WORKER })
    ).filter((w) => w.enabled);
  }

  /**
   * AI 技能 task-recognize-detail：返回任务识别上下文（Markdown）。
   * 包含任务详情、状态、时间与启用中的工作者机器人清单，供外部识别流程读取。
   */
  async recognizeDetailMarkdown(id: number): Promise<string> {
    const task = await this.mustFind(id);
    const roster = await this.enabledWorkerRoster();
    const agent = task.agentId
      ? roster.find((w) => w.id === task.agentId)
      : undefined;
    const agentLabel = task.agentId
      ? `${agent ? agent.name : `#${task.agentId}`}（${task.agentId}）`
      : '未分配';
    const lines = [
      mdFrontmatter({ update: task.updatedAt, title: task.title }),
      `# ${task.title}`,
      '',
      '## 任务信息',
      '',
      `- ID：${task.id}`,
      `- 编号：${task.code}`,
      `- 类型：${task.type}`,
      `- 状态：${task.status}-${task.subStatus}`,
      `- 执行机器人：${agentLabel}`,
      `- 创建时间：${beijingTime(task.createdAt)}`,
      `- 更新时间：${beijingTime(task.updatedAt)}`,
      '',
      '## 描述',
      '',
      markdownText(task.description),
      '',
      '## 任务输入（用户原始需求）',
      '',
      markdownText(task.input),
      '',
      '## 需求内容（AI 分析整理）',
      '',
      markdownText(task.content),
      '',
      '## 交付方式',
      '',
      markdownText(task.outputSpec),
      '',
      '## 工作计划',
      '',
      markdownText(task.workPlan),
    ];
    lines.push('', '## 有效机器人清单', '');
    if (roster.length === 0) {
      lines.push('当前没有启用的工作者机器人。');
    } else {
      lines.push('| ID | 名称 | 描述 |', '| --- | --- | --- |');
      for (const w of roster) {
        lines.push(
          `| ${w.id} | ${escapeCell(w.name)} | ${escapeCell(w.intro ?? '-')} |`,
        );
      }
    }
    lines.push(
      '',
      '## 识别更新',
      '',
      '识别完成后调用 `POST /api/tasks/' +
        task.id +
        '/recognize.md` 保存标题、原始需求（input）、需求内容（content，AI 分析整理后的需求，含澄清与补充详情）、交付方式、工作计划与执行机器人；该接口只保存识别结果，不改变任务状态、不派发执行。',
      '',
    );
    return lines.join('\n');
  }

  /** 识别结果落库：只更新识别字段与机器人分配，不改状态、不派发（调用方负责后续流程） */
  async recognizeUpdate(
    id: number,
    input: RecognizeTaskInput,
    operator: string | null,
  ): Promise<Task> {
    const title = input.title?.trim();
    if (!title) throw new BadRequestException('任务标题不能为空');
    if (title.length > 200)
      throw new BadRequestException('任务标题不能超过 200 字');
    const content = input.content?.trim();
    if (!content) throw new BadRequestException('需求内容不能为空');
    const outputSpec = input.outputSpec?.trim();
    if (!outputSpec) throw new BadRequestException('交付方式不能为空');
    const workPlan = input.workPlan?.trim();
    if (!workPlan) throw new BadRequestException('工作计划不能为空');

    const task = await this.mustFind(id);
    if (input.agentId !== undefined && input.agentId !== null) {
      if (!Number.isInteger(input.agentId) || input.agentId < 1) {
        throw new BadRequestException('机器人 ID 必须为正整数');
      }
      await this.assertWorker(input.agentId);
    }
    task.title = title;
    task.content = content;
    if (input.input !== undefined) {
      task.input = input.input?.trim() || null;
    }
    task.outputSpec = outputSpec;
    task.workPlan = workPlan;
    if (input.agentId !== undefined) {
      task.agentId = input.agentId ?? null;
    }
    const saved = await this.tasks.save(task);
    await this.addEvent(id, '操作', 'AI 更新任务识别信息', operator, {
      title,
      input: saved.input,
      content,
      outputSpec,
      workPlan,
      agentId: saved.agentId,
    });
    return saved;
  }

  /** AI 技能 task-recognize-update：保存识别结果并返回 Markdown 结果 */
  async recognizeUpdateMarkdown(
    id: number,
    input: RecognizeTaskInput,
    operator: string | null,
  ): Promise<string> {
    const saved = await this.recognizeUpdate(id, input, operator);
    const roster = await this.enabledWorkerRoster();
    const agent = saved.agentId
      ? roster.find((w) => w.id === saved.agentId)
      : undefined;
    const agentLabel = saved.agentId
      ? `${agent ? agent.name : `#${saved.agentId}`}（${saved.agentId}）`
      : '未分配';
    return [
      mdFrontmatter({ update: saved.updatedAt, title: saved.title }),
      '# 任务识别信息已更新',
      '',
      `- ID：${saved.id}`,
      `- 编号：${saved.code}`,
      `- 状态：${saved.status}-${saved.subStatus}（识别更新不改变任务状态）`,
      `- 执行机器人：${agentLabel}`,
      `- 详情地址：GET /api/tasks/${saved.id}/recognize.md`,
      '',
      '## 标题',
      '',
      saved.title,
      '',
      '## 任务输入（用户原始需求）',
      '',
      markdownText(saved.input),
      '',
      '## 需求内容（AI 分析整理）',
      '',
      markdownText(saved.content),
      '',
      '## 交付方式',
      '',
      saved.outputSpec,
      '',
      '## 工作计划',
      '',
      saved.workPlan,
      '',
    ].join('\n');
  }

  /** 删除根任务：级联删子任务、事件、方案（无物理外键，应用层处理） */
  async remove(id: number, operator: string | null): Promise<void> {
    const task = await this.mustFind(id);
    if (task.status === TaskStatus.RUNNING) {
      throw new BadRequestException('任务进行中，先中断/取消或等待完成再删除');
    }
    const children = await this.tasks.find({ where: { rootId: id } });
    const ids = children.map((c) => c.id);
    await this.workerInbox.deleteForTasks([...new Set([id, ...ids])]);
    if (ids.length > 0) {
      await this.events.delete({ taskId: In(ids) });
      await this.taskMessages.delete({ taskId: In(ids) });
      await this.tasks.delete({ id: In(ids) });
    }
    await this.events.delete({ taskId: id });
    await this.taskMessages.delete({ taskId: id });
    await this.tasks.delete({ id });
    this.logger.log(
      `任务 ${task.code} 已删除（operator=${operator ?? 'system'}，级联 ${ids.length} 子任务）`,
    );
    this.taskRealtime.tasksDeleted([...new Set([id, ...ids])]);
  }

  // ===== 等待中状态的人工动作 =====

  /** 兼容旧提交入口：待反馈 → 待继续（LOOP 空闲后恢复执行） */
  async requeueForIdentify(id: number, operator: string | null): Promise<Task> {
    const task = await this.mustFind(id);
    if (
      task.status !== TaskStatus.WAITING ||
      task.subStatus !== TaskSubStatus.PENDING_FEEDBACK
    ) {
      throw new BadRequestException(
        `任务 ${task.code} 当前状态「${task.status}-${task.subStatus}」不可重新提交`,
      );
    }
    task.subStatus = task.agentId
      ? TaskSubStatus.PENDING_RESUME
      : TaskSubStatus.PENDING_ASSIGNMENT;
    task.resumePrompt = task.agentId
      ? '# 需求方补充\n\n请根据最新反馈继续处理任务。'
      : null;
    task.missingItems = null;
    task.remindCount = 0;
    task.firstRemindedAt = null;
    task.lastRemindedAt = null;
    const saved = await this.tasks.save(task);
    await this.addEvent(
      id,
      '操作',
      `状态变更：等待中-待反馈 → ${saved.status}-${saved.subStatus}（重新提交）`,
      operator,
      { intervention: true },
    );
    return saved;
  }

  /**
   * 提交用户反馈：反馈正文追加到任务描述；有执行机器人时进入待继续，
   * 尚未分配时回到待分配重新匹配。
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
    task.subStatus = task.agentId
      ? TaskSubStatus.PENDING_RESUME
      : TaskSubStatus.PENDING_ASSIGNMENT;
    task.resumePrompt = task.agentId
      ? text
        ? `# 需求方补充反馈\n\n${text}`
        : '请继续处理当前任务。'
      : null;
    task.missingItems = null;
    task.remindCount = 0;
    task.firstRemindedAt = null;
    task.lastRemindedAt = null;
    const saved = await this.tasks.save(task);
    if (text) {
      await this.addEvent(id, '反馈', text, operator, { feedback: text });
    }
    await this.addEvent(
      id,
      '操作',
      text ? '提交反馈并等待继续' : '重新提交执行',
      operator,
      { intervention: true },
    );
    return saved;
  }

  /** 任务对话统一入口：无执行会话时补充并重新识别，有会话时直接续聊 */
  async sendMessage(
    id: number,
    content: string,
    operator: string | null,
  ): Promise<Task> {
    const task = await this.mustFind(id);
    if (task.status === TaskStatus.FINISHED) {
      throw new BadRequestException(
        `任务 ${task.code} 已结束，不能继续发送消息`,
      );
    }
    const text = content.trim();
    if (!text) throw new BadRequestException('消息内容不能为空');
    const usesIdentify =
      task.status === TaskStatus.WAITING &&
      [
        TaskSubStatus.PENDING_ASSIGNMENT,
        TaskSubStatus.PENDING_ACCEPTANCE,
        TaskSubStatus.PENDING_FEEDBACK,
      ].includes(task.subStatus);
    if (usesIdentify) return this.supplement(id, text, operator);
    return this.dispatchService.continueConversation(id, text, operator);
  }

  /**
   * 任务尚未进入执行会话时发送补充消息：追加到任务描述；
   * 待反馈按是否已有执行机器人转入待继续或待分配。
   */
  async supplement(
    id: number,
    content: string,
    operator: string | null,
  ): Promise<Task> {
    const task = await this.mustFind(id);
    const allowed =
      task.status === TaskStatus.WAITING &&
      [
        TaskSubStatus.PENDING_ASSIGNMENT,
        TaskSubStatus.PENDING_ACCEPTANCE,
        TaskSubStatus.PENDING_FEEDBACK,
      ].includes(task.subStatus);
    if (!allowed) {
      throw new BadRequestException(
        `任务 ${task.code} 当前状态「${task.status}-${task.subStatus}」不可补充需求`,
      );
    }
    const text = content.trim();
    if (!text) throw new BadRequestException('消息内容不能为空');
    const from = `${task.status}-${task.subStatus}`;
    task.description = [task.description?.trim(), text]
      .filter(Boolean)
      .join('\n\n');
    task.status = TaskStatus.WAITING;
    if (task.subStatus === TaskSubStatus.PENDING_FEEDBACK) {
      task.subStatus = task.agentId
        ? TaskSubStatus.PENDING_RESUME
        : TaskSubStatus.PENDING_ASSIGNMENT;
      task.resumePrompt = task.agentId ? `# 需求方补充反馈\n\n${text}` : null;
    }
    task.missingItems = null;
    task.remindCount = 0;
    task.firstRemindedAt = null;
    task.lastRemindedAt = null;
    const saved = await this.tasks.save(task);
    await this.addEvent(id, '反馈', text, operator, {
      intervention: true,
      chat: true,
    });
    await this.addEvent(
      id,
      '状态变更',
      `状态变更：${from} → ${saved.status}-${saved.subStatus}（补充需求）`,
      operator,
    );
    return saved;
  }

  /** 人工标记待反馈（调度机器人自动识别失败时由 LOOP 内部调用，也可人工补充） */
  async markMissing(
    id: number,
    items: TaskMissingItem[],
    schedulerId: number | null,
    operator: string | null = null,
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
    task.firstRemindedAt = null;
    task.lastRemindedAt = null;
    if (schedulerId) task.schedulerId = schedulerId;
    const saved = await this.tasks.save(task);
    await this.addEvent(
      id,
      '状态变更',
      `状态变更：等待中-待反馈（需反馈 ${items.length} 项：${items.map((i) => i.item).join('、')}）`,
      operator,
      { schedulerId, ...(operator ? { intervention: true } : {}) },
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
    const updated = await this.tasks.update(
      {
        id: task.id,
        status: TaskStatus.WAITING,
        subStatus: TaskSubStatus.PENDING_ACCEPT,
      },
      {
        status: TaskStatus.FINISHED,
        subStatus: TaskSubStatus.COMPLETED,
        acceptedAt: now,
        acceptedBy: operator,
        deliveredAt: now,
      },
    );
    if (!updated.affected) {
      throw new BadRequestException('任务状态已变化，请刷新后重试');
    }
    const saved = await this.mustFind(task.id);
    await this.addEvent(
      id,
      '状态变更',
      '状态变更：等待中-待验收 → 已结束-完成',
      operator,
      { intervention: true },
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
      // 中断是取消流程的内部步骤，本次操作只记录一条人工介入
      await this.dispatchService
        .interrupt(id, operator, false)
        .catch(() => undefined);
    }
    const from = `${task.status}-${task.subStatus}`;
    task.status = TaskStatus.FINISHED;
    task.subStatus = TaskSubStatus.CANCELED;
    task.canceledAt = new Date();
    const saved = await this.tasks.save(task);
    await this.workerInbox.completeForChild(id);
    await this.workerInbox.enqueue(saved, 'cancelled', {
      payload: { reason: '任务已取消' },
    });
    await this.addEvent(
      id,
      '状态变更',
      `状态变更：${from} → 已结束-取消`,
      operator,
      { intervention: true },
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
