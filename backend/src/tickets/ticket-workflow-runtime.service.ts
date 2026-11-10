import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Interval } from '@nestjs/schedule';
import { In, Not, Repository } from 'typeorm';
import type { User } from '../auth/user.entity';
import {
  TaskStatus,
  TaskSubStatus,
  TaskType,
  UserRole,
  WorkerRole,
  WorkerRuntime,
} from '../common/enums';
import { TaskTemplate } from '../tasks/task-template.entity';
import { Task } from '../tasks/task.entity';
import { TaskDispatchService } from '../tasks/task-dispatch.service';
import { TaskNotifyService } from '../tasks/task-notify.service';
import { TasksService } from '../tasks/tasks.service';
import { Worker } from '../workers/worker.entity';
import { LlmService } from '../model-config/llm.service';
import {
  WORKFLOW_END_NODE,
  type WorkflowConditionRule,
  type WorkflowDefinitionJson,
  type WorkflowEdgeDefinition,
  type WorkflowInputField,
  type WorkflowInputFieldType,
  type WorkflowNodeDefinition,
} from '../workflows/workflow.types';
import { WorkflowDefinitionVersion } from '../workflows/workflow-definition-version.entity';
import { WorkflowDefinition } from '../workflows/workflow-definition.entity';
import { TicketWorkflowRun } from './ticket-workflow-run.entity';
import { Ticket } from './ticket.entity';

export interface CreateWorkflowTicketInput {
  workflowDefinitionId: number;
  title?: string;
  inputValues: Record<string, unknown>;
}

export interface TicketWorkflowRunView extends TicketWorkflowRun {
  /** 节点任务当前主-子状态（无任务为空） */
  taskStatus: string | null;
}

export interface TicketWorkflowView {
  definitionId: number;
  definitionName: string;
  versionId: number;
  version: number;
  status: string;
  currentNodeKey: string | null;
  currentNodeName: string | null;
  autoAcceptance: boolean;
  inputValues: Record<string, unknown>;
  nodes: WorkflowNodeDefinition[];
  edges: WorkflowEdgeDefinition[];
  runs: TicketWorkflowRunView[];
}

const RUN_STATUS_WAITING = '等待中';
const RUN_STATUS_EXECUTING = '执行中';
const RUN_STATUS_WAIT_ACCEPT = '待人工验收';
const RUN_STATUS_COMPLETED = '已完成';
const RUN_STATUS_CANCELED = '已取消';

const TICKET_STATUS_PROCESSING = '处理中';
const TICKET_STATUS_WAIT_ACCEPT = '待验收';
const TICKET_STATUS_COMPLETED = '已完成';
const TICKET_STATUS_FAILED = '已失败';
const TICKET_STATUS_CANCELED = '已取消';

/** 单次流转链允许连续经过的判断节点上限，防止判断环导致死循环 */
const CONDITION_CHAIN_LIMIT = 50;

function outcomeForNode(kind: string, finished: Task): string {
  // 节点任务「失败」或「已拒绝」均视为当前节点失败：
  // 审批节点按驳回流转，操作节点按执行失败流转。
  if (
    finished.subStatus === TaskSubStatus.FAILED ||
    finished.subStatus === TaskSubStatus.REFUSED
  ) {
    return kind === 'approval' ? 'rejected' : 'failed';
  }
  return kind === 'approval' ? 'approved' : 'succeeded';
}

/** 数字字段相等比较：按数值而非字符串，兼容 1200 与 1200.0 */
function numericEquals(left: string, right: string): boolean {
  if (!left || !right) return false;
  const a = Number(left);
  const b = Number(right);
  return Number.isFinite(a) && Number.isFinite(b) && a === b;
}

/** 判断节点条件求值：inputValues 统一存字符串，按字段类型选择比较方式 */
function matchConditionRule(
  rule: WorkflowConditionRule,
  fieldType: WorkflowInputFieldType | null,
  values: Record<string, unknown>,
): boolean {
  const text = inputValueText(values[rule.field]).trim();
  const expected = (rule.value ?? '').trim();
  switch (rule.operator) {
    case 'empty':
      return !text;
    case 'notEmpty':
      return Boolean(text);
    case 'eq':
      if (fieldType === 'number') {
        return numericEquals(text, expected);
      }
      return text === expected;
    case 'ne':
      if (fieldType === 'number') {
        return !numericEquals(text, expected);
      }
      return text !== expected;
    case 'contains':
      return text.includes(expected);
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      // 空值不参与大小比较，避免可选字段被当成 0 或空串
      if (!text) return false;
      let compared: number;
      if (fieldType === 'number') {
        const left = Number(text);
        const right = Number(expected);
        if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
        compared = left - right;
      } else {
        // 日期按 YYYY-MM-DD 字典序等价于时间顺序
        compared = text.localeCompare(expected);
      }
      if (rule.operator === 'gt') return compared > 0;
      if (rule.operator === 'gte') return compared >= 0;
      if (rule.operator === 'lt') return compared < 0;
      return compared <= 0;
    }
    default:
      return false;
  }
}

function inputValueText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return value.toString();
  }
  return JSON.stringify(value);
}

export function renderInputValues(
  fields: WorkflowInputField[] | null,
  values: Record<string, unknown>,
): string {
  if (!fields?.length) return '（无结构化输入）';
  return [
    '| 字段 | 内容 |',
    '| --- | --- |',
    ...fields.map((field) => {
      const value = inputValueText(values[field.key]).trim();
      return `| ${field.label} | ${
        value ? value.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, '<br>') : '-'
      } |`;
    }),
  ].join('\n');
}

