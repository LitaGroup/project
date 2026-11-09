import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  MessageEvent,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { Observable } from 'rxjs';
import { Brackets, In, IsNull, Repository } from 'typeorm';
import {
  TaskStatus,
  TaskSubStatus,
  UserRole,
  WorkerRole,
} from '../common/enums';
import { beijingTime, mdFrontmatter } from '../common/frontmatter';
import {
  unescapeMarkdown,
  unescapeMarkdownUrlColons,
} from '../common/markdown-escape';
import { WorkerView, WorkersService } from '../workers/workers.service';
import { User } from '../auth/user.entity';
import { Worker } from '../workers/worker.entity';
import { Task, TaskMissingItem } from './task.entity';
import type { TaskChatPerspective } from './task-chat.types';
import { TaskEvent } from './task-event.entity';
import { TaskMessage } from './task-message.entity';
import { TaskTemplate } from './task-template.entity';
import { deriveTaskTitle } from './task-title';
import { TaskDispatchService } from './task-dispatch.service';
import { isTaskRequesterUser } from './task-requester';
import { TaskWorkerInboxService } from './task-worker-inbox.service';
import {
  TaskRealtimeEvent,
  TaskRealtimeService,
} from './task-realtime.service';
import {
  SYSTEM_PROJECT_DELIVERY_TASK_TEMPLATE_ID,
  SYSTEM_PROJECT_DELIVERY_TASK_TEMPLATE_NAME,
} from './system-task-templates';

export interface CreateTaskInput {
  /** 标题（可空：按任务描述首行推导） */
  title?: string;
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
  /** 关联项目（projects.id，可空；项目交付任务使用） */
  projectId?: number | null;
  /** 兼容旧客户端字段：新流程创建后始终进入「等待中-待分配」 */
  submitForScheduling?: boolean;
}

export interface UpdateTaskInput {
  title?: string;
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

/** 项目详情展示的项目交付任务快照 */
export interface ProjectDeliveryTaskView {
  task: Task;
  agentName: string | null;
  latestEvent: TaskEvent | null;
  liveLines: string[];
  childCount: number;
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
    private readonly dispatchService: TaskDispatchService,
    private readonly workerInbox: TaskWorkerInboxService,
    private readonly taskRealtime: TaskRealtimeService,
  ) {}

