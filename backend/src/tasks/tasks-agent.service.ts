import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, In, IsNull, Repository } from 'typeorm';
import type { AuthedRequest } from '../auth/auth.guard';
import { User } from '../auth/user.entity';
import { beijingTime, mdFrontmatter } from '../common/frontmatter';
import { TaskStatus } from '../common/enums';
import { Worker } from '../workers/worker.entity';
import { PersonalAgentsService } from '../workers/personal-agents.service';
import { WorkersService } from '../workers/workers.service';
import { Task } from './task.entity';
import { TaskDocumentService } from './task-document.service';
import { TaskEvent } from './task-event.entity';
import { CreateTaskInput, TasksService } from './tasks.service';

/** 当前 Agent 身份可访问的任务范围（真人机器人 / 个人 AGENT / 用户本人） */
export interface AgentTaskScope {
  userIds: number[];
  workerIds: number[];
  /** 我负责的机器人（workers.ownerUserId），任务清单中标记为「负责方」 */
  responsibleWorkerIds: number[];
  /** 身份描述（用于 Markdown 头部） */
  label: string;
}

export interface AgentTaskQuery {
  q?: string;
  status?: string;
  subStatus?: string;
  type?: string;
  rootOnly?: boolean;
}

export interface AgentCreateTaskInput {
  title?: string;
  type?: string;
  description?: string | null;
  input?: string | null;
  outputSpec?: string | null;
  templateId?: number | null;
}

/** 任务清单最多返回条数（避免 Agent 上下文过大） */
const TASK_LIST_LIMIT = 300;

/**
 * AI Agent 用的任务 Markdown 服务：
 * - 任务清单 / 详情按身份收敛到「我的任务」（需求方、执行方或负责方）；
 * - 创建任务时把机器人身份映射为需求方（个人 AGENT → 其绑定用户）。
 */
@Injectable()
export class TasksAgentService {
  constructor(
    @InjectRepository(Task)
    private readonly tasks: Repository<Task>,
    @InjectRepository(TaskEvent)
    private readonly events: Repository<TaskEvent>,
    @InjectRepository(Worker)
    private readonly workers: Repository<Worker>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly tasksService: TasksService,
    private readonly taskDocuments: TaskDocumentService,
    private readonly workersService: WorkersService,
    private readonly personalAgents: PersonalAgentsService,
  ) {}

  /**
   * 解析当前请求的任务身份。
   * - 机器人令牌：机器人自身 + 其绑定用户（真人机器人）/ 其个人 AGENT 的主人的真人机器人；
   * - 用户令牌：用户本人 + 真人机器人 + 个人 AGENT。
   */
  async resolveScope(req: AuthedRequest): Promise<AgentTaskScope> {
    const userIds = new Set<number>();
    const workerIds = new Set<number>();
    const labels: string[] = [];

    if (req.worker) {
      workerIds.add(req.worker.id);
      labels.push(req.worker.name);
      if (req.worker.humanUserId) {
        userIds.add(req.worker.humanUserId);
        const personal = await this.personalAgents.findForUser(
          req.worker.humanUserId,
        );
        if (personal) workerIds.add(personal.id);
      }
      if (req.worker.personalAgentUserId) {
        userIds.add(req.worker.personalAgentUserId);
        const human = await this.workersService.findByHumanUserId(
          req.worker.personalAgentUserId,
        );
        if (human) workerIds.add(human.id);
      }
    }
    if (req.user) {
      userIds.add(req.user.id);
      labels.push(req.user.name);
      const human = await this.workersService.findByHumanUserId(req.user.id);
      if (human) workerIds.add(human.id);
      const personal = await this.personalAgents.findForUser(req.user.id);
      if (personal) workerIds.add(personal.id);
    }

    if (userIds.size === 0 && workerIds.size === 0) {
      throw new ForbiddenException('缺少可识别的用户或机器人身份');
    }
    // 用户负责的机器人（workers.ownerUserId）也纳入「我的任务」范围：
    // 与工作台的 responsible 角色保持一致；单独记录，避免被误标为「执行方」。
    // 个人 AGENT 只承载「我的 AI」对话，不作为对外任务身份。
    const responsibleWorkerIds = new Set<number>();
    if (userIds.size > 0) {
      const owned = await this.workers.find({
        where: {
          ownerUserId: In([...userIds]),
          personalAgentUserId: IsNull(),
        },
        select: { id: true },
      });
      for (const worker of owned) {
        if (!workerIds.has(worker.id)) responsibleWorkerIds.add(worker.id);
      }
    }
    return {
      userIds: [...userIds],
      workerIds: [...workerIds],
      responsibleWorkerIds: [...responsibleWorkerIds],
      label: labels.filter(Boolean).join(' / ') || '当前 Agent',
    };
  }