/**
 * 工单工作流运行时：
 * 创建工单固定发布版本，起始节点按字段校验输入；审批/操作节点创建任务中心任务，
 * 审批节点由负责机器人执行，操作节点按任务定义自动分配；判断节点不创建任务，
 * 进入后按起始输入字段的条件自动分发；节点任务通过后推进下一节点，
 * 验收节点仅工单发起机器人可操作（autoAccept 时直接通过）。
 */
@Injectable()
export class TicketWorkflowRuntimeService {
  private readonly logger = new Logger(TicketWorkflowRuntimeService.name);
  private readonly advancing = new Set<number>();
  /** 标题命名进行中的工单（进程内防重，异步任务失败不影响主流程） */
  private readonly titleNaming = new Set<number>();

  constructor(
    @InjectRepository(Ticket)
    private readonly tickets: Repository<Ticket>,
    @InjectRepository(TicketWorkflowRun)
    private readonly runs: Repository<TicketWorkflowRun>,
    @InjectRepository(WorkflowDefinition)
    private readonly definitions: Repository<WorkflowDefinition>,
    @InjectRepository(WorkflowDefinitionVersion)
    private readonly versions: Repository<WorkflowDefinitionVersion>,
    @InjectRepository(TaskTemplate)
    private readonly templates: Repository<TaskTemplate>,
    @InjectRepository(Task)
    private readonly tasks: Repository<Task>,
    @InjectRepository(Worker)
    private readonly workers: Repository<Worker>,
    private readonly tasksService: TasksService,
    private readonly dispatchService: TaskDispatchService,
    private readonly taskNotify: TaskNotifyService,
    private readonly llm: LlmService,
  ) {}

  /** 轮询节点任务终态；解耦任务中心，避免反向依赖工单模块 */
  @Interval(5_000)
  async pollNodeTasks(): Promise<void> {
    try {
      const activeRuns = await this.runs.find({
        where: [
          { status: RUN_STATUS_WAITING },
          { status: RUN_STATUS_EXECUTING },
        ],
      });
      for (const run of activeRuns) {
        if (!run.taskId) continue;
        if (this.advancing.has(run.ticketId)) continue;
        const task = await this.tasks.findOne({
          where: { id: run.taskId },
        });
        if (!task) {
          await this.failTicket(run.ticketId, `节点任务 #${run.taskId} 不存在`);
          continue;
        }
        if (task.status === TaskStatus.RUNNING) {
          if (run.status !== RUN_STATUS_EXECUTING) {
            await this.runs.update(run.id, { status: RUN_STATUS_EXECUTING });
          }
          continue;
        }
        if (
          task.status === TaskStatus.WAITING &&
          task.subStatus === TaskSubStatus.PENDING_ACCEPT
        ) {
          // 工单流程的节点验收由验收节点统一处理；节点任务通过即推进
          await this.tasksService.accept(task.id, '工单流程节点自动通过');
          const completed = await this.tasks.findOne({
            where: { id: task.id },
          });
          if (completed?.status === TaskStatus.FINISHED) {
            await this.completeRunAndAdvance(run, completed);
          }
          continue;
        }
        if (task.status !== TaskStatus.FINISHED) continue;
        if (task.subStatus === TaskSubStatus.COMPLETED) {
          await this.completeRunAndAdvance(run, task);
        } else if (task.subStatus === TaskSubStatus.CANCELED) {
          await this.runs.update(run.id, {
            status: RUN_STATUS_CANCELED,
            finishedAt: new Date(),
          });
          await this.updateTicket(run.ticketId, {
            workflowStatus: TICKET_STATUS_CANCELED,
          });
        } else {
          await this.completeRunWithOutcome(
            run,
            task,
            outcomeForNode(run.nodeKind, task),
          );
        }
      }
    } catch (error) {
      this.logger.warn(`工单工作流轮询失败: ${(error as Error).message}`);
    }
  }

