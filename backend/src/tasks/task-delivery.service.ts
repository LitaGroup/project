import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../auth/user.entity';
import { TaskStatus, TaskSubStatus, WorkerRuntime } from '../common/enums';
import { mdFrontmatter } from '../common/frontmatter';
import { Worker } from '../workers/worker.entity';
import { Task } from './task.entity';
import { TaskChatService } from './task-chat.service';
import type { TaskChatPerspective } from './task-chat.types';
import type { TaskDeliveryReportInput } from './task-delivery-report';
import { TaskDispatchService } from './task-dispatch.service';
import {
  TaskDocumentService,
  type TaskHandoffDocument,
  type TaskHandoffUpdateInput,
} from './task-document.service';
import { TaskHandoffService } from './task-handoff.service';
import { TaskNotifyService } from './task-notify.service';
import { TasksService } from './tasks.service';
import {
  actorName,
  assertTaskRequester,
  type TaskActor,
} from './task-requester';
import { TaskWorkerInboxService } from './task-worker-inbox.service';

/** 验收不通过超过该次数后转任务负责人处理（第 4 次触发） */
export const MAX_ACCEPT_REJECTS = 3;

export interface DeliveryReplyInput {
  /** accept=通过验收；refuse=拒绝并退回执行 */
  action?: string;
  /** 拒绝验收时的反馈意见（必填） */
  content?: string;
}

function markdownText(value: string | null | undefined): string {
  return value?.trim() || '（暂无）';
}

/**
 * 任务交付验收的 Agent 接口：
 * - 执行机器人申请验收（task-deliver-apply）
 * - 任务需求方处理验收（task-deliver-reply）
 */
@Injectable()
export class TaskDeliveryService {
  private readonly logger = new Logger(TaskDeliveryService.name);
  private readonly apiUrl: string;

  constructor(
    @InjectRepository(Task)
    private readonly tasks: Repository<Task>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(Worker)
    private readonly workers: Repository<Worker>,
    private readonly tasksService: TasksService,
    private readonly dispatchService: TaskDispatchService,
    private readonly taskChat: TaskChatService,
    private readonly taskDocuments: TaskDocumentService,
    private readonly taskHandoff: TaskHandoffService,
    private readonly taskNotify: TaskNotifyService,
    private readonly workerInbox: TaskWorkerInboxService,
    config: ConfigService,
  ) {
    this.apiUrl = (
      config.get<string>('API_URL') ?? 'http://localhost:3100/api'
    ).replace(/\/+$/, '');
  }

  /** 执行机器人申请验收：只保存产出并进入等待中-待验收 */
  async apply(
    taskId: number,
    worker: Worker,
    report: TaskDeliveryReportInput = {},
  ): Promise<string> {
    const task = await this.mustFind(taskId);
    if (task.agentId !== worker.id) {
      throw new ForbiddenException(
        `任务 ${task.code} 的执行机器人不是「${worker.name}」`,
      );
    }
    const requester = await this.requesterNameOf(task);
    const applied = await this.dispatchService.applyForAcceptance(
      taskId,
      worker,
      { requesterName: requester, report },
    );
    const saved = applied.task;
    return [
      mdFrontmatter({
        update: saved.updatedAt,
        title: '任务验收申请已提交',
      }),
      '# 任务验收申请已提交',
      '',
      `- ID：${saved.id}`,
      `- 编号：${saved.code}`,
      `- 状态：${saved.status}-${saved.subStatus}`,
      `- 执行机器人：${worker.name}（${worker.id}）`,
      `- 需求方：${requester ?? '未记录'}`,
      `- 交付文档：[${applied.handoff.path}](${applied.handoff.url})`,
      `- 交付文档版本：v${applied.handoff.version}`,
      '',
      '## 交付物',
      '',
      markdownText(saved.result),
      '',
      '## 后续处理',
      '',
      `需求方通过：POST ${this.apiUrl}/tasks/${saved.id}/handoff/accept.md`,
      '',
      `需求方返工：POST ${this.apiUrl}/tasks/${saved.id}/handoff/refuse.md，body {"content":"反馈意见"}`,
      '',
      `需求方判失败：POST ${this.apiUrl}/tasks/${saved.id}/fail.md，body {"reason":"失败原因"}`,
      '',
    ].join('\n');
  }