  /** GET /api/tasks.md：我的任务清单 */
  async listMarkdown(
    scope: AgentTaskScope,
    params: AgentTaskQuery,
  ): Promise<string> {
    const where = this.whereOf(scope);
    let rows = await this.tasks.find({
      where,
      order: { updatedAt: 'DESC' },
      take: TASK_LIST_LIMIT,
    });
    const keyword = params.q?.trim().toLowerCase();
    if (keyword) {
      rows = rows.filter((task) =>
        `${task.code}\n${task.title}`.toLowerCase().includes(keyword),
      );
    }
    if (params.status) {
      rows = rows.filter((task) => task.status === params.status);
    }
    if (params.subStatus) {
      rows = rows.filter((task) => task.subStatus === params.subStatus);
    }
    if (params.type) {
      rows = rows.filter((task) => task.type === params.type);
    }
    if (params.rootOnly) {
      rows = rows.filter((task) => task.parentId === null);
    }

    const counts = new Map<string, number>();
    for (const task of rows) {
      counts.set(task.status, (counts.get(task.status) ?? 0) + 1);
    }
    const names = await this.namesOf(rows);
    const lines: string[] = [
      mdFrontmatter({
        title: '我的任务',
        description: `任务清单（${scope.label}）`,
      }),
      '# 我的任务',
      '',
      `身份：${scope.label}`,
      '',
      `统计：等待中 ${counts.get(TaskStatus.WAITING) ?? 0} 条 / 进行中 ${
        counts.get(TaskStatus.RUNNING) ?? 0
      } 条 / 已结束 ${counts.get(TaskStatus.FINISHED) ?? 0} 条（共 ${
        rows.length
      } 条，最多返回 ${TASK_LIST_LIMIT} 条）`,
      '',
      '| ID | 编号 | 标题 | 类型 | 状态 | 我的角色 | 执行机器人 | 需求方 | 更新时间 |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ];
    for (const task of rows) {
      lines.push(
        `| ${task.id} | ${cell(task.code)} | ${cell(task.title)} | ${cell(
          task.type,
        )} | ${cell(`${task.status}-${task.subStatus}`)} | ${cell(
          this.roleOf(scope, task),
        )} | ${cell(this.agentName(names, task))} | ${cell(
          this.requesterName(names, task),
        )} | ${cell(beijingTime(task.updatedAt))} |`,
      );
    }
    if (rows.length === 0) {
      lines.push('| — | — | 暂无任务 | — | — | — | — | — | — |');
    }
    lines.push(
      '',
      '## 相关接口',
      '',
      '- 任务详情：`GET /api/tasks/{id}.md`',
      '- 创建任务：`POST /api/tasks/create.md`',
      '- 接受 / 拒绝 / 提问 / 答复 / 验收 / 返工 / 失败等：见 `GET /api/tasks/defines.md` 与 `project-manage` 技能',
      '- 参数：`q`（编号/标题模糊搜索）、`status`、`subStatus`、`type`、`rootOnly=true`',
      '',
      '> 只返回当前身份作为需求方、执行方或负责方的任务；需要其它项目上下文时使用项目 / 文档 / 知识相关技能。',
      '',
    );
    return lines.join('\n');
  }

  /** GET /api/tasks/:id.md：任务详情 */
  async detailMarkdown(scope: AgentTaskScope, taskId: number): Promise<string> {
    const task = await this.tasksService.findOneDetail(taskId);
    if (!this.includes(scope, task)) {
      throw new ForbiddenException(
        '仅任务需求方、执行方或负责方可以读取该任务',
      );
    }
    const names = await this.namesOf([task]);
    const documents = await this.taskDocuments
      .listTaskDocuments(task)
      .catch(() => []);
    const directory = this.taskDocuments.taskDirectory(task);
    const children = task.children ?? [];
    const events = (task.events ?? []).slice(0, 20);
    const lines: string[] = [
      mdFrontmatter({
        title: `任务 ${task.code}`,
        description: task.title,
        update: task.updatedAt,
      }),
      `# ${task.code} ${task.title}`,
      '',
      `- 状态：${task.status}-${task.subStatus}`,
      `- 类型：${task.type}`,
      `- 任务定义：${task.templateName ?? '未设置'}`,
      `- 需求方：${this.requesterName(names, task)}`,
      `- 执行机器人：${this.agentName(names, task)}`,
      `- 我的角色：${this.roleOf(scope, task)}`,
      `- 创建时间：${beijingTime(task.createdAt)}`,
      `- 更新时间：${beijingTime(task.updatedAt)}`,
      task.assignedAt ? `- 分配时间：${beijingTime(task.assignedAt)}` : '',
      task.handoffPath
        ? `- 交付文档：[${task.handoffPath}](/api/tasks/${task.id}/handoff.md)（v${task.handoffVersion}${task.handoffSubmittedVersion ? `，已提交 v${task.handoffSubmittedVersion}` : ''}）`
        : `- 交付文档：尚未创建（首次写入使用 \`baseVersion=0\`，预定路径 \`${directory}/HANDOFF\`）`,
      `- 任务文档目录：\`${directory}\`（需求明确指定文档地址时以需求为准）`,
      '',
      '## 任务文档',
      '',
      `任务相关文档默认放在 \`${directory}\`：\`API.md\` 接口、\`TECH_DESIGN.md\` 技术方案、\`HANDOFF.md\` 交付、\`REVIEW.md\` 复盘（验收后平台生成）。`,
      '',
    ];
    if (documents.length === 0) {
      lines.push('（暂无其它文档）', '');
    } else {
      lines.push('| 文档 | 阅读地址 | 更新时间 |', '| --- | --- | --- |');
      for (const document of documents) {
        lines.push(
          `| ${document.name} | [/api${document.markdownUrl}](/api${document.markdownUrl}) | ${
            document.updatedAt ? beijingTime(document.updatedAt) : '-'
          } |`,
        );
      }
      lines.push('');
    }
    lines.push(
      '## 任务描述',
      '',
      body(task.description),
      '',
      '## 任务输入',
      '',
      body(task.input),
      '',
      '## 需求内容',
      '',
      body(task.content),
      '',
      '## 输出要求',
      '',
      body(task.outputSpec),
      '',
      '## 工作计划',
      '',
      body(task.workPlan),
      '',
    );
    if ((task.missingItems ?? []).length > 0) {
      lines.push('## 待反馈事项', '');
      for (const item of task.missingItems ?? []) {
        lines.push(`- ${item.item}${item.reason ? `：${item.reason}` : ''}`);
      }
      lines.push('');
    }
    if (children.length > 0) {
      lines.push('## 子任务', '');
      for (const child of children) {
        lines.push(
          `- #${child.id} ${child.code} ${child.title}（${child.status}-${child.subStatus}）`,
        );
      }
      lines.push('');
    }
    lines.push('## 最近事件', '');
    if (events.length === 0) {
      lines.push('（暂无事件）');
    } else {
      for (const event of events) {
        lines.push(
          `### ${event.type}${event.operator ? ` · ${event.operator}` : ''} · ${beijingTime(
            event.createdAt,
          )}`,
          '',
          event.content,
          '',
        );
      }
    }
    lines.push('## 交付结果', '', body(task.result), '');
    lines.push(
      '## 可用操作',
      '',
      '- 接受邀约：`POST /api/tasks/{id}/accept-task.md`',
      '- 拒绝邀约：`POST /api/tasks/{id}/refuse.md`',
      '- 提问：`POST /api/tasks/{id}/questions/ask.md`',
      '- 答复：`POST /api/tasks/{id}/questions/{questionId}/answer.md`',
      '- 交付文档：`GET /api/tasks/{id}/handoff.md`',
      '- 创建/更新交付文档：`POST /api/tasks/{id}/handoff/update.md`（body 带 `content` 与 `baseVersion`；首次创建用 0，之后按当前版本更新）',
      '- 任务文档目录：`GET /api/tasks/{id}/documents.md`',
      '- 写入任务文档：`POST /api/tasks/{id}/documents.md`（body 带 `name` 与 `content`，如 `TECH_DESIGN.md`）',
      '- 工单文档：`GET /api/tasks/{id}/ticket-documents.md`（任务属于工单时查看清单与调用示例）',
      '- 交付/更新/删除工单文档：`POST /api/tasks/{id}/ticket-documents.md` / `.../{documentId}/update.md` / `.../{documentId}/delete.md`',
      '- 申请验收：`POST /api/tasks/{id}/handoff/apply.md`',
      '- 验收通过：`POST /api/tasks/{id}/handoff/accept.md`',
      '- 验收返工：`POST /api/tasks/{id}/handoff/refuse.md`',
      '- 判定失败：`POST /api/tasks/{id}/fail.md`',
      '- 创建子任务：`POST /api/tasks/{id}/subtasks/create.md`',
      '',
      '> 先确认当前状态与自己的角色：只有需求方可验收/返工/判失败，只有执行方可接受/提问/申请验收。',
      '',
    );
    return lines.join('\n');
  }

  /** POST /api/tasks/create.md：个人 AGENT / 机器人 / 用户创建根任务 */
  async createMarkdown(
    req: AuthedRequest,
    input: AgentCreateTaskInput,
  ): Promise<string> {
    if (!input.description?.trim() && !input.title?.trim()) {
      throw new BadRequestException('标题或任务描述不能为空');
    }
    const identity = await this.createIdentity(req);
    const created = await this.tasksService.create({
      title: input.title?.trim() || undefined,
      type: input.type?.trim() || undefined,
      description: input.description?.trim() || null,
      input: input.input?.trim() || null,
      outputSpec: input.outputSpec?.trim() || null,
      templateId: input.templateId ?? null,
      ...identity,
    } satisfies CreateTaskInput);
    const requesterLabel =
      created.requesterType === 'worker' && created.requesterId
        ? ((
            await this.workers.findOne({
              where: { id: created.requesterId },
              select: { name: true },
            })
          )?.name ?? `机器人 #${created.requesterId}`)
        : `用户 #${created.requesterId}`;
    return [
      mdFrontmatter({
        title: '任务已创建',
        description: `${created.code} ${created.title}`,
      }),
      '# 任务已创建',
      '',
      `- ID：${created.id}`,
      `- 编号：${created.code}`,
      `- 标题：${created.title}`,
      `- 类型：${created.type}`,
      `- 状态：${created.status}-${created.subStatus}`,
      `- 需求方：${requesterLabel}`,
      '',
      '## 读取与跟进',
      '',
      `- 详情：\`GET /api/tasks/${created.id}.md\``,
      `- 网页：\`/tasks/${created.id}\``,
      '',
      '任务已进入「等待中-待分配」，平台会按任务定义自动分配机器人。',
      '需要补充信息时，可在任务详情中继续发送消息，或等待执行机器人提问。',
      '',
    ].join('\n');
  }

  /** 创建任务时的需求方身份映射 */
  private async createIdentity(
    req: AuthedRequest,
  ): Promise<
    Pick<
      CreateTaskInput,
      'createdById' | 'requesterType' | 'requesterId' | 'operatorName'
    >
  > {
    if (req.worker) {
      // 个人 AGENT 仅是用户的 AI 对话通道：对外需求方固定映射为其主人
      // 的真人机器人，个人 AGENT 不再写入任何任务身份字段。
      if (req.worker.personalAgentUserId) {
        return this.userIdentity(req.worker.personalAgentUserId, null);
      }
      const humanUserId = req.worker.humanUserId ?? null;
      return {
        createdById: humanUserId,
        requesterType: 'worker',
        requesterId: req.worker.id,
        operatorName: req.worker.name,
      };
    }
    if (!req.user) throw new ForbiddenException('缺少用户身份');
    return this.userIdentity(req.user.id, req.user.name ?? null);
  }

  /** 用户身份创建任务：需求方优先绑定真人机器人，没有时回退用户本人 */
  private async userIdentity(
    userId: number,
    operatorName: string | null,
  ): Promise<
    Pick<
      CreateTaskInput,
      'createdById' | 'requesterType' | 'requesterId' | 'operatorName'
    >
  > {
    const [human, user] = await Promise.all([
      this.workersService.findByHumanUserId(userId),
      this.users.findOne({
        where: { id: userId },
        select: { id: true, name: true },
      }),
    ]);
    return {
      createdById: userId,
      requesterType: human ? 'worker' : 'user',
      requesterId: human?.id ?? userId,
      operatorName: operatorName ?? user?.name ?? undefined,
    };
  }

  /** 任务查询条件（需求方或执行方） */
  private whereOf(scope: AgentTaskScope): FindOptionsWhere<Task>[] {
    const where: FindOptionsWhere<Task>[] = [];
    if (scope.workerIds.length > 0) {
      where.push({ agentId: In(scope.workerIds) });
      where.push({
        requesterType: 'worker',
        requesterId: In(scope.workerIds),
      });
    }
    if (scope.userIds.length > 0) {
      where.push({
        requesterType: 'user',
        requesterId: In(scope.userIds),
      });
      where.push({ ownerTakeoverUserId: In(scope.userIds) });
    }
    if (scope.responsibleWorkerIds.length > 0) {
      where.push({ agentId: In(scope.responsibleWorkerIds) });
    }
    return where;
  }

  /** 当前身份是否属于任务需求方/执行方 */
  private includes(scope: AgentTaskScope, task: Task): boolean {
    if (task.agentId && scope.workerIds.includes(task.agentId)) return true;
    if (task.agentId && scope.responsibleWorkerIds.includes(task.agentId)) {
      return true;
    }
    if (
      task.requesterType === 'worker' &&
      task.requesterId &&
      scope.workerIds.includes(task.requesterId)
    ) {
      return true;
    }
    if (
      task.requesterType === 'user' &&
      task.requesterId &&
      scope.userIds.includes(task.requesterId)
    ) {
      return true;
    }
    if (
      task.ownerTakeoverUserId &&
      scope.userIds.includes(task.ownerTakeoverUserId)
    ) {
      return true;
    }
    return Boolean(
      !task.requesterType &&
      task.createdById &&
      scope.userIds.includes(task.createdById),
    );
  }

  private roleOf(scope: AgentTaskScope, task: Task): string {
    const requester =
      (task.requesterType === 'worker' &&
        task.requesterId &&
        scope.workerIds.includes(task.requesterId)) ||
      (task.requesterType === 'user' &&
        task.requesterId &&
        scope.userIds.includes(task.requesterId)) ||
      (!task.requesterType &&
        task.createdById &&
        scope.userIds.includes(task.createdById));
    const executor = Boolean(
      task.agentId && scope.workerIds.includes(task.agentId),
    );
    const responsible = Boolean(
      (task.agentId && scope.responsibleWorkerIds.includes(task.agentId)) ||
      (task.ownerTakeoverUserId &&
        scope.userIds.includes(task.ownerTakeoverUserId)),
    );
    if (requester && executor) return '需求方/执行方';
    if (requester && responsible) return '需求方/负责方';
    if (requester) return '需求方';
    if (executor) return '执行方';
    if (responsible) return '负责方';
    return '—';
  }

  private async namesOf(tasks: Task[]): Promise<{
    workers: Map<number, string>;
    users: Map<number, string>;
  }> {
    const workerIds = new Set<number>();
    const userIds = new Set<number>();
    for (const task of tasks) {
      if (task.agentId) workerIds.add(task.agentId);
      if (task.requesterType === 'worker' && task.requesterId) {
        workerIds.add(task.requesterId);
      }
      if (task.requesterType === 'user' && task.requesterId) {
        userIds.add(task.requesterId);
      }
      if (task.createdById) userIds.add(task.createdById);
    }
    const workers = workerIds.size
      ? await this.workers.find({ where: { id: In([...workerIds]) } })
      : [];
    // 历史任务里的个人 AGENT 对外统一显示其主人姓名（个人 AGENT 不再作为任务身份）
    for (const worker of workers) {
      if (worker.personalAgentUserId) userIds.add(worker.personalAgentUserId);
    }
    const users = userIds.size
      ? await this.users.find({ where: { id: In([...userIds]) } })
      : [];
    const usersById = new Map(users.map((user) => [user.id, user.name]));
    const workersById = new Map<number, string>();
    for (const worker of workers) {
      if (worker.personalAgentUserId) {
        workersById.set(
          worker.id,
          usersById.get(worker.personalAgentUserId) ??
            worker.ownerName ??
            worker.name,
        );
        continue;
      }
      workersById.set(worker.id, worker.name);
    }
    return { workers: workersById, users: usersById };
  }

  private agentName(
    names: { workers: Map<number, string> },
    task: Task,
  ): string {
    return task.agentId
      ? (names.workers.get(task.agentId) ?? `#${task.agentId}`)
      : '未分配';
  }

  private requesterName(
    names: { workers: Map<number, string>; users: Map<number, string> },
    task: Task,
  ): string {
    if (task.requesterType === 'worker' && task.requesterId) {
      return (
        names.workers.get(task.requesterId) ?? `机器人 #${task.requesterId}`
      );
    }
    if (task.requesterType === 'user' && task.requesterId) {
      return names.users.get(task.requesterId) ?? `用户 #${task.requesterId}`;
    }
    if (task.createdById) {
      return names.users.get(task.createdById) ?? `用户 #${task.createdById}`;
    }
    return '—';
  }
}

/** Markdown 表格单元格：转义竖线并折叠换行 */
function cell(value: string | null | undefined): string {
  const text = (value ?? '—').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  return text.trim() || '—';
}

/** 正文占位 */
function body(value: string | null | undefined): string {
  const text = value?.trim();
  return text ? text : '（暂无）';
}