  async create(input: CreateWorkflowTicketInput, user: User): Promise<Ticket> {
    const definition = await this.definitions.findOne({
      where: { id: Number(input.workflowDefinitionId), enabled: true },
    });
    if (!definition) throw new NotFoundException('工单配置不存在或已停用');
    if (!definition.latestPublishedVersion) {
      throw new BadRequestException('该工单配置还没有发布版本，暂不能创建工单');
    }
    const version = await this.versions.findOne({
      where: {
        definitionId: definition.id,
        version: definition.latestPublishedVersion,
      },
    });
    if (!version) throw new NotFoundException('工单发布版本不存在');
    const workflow = version.definition;
    const start = workflow.nodes.find((node) => node.kind === 'start');
    const initiator = await this.workers.findOne({
      where: { humanUserId: user.id },
      select: { id: true, name: true, enabled: true },
    });
    if (!initiator) {
      throw new BadRequestException('当前用户没有绑定真人机器人，不能发起工单');
    }
    if (!initiator.enabled) {
      throw new BadRequestException('发起机器人已停用');
    }
    const inputValues = this.normalizeInputValues(
      start?.inputFields ?? [],
      input.inputValues ?? {},
    );
    const providedTitle = String(input.title ?? '').trim();
    const firstKey = Object.keys(inputValues)[0] ?? '';
    const title =
      providedTitle ||
      inputValueText(inputValues.title).trim() ||
      inputValueText(inputValues[firstKey]).trim() ||
      `新${definition.name}`;
    if (!title) throw new BadRequestException('工单标题不能为空');

    const ticket = await this.tickets.save(
      this.tickets.create({
        code: `TMP-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
        category: definition.category || definition.name.slice(0, 64),
        title,
        description: inputValueText(inputValues.description).trim() || null,
        createdById: user.id,
        createdByName: user.name,
        assigneeType: 'worker',
        assigneeId: initiator.id,
        assigneeName: initiator.name,
        taskId: null,
        workflowDefinitionId: definition.id,
        workflowVersionId: version.id,
        workflowVersion: version.version,
        initiatorWorkerId: initiator.id,
        initiatorWorkerName: initiator.name,
        inputValues,
        workflowStatus: TICKET_STATUS_PROCESSING,
        currentNodeKey: start?.key ?? null,
        currentNodeName: start?.name ?? null,
      }),
    );
    ticket.code = `WO-${String(ticket.id).padStart(4, '0')}`;
    const saved = await this.tickets.save(ticket);
    try {
      await this.enterNode(saved, workflow, start?.key ?? null);
    } catch (error) {
      await this.tickets.delete(saved.id);
      throw error;
    }
    // 标题命名异步执行：不阻塞创建返回与节点派发，失败只告警
    this.scheduleTitleNaming(saved);
    return this.mustFind(saved.id);
  }

  /**
   * 后台生成工单标题：「T-{id}」+ 模型生成的简洁标题。
   * 未配置模型场景时直接跳过；期间标题被人工修改（乐观条件不命中）则不覆盖。
   */
  private scheduleTitleNaming(ticket: Ticket): void {
    if (!ticket.id || this.titleNaming.has(ticket.id)) return;
    this.titleNaming.add(ticket.id);
    void this.generateTitle(ticket)
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`工单 ${ticket.code} 标题生成失败：${message}`);
      })
      .finally(() => this.titleNaming.delete(ticket.id));
  }

  private async generateTitle(ticket: Ticket): Promise<void> {
    const material = [
      ticket.category ? `工单类型：${ticket.category}` : '',
      `当前标题：${ticket.title}`,
      ticket.description ? `工单描述：${ticket.description}` : '',
      ticket.inputValues
        ? `结构化输入：${inputValueText(ticket.inputValues)}`
        : '',
    ]
      .filter(Boolean)
      .join('\n');
    const generated = await this.llm.generateTitle(material.slice(0, 4000));
    if (!generated) return;
    const title = `「T-${ticket.id}」${generated}`.slice(0, 200);
    const result = await this.tickets
      .createQueryBuilder()
      .update(Ticket)
      .set({ title })
      .where('id = :id AND title = :original', {
        id: ticket.id,
        original: ticket.title,
      })
      .execute();
    if (result.affected) {
      this.logger.log(`工单 ${ticket.code} 标题已生成：${title}`);
    }
  }

  /**
   * 机器人拒绝当前节点（当前节点操作失败）：
   * 仅当前节点的处理机器人可用，nodeKey 必须与工单当前节点一致；
   * 节点任务置为失败后按工作流「failed/rejected」流转推进（无流转则工单失败）。
   */
  async rejectNodeByWorker(
    ticketId: number,
    worker: Worker,
    nodeKey: string,
    reason: string,
  ): Promise<{
    ticket: Ticket;
    node: WorkflowNodeDefinition;
    task: Task;
    outcome: string;
  }> {
    const ticket = await this.mustFind(ticketId);
    if (!ticket.workflowDefinitionId) {
      throw new BadRequestException('历史工单不支持工作流节点拒绝');
    }
    const key = String(nodeKey ?? '').trim();
    if (!key) throw new BadRequestException('nodeKey 不能为空');
    if (!ticket.currentNodeKey || ticket.currentNodeKey !== key) {
      throw new BadRequestException(
        `nodeKey 与工单当前节点不一致（当前：${
          ticket.currentNodeKey ?? '流程已结束'
        }）`,
      );
    }
    const workflow = await this.workflowOf(ticket);
    const node = workflow.nodes.find((item) => item.key === key);
    if (!node) throw new BadRequestException('当前节点在工作流中不存在');
    if (node.kind !== 'operation' && node.kind !== 'approval') {
      throw new BadRequestException(
        `当前节点类型「${node.kind}」不产生节点任务，无需拒绝`,
      );
    }
    const run = await this.currentRun(ticket.id, key);
    if (!run || !run.taskId) {
      throw new BadRequestException('当前节点没有节点任务，无需拒绝');
    }
    if (
      run.status !== RUN_STATUS_WAITING &&
      run.status !== RUN_STATUS_EXECUTING
    ) {
      throw new BadRequestException(
        `当前节点运行状态「${run.status}」不可拒绝`,
      );
    }
    if (run.agentId !== worker.id) {
      throw new ForbiddenException('仅当前节点的处理机器人可以拒绝');
    }
    const text = String(reason ?? '').trim();
    if (!text) throw new BadRequestException('拒绝原因 reason 不能为空');
    const task = await this.tasks.findOne({ where: { id: run.taskId } });
    if (!task) {
      await this.failTicket(ticket.id, `节点任务 #${run.taskId} 不存在`);
      throw new BadRequestException('节点任务不存在，工单已失败');
    }
    if (task.status === TaskStatus.FINISHED) {
      throw new BadRequestException('节点任务已结束，不能拒绝');
    }
    const previousStatus = `${task.status}-${task.subStatus}`;
    const updated = await this.tasks.update(
      { id: task.id, status: Not(TaskStatus.FINISHED) },
      {
        status: TaskStatus.FINISHED,
        subStatus: TaskSubStatus.FAILED,
        failedAt: new Date(),
        failedBy: worker.name,
        failureReason: text,
      },
    );
    if (!updated.affected) {
      throw new BadRequestException('节点任务已结束，不能拒绝');
    }
    const failedTask = await this.tasks.findOne({ where: { id: task.id } });
    await this.tasksService.addEvent(
      task.id,
      '状态变更',
      `状态变更：${previousStatus} → 已结束-失败（${worker.name} 拒绝节点「${node.name}」：${text}）`,
      worker.name,
      {
        ticketId: ticket.id,
        ticketCode: ticket.code,
        nodeKey: node.key,
        nodeKind: node.kind,
        reason: text,
      },
    );
    const outcome = outcomeForNode(node.kind, failedTask ?? task);
    await this.completeRunWithOutcome(run, failedTask ?? task, outcome);
    return {
      ticket: await this.mustFind(ticketId),
      node,
      task: failedTask ?? task,
      outcome,
    };
  }

  /**
   * 当前审批节点直接通过：工单发起人、当前审批节点的真人处理人或管理员可用。
   * 不发起交付申请，不生成 HANDOFF/REVIEW，直接完成任务并按 approved 推进。
   * remark 为可选审批意见，记录到任务产出与事件。
   */
  async approveNodeByUser(
    ticketId: number,
    user: User,
    remark?: string,
  ): Promise<Ticket> {
    const ticket = await this.mustFind(ticketId);
    if (!ticket.workflowDefinitionId) {
      throw new BadRequestException('历史工单不支持工作流节点审批');
    }
    const workflow = await this.workflowOf(ticket);
    const node = workflow.nodes.find(
      (item) => item.key === ticket.currentNodeKey,
    );
    if (!node) {
      throw new BadRequestException('工单流程已结束，没有可审批的当前节点');
    }
    if (node.kind !== 'approval') {
      throw new BadRequestException('当前节点不是审批节点');
    }
    const run = await this.currentRun(ticket.id, node.key);
    if (!run || !run.taskId) {
      throw new BadRequestException('当前审批节点没有节点任务');
    }
    if (
      run.status !== RUN_STATUS_WAITING &&
      run.status !== RUN_STATUS_EXECUTING
    ) {
      throw new BadRequestException(
        `当前节点运行状态「${run.status}」不可审批`,
      );
    }
    const humanWorker = await this.workers.findOne({
      where: { humanUserId: user.id },
      select: { id: true },
    });
    const isAssignedHuman = Boolean(
      humanWorker && run.agentId === humanWorker.id,
    );
    const isInitiator = ticket.createdById === user.id;
    const isAdmin = user.role === UserRole.ADMIN;
    if (!isAssignedHuman && !isInitiator && !isAdmin) {
      throw new ForbiddenException(
        '仅工单发起人、当前审批处理人或管理员可以审批',
      );
    }
    const task = await this.tasks.findOne({ where: { id: run.taskId } });
    if (!task) {
      await this.failTicket(ticket.id, `节点任务 #${run.taskId} 不存在`);
      throw new BadRequestException('节点任务不存在，工单已失败');
    }
    if (task.status === TaskStatus.FINISHED) {
      throw new BadRequestException('节点任务已结束，不能重复审批');
    }
    const previousStatus = `${task.status}-${task.subStatus}`;
    const now = new Date();
    const approvalRemark = remark?.trim() || null;
    const updated = await this.tasks.update(
      { id: task.id, status: Not(TaskStatus.FINISHED) },
      {
        status: TaskStatus.FINISHED,
        subStatus: TaskSubStatus.COMPLETED,
        acceptedAt: now,
        acceptedBy: user.name,
        deliveredAt: now,
        missingItems: null,
        resumePrompt: null,
        ...(approvalRemark ? { result: approvalRemark } : {}),
      },
    );
    if (!updated.affected) {
      throw new BadRequestException('节点任务已结束，不能重复审批');
    }
    const completed = await this.tasks.findOne({ where: { id: task.id } });
    await this.tasksService.addEvent(
      task.id,
      '状态变更',
      `状态变更：${previousStatus} → 已结束-完成（${user.name} 审批通过节点「${node.name}」${
        approvalRemark ? `，意见：${approvalRemark}` : ''
      }）`,
      user.name,
      {
        ticketId: ticket.id,
        ticketCode: ticket.code,
        nodeKey: node.key,
        nodeKind: node.kind,
        approval: true,
        ...(approvalRemark ? { remark: approvalRemark } : {}),
      },
    );
    await this.completeRunWithOutcome(run, completed ?? task, 'approved');
    return this.mustFind(ticketId);
  }

  /**
   * 当前审批节点驳回：工单发起人、当前审批节点的真人处理人或管理员可用。
   * reason 为必填驳回意见；节点任务置为失败并按 rejected 推进工作流
   * （与机器人职责内的节点拒绝保持一致）。
   */
  async rejectNodeByUser(
    ticketId: number,
    user: User,
    reason: string,
  ): Promise<Ticket> {
    const ticket = await this.mustFind(ticketId);
    if (!ticket.workflowDefinitionId) {
      throw new BadRequestException('历史工单不支持工作流节点审批');
    }
    const workflow = await this.workflowOf(ticket);
    const node = workflow.nodes.find(
      (item) => item.key === ticket.currentNodeKey,
    );
    if (!node) {
      throw new BadRequestException('工单流程已结束，没有可驳回的当前节点');
    }
    if (node.kind !== 'approval') {
      throw new BadRequestException('当前节点不是审批节点');
    }
    const run = await this.currentRun(ticket.id, node.key);
    if (!run || !run.taskId) {
      throw new BadRequestException('当前审批节点没有节点任务');
    }
    if (
      run.status !== RUN_STATUS_WAITING &&
      run.status !== RUN_STATUS_EXECUTING
    ) {
      throw new BadRequestException(
        `当前节点运行状态「${run.status}」不可驳回`,
      );
    }
    const humanWorker = await this.workers.findOne({
      where: { humanUserId: user.id },
      select: { id: true },
    });
    const isAssignedHuman = Boolean(
      humanWorker && run.agentId === humanWorker.id,
    );
    const isInitiator = ticket.createdById === user.id;
    const isAdmin = user.role === UserRole.ADMIN;
    if (!isAssignedHuman && !isInitiator && !isAdmin) {
      throw new ForbiddenException(
        '仅工单发起人、当前审批处理人或管理员可以驳回',
      );
    }
    const text = String(reason ?? '').trim();
    if (!text) throw new BadRequestException('驳回意见不能为空');
    const task = await this.tasks.findOne({ where: { id: run.taskId } });
    if (!task) {
      await this.failTicket(ticket.id, `节点任务 #${run.taskId} 不存在`);
      throw new BadRequestException('节点任务不存在，工单已失败');
    }
    if (task.status === TaskStatus.FINISHED) {
      throw new BadRequestException('节点任务已结束，不能重复审批');
    }
    const previousStatus = `${task.status}-${task.subStatus}`;
    const updated = await this.tasks.update(
      { id: task.id, status: Not(TaskStatus.FINISHED) },
      {
        status: TaskStatus.FINISHED,
        subStatus: TaskSubStatus.FAILED,
        failedAt: new Date(),
        failedBy: user.name,
        failureReason: text,
        missingItems: null,
        resumePrompt: null,
        result: text,
      },
    );
    if (!updated.affected) {
      throw new BadRequestException('节点任务已结束，不能重复审批');
    }
    const failedTask = await this.tasks.findOne({ where: { id: task.id } });
    await this.tasksService.addEvent(
      task.id,
      '状态变更',
      `状态变更：${previousStatus} → 已结束-失败（${user.name} 驳回节点「${node.name}」：${text}）`,
      user.name,
      {
        ticketId: ticket.id,
        ticketCode: ticket.code,
        nodeKey: node.key,
        nodeKind: node.kind,
        rejected: true,
        remark: text,
      },
    );
    await this.completeRunWithOutcome(run, failedTask ?? task, 'rejected');
    return this.mustFind(ticketId);
  }

  /** 验收节点人工操作；仅发起机器人（或其绑定用户）可用 */
  async acceptNode(
    ticketId: number,
    outcome: 'approved' | 'rejected',
    actor: { user?: User | null; worker?: { id: number; name: string } | null },
    remark?: string,
  ): Promise<Ticket> {
    void remark;
    const ticket = await this.mustFind(ticketId);
    if (!ticket.workflowDefinitionId) {
      throw new BadRequestException('历史工单不支持工作流验收操作');
    }
    if (ticket.workflowStatus !== TICKET_STATUS_WAIT_ACCEPT) {
      throw new BadRequestException(
        `工单当前状态「${ticket.workflowStatus}」不可验收`,
      );
    }
    const initiatorId = ticket.initiatorWorkerId;
    const byUser = actor.user
      ? await this.workers.findOne({
          where: { humanUserId: actor.user.id },
          select: { id: true },
        })
      : null;
    const isInitiator =
      (byUser && byUser.id === initiatorId) ||
      (actor.worker && actor.worker.id === initiatorId);
    if (!isInitiator) {
      throw new ForbiddenException('工单只能由发起机器人验收');
    }
    const workflow = await this.workflowOf(ticket);
    const current = workflow.nodes.find(
      (node) => node.key === ticket.currentNodeKey,
    );
    if (!current || current.kind !== 'acceptance') {
      throw new BadRequestException('当前节点不是验收节点');
    }
    if (current.autoAccept) {
      throw new BadRequestException('该工单已开启自动验收，无需人工操作');
    }
    const run = await this.currentRun(ticket.id, current.key);
    if (!run || run.status !== RUN_STATUS_WAIT_ACCEPT) {
      throw new BadRequestException('验收节点不在待人工验收状态');
    }
    await this.runs.update(run.id, {
      status: RUN_STATUS_COMPLETED,
      outcome,
      finishedAt: new Date(),
    });
    if (outcome === 'approved') {
      await this.updateTicket(ticket.id, {
        workflowStatus: TICKET_STATUS_COMPLETED,
        currentNodeKey: null,
        currentNodeName: null,
      });
      return this.mustFind(ticket.id);
    }
    await this.advance(ticket.id, workflow, current.key, outcome);
    return this.mustFind(ticket.id);
  }

  async workflowView(ticket: Ticket): Promise<TicketWorkflowView | null> {
    if (!ticket.workflowVersionId) return null;
    const version = await this.versions.findOne({
      where: { id: ticket.workflowVersionId },
    });
    if (!version) return null;
    const definition = await this.definitions.findOne({
      where: { id: ticket.workflowDefinitionId ?? 0 },
    });
    const workflow = version.definition;
    const runRows = await this.runs.find({
      where: { ticketId: ticket.id },
      order: { id: 'ASC' },
    });
    const taskIds = runRows
      .map((run) => run.taskId)
      .filter((id): id is number => Boolean(id));
    const taskRows = taskIds.length
      ? await this.tasks.find({
          where: { id: In(taskIds) },
          select: { id: true, status: true, subStatus: true },
        })
      : [];
    const taskById = new Map(taskRows.map((task) => [task.id, task]));
    const hasAutoAcceptance = workflow.nodes.some(
      (node) => node.kind === 'acceptance' && node.autoAccept,
    );
    return {
      definitionId: ticket.workflowDefinitionId ?? 0,
      definitionName: definition?.name ?? version.name,
      versionId: version.id,
      version: version.version,
      status: ticket.workflowStatus ?? TICKET_STATUS_PROCESSING,
      currentNodeKey: ticket.currentNodeKey,
      currentNodeName: ticket.currentNodeName,
      autoAcceptance: hasAutoAcceptance,
      inputValues: ticket.inputValues ?? {},
      nodes: workflow.nodes,
      edges: workflow.edges,
      runs: runRows.map((run) => {
        const task = run.taskId ? taskById.get(run.taskId) : null;
        return {
          ...run,
          taskStatus: task ? `${task.status}-${task.subStatus}` : null,
        };
      }),
    };
  }

  private async enterNode(
    ticket: Ticket,
    workflow: WorkflowDefinitionJson,
    nodeKey: string | null,
    depth = 0,
  ): Promise<void> {
    const node = workflow.nodes.find((item) => item.key === nodeKey);
    if (!node) {
      await this.failTicket(ticket.id, `节点「${nodeKey ?? '未知'}」不存在`);
      return;
    }
    await this.updateTicket(ticket.id, {
      workflowStatus:
        node.kind === 'acceptance'
          ? node.autoAccept
            ? TICKET_STATUS_PROCESSING
            : TICKET_STATUS_WAIT_ACCEPT
          : TICKET_STATUS_PROCESSING,
      currentNodeKey: node.key,
      currentNodeName: node.name,
    });
    if (node.kind === 'start') {
      await this.recordSimpleRun(ticket.id, node, RUN_STATUS_COMPLETED);
      await this.advance(ticket.id, workflow, node.key, null);
      return;
    }
    if (node.kind === 'condition') {
      await this.recordSimpleRun(ticket.id, node, RUN_STATUS_COMPLETED);
      await this.advanceConditionNode(ticket, workflow, node, depth);
      return;
    }
    if (node.kind === 'acceptance') {
      if (node.autoAccept) {
        await this.recordSimpleRun(
          ticket.id,
          node,
          RUN_STATUS_COMPLETED,
          'approved',
        );
        await this.updateTicket(ticket.id, {
          workflowStatus: TICKET_STATUS_COMPLETED,
          currentNodeKey: null,
          currentNodeName: null,
        });
        return;
      }
      await this.recordSimpleRun(ticket.id, node, RUN_STATUS_WAIT_ACCEPT);
      return;
    }
    await this.createNodeTask(ticket, workflow, node);
  }

  /**
   * 判断节点：按出边顺序评估条件，命中第一条即流转；全部不命中走默认（无条件）分支。
   * depth 限制单次流转链上连续判断节点的数量，避免判断环造成死循环。
   */
  private async advanceConditionNode(
    ticket: Ticket,
    workflow: WorkflowDefinitionJson,
    node: WorkflowNodeDefinition,
    depth: number,
  ): Promise<void> {
    if (depth >= CONDITION_CHAIN_LIMIT) {
      await this.failTicket(
        ticket.id,
        `判断节点连续流转超过 ${CONDITION_CHAIN_LIMIT} 次，请检查流转条件是否存在循环`,
      );
      return;
    }
    const outgoing = workflow.edges.filter((edge) => edge.from === node.key);
    const fieldTypes = new Map<string, WorkflowInputFieldType>(
      (
        workflow.nodes.find((item) => item.kind === 'start')?.inputFields ?? []
      ).map((field) => [field.key, field.type]),
    );
    const values = ticket.inputValues ?? {};
    const matched =
      outgoing.find(
        (edge) =>
          Boolean(edge.conditions?.length) &&
          (edge.conditions ?? []).every((rule) =>
            matchConditionRule(
              rule,
              fieldTypes.get(rule.field) ?? null,
              values,
            ),
          ),
      ) ?? outgoing.find((edge) => !edge.conditions?.length);
    if (!matched) {
      await this.failTicket(
        ticket.id,
        `判断节点「${node.name}」没有命中任何分支，且未配置默认流转`,
      );
      return;
    }
    this.logger.log(
      `工单 #${ticket.id} 判断节点「${node.name}」命中分支「${
        matched.label ?? matched.to
      }」`,
    );
    if (matched.to === WORKFLOW_END_NODE) {
      await this.updateTicket(ticket.id, {
        workflowStatus: TICKET_STATUS_COMPLETED,
        currentNodeKey: null,
        currentNodeName: null,
      });
      return;
    }
    await this.enterNode(ticket, workflow, matched.to, depth + 1);
  }

  private async createNodeTask(
    ticket: Ticket,
    workflow: WorkflowDefinitionJson,
    node: WorkflowNodeDefinition,
  ): Promise<void> {
    if (!node.taskTemplateId) {
      await this.failTicket(ticket.id, `节点「${node.name}」未配置任务定义`);
      return;
    }
    const template = await this.templates.findOne({
      where: { id: node.taskTemplateId },
    });
    if (!template) {
      await this.failTicket(ticket.id, `节点「${node.name}」的任务定义不存在`);
      return;
    }
    let agent: Worker | null = null;
    if (node.kind === 'approval') {
      if (!node.responsibleWorkerId) {
        await this.failTicket(
          ticket.id,
          `节点「${node.name}」未配置负责机器人`,
        );
        return;
      }
      agent = await this.enabledWorker(node.responsibleWorkerId);
    } else {
      agent = await this.pickEnabledAgent(template.agentIds ?? []);
    }
    if (!agent) {
      await this.failTicket(
        ticket.id,
        `节点「${node.name}」没有可用的处理机器人（任务定义：${template.name}）`,
      );
      return;
    }
    const attempt =
      (await this.runs.count({
        where: { ticketId: ticket.id, nodeKey: node.key },
      })) + 1;
    const run = await this.runs.save(
      this.runs.create({
        ticketId: ticket.id,
        nodeKey: node.key,
        nodeName: node.name,
        nodeKind: node.kind,
        attempt,
        taskTemplateId: template.id,
        taskTemplateName: template.name,
        agentId: agent.id,
        agentName: agent.name,
        status: RUN_STATUS_WAITING,
        startedAt: new Date(),
      }),
    );
    const outputSpec =
      node.kind === 'approval'
        ? '完成节点审批：通过后结束任务；如需驳回，请将任务判定失败并说明驳回原因。'
        : '完成节点操作后申请验收；节点结果会自动推进工单工作流。';
    const description = [
      `# 工单节点：${node.name}`,
      '',
      `- 工单：${ticket.code} ${ticket.title}（ID=${ticket.id}）`,
      `- 节点类型：${node.kind === 'approval' ? '审批' : '操作'}`,
      `- 处理机器人：${agent.name}`,
      '',
      node.description?.trim() ? `## 节点说明\n\n${node.description}` : '',
      '',
      '## 工单文档',
      '',
      '本任务属于上述工单。查看、交付、更新或删除工单文档：`GET /api/tasks/{当前任务ID}/ticket-documents.md`（清单中附带调用示例）。',
      '任务自身文档使用 `GET /api/tasks/{当前任务ID}/documents.md` 查看；链接形态保留引用，正文形态保存独立副本。',
      '',
      '## 工单输入',
      '',
      renderInputValues(
        workflow.nodes.find((item) => item.kind === 'start')?.inputFields ?? [],
        ticket.inputValues ?? {},
      ),
      '',
      ticket.description?.trim() ? `## 工单描述\n\n${ticket.description}` : '',
    ]
      .filter((section) => section !== '')
      .join('\n');
    const task = await this.tasksService.create({
      title: `${ticket.code} ${node.name}`,
      description,
      outputSpec,
      type: node.kind === 'approval' ? TaskType.APPROVAL : TaskType.NORMAL,
      templateId: template.id,
      agentId: agent.id,
      createdById: ticket.createdById,
      requesterType: 'worker',
      requesterId: ticket.initiatorWorkerId,
      operatorName: '工单工作流',
    });
    // 直接进入待接受：审批任务默认接受（不存在不接受），其余由任务中心两阶段邀约执行
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
        `状态变更：等待中-待分配 → 等待中-待接受（工单节点「${node.name}」，机器人：${agent.name}）`,
        null,
        { ticketId: ticket.id, ticketCode: ticket.code, nodeKey: node.key },
      );
      if (task.type === TaskType.APPROVAL) {
        await this.autoAcceptApprovalNodeTask(task, agent, node, ticket);
      }
    }
    await this.runs.update(run.id, { taskId: task.id });
    await this.updateTicket(ticket.id, {
      currentNodeKey: node.key,
      currentNodeName: node.name,
      workflowStatus: TICKET_STATUS_PROCESSING,
    });
  }