  /** 需求方处理验收：通过则完成并生成总结；拒绝则退回原执行机器人 */
  async reply(
    taskId: number,
    actor: User,
    input: DeliveryReplyInput,
  ): Promise<string> {
    const task = await this.mustFind(taskId);
    const requesterId = await this.requesterUserId(task);
    if (!requesterId || actor.id !== requesterId) {
      throw new ForbiddenException('仅任务需求方可以处理验收反馈');
    }
    const action = input.action?.trim();
    if (action !== 'accept' && action !== 'refuse') {
      throw new BadRequestException('action 只支持 accept 或 refuse');
    }

    if (action === 'accept') {
      const saved = await this.acceptTask(taskId, actor);
      return [
        mdFrontmatter({
          update: saved.updatedAt,
          title: '任务验收已通过',
        }),
        '# 任务验收已通过',
        '',
        `- ID：${saved.id}`,
        `- 编号：${saved.code}`,
        `- 状态：${saved.status}-${saved.subStatus}`,
        `- 验收人：${actor.name ?? '未知'}`,
        '',
        '任务已完成，平台正在异步生成 REVIEW 复盘文档。',
        '',
      ].join('\n');
    }

    const content = input.content?.trim();
    if (!content) {
      throw new BadRequestException('拒绝验收时必须提供反馈意见 content');
    }
    const saved = await this.refuse(
      task,
      { type: 'user', user: actor },
      content,
    );
    const escalated =
      saved.status === TaskStatus.WAITING &&
      saved.subStatus === TaskSubStatus.PENDING_FEEDBACK;
    return [
      mdFrontmatter({
        update: saved.updatedAt,
        title: escalated ? '任务验收已拒绝并转负责人' : '任务验收已拒绝',
      }),
      escalated ? '# 任务验收已拒绝并转负责人' : '# 任务验收已拒绝',
      '',
      `- ID：${saved.id}`,
      `- 编号：${saved.code}`,
      `- 状态：${saved.status}-${saved.subStatus}`,
      `- 验收人：${actor.name ?? '未知'}`,
      `- 累计验收不通过：${saved.acceptRejectCount} 次`,
      '',
      '## 反馈意见',
      '',
      content,
      '',
      escalated
        ? `验收不通过已超过 ${MAX_ACCEPT_REJECTS} 次，任务已转交执行机器人负责人处理。负责人补充意见后会重新识别并派发机器人。`
        : '任务已退回原执行机器人继续处理，完成后需重新申请验收。',
      '',
    ].join('\n');
  }

  /**
   * 任务详情页消息入口：待验收时统一按「验收不通过」处理并计数，
   * 其他状态仍走原有补充需求/继续对话逻辑。
   */
  async sendMessage(
    taskId: number,
    actor: User,
    content: string,
    perspective: TaskChatPerspective = 'requester',
  ): Promise<Task> {
    const task = await this.mustFind(taskId);
    if (task.status === TaskStatus.FINISHED) {
      throw new BadRequestException(
        `任务 ${task.code} 已结束，不能继续发送消息`,
      );
    }
    const humanWorker = await this.workers.findOne({
      where: { humanUserId: actor.id },
      select: { id: true, name: true, runtime: true },
    });
    const personalAgent = await this.workers.findOne({
      where: { personalAgentUserId: actor.id },
      select: { id: true, name: true, runtime: true },
    });
    const requesterWorker =
      humanWorker &&
      humanWorker.runtime === WorkerRuntime.HUMAN &&
      task.requesterType === 'worker' &&
      task.requesterId === humanWorker.id
        ? humanWorker
        : personalAgent &&
            task.requesterType === 'worker' &&
            task.requesterId === personalAgent.id
          ? // 历史任务需求方是个人 AGENT：有真人机器人时按真人身份操作
            (humanWorker ?? personalAgent)
          : null;
    const text = content.trim();
    if (!text) throw new BadRequestException('消息内容不能为空');
    // 执行方是当前用户的真人机器人：任何未结束状态（含待验收）都按操作台对话落库，
    // 不触发机器人会话，也不改变任务状态。
    if (
      perspective === 'responsible' &&
      humanWorker &&
      humanWorker.runtime === WorkerRuntime.HUMAN &&
      task.agentId === humanWorker.id
    ) {
      const message = await this.taskChat.postAssistantMessage(taskId, text, {
        meta: {
          humanWorkerMessage: true,
          workerId: humanWorker.id,
          perspective: 'responsible',
        },
      });
      await this.dispatchService.addEvent(
        taskId,
        '操作',
        '真人机器人在操作台回复',
        humanWorker.name,
        { humanWorker: true },
      );
      // 子任务需求方是 AI 机器人时进入收件箱，由 LOOP 唤醒父机器人回复。
      await this.dispatchService.notifyRequesterWorkerMessage(
        task,
        text,
        message.id,
      );
      return this.mustFind(taskId);
    }
    if (
      task.status === TaskStatus.WAITING &&
      task.subStatus === TaskSubStatus.PENDING_ACCEPT
    ) {
      return this.refuse(
        task,
        requesterWorker
          ? { type: 'worker', worker: requesterWorker }
          : { type: 'user', user: actor },
        text,
      );
    }
    return this.tasksService.sendMessage(taskId, text, actor.name ?? null, {
      actorWorkerId:
        perspective === 'requester' ? (requesterWorker?.id ?? null) : null,
      perspective,
    });
  }

