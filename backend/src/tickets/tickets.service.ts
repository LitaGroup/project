import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { In, Repository } from 'typeorm';
import type { User } from '../auth/user.entity';
import { TaskStatus, TaskSubStatus, WorkerRole } from '../common/enums';
import { beijingTime, mdFrontmatter } from '../common/frontmatter';
import { unescapeMarkdown } from '../common/markdown-escape';
import { TaskDispatchService } from '../tasks/task-dispatch.service';
import { TaskTemplate } from '../tasks/task-template.entity';
import { Task } from '../tasks/task.entity';
import { deriveTaskTitle } from '../tasks/task-title';
import {
  isSystemTaskTemplateId,
  TICKET_TASK_TYPE,
} from '../tasks/system-task-templates';
import { TasksService } from '../tasks/tasks.service';
import { Worker } from '../workers/worker.entity';
import { findTicketCategory, TICKET_CATEGORIES } from './ticket-categories';
import { TicketConfig } from './ticket-config.entity';
import { Ticket } from './ticket.entity';

export interface CreateTicketInput {
  category: string;
  title?: string;
  description?: string;
}

export interface RouteTicketInput {
  templateId: number;
  title: string;
  content: string;
  outputSpec: string;
  workPlan: string;
}

export interface UpdateTicketConfigInput {
  allowedTemplateIds?: number[];
}

export interface TicketView extends Ticket {
  /** 推导状态：待分配/待接受/待反馈/待继续/待验收/处理中/已完成/已失败/已取消 */
  status: string;
  task: Task | null;
}

export interface TicketConfigView {
  category: string;
  defaultTemplateId: number;
  defaultTemplateName: string;
  allowedTemplateIds: number[];
  allowedTemplates: Array<{ id: number; name: string; type: string }>;
  enabled: boolean;
  description: string;
}

function markdownText(value: string | null | undefined): string {
  return value?.trim() || '（暂无）';
}

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
 * 工单：创建时按工单类型固定默认任务定义派发，支持调度机器人澄清后转交配置内的后续定义。
 * 工单与任务一对一；对话、验收、失败、取消全部复用任务中心。
 */
@Injectable()
export class TicketsService implements OnModuleInit {
  private readonly logger = new Logger(TicketsService.name);
  private readonly apiUrl: string;

  constructor(
    @InjectRepository(Ticket)
    private readonly tickets: Repository<Ticket>,
    @InjectRepository(TicketConfig)
    private readonly configs: Repository<TicketConfig>,
    @InjectRepository(Task)
    private readonly tasks: Repository<Task>,
    @InjectRepository(TaskTemplate)
    private readonly templates: Repository<TaskTemplate>,
    @InjectRepository(Worker)
    private readonly workers: Repository<Worker>,
    private readonly tasksService: TasksService,
    private readonly dispatchService: TaskDispatchService,
    config: ConfigService,
  ) {
    this.apiUrl = (
      config.get<string>('API_URL') ?? 'http://localhost:3100/api'
    ).replace(/\/+$/, '');
  }

  /** 开发环境 synchronize 建表后补齐六类工单配置；已有配置不覆盖 */
  async onModuleInit(): Promise<void> {
    for (const item of TICKET_CATEGORIES) {
      await this.configs
        .createQueryBuilder()
        .insert()
        .into(TicketConfig)
        .values({
          category: item.category,
          defaultTemplateId: item.defaultTemplateId,
          allowedTemplateIds: [],
          enabled: item.enabled,
        })
        .orIgnore()
        .execute();
      // 存量配置按当前开放清单对齐（当前无管理端关闭入口，启停由代码常量控制）
      await this.configs.update(
        { category: item.category },
        { enabled: item.enabled },
      );
    }
  }