  /**
   * 审批任务默认接受：不存在不接受的情况。
   * - 真人处理人：自动接受后等待通过/驳回，并异步发送飞书审批卡片；
   * - AI 处理人：自动接受后直接派发执行（跳过邀约问答）；
   * - 执行容量不足时保持待接受，由 LOOP 按节流自动接受重试。
   */
  private async autoAcceptApprovalNodeTask(
    task: Task,
    agent: Worker,
    node: WorkflowNodeDefinition,
    ticket: Ticket,
  ): Promise<void> {
    const claimed = await this.dispatchService
      .claimExecution(task.id, TaskSubStatus.PENDING_ACCEPTANCE, {
        nullIfStateChanged: true,
      })
      .catch((error: Error) => {
        this.logger.warn(
          `审批任务 ${task.code} 自动接受失败: ${error.message}`,
        );
        return null;
      });
    if (!claimed) return;
    await this.tasksService.addEvent(
      task.id,
      '状态变更',
      '状态变更：等待中-待接受 → 进行中-执行中（审批任务默认接受）',
      '工单工作流',
      {
        ticketId: ticket.id,
        ticketCode: ticket.code,
        nodeKey: node.key,
        nodeKind: node.kind,
        approval: true,
      },
    );
    if (agent.runtime === WorkerRuntime.HUMAN) {
      // 工单创建请求内不阻塞：通知失败只告警，审批仍可在页面完成
      void this.notifyApprovalAssignee(task, node, ticket).catch(
        (error: Error) => {
          this.logger.warn(
            `审批任务 ${task.code} 飞书通知失败: ${error.message}`,
          );
        },
      );
      return;
    }
    // AI 处理人：直接派发执行；失败退回待接受，由 LOOP 自动接受重试
    try {
      await this.dispatchService.dispatch(task.id, null);
    } catch (error) {
      const message = (error as Error).message;
      await this.tasks.update(
        {
          id: task.id,
          status: TaskStatus.RUNNING,
          subStatus: TaskSubStatus.EXECUTING,
        },
        {
          status: TaskStatus.WAITING,
          subStatus: TaskSubStatus.PENDING_ACCEPTANCE,
          offerAttemptAt: new Date(),
        },
      );
      await this.tasksService.addEvent(
        task.id,
        '系统',
        `审批任务派发失败，将自动重试：${message}`,
        null,
        { watchdog: true, reason: 'approval-dispatch-retry' },
      );
    }
  }