  /** 读取任务交付文档（包含平台维护的版本信息） */
  async getHandoff(taskId: number): Promise<TaskHandoffDocument> {
    const task = await this.mustFind(taskId);
    return this.taskDocuments.readHandoff(task);
  }

  /** AI 读取交付文档：标准 Frontmatter + 作者正文。 */
  async getHandoffMarkdown(taskId: number): Promise<string> {
    const task = await this.mustFind(taskId);
    const document = await this.taskDocuments.readHandoff(task);
    return this.taskDocuments.renderHandoffMarkdown(task, document);
  }

  /** 执行机器人维护交付文档：只允许当前执行机器人且任务正在执行。 */
  async updateHandoffByWorker(
    taskId: number,
    worker: Worker,
    input: TaskHandoffUpdateInput,
  ): Promise<TaskHandoffDocument> {
    const task = await this.mustFind(taskId);
    if (task.agentId !== worker.id) {
      throw new ForbiddenException(
        `任务 ${task.code} 的执行机器人不是「${worker.name}」`,
      );
    }
    const pendingApply =
      task.status === TaskStatus.WAITING &&
      task.subStatus === TaskSubStatus.PENDING_APPLY;
    if (
      !pendingApply &&
      (task.status !== TaskStatus.RUNNING ||
        task.subStatus !== TaskSubStatus.EXECUTING)
    ) {
      throw new BadRequestException(
        `任务 ${task.code} 当前状态「${task.status}-${task.subStatus}」不可更新交付文档`,
      );
    }
    const result = await this.taskDocuments.updateHandoff(taskId, {
      content: input.content,
      append: input.append,
      baseVersion: input.baseVersion,
      updatedBy: input.updatedBy || worker.name,
    });
    if (result.changed) {
      await this.recordHandoffUpdate(
        result.task,
        result.document,
        worker.name,
        'worker',
      );
    }
    return result.document;
  }

  /**
   * 需求方/真人执行者维护交付文档。
   * 需求方修改后，平台把最新版本通知给 AI 执行机器人。
   */
  async updateHandoffByUser(
    taskId: number,
    actor: User,
    input: TaskHandoffUpdateInput,
  ): Promise<TaskHandoffDocument> {
    const operator = actor.name ?? '需求方';
    const result = await this.taskDocuments.updateHandoff(taskId, {
      content: input.content,
      append: input.append,
      baseVersion: input.baseVersion,
      updatedBy: operator,
    });
    if (result.changed) {
      await this.recordHandoffUpdate(
        result.task,
        result.document,
        operator,
        'user',
      );
      await this.notifyAgentOfHandoffUpdate(
        result.task,
        result.document,
        operator,
      );
    }
    return result.document;
  }