  async findAll(params: {
    category?: string;
    status?: string;
    q?: string;
  }): Promise<TicketView[]> {
    const qb = this.tickets.createQueryBuilder('t');
    if (params.category) {
      const category = findTicketCategory(params.category);
      if (!category) return [];
      qb.andWhere('t.category = :category', { category: category.category });
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
    const tasks = rows.length
      ? await this.tasks.find({
          where: { id: In(rows.map((row) => row.taskId)) },
        })
      : [];
    const taskById = new Map(tasks.map((task) => [task.id, task]));
    const status = params.status?.trim();
    return rows
      .map((ticket) => {
        const task = taskById.get(ticket.taskId) ?? null;
        return { ...ticket, task, status: deriveTicketStatus(task) };
      })
      .filter((ticket) => !status || ticket.status === status);
  }

  async findOne(id: number): Promise<
    TicketView & {
      config: TicketConfigView;
      allowedTemplates: Array<{
        id: number;
        name: string;
        type: string;
        description: string | null;
        agentIds: number[];
      }>;
    }
  > {
    const ticket = await this.mustFind(id);
    const [task, config] = await Promise.all([
      this.tasks.findOne({ where: { id: ticket.taskId } }),
      this.configView(ticket.category),
    ]);
    const allowedTemplates = await this.templates.find({
      where: { id: In(config.allowedTemplateIds) },
    });
    return {
      ...ticket,
      task,
      status: deriveTicketStatus(task),
      config,
      allowedTemplates: config.allowedTemplateIds
        .map((templateId) =>
          allowedTemplates.find((template) => template.id === templateId),
        )
        .filter((template): template is TaskTemplate => Boolean(template))
        .map((template) => ({
          id: template.id,
          name: template.name,
          type: template.type,
          description: template.description,
          agentIds: template.agentIds ?? [],
        })),
    };
  }

  async create(input: CreateTicketInput, user: User): Promise<TicketView> {
    const category = findTicketCategory(input.category);
    if (!category) throw new BadRequestException('工单类型不存在');
    const config = await this.configs.findOne({
      where: { category: category.category },
    });
    if (!config?.enabled || !category.enabled) {
      throw new BadRequestException(`「${category.category}」暂未开放创建`);
    }
    const description = input.description?.trim();
    if (!description) throw new BadRequestException('工单描述不能为空');

    const template = await this.templates.findOne({
      where: { id: config.defaultTemplateId },
    });
    if (!template) {
      throw new BadRequestException(
        `工单默认任务定义 #${config.defaultTemplateId} 不存在，请检查系统配置`,
      );
    }
    const agent = await this.pickEnabledAgent(template.agentIds ?? []);
    if (!agent) {
      throw new BadRequestException(
        `默认任务定义「${template.name}」没有启用的处理机器人，请先在任务定义中配置`,
      );
    }

    const title =
      (input.title?.trim() ? unescapeMarkdown(input.title.trim()) : '') ||
      deriveTaskTitle(description) ||
      '新工单';
    const task = await this.tasksService.create({
      title,
      description,
      type: TICKET_TASK_TYPE,
      templateId: template.id,
      agentId: agent.id,
      createdById: user.id,
      requesterType: 'user',
      requesterId: user.id,
      operatorName: user.name,
    });
    // 工单严格绑定默认定义：直接进入待接受，不再经过通用分配器的同类型/未知任务兜底
    const advanced = await this.tasks.update(
      {
        id: task.id,
        status: TaskStatus.WAITING,
        subStatus: TaskSubStatus.PENDING_ASSIGNMENT,
      },
      {
        subStatus: TaskSubStatus.PENDING_ACCEPTANCE,
        offerAttemptAt: null,
      },
    );
    if (advanced.affected) {
      task.subStatus = TaskSubStatus.PENDING_ACCEPTANCE;
      await this.tasksService.addEvent(
        task.id,
        '状态变更',
        `状态变更：等待中-待分配 → 等待中-待接受（任务定义「${template.name}」，机器人：${agent.name}）`,
        null,
        {
          source: 'definition',
          templateId: template.id,
          templateName: template.name,
          agentId: agent.id,
          agentName: agent.name,
        },
      );
    } else {
      const latest = await this.tasks.findOne({ where: { id: task.id } });
      if (latest) {
        task.status = latest.status;
        task.subStatus = latest.subStatus;
      }
    }

    let saved: Ticket;
    try {
      const ticket = await this.tickets.save(
        this.tickets.create({
          code: `TMP-${randomBytes(8).toString('hex')}`,
          category: category.category,
          title,
          description,
          createdById: user.id,
          createdByName: user.name,
          // 责任方由工单绑定的默认调度机器人自动担任，创建时无需用户选择
          assigneeType: 'worker',
          assigneeId: agent.id,
          assigneeName: agent.name,
          taskId: task.id,
        }),
      );
      ticket.code = `WO-${String(ticket.id).padStart(4, '0')}`;
      saved = await this.tickets.save(ticket);
    } catch (error) {
      await this.tasksService
        .remove(task.id, user.name)
        .catch((e: Error) =>
          this.logger.warn(
            `工单创建失败后清理任务 #${task.id} 失败：${e.message}`,
          ),
        );
      throw error;
    }
    await this.tasksService
      .addEvent(
        task.id,
        '操作',
        `创建${category.category} ${saved.code}，处理机器人：${agent.name}`,
        user.name,
        {
          ticketId: saved.id,
          ticketCode: saved.code,
          category: saved.category,
          assigneeType: saved.assigneeType,
          assigneeId: saved.assigneeId,
        },
      )
      .catch((e: Error) =>
        this.logger.warn(`工单 ${saved.code} 创建事件写入失败：${e.message}`),
      );
    return { ...saved, task, status: deriveTicketStatus(task) };
  }

  async listConfigs(): Promise<TicketConfigView[]> {
    const rows = await this.configs.find();
    return Promise.all(
      TICKET_CATEGORIES.map((item) =>
        this.configView(
          item.category,
          rows.find((row) => row.category === item.category),
        ),
      ),
    );
  }

  async updateConfig(
    categoryName: string,
    input: UpdateTicketConfigInput,
  ): Promise<TicketConfigView> {
    const category = findTicketCategory(categoryName);
    if (!category) throw new NotFoundException('工单类型不存在');
    const config = await this.mustFindConfig(category.category);
    if (input.allowedTemplateIds !== undefined) {
      config.allowedTemplateIds = await this.normalizeAllowedTemplates(
        input.allowedTemplateIds,
      );
    }
    await this.configs.save(config);
    return this.configView(category.category);
  }

  private async configView(
    categoryName: string,
    provided?: TicketConfig,
  ): Promise<TicketConfigView> {
    const category = findTicketCategory(categoryName);
    if (!category) throw new NotFoundException('工单类型不存在');
    const config = provided ?? (await this.mustFindConfig(category.category));
    const ids = [
      config.defaultTemplateId,
      ...(config.allowedTemplateIds ?? []),
    ];
    const templates = ids.length
      ? await this.templates.find({ where: { id: In(ids) } })
      : [];
    const templateById = new Map(templates.map((item) => [item.id, item]));
    const existingAllowedIds = (config.allowedTemplateIds ?? []).filter((id) =>
      templateById.has(id),
    );
    return {
      category: category.category,
      defaultTemplateId: config.defaultTemplateId,
      defaultTemplateName:
        templateById.get(config.defaultTemplateId)?.name ??
        category.defaultTemplateName,
      allowedTemplateIds: existingAllowedIds,
      allowedTemplates: existingAllowedIds
        .map((id) => templateById.get(id))
        .filter((item): item is TaskTemplate => Boolean(item))
        .map((item) => ({ id: item.id, name: item.name, type: item.type })),
      enabled: config.enabled,
      description: category.description,
    };
  }

  private async normalizeAllowedTemplates(ids: number[]): Promise<number[]> {
    if (!Array.isArray(ids))
      throw new BadRequestException('任务定义清单格式错误');
    const unique = [...new Set(ids.map((id) => Number(id)))];
    for (const id of unique) {
      if (!Number.isInteger(id) || id < 1) {
        throw new BadRequestException('任务定义 ID 必须为正整数');
      }
      if (isSystemTaskTemplateId(id)) {
        throw new BadRequestException('系统调度任务定义不能配置为后续转派定义');
      }
      const template = await this.templates.findOne({ where: { id } });
      if (!template) {
        throw new BadRequestException(`任务定义 #${id} 不存在`);
      }
    }
    return unique;
  }

  private async pickEnabledAgent(ids: number[]): Promise<Worker | null> {
    if (!ids?.length) return null;
    const rows = await this.workers.find({ where: { id: In(ids) } });
    const byId = new Map(rows.map((worker) => [worker.id, worker]));
    for (const id of ids) {
      const worker = byId.get(id);
      if (worker?.enabled && worker.role === WorkerRole.WORKER) return worker;
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
    task.type = template.type;
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
    const ticket = await this.tickets.findOne({ where: { taskId } });
    if (!ticket) {
      return [
        mdFrontmatter({ update: task.updatedAt, title: task.title }),
        '# 非工单任务',
        '',
        `任务 ${task.code} 未关联工单，请按普通任务流程处理。`,
        '',
      ].join('\n');
    }
    const config = await this.mustFindConfig(ticket.category);
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
      `- 处理机器人：${ticket.assigneeName}（由工单绑定任务定义自动分配）`,
      `- 创建人：${ticket.createdByName}`,
      `- 创建时间：${beijingTime(ticket.createdAt)}`,
      `- 关联任务：${task.code}（${task.status}-${task.subStatus}）`,
      `- 当前任务定义：${task.templateName ?? '未设置'}`,
      '',
      '## 工单描述',
      '',
      markdownText(ticket.description),
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
        '| ID | 名称 | 类型 |',
        '| --- | --- | --- |',
        ...orderedTemplates.map(
          (template) =>
            `| ${template.id} | ${escapeCell(template.name)} | ${escapeCell(template.type)} |`,
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