  /** 审批任务飞书卡片：工单链接、关键正文与通过/驳回/查看按钮 */
  private async notifyApprovalAssignee(
    task: Task,
    node: WorkflowNodeDefinition,
    ticket: Ticket,
  ): Promise<void> {
    const workflow = await this.workflowOf(ticket);
    const startFields =
      workflow.nodes.find((item) => item.kind === 'start')?.inputFields ?? [];
    const summaryLines = startFields.map((field) => {
      const value = inputValueText(ticket.inputValues?.[field.key]).trim();
      return `- ${field.label}：${
        value ? value.replace(/\s*\n\s*/g, ' ') : '-'
      }`;
    });
    await this.taskNotify.notifyApprovalTask({
      task,
      ticket: { id: ticket.id, code: ticket.code, title: ticket.title },
      nodeName: node.name,
      summaryLines,
      initiatorName: ticket.createdByName ?? null,
    });
  }

  private async completeRunAndAdvance(
    run: TicketWorkflowRun,
    task: Task,
  ): Promise<void> {
    await this.completeRunWithOutcome(
      run,
      task,
      outcomeForNode(run.nodeKind, task),
    );
  }

  private async completeRunWithOutcome(
    run: TicketWorkflowRun,
    task: Task,
    outcome: string,
  ): Promise<void> {
    if (this.advancing.has(run.ticketId)) return;
    this.advancing.add(run.ticketId);
    try {
      await this.runs.update(run.id, {
        status: RUN_STATUS_COMPLETED,
        outcome,
        finishedAt: new Date(),
      });
      const ticket = await this.mustFind(run.ticketId);
      const workflow = await this.workflowOf(ticket);
      await this.advance(ticket.id, workflow, run.nodeKey, outcome);
    } catch (error) {
      this.logger.warn(
        `工单 #${run.ticketId} 节点「${run.nodeKey}」推进失败: ${(error as Error).message}`,
      );
      await this.failTicket(run.ticketId, (error as Error).message);
    } finally {
      this.advancing.delete(run.ticketId);
    }
  }