  private async recordHandoffUpdate(
    task: Task,
    document: TaskHandoffDocument,
    operator: string,
    source: 'user' | 'worker',
  ): Promise<void> {
    await this.dispatchService.addEvent(
      task.id,
      '操作',
      `交付文档更新至 v${document.version}（${source === 'user' ? '人工编辑' : '执行方编辑'}）`,
      operator,
      {
        handoffPath: document.path,
        handoffVersion: document.version,
        handoffUpdatedBy: operator,
        handoffUpdateSource: source,
      },
    );
  }

  /**
   * 人工修改交付文档后告知执行机器人：
   * - 执行中：进入当前会话的发送队列，本轮结束后读取最新版本
   * - 待反馈/待继续/待申请验收：并入下一次恢复提示（待申请验收同时转入待继续）
   */
  private async notifyAgentOfHandoffUpdate(
    task: Task,
    document: TaskHandoffDocument,
    operator: string,
  ): Promise<void> {
    if (!task.agentId) return;
    const agent = await this.workers.findOne({
      where: { id: task.agentId },
      select: { id: true, runtime: true },
    });
    if (!agent || agent.runtime === WorkerRuntime.HUMAN) return;
    const url = `${this.apiUrl}/tasks/${task.id}/handoff.md`;
    const prompt = [
      `需求方「${operator}」已将任务 ${task.code} 的交付文档更新到 v${document.version}。`,
      `请先读取 ${url}，以最新正文为准，并保留需求方已经修改的内容。`,
      '不要用旧版本覆盖人工修改；如无其它要求，继续完成当前任务并按需更新交付文档。',
    ].join('\n');
    if (
      task.status === TaskStatus.RUNNING &&
      task.subStatus === TaskSubStatus.EXECUTING
    ) {
      try {
        await this.dispatchService.continueConversation(
          task.id,
          `需求方更新了交付文档（v${document.version}），请以最新版本为准。`,
          operator,
          { modelContent: prompt, perspective: 'requester' },
        );
      } catch (error) {
        this.logger.warn(
          `任务 ${task.code} 交付文档变更通知机器人失败：${(error as Error).message}`,
        );
      }
      return;
    }
    if (
      task.status === TaskStatus.WAITING &&
      [
        TaskSubStatus.PENDING_FEEDBACK,
        TaskSubStatus.PENDING_RESUME,
        TaskSubStatus.PENDING_APPLY,
      ].includes(task.subStatus)
    ) {
      await this.tasks.update(
        { id: task.id, status: task.status, subStatus: task.subStatus },
        {
          ...(task.subStatus === TaskSubStatus.PENDING_APPLY
            ? { subStatus: TaskSubStatus.PENDING_RESUME }
            : {}),
          resumePrompt: [task.resumePrompt?.trim(), prompt]
            .filter(Boolean)
            .join('\n\n'),
        },
      );
    }
  }

  /** 验收通过（网页 JSON 接口）：仅任务需求方可操作，异步生成复盘并销毁会话 */
  async acceptTask(taskId: number, actor: User): Promise<Task> {
    return this.acceptHandoff(taskId, { type: 'user', user: actor });
  }

  /** 人或机器人需求方验收通过。 */
  async acceptHandoff(taskId: number, actor: TaskActor): Promise<Task> {
    const task = await this.mustFind(taskId);
    await this.assertRequester(task, actor);
    const saved = await this.tasksService.accept(taskId, actorName(actor));
    await this.dispatchService.discardQueuedConversations(taskId);
    await this.workerInbox.completeForChild(taskId, 'handoff');
    // 验收成功后的总结与会话清理均为异步收尾，不阻塞验收结果
    void this.taskHandoff.request(taskId).catch((error: Error) => {
      this.logger.warn(
        `任务 ${saved.code} 验收后启动总结失败：${error.message}`,
      );
    });
    void this.dispatchService
      .destroyAcceptedSession(taskId)
      .catch((error: Error) => {
        this.logger.warn(
          `任务 ${saved.code} 验收后销毁执行器会话失败：${error.message}`,
        );
      });
    return saved;
  }

  /** 验收不通过（网页 JSON 接口）：返回更新后的任务 */
  async reject(taskId: number, actor: User, content: string): Promise<Task> {
    return this.refuseHandoff(taskId, { type: 'user', user: actor }, content);
  }