  /**
   * 任务列表（默认只返回根任务；q 匹配编号/标题，status/subStatus 精确筛选；
   * rootOnly=false 时返回全部）。每个根任务附 children 树。
   */
  async findAll(params: {
    q?: string;
    status?: TaskStatus;
    subStatus?: TaskSubStatus;
    rootOnly?: boolean;
  }): Promise<
    Array<Task & { children?: Task[]; requesterName: string | null }>
  > {
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
      const nameOf = await this.requesterNameResolver([...roots, ...children]);
      return roots.map((r) => {
        const children = byParent.get(r.id) ?? [];
        for (const child of children) {
          Object.assign(child, {
            liveLines: this.recentLiveLines(child.id),
            requesterName: nameOf(child),
          });
        }
        return Object.assign(r, {
          children,
          liveLines: this.recentLiveLines(r.id),
          requesterName: nameOf(r),
        });
      });
    }
    // 平铺列表（看板用）：附带执行中任务的实时输出，避免前端逐个拉详情
    const nameOf = await this.requesterNameResolver(roots);
    return roots.map((r) =>
      Object.assign(r, {
        liveLines: this.recentLiveLines(r.id),
        requesterName: nameOf(r),
      }),
    );
  }

  /** 单个任务列表快照（SSE 任务变更推送用，不含详情事件时间线） */
  async findOneForList(
    id: number,
  ): Promise<
    (Task & { liveLines: string[]; requesterName: string | null }) | null
  > {
    const task = await this.tasks.findOne({ where: { id } });
    if (!task) return null;
    const nameOf = await this.requesterNameResolver([task]);
    return Object.assign(task, {
      liveLines: this.recentLiveLines(id),
      requesterName: nameOf(task),
    });
  }

  /**
   * 批量解析任务需求方展示名：worker 取机器人名（历史个人 AGENT 显示其主人），
   * user 取用户姓名；需求方缺省时回退任务创建人。
   */
  private async requesterNameResolver(
    tasks: Task[],
  ): Promise<(task: Task) => string | null> {
    const workerIds = new Set<number>();
    const userIds = new Set<number>();
    const requesterOf = (
      task: Task,
    ): { type: 'user' | 'worker' | null; id: number | null } => {
      const type = task.requesterType ?? (task.createdById ? 'user' : null);
      const id = task.requesterId ?? task.createdById;
      return { type, id };
    };
    for (const task of tasks) {
      const { type, id } = requesterOf(task);
      if (!id) continue;
      if (type === 'worker') workerIds.add(id);
      else if (type === 'user') userIds.add(id);
    }
    const workers = workerIds.size
      ? await this.workers.find({
          where: { id: In([...workerIds]) },
          select: {
            id: true,
            name: true,
            ownerName: true,
            personalAgentUserId: true,
          },
        })
      : [];
    for (const worker of workers) {
      if (worker.personalAgentUserId) userIds.add(worker.personalAgentUserId);
    }
    const users = userIds.size
      ? await this.users.find({
          where: { id: In([...userIds]) },
          select: { id: true, name: true },
        })
      : [];
    const userNames = new Map(users.map((user) => [user.id, user.name]));
    const workerNames = new Map<number, string>();
    for (const worker of workers) {
      workerNames.set(
        worker.id,
        worker.personalAgentUserId
          ? (userNames.get(worker.personalAgentUserId) ??
              worker.ownerName ??
              worker.name)
          : worker.name,
      );
    }
    return (task) => {
      const { type, id } = requesterOf(task);
      if (!id) return null;
      if (type === 'worker') {
        return workerNames.get(id) ?? `机器人 #${id}`;
      }
      return userNames.get(id) ?? `用户 #${id}`;
    };
  }

  /** 列表快照只保留最近 60 行输出，完整输出仍走详情/任务级 SSE */
  private recentLiveLines(id: number): string[] {
    const lines = this.dispatchService.liveLines(id);
    return lines.length > 60 ? lines.slice(-60) : lines;
  }

  /** 项目工作项进度：取任务最近一条非空实时输出 */
  latestProjectProgressLine(id: number): string | null {
    const line = [...this.recentLiveLines(id)]
      .reverse()
      .find((item) => item.trim());
    return line?.replace(/\s+/g, ' ').trim() || null;
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
    // AI 生成的 Markdown 常把 URL 写成 `http\://`，冒号转义没有语义，入库前还原
    const description = input.description?.trim()
      ? unescapeMarkdownUrlColons(input.description.trim())
      : null;
    // 未填标题时取描述首行作为临时标题；直接识别分配不会改写标题
    const title =
      (input.title?.trim() ? unescapeMarkdown(input.title.trim()) : '') ||
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
        templateId: template?.id ?? null,
        templateName: template?.name ?? null,
        projectId: input.projectId ?? null,
        description,
        input: input.input?.trim()
          ? unescapeMarkdownUrlColons(input.input.trim())
          : null,
        outputSpec: input.outputSpec?.trim()
          ? unescapeMarkdownUrlColons(input.outputSpec.trim())
          : null,
        agentId: input.agentId ?? null,
        assignedAt: input.agentId ? new Date() : null,
        schedulerId: input.schedulerId ?? null,
        parentId: input.parentId ?? null,
        createdById: input.createdById ?? null,
        requesterType,
        requesterId,
        handoffPath: null,
        handoffVersion: 0,
        handoffSubmittedVersion: null,
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
    // 交付文档由执行方开始处理后显式创建，平台不在任务创建时生成。
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
      const title = unescapeMarkdown(input.title.trim());
      if (!title) throw new BadRequestException('标题不能为空');
      task.title = title;
    }
    if (input.description !== undefined) {
      task.description = input.description?.trim()
        ? unescapeMarkdownUrlColons(input.description.trim())
        : null;
    }
    if (input.input !== undefined) {
      task.input = input.input?.trim()
        ? unescapeMarkdownUrlColons(input.input.trim())
        : null;
    }
    if (input.outputSpec !== undefined) {
      task.outputSpec = input.outputSpec?.trim()
        ? unescapeMarkdownUrlColons(input.outputSpec.trim())
        : null;
    }
    if (input.workPlan !== undefined) {
      task.workPlan = input.workPlan?.trim()
        ? unescapeMarkdownUrlColons(input.workPlan.trim())
        : null;
    }
    if (input.agentId !== undefined) {
      const previousAgentId = task.agentId;
      if (input.agentId) await this.assertWorker(input.agentId);
      task.agentId = input.agentId ?? null;
      task.assignedAt =
        input.agentId && input.agentId !== previousAgentId
          ? new Date()
          : input.agentId
            ? task.assignedAt
            : null;
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
    const title = input.title ? unescapeMarkdown(input.title.trim()) : '';
    if (!title) throw new BadRequestException('任务标题不能为空');
    if (title.length > 200)
      throw new BadRequestException('任务标题不能超过 200 字');
    const content = input.content?.trim()
      ? unescapeMarkdownUrlColons(input.content.trim())
      : '';
    if (!content) throw new BadRequestException('需求内容不能为空');
    const outputSpec = input.outputSpec?.trim()
      ? unescapeMarkdownUrlColons(input.outputSpec.trim())
      : '';
    if (!outputSpec) throw new BadRequestException('交付方式不能为空');
    const workPlan = input.workPlan?.trim()
      ? unescapeMarkdownUrlColons(input.workPlan.trim())
      : '';
    if (!workPlan) throw new BadRequestException('工作计划不能为空');

    const task = await this.mustFind(id);
    if (input.agentId !== undefined) {
      const previousAgentId = task.agentId;
      if (input.agentId !== undefined && input.agentId !== null) {
        if (!Number.isInteger(input.agentId) || input.agentId < 1) {
          throw new BadRequestException('机器人 ID 必须为正整数');
        }
        await this.assertWorker(input.agentId);
      }
      if (input.agentId && input.agentId !== previousAgentId) {
        task.assignedAt = new Date();
      }
    }
    task.title = title;
    task.content = content;
    if (input.input !== undefined) {
      task.input = input.input?.trim()
        ? unescapeMarkdownUrlColons(input.input.trim())
        : null;
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

  /** 兼容旧提交入口：待反馈 → 待继续（LOOP 在机器人仍有执行容量时恢复执行） */
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
    options?: {
      actorWorkerId?: number | null;
      perspective?: TaskChatPerspective;
    },
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
        TaskSubStatus.PENDING_RESUME,
        TaskSubStatus.PENDING_APPLY,
      ].includes(task.subStatus);
    if (usesIdentify) {
      return this.supplement(id, text, operator, options);
    }
    return this.dispatchService.continueConversation(id, text, operator, {
      actorWorkerId: options?.actorWorkerId,
      perspective: options?.perspective,
    });
  }

  /**
   * 任务尚未进入执行会话时发送补充消息：追加到任务描述；
   * 待反馈按是否已有执行机器人转入待继续或待分配。
   */
  async supplement(
    id: number,
    content: string,
    operator: string | null,
    options?: {
      actorWorkerId?: number | null;
      perspective?: TaskChatPerspective;
    },
  ): Promise<Task> {
    const task = await this.mustFind(id);
    const allowed =
      task.status === TaskStatus.WAITING &&
      [
        TaskSubStatus.PENDING_ASSIGNMENT,
        TaskSubStatus.PENDING_ACCEPTANCE,
        TaskSubStatus.PENDING_FEEDBACK,
        TaskSubStatus.PENDING_RESUME,
        TaskSubStatus.PENDING_APPLY,
      ].includes(task.subStatus);
    if (!allowed) {
      throw new BadRequestException(
        `任务 ${task.code} 当前状态「${task.status}-${task.subStatus}」不可补充需求`,
      );
    }
    const text = content.trim();
    if (!text) throw new BadRequestException('消息内容不能为空');
    const from = `${task.status}-${task.subStatus}`;
    const previousSubStatus = task.subStatus;
    task.description = [task.description?.trim(), text]
      .filter(Boolean)
      .join('\n\n');
    task.status = TaskStatus.WAITING;
    if (previousSubStatus === TaskSubStatus.PENDING_FEEDBACK) {
      task.subStatus = task.agentId
        ? TaskSubStatus.PENDING_RESUME
        : TaskSubStatus.PENDING_ASSIGNMENT;
      task.resumePrompt = task.agentId ? `# 需求方补充反馈\n\n${text}` : null;
    } else if (
      previousSubStatus === TaskSubStatus.PENDING_RESUME ||
      previousSubStatus === TaskSubStatus.PENDING_APPLY
    ) {
      // 已在等待机器人继续：补充消息并入恢复提示，机器人恢复时一并读取。
      // 待申请验收收到新消息时转为待继续，机器人仍有执行容量后立即恢复原任务。
      task.subStatus = TaskSubStatus.PENDING_RESUME;
      task.resumePrompt = [
        task.resumePrompt?.trim(),
        `# 需求方补充消息\n\n${text}`,
      ]
        .filter(Boolean)
        .join('\n\n---\n\n');
    }
    task.missingItems = null;
    task.remindCount = 0;
    task.firstRemindedAt = null;
    task.lastRemindedAt = null;
    const saved = await this.tasks.save(task);
    await this.addEvent(id, '反馈', text, operator, {
      intervention: true,
      chat: true,
      ...(options?.perspective ? { perspective: options.perspective } : {}),
      ...(options?.actorWorkerId
        ? {
            actorType: 'worker' as const,
            actorWorkerId: options.actorWorkerId,
          }
        : {}),
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

  /**
   * 验收：只要当前待验收或曾提交过验收申请，未结束任务均可验收完成。
   * 返工后任务可能已回到执行中，历史验收申请仍允许需求方直接通过。
   */
  async accept(id: number, operator: string | null): Promise<Task> {
    const task = await this.mustFind(id);
    const pendingAcceptance =
      task.status === TaskStatus.WAITING &&
      task.subStatus === TaskSubStatus.PENDING_ACCEPT;
    if (
      task.status === TaskStatus.FINISHED ||
      (!pendingAcceptance && !(await this.hasAcceptanceApplication(id)))
    ) {
      throw new BadRequestException(
        `任务 ${task.code} 当前状态「${task.status}-${task.subStatus}」不可验收`,
      );
    }
    const from = `${task.status}-${task.subStatus}`;
    const now = new Date();
    const updated = await this.tasks.update(
      {
        id: task.id,
        status: task.status,
        subStatus: task.subStatus,
      },
      {
        status: TaskStatus.FINISHED,
        subStatus: TaskSubStatus.COMPLETED,
        acceptedAt: now,
        acceptedBy: operator,
        deliveredAt: now,
        missingItems: null,
        resumePrompt: null,
      },
    );
    if (!updated.affected) {
      throw new BadRequestException('任务状态已变化，请刷新后重试');
    }
    const saved = await this.mustFind(task.id);
    await this.addEvent(
      id,
      '状态变更',
      `状态变更：${from} → 已结束-完成`,
      operator,
      { intervention: true },
    );
    return saved;
  }

  /** 是否提交过验收申请（按最新交付事件判断，撤销交付会让旧申请失效） */
  private async hasAcceptanceApplication(id: number): Promise<boolean> {
    const events = await this.events.find({
      where: { taskId: id },
      select: { id: true, taskId: true, meta: true },
    });
    let active = false;
    for (const event of events.sort((a, b) => a.id - b.id)) {
      if (event.meta?.deliveryApply === true) active = true;
      if (event.meta?.deliveryRevoke === true) active = false;
    }
    return active;
  }

  /**
   * 停止任务（对外入口）：任务发起者或管理员可操作。
   * 停止父任务会级联取消其全部未结束后代，不受后代发起者限制。
   */
  async cancelForUser(id: number, user: User): Promise<Task> {
    const task = await this.mustFind(id);
    if (user.role !== UserRole.ADMIN) {
      const [humanWorker, personalAgent] = await Promise.all([
        this.workersService.findByHumanUserId(user.id),
        this.workers.findOne({
          where: { personalAgentUserId: user.id },
          select: { id: true },
        }),
      ]);
      if (
        !isTaskRequesterUser(task, user.id, {
          humanWorkerId: humanWorker?.id ?? null,
          personalAgentId: personalAgent?.id ?? null,
        })
      ) {
        throw new ForbiddenException('仅任务发起者或管理员可以停止任务');
      }
    }
    return this.cancel(id, user.name ?? null);
  }

  /**
   * 取消任务：先停止目标，再按任务树父级优先取消全部未结束后代。
   * 先取消父节点可立即阻止继续创建子任务，再逐层读取并取消其子节点。
   * 已结束的后代保持原状态，但仍继续遍历其子节点，确保深层未结束任务也被停止。
   */
  async cancel(id: number, operator: string | null): Promise<Task> {
    const task = await this.mustFind(id);
    if (task.status === TaskStatus.FINISHED) {
      throw new BadRequestException(
        `任务 ${task.code} 当前状态「${task.status}-${task.subStatus}」不可取消`,
      );
    }
    const target = await this.cancelOne(task, operator);
    try {
      const queue: Task[] = [task];
      const visited = new Set<number>([task.id]);
      for (let index = 0; index < queue.length; index += 1) {
        const parent = queue[index];
        const children = await this.tasks.find({
          where: { parentId: parent.id },
          order: { id: 'ASC' },
        });
        for (const child of children) {
          if (visited.has(child.id)) continue;
          visited.add(child.id);
          queue.push(child);
          if (child.status !== TaskStatus.FINISHED) {
            await this.cancelOne(child, operator);
          }
        }
      }
      return target;
    } finally {
      // 只向树外父任务通知一次；被级联停止的父任务和后代无需再互相唤醒
      await this.workerInbox.enqueue(target, 'cancelled', {
        payload: { reason: '任务已停止，其全部未结束子任务已级联取消' },
      });
    }
  }

  /** 取消单个任务节点（执行中先中断会话，不负责子任务遍历） */
  private async cancelOne(task: Task, operator: string | null): Promise<Task> {
    if (
      task.status === TaskStatus.RUNNING &&
      task.subStatus === TaskSubStatus.EXECUTING
    ) {
      // 中断是取消流程的内部步骤，本次操作只记录一条人工介入
      await this.dispatchService
        .interrupt(task.id, operator, false)
        .catch(() => undefined);
    }
    const from = `${task.status}-${task.subStatus}`;
    task.status = TaskStatus.FINISHED;
    task.subStatus = TaskSubStatus.CANCELED;
    task.canceledAt = new Date();
    const saved = await this.tasks.save(task);
    await this.workerInbox.completeForChild(task.id);
    await this.addEvent(
      task.id,
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

  /** 项目详情使用的交付任务快照：绑定项目 + 系统定义的最新根任务 */
  async findProjectDeliveryTask(
    projectId: number,
  ): Promise<ProjectDeliveryTaskView | null> {
    let task = await this.tasks.findOne({
      where: {
        projectId,
        templateId: SYSTEM_PROJECT_DELIVERY_TASK_TEMPLATE_ID,
        parentId: IsNull(),
      },
      order: { id: 'DESC' },
    });
    if (!task) {
      // 兼容 projectId 上线前按固定描述创建的项目任务，读取时自动回填关联
      task = await this.tasks.findOne({
        where: {
          templateId: SYSTEM_PROJECT_DELIVERY_TASK_TEMPLATE_ID,
          parentId: IsNull(),
          description: `项目ID：${projectId} 的实施交付`,
        },
        order: { id: 'DESC' },
      });
      if (task) {
        task.projectId = projectId;
        await this.tasks.save(task);
      }
    }
    if (!task) return null;
    const [agent, latestEvent, childCount] = await Promise.all([
      task.agentId
        ? this.workers.findOne({
            where: { id: task.agentId },
            select: { id: true, name: true },
          })
        : Promise.resolve(null),
      this.events.findOne({
        where: { taskId: task.id },
        order: { id: 'DESC' },
      }),
      this.tasks.count({ where: { parentId: task.id } }),
    ]);
    return {
      task,
      agentName: agent?.name ?? null,
      latestEvent,
      liveLines: this.recentLiveLines(task.id).slice(-5),
      childCount,
    };
  }

  /**
   * 幂等创建项目开发交付任务；已有未取消的项目任务时直接返回现有任务。
   * 已取消的任务保留历史，但允许重新创建一条交付任务。
   */
  async ensureProjectDeliveryTask(
    projectId: number,
    creator?: { userId: number; userName?: string | null },
    projectName?: string | null,
  ): Promise<ProjectDeliveryTaskView> {
    const existing = await this.findProjectDeliveryTask(projectId);
    const canceled =
      existing?.task.status === TaskStatus.FINISHED &&
      existing.task.subStatus === TaskSubStatus.CANCELED;
    if (existing && !canceled) return existing;
    const humanWorker = creator
      ? await this.workersService.findByHumanUserId(creator.userId)
      : null;
    const projectTaskTitle = projectName?.trim()
      ? `项目任务-${projectName.trim()}`
      : SYSTEM_PROJECT_DELIVERY_TASK_TEMPLATE_NAME;
    await this.create({
      projectId,
      templateId: SYSTEM_PROJECT_DELIVERY_TASK_TEMPLATE_ID,
      title: projectTaskTitle.slice(0, 200),
      description: `项目ID：${projectId} 的实施交付`,
      createdById: creator?.userId ?? null,
      operatorName: creator?.userName ?? undefined,
      requesterType: creator ? (humanWorker ? 'worker' : 'user') : null,
      requesterId: creator ? (humanWorker?.id ?? creator.userId) : null,
    });
    const created = await this.findProjectDeliveryTask(projectId);
    if (!created) {
      throw new NotFoundException('项目交付任务创建后未能读取');
    }
    return created;
  }

  async mustFind(id: number): Promise<Task> {
    const task = await this.tasks.findOne({ where: { id } });
    if (!task) throw new NotFoundException(`Task ${id} not found`);
    return task;
  }
}