  private async advance(
    ticketId: number,
    workflow: WorkflowDefinitionJson,
    fromKey: string,
    outcome: string | null,
  ): Promise<void> {
    const candidates = workflow.edges.filter(
      (edge) => edge.from === fromKey && edge.outcome === outcome,
    );
    if (!candidates.length) {
      await this.failTicket(
        ticketId,
        `节点「${fromKey}」没有结果「${outcome ?? '无条件'}」的流转`,
      );
      return;
    }
    const edge = candidates[0];
    if (edge.to === WORKFLOW_END_NODE) {
      // 审批驳回或操作失败直接结束流程；其余终局流转都视为工单完成
      const failed = edge.outcome === 'failed' || edge.outcome === 'rejected';
      await this.updateTicket(ticketId, {
        workflowStatus: failed ? TICKET_STATUS_FAILED : TICKET_STATUS_COMPLETED,
        currentNodeKey: null,
        currentNodeName: null,
      });
      return;
    }
    const ticket = await this.mustFind(ticketId);
    await this.enterNode(ticket, workflow, edge.to);
  }

  private normalizeInputValues(
    fields: WorkflowInputField[],
    input: Record<string, unknown>,
  ): Record<string, unknown> {
    const values: Record<string, unknown> = {};
    for (const field of fields) {
      const raw = input[field.key];
      const value = inputValueText(raw).trim();
      if (!value) {
        if (field.required && !field.defaultValue) {
          throw new BadRequestException(`「${field.label}」不能为空`);
        }
        values[field.key] = field.defaultValue ?? '';
        continue;
      }
      if (field.type === 'number' && Number.isNaN(Number(value))) {
        throw new BadRequestException(`「${field.label}」必须是数字`);
      }
      if (field.type === 'select' && !(field.options ?? []).includes(value)) {
        throw new BadRequestException(`「${field.label}」必须是可选选项之一`);
      }
      values[field.key] = value;
    }
    // 容错保留配置之外的字段，便于后续扩展
    for (const [key, value] of Object.entries(input)) {
      if (!(key in values)) values[key] = value;
    }
    return values;
  }