  /** 人或机器人需求方拒绝验收；机器人忙碌时进入待继续而不是并行执行。 */
  async refuseHandoff(
    taskId: number,
    actor: TaskActor,
    content: string,
  ): Promise<Task> {
    const task = await this.mustFind(taskId);
    await this.assertRequester(task, actor);
    const text = content.trim();
    if (!text) throw new BadRequestException('验收反馈内容不能为空');
    return this.refuse(task, actor, text);
  }

  /**
   * 记录一次验收不通过：前 3 次退回原机器人，超过 3 次转执行机器人负责人。
   * 计数使用原子递增，申请验收不会重置，确保同一任务持续累计。
   */
  private async refuse(
    task: Task,
    actor: TaskActor,
    content: string,
  ): Promise<Task> {
    if (
      task.status !== TaskStatus.WAITING ||
      task.subStatus !== TaskSubStatus.PENDING_ACCEPT
    ) {
      throw new BadRequestException(
        `任务 ${task.code} 当前状态「${task.status}-${task.subStatus}」不可拒绝验收`,
      );
    }
    await this.tasks.increment({ id: task.id }, 'acceptRejectCount', 1);
    const current = await this.mustFind(task.id);
    const count = current.acceptRejectCount ?? 1;
    const operator = actorName(actor);
    const reworkPrompt = this.buildReworkPrompt(task.id, content);

    if (count <= MAX_ACCEPT_REJECTS) {
      const claimed = await this.dispatchService.claimExecution(
        task.id,
        TaskSubStatus.PENDING_ACCEPT,
      );
      let saved: Task;
      if (!claimed) {
        // 等待验收期间机器人可能已接受其他任务，返工先排队，避免并行执行。
        const queued = await this.tasks.update(
          {
            id: task.id,
            status: TaskStatus.WAITING,
            subStatus: TaskSubStatus.PENDING_ACCEPT,
          },
          {
            subStatus: TaskSubStatus.PENDING_RESUME,
            resumePrompt: reworkPrompt,
            remindCount: 0,
            firstRemindedAt: null,
            lastRemindedAt: null,
          },
        );
        if (!queued.affected) {
          throw new BadRequestException('任务状态已变化，请刷新后重试');
        }
        saved = await this.mustFind(task.id);
      } else {
        try {
          saved = await this.dispatchService.continueConversation(
            task.id,
            content,
            operator,
            { modelContent: reworkPrompt },
          );
        } catch (error) {
          await this.tasks.update(
            { id: task.id, status: TaskStatus.RUNNING },
            {
              status: TaskStatus.WAITING,
              subStatus: TaskSubStatus.PENDING_RESUME,
              resumePrompt: reworkPrompt,
            },
          );
          throw error;
        }
      }
      saved.acceptRejectCount = count;
      await this.workerInbox.completeForChild(task.id, 'handoff');
      await this.dispatchService.addEvent(
        task.id,
        '操作',
        `需求方拒绝验收（累计 ${count} 次），${
          claimed
            ? '已退回执行机器人重新处理'
            : '机器人忙碌，已转入等待中-待继续'
        }`,
        operator,
        {
          intervention: true,
          deliveryReply: 'refuse',
          feedback: content,
          acceptRejectCount: count,
          queued: !claimed,
        },
      );
      return saved;
    }

    const worker = current.agentId
      ? await this.workers.findOne({ where: { id: current.agentId } })
      : null;
    const ownerUserId = worker?.ownerUserId ?? null;
    const ownerName = worker?.ownerName ?? null;
    const now = new Date();
    const updated = await this.tasks.update(
      {
        id: current.id,
        status: TaskStatus.WAITING,
        subStatus: TaskSubStatus.PENDING_ACCEPT,
      },
      {
        status: TaskStatus.WAITING,
        subStatus: TaskSubStatus.PENDING_FEEDBACK,
        acceptRejectCount: count,
        ownerTakeoverAt: now,
        ownerTakeoverUserId: ownerUserId,
        ownerTakeoverName: ownerName,
        missingItems: [
          {
            item: `验收不通过已达 ${count} 次，等待任务负责人处理`,
            reason: content,
          },
        ],
        remindCount: 0,
        firstRemindedAt: null,
        lastRemindedAt: null,
      },
    );
    if (!updated.affected) {
      throw new BadRequestException('任务状态已变化，请刷新后重试');
    }
    const saved = await this.mustFind(task.id);
    await this.dispatchService.addEvent(
      task.id,
      '状态变更',
      `状态变更：等待中-待验收 → 等待中-待反馈（验收不通过累计 ${count} 次，转任务负责人${
        ownerName ? `「${ownerName}」` : '（未配置，回退需求方）'
      }处理）`,
      operator,
      {
        intervention: true,
        deliveryReply: 'refuse',
        feedback: content,
        acceptRejectCount: count,
        ownerTakeover: true,
        ownerTakeoverUserId: ownerUserId,
        ownerTakeoverName: ownerName,
      },
    );

    await this.workerInbox.completeForChild(task.id, 'handoff');
    const notifyTitle = `任务待负责人处理：${saved.code} ${saved.title}`;
    const notifyDescription = `验收不通过已达 ${count} 次，请负责人补充处理意见。最近反馈：${content}`;
    const ownerNotified = await this.taskNotify.notifyTaskAgentOwner(
      saved,
      'feedback',
      notifyTitle,
      notifyDescription,
    );
    if (!ownerNotified.sent) {
      await this.taskNotify.notifyTaskRequester(
        saved,
        'feedback',
        notifyTitle,
        notifyDescription,
      );
    }
    return saved;
  }