  private async recordSimpleRun(
    ticketId: number,
    node: WorkflowNodeDefinition,
    status: string,
    outcome?: string,
  ): Promise<void> {
    const attempt =
      (await this.runs.count({
        where: { ticketId, nodeKey: node.key },
      })) + 1;
    await this.runs.insert({
      ticketId,
      nodeKey: node.key,
      nodeName: node.name,
      nodeKind: node.kind,
      attempt,
      status,
      ...(outcome ? { outcome } : {}),
      startedAt: new Date(),
      finishedAt:
        status === RUN_STATUS_COMPLETED || status === RUN_STATUS_WAIT_ACCEPT
          ? status === RUN_STATUS_COMPLETED
            ? new Date()
            : null
          : null,
    });
  }

  private async pickEnabledAgent(ids: number[]): Promise<Worker | null> {
    if (!ids?.length) return null;
    const rows = await this.workers.find({ where: { id: In(ids) } });
    const byId = new Map(rows.map((worker) => [worker.id, worker]));
    for (const id of ids) {
      const worker = byId.get(id);
      if (
        worker?.enabled &&
        worker.role === WorkerRole.WORKER &&
        !worker.personalAgentUserId
      ) {
        return worker;
      }
    }
    return null;
  }

  private async enabledWorker(id: number): Promise<Worker | null> {
    const worker = await this.workers.findOne({ where: { id } });
    return worker?.enabled && !worker.personalAgentUserId ? worker : null;
  }

  private async currentRun(
    ticketId: number,
    nodeKey: string,
  ): Promise<TicketWorkflowRun | null> {
    return this.runs.findOne({
      where: { ticketId, nodeKey },
      order: { id: 'DESC' },
    });
  }

  private async workflowOf(ticket: Ticket): Promise<WorkflowDefinitionJson> {
    const version = await this.versions.findOne({
      where: { id: ticket.workflowVersionId ?? 0 },
    });
    if (!version) throw new NotFoundException('工单发布版本不存在');
    return version.definition;
  }

  private async updateTicket(
    ticketId: number,
    patch: Partial<Ticket>,
  ): Promise<void> {
    // simple-json 的 Record 值 TypeORM 深_partial 推导过窄，这里按运行时对象写入
    await this.tickets.update(
      ticketId,
      patch as Parameters<typeof this.tickets.update>[1],
    );
  }

  private async failTicket(ticketId: number, reason: string): Promise<void> {
    await this.updateTicket(ticketId, {
      workflowStatus: TICKET_STATUS_FAILED,
      currentNodeKey: null,
      currentNodeName: null,
    });
    this.logger.warn(`工单 #${ticketId} 已失败：${reason}`);
  }

  private async mustFind(id: number): Promise<Ticket> {
    const ticket = await this.tickets.findOne({ where: { id } });
    if (!ticket) throw new NotFoundException(`Ticket ${id} not found`);
    return ticket;
  }
}