  /** 返工 Prompt：明确退回原因，并要求新一轮交付重新申请验收。 */
  private buildReworkPrompt(taskId: number, content: string): string {
    return [
      '# 验收返工',
      '',
      '需求方未通过本次验收，任务已退回执行机器人继续处理。',
      '',
      '## 退回原因',
      '',
      content,
      '',
      '## 后续要求',
      '',
      `请根据退回原因完成修改并自检。完成后如需继续验收，必须重新调用 POST ${this.apiUrl}/tasks/${taskId}/handoff/apply.md 提交验收申请。`,
      '',
      '此前的验收申请已失效，不能视为本次交付已申请验收。',
    ].join('\n');
  }

  /** 需求方展示名：机器人需求方取机器人名，人类需求方取用户姓名。 */
  private async requesterNameOf(task: Task): Promise<string | null> {
    if (task.requesterType === 'worker' && task.requesterId) {
      const worker = await this.workers.findOne({
        where: { id: task.requesterId },
        select: { id: true, name: true },
      });
      return worker?.name ?? null;
    }
    const userId = await this.requesterUserId(task);
    return userId ? this.userName(userId) : null;
  }

  /** 显式需求方优先；历史数据保留创建人/根任务创建人回退。 */
  private async requesterUserId(task: Task): Promise<number | null> {
    if (task.requesterType) {
      return task.requesterType === 'user' ? task.requesterId : null;
    }
    if (task.createdById && task.createdById > 0) return task.createdById;
    if (!task.rootId || task.rootId === task.id) return null;
    const root = await this.tasks.findOne({
      where: { id: task.rootId },
      select: { id: true, createdById: true },
    });
    return root?.createdById && root.createdById > 0 ? root.createdById : null;
  }

  private async assertRequester(task: Task, actor: TaskActor): Promise<void> {
    if (task.requesterType) {
      assertTaskRequester(task, actor);
      return;
    }
    // 未回填的历史子任务只可能由根任务人类创建人处理，不能误放给执行机器人。
    const requesterId = await this.requesterUserId(task);
    if (
      actor.type !== 'user' ||
      !requesterId ||
      actor.user.id !== requesterId
    ) {
      throw new ForbiddenException('仅任务需求方可以执行该操作');
    }
  }

  private async userName(userId: number): Promise<string | null> {
    const user = await this.users.findOne({
      where: { id: userId },
      select: { id: true, name: true },
    });
    return user?.name ?? null;
  }

  private async mustFind(taskId: number): Promise<Task> {
    const task = await this.tasks.findOne({ where: { id: taskId } });
    if (!task) throw new NotFoundException(`Task ${taskId} not found`);
    return task;
  }
}
