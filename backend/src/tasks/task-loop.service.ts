import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThan, MoreThan, Repository } from 'typeorm';
import { TaskStatus, TaskSubStatus } from '../common/enums';
import { Task, TaskMissingItem } from './task.entity';
import {
  TaskAssignmentService,
  type TaskAssignmentResult,
} from './task-assignment.service';
import { TaskDispatchService } from './task-dispatch.service';
import { TaskMessage } from './task-message.entity';
import { TaskNotifyService } from './task-notify.service';
import {
  mapLegacyTaskStatus,
  nextInboxRetryDelay,
  nextReminderAction,
  nextResumeRetryDelay,
  TASK_INBOX_STALE_MS,
  TASK_REMIND_TIMEOUT_DAYS,
} from './task-loop.rules';
import { TasksService } from './tasks.service';
import { TaskRequesterReplyService } from './task-requester-reply.service';
import { TaskRequesterVerifyService } from './task-requester-verify.service';
import { TaskReleaseNotificationService } from './task-release-notification.service';
import type { TaskWorkerInbox } from './task-worker-inbox.entity';
import {
  taskInboxPrompt,
  TaskWorkerInboxService,
} from './task-worker-inbox.service';

const REMIND_BATCH_SIZE = 100;
const OFFER_RETRY_MS = 30_000;
const ORPHAN_CHILD_SCAN_MS = 30_000;
const ORPHAN_CHILD_SCAN_LIMIT = 100;
const OFFER_STALL_MS = 10 * 60_000;
const OFFER_STALL_REMIND_MS = 30 * 60_000;
/** 根任务机器人需求方自动验收扫描间隔 */
const REQUESTER_VERIFY_SCAN_MS = 30_000;
/** 根任务执行方消息补建扫描间隔与回看窗口 */
const ROOT_MESSAGE_SCAN_MS = 30_000;
const ROOT_MESSAGE_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 多机器人任务 LOOP（每秒）：
 * 待分配→分配；待接受→任务邀约；待继续→机器人仍有执行容量时恢复；
 * 机器人需求方收件箱→父任务待继续 / 根任务需求方一次性回复；
 * 待申请验收不占用机器人，收到补充消息或子任务事件时转待继续；
 * 待反馈/待验收仅提醒，不占用机器人。
 */
@Injectable()
export class TaskLoopService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TaskLoopService.name);
  private ready = false;
  private running = false;
  private readonly reminding = new Set<number>();
  private readonly offering = new Set<number>();
  private readonly resuming = new Set<number>();
  private readonly offerStalledNotifiedAt = new Map<number, number>();
  private readonly resumeFailures = new Map<
    number,
    { failures: number; nextRetryAt: number }
  >();
  private lastOrphanScanAt = 0;
  private orphanScanCursor = 0;
  private lastRequesterVerifyScanAt = 0;
  private lastRootMessageScanAt = 0;
  private readonly apiUrl: string;

  constructor(
    @InjectRepository(Task)
    private readonly tasks: Repository<Task>,
    @InjectRepository(TaskMessage)
    private readonly messages: Repository<TaskMessage>,
    private readonly tasksService: TasksService,
    private readonly assignmentService: TaskAssignmentService,
    private readonly dispatchService: TaskDispatchService,
    private readonly taskNotify: TaskNotifyService,
    private readonly workerInbox: TaskWorkerInboxService,
    private readonly requesterVerify: TaskRequesterVerifyService,
    private readonly requesterReply: TaskRequesterReplyService,
    private readonly releaseNotification: TaskReleaseNotificationService,
    config: ConfigService,
  ) {
    this.apiUrl = (
      config.get<string>('API_URL') ?? 'http://localhost:3100/api'
    ).replace(/\/+$/, '');
  }

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.migrateLegacyStatuses();
    } catch (e) {
      this.logger.error(`任务 LOOP 启动迁移失败: ${(e as Error).message}`);
    } finally {
      this.ready = true;
    }
  }

  @Interval(1000)
  async tick(): Promise<void> {
    if (!this.ready || this.running) return;
    this.running = true;
    try {
      await this.repairOrphanChildEvents();
      await this.repairRootRequesterMessages();
      await this.queueWorkerInbox();
      await this.queueRootRequesterVerification();
      await this.assignPending();
      await this.offerPending();
      await this.resumePending();
      await this.processReminders('feedback');
      await this.processReminders('accept');
    } catch (e) {
      this.logger.warn(`任务 LOOP 执行失败: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  // ===== 待分配 → 待接受 =====

  private async assignPending(): Promise<void> {
    const pending = await this.tasks.find({
      where: {
        status: TaskStatus.WAITING,
        subStatus: TaskSubStatus.PENDING_ASSIGNMENT,
      },
      order: { id: 'ASC' },
      take: 20,
    });
    for (const task of pending) {
      let result: TaskAssignmentResult;
      try {
        result = await this.assignmentService.assign(task);
      } catch (e) {
        await this.toFeedback(task.id, [
          {
            item: '任务分配失败，请检查任务定义',
            reason: (e as Error).message,
          },
        ]);
        continue;
      }
      if (!result.agentId) {
        await this.toFeedback(task.id, [
          {
            item: '未找到可承接任务的机器人，请配置任务定义或系统未知任务定义（ID=6）',
            reason: '任务定义没有启用中的处理机器人',
          },
        ]);
        continue;
      }
      // 执行容量已满的机器人继续等待；待接受邀约也只在有容量后发送。
      if (!(await this.dispatchService.hasExecutionCapacity(result.agentId)))
        continue;
      const updated = await this.tasks.update(
        {
          id: task.id,
          status: TaskStatus.WAITING,
          subStatus: TaskSubStatus.PENDING_ASSIGNMENT,
        },
        {
          subStatus: TaskSubStatus.PENDING_ACCEPTANCE,
          templateId: result.templateId,
          templateName: result.templateName,
          agentId: result.agentId,
          assignedAt: new Date(),
          offerAttemptAt: null,
          missingItems: null,
          remindCount: 0,
          firstRemindedAt: null,
          lastRemindedAt: null,
        },
      );
      if (!updated.affected) continue;
      const sourceLabel = {
        manual: '人工预分配',
        definition: '任务定义',
        unknown: '系统未知任务定义（ID=6）',
      }[result.source];
      await this.tasksService.addEvent(
        task.id,
        '状态变更',
        `状态变更：等待中-待分配 → 等待中-待接受（${sourceLabel}，机器人：${result.agentName ?? result.agentId}）`,
        null,
        {
          source: result.source,
          templateId: result.templateId,
          templateName: result.templateName,
          agentId: result.agentId,
          agentName: result.agentName,
        },
      );
    }
  }

  private async toFeedback(
    taskId: number,
    items: TaskMissingItem[],
  ): Promise<void> {
    const updated = await this.tasks.update(
      {
        id: taskId,
        status: TaskStatus.WAITING,
        subStatus: TaskSubStatus.PENDING_ASSIGNMENT,
      },
      {
        subStatus: TaskSubStatus.PENDING_FEEDBACK,
        missingItems: items,
        remindCount: 0,
        firstRemindedAt: null,
        lastRemindedAt: null,
      },
    );
    if (!updated.affected) return;
    await this.tasksService.addEvent(
      taskId,
      '状态变更',
      `状态变更：等待中-待分配 → 等待中-待反馈（${items
        .map((item) => item.item)
        .join('、')}）`,
      null,
    );
  }

  // ===== 待接受：两阶段邀约 =====

  private async offerPending(): Promise<void> {
    const pending = await this.tasks.find({
      where: {
        status: TaskStatus.WAITING,
        subStatus: TaskSubStatus.PENDING_ACCEPTANCE,
      },
      order: { id: 'ASC' },
      take: 20,
    });
    const now = Date.now();
    for (const task of pending) {
      if (!task.agentId) continue;
      await this.warnOfferStalled(task);
      if (this.offering.has(task.id)) continue;
      // 必须在下面原子写入 offerAttemptAt 之前判断，避免把首次邀约误判为重试。
      const firstOffer = !task.offerAttemptAt;
      if (task.offerAttemptAt) {
        const attemptedAt = new Date(task.offerAttemptAt).getTime();
        if (now - attemptedAt < OFFER_RETRY_MS) continue;
      }
      if (this.dispatchService.taskChatRunning(task.id)) continue;
      if (!(await this.dispatchService.hasExecutionCapacity(task.agentId)))
        continue;
      // 多实例下用 offerAttemptAt 原子抢占，只允许一个实例发送任务邀约。
      const cutoff = new Date(now - OFFER_RETRY_MS);
      const claimed = await this.tasks.update(
        [
          {
            id: task.id,
            status: TaskStatus.WAITING,
            subStatus: TaskSubStatus.PENDING_ACCEPTANCE,
            offerAttemptAt: IsNull(),
          },
          {
            id: task.id,
            status: TaskStatus.WAITING,
            subStatus: TaskSubStatus.PENDING_ACCEPTANCE,
            offerAttemptAt: LessThan(cutoff),
          },
        ],
        { offerAttemptAt: new Date(now) },
      );
      if (!claimed.affected) continue;
      this.offering.add(task.id);
      let offered = false;
      try {
        await this.dispatchService.offer(task.id);
        offered = true;
      } catch (e) {
        this.logger.warn(`任务 #${task.id} 邀约失败: ${(e as Error).message}`);
        await this.tasks.update(
          { id: task.id, subStatus: TaskSubStatus.PENDING_ACCEPTANCE },
          { offerAttemptAt: new Date() },
        );
        await this.tasksService.addEvent(
          task.id,
          '系统',
          `任务邀约失败，将稍后重试：${(e as Error).message}`,
          null,
        );
      } finally {
        this.offering.delete(task.id);
      }
      if (!offered || !firstOffer) continue;
      try {
        await this.taskNotify.notifyTaskHumanAssignee(
          task,
          'notice',
          `新任务待处理：${task.code} ${task.title}`,
          '任务已分配给你，请前往工作台确认是否接受。',
        );
      } catch (e) {
        this.logger.warn(
          `任务 #${task.id} 真人执行人通知失败: ${(e as Error).message}`,
        );
      }
    }
  }

  /** 待接受超过阈值仍未接受/拒绝：提醒机器人负责人，不自动接受或改派。 */
  private async warnOfferStalled(task: Task): Promise<void> {
    if (!task.assignedAt) return;
    const assignedAt = new Date(task.assignedAt).getTime();
    const now = Date.now();
    if (!Number.isFinite(assignedAt) || now - assignedAt < OFFER_STALL_MS) {
      return;
    }
    const last = this.offerStalledNotifiedAt.get(task.id) ?? 0;
    if (now - last < OFFER_STALL_REMIND_MS) return;
    this.offerStalledNotifiedAt.set(task.id, now);
    const title = `任务长时间未接受：${task.code} ${task.title}`;
    const description =
      '任务邀约已发出超过 10 分钟，机器人仍未接受或拒绝。请检查机器人状态、执行器连接与任务定义配置。';
    const notified = await this.taskNotify.notifyTaskAgentOwner(
      task,
      'notice',
      title,
      description,
    );
    if (!notified.sent) {
      await this.taskNotify.notifyTaskRequester(
        task,
        'notice',
        title,
        description,
        { fallbackToRequesterOwner: true },
      );
    }
    await this.tasksService.addEvent(task.id, '系统', description, null, {
      watchdog: true,
      reason: 'offer-accept-timeout',
      assignedAt: new Date(assignedAt).toISOString(),
    });
  }

  // ===== 待继续：统一恢复队列 =====

  private async resumePending(): Promise<void> {
    const pending = await this.tasks.find({
      where: {
        status: TaskStatus.WAITING,
        subStatus: TaskSubStatus.PENDING_RESUME,
      },
      order: { id: 'ASC' },
      take: 20,
    });
    const now = Date.now();
    for (const task of pending) {
      if (this.resuming.has(task.id) || !task.agentId) continue;
      const retry = this.resumeFailures.get(task.id);
      if (retry && retry.nextRetryAt > now) continue;
      if (this.dispatchService.taskChatRunning(task.id)) continue;
      if (!(await this.dispatchService.hasExecutionCapacity(task.agentId)))
        continue;
      this.resuming.add(task.id);
      const resumePrompt = task.resumePrompt?.trim() || '请继续处理当前任务。';
      try {
        const claimed = await this.dispatchService.claimExecution(
          task.id,
          TaskSubStatus.PENDING_RESUME,
          { nullIfStateChanged: true },
        );
        if (!claimed) continue;
        await this.tasksService.addEvent(
          task.id,
          '状态变更',
          '状态变更：等待中-待继续 → 进行中-执行中（LOOP 恢复执行）',
          null,
        );
        await this.dispatchService.dispatch(task.id, null, resumePrompt);
        await this.workerInbox.markDelivered(task.id);
        this.resumeFailures.delete(task.id);
      } catch (e) {
        const failures = (this.resumeFailures.get(task.id)?.failures ?? 0) + 1;
        const delay = nextResumeRetryDelay(failures - 1);
        this.resumeFailures.set(task.id, {
          failures,
          nextRetryAt: Date.now() + delay,
        });
        this.logger.warn(`任务 #${task.id} 恢复失败: ${(e as Error).message}`);
        await this.tasks.update(
          {
            id: task.id,
            status: TaskStatus.RUNNING,
            subStatus: TaskSubStatus.EXECUTING,
          },
          {
            status: TaskStatus.WAITING,
            subStatus: TaskSubStatus.PENDING_RESUME,
            resumePrompt,
          },
        );
        await this.tasksService.addEvent(
          task.id,
          '系统',
          `恢复执行失败（第 ${failures} 次），任务回到等待中-待继续：${(e as Error).message}`,
          null,
          { watchdog: true, failures, nextRetryAt: Date.now() + delay },
        );
      } finally {
        this.resuming.delete(task.id);
      }
    }
  }

  // ===== 父机器人收件箱 =====

  /**
   * 修复“子任务已等待人工处理、但收件箱缺失/丢失”的孤儿链路。
   * 以持久化提问与任务状态为准补建事件，后续由统一收件箱流程唤醒父机器人。
   */
  private async repairOrphanChildEvents(): Promise<void> {
    const now = Date.now();
    if (now - this.lastOrphanScanAt < ORPHAN_CHILD_SCAN_MS) return;
    this.lastOrphanScanAt = now;
    const children = await this.tasks.find({
      where: {
        id: MoreThan(this.orphanScanCursor),
        status: TaskStatus.WAITING,
        subStatus: In([
          TaskSubStatus.PENDING_FEEDBACK,
          TaskSubStatus.PENDING_ACCEPT,
        ]),
        requesterType: 'worker',
      },
      order: { id: 'ASC' },
      take: ORPHAN_CHILD_SCAN_LIMIT,
    });
    for (const child of children) {
      if (child.subStatus === TaskSubStatus.PENDING_FEEDBACK) {
        const rows = await this.messages.find({
          where: { taskId: child.id, kind: 'question' },
          order: { id: 'DESC' },
        });
        const pending = rows.find(
          (row) => row.question?.state === 'pending' && row.question.id,
        );
        if (!pending?.question) continue;
        await this.workerInbox.enqueue(child, 'question', {
          referenceId: pending.question.id,
          payload: { questions: pending.question.questions },
        });
        continue;
      }
      await this.workerInbox.enqueue(child, 'handoff', {
        payload: {
          handoffPath: child.handoffPath,
          handoffVersion: child.handoffSubmittedVersion,
        },
      });
    }
    this.orphanScanCursor =
      children.length < ORPHAN_CHILD_SCAN_LIMIT
        ? 0
        : (children[children.length - 1]?.id ?? this.orphanScanCursor);
  }

  /**
   * 补建根任务执行方消息事件：
   * 历史版本会直接丢弃根任务消息，进程重启也可能在落库后、入队前中断。
   * 以最近一条真人执行方消息为准，没有对应收件箱事件且之后没有需求方回复时补建。
   */
  private async repairRootRequesterMessages(): Promise<void> {
    const now = Date.now();
    if (now - this.lastRootMessageScanAt < ROOT_MESSAGE_SCAN_MS) return;
    this.lastRootMessageScanAt = now;
    const roots = await this.tasks.find({
      where: {
        parentId: IsNull(),
        requesterType: 'worker',
        status: In([TaskStatus.WAITING, TaskStatus.RUNNING]),
        updatedAt: MoreThan(new Date(now - ROOT_MESSAGE_LOOKBACK_MS)),
      },
      order: { updatedAt: 'DESC' },
      take: 50,
    });
    for (const task of roots) {
      if (!task.requesterId) continue;
      const rows = await this.messages.find({
        where: { taskId: task.id, kind: 'message' },
        order: { id: 'DESC' },
        take: 20,
      });
      const latestHumanMessage = rows.find(
        (row) =>
          row.role === 'assistant' &&
          row.meta?.humanWorkerMessage === true &&
          row.content.trim(),
      );
      if (!latestHumanMessage) continue;
      const replied = rows.some(
        (row) =>
          row.role === 'user' &&
          row.createdAt.getTime() > latestHumanMessage.createdAt.getTime(),
      );
      if (replied) continue;
      if (
        await this.workerInbox.hasReference(
          task.id,
          'message',
          latestHumanMessage.messageKey,
        )
      ) {
        continue;
      }
      await this.workerInbox.enqueue(task, 'message', {
        referenceId: latestHumanMessage.messageKey,
        payload: { content: latestHumanMessage.content.trim() },
      });
    }
  }

  private async queueWorkerInbox(): Promise<void> {
    const entries = await this.workerInbox.listActionable(
      new Date(),
      TASK_INBOX_STALE_MS,
    );
    for (const entry of entries) {
      // 提测通知不是父子任务事件：不查任务、不改任务状态，由独立服务消费。
      if (entry.kind === 'release') {
        await this.releaseNotification.handle(entry);
        continue;
      }
      const child = await this.tasks.findOne({
        where: { id: entry.childTaskId },
      });
      if (!child) {
        await this.workerInbox.markDead(entry.id);
        continue;
      }
      // 根任务消息事件以任务自身作为 parentTaskId，由需求方机器人一次性会话回复。
      if (entry.parentTaskId === entry.childTaskId) {
        await this.queueRootRequesterMessage(child, entry);
        continue;
      }
      const parent = await this.tasks.findOne({
        where: { id: entry.parentTaskId },
      });
      if (
        !parent ||
        parent.status === TaskStatus.FINISHED ||
        parent.agentId !== entry.workerId
      ) {
        // 父任务不可用时只关闭当前事件，不改写子任务需求方或执行方。
        this.logger.warn(
          `子任务 ${child.code} 的 ${entry.kind} 事件无法处理：父任务已结束或处理机器人已变化`,
        );
        await this.workerInbox.markDead(entry.id);
        continue;
      }
      if (!this.childEventNeedsAction(entry, child)) {
        await this.workerInbox.markDone(entry.id);
        continue;
      }

      const prompt = taskInboxPrompt(entry, child, this.apiUrl);
      if (
        parent.status === TaskStatus.WAITING &&
        parent.subStatus === TaskSubStatus.PENDING_RESUME
      ) {
        if (parent.resumePrompt?.includes(`事件收件箱 ID：${entry.id}`)) {
          // 已写入待继续上下文，正常等待 LOOP 恢复；陈旧过久则计一次失败尝试，
          // 防止恢复任务永久失败时子任务无限等待。
          if (entry.status !== 'pending') {
            await this.deferInboxEntry(
              entry,
              parent,
              child,
              '父任务长期停留在待继续，恢复尚未成功',
            );
          } else {
            await this.workerInbox.markQueued(entry.id);
          }
          continue;
        }
        if (entry.status !== 'pending') {
          const reopened = await this.workerInbox.reopen(
            entry.id,
            '父任务待继续上下文缺少该事件，重新排队',
          );
          if (!reopened) continue;
          entry.status = 'pending';
        }
        const updated = await this.tasks.update(
          {
            id: parent.id,
            status: TaskStatus.WAITING,
            subStatus: TaskSubStatus.PENDING_RESUME,
          },
          {
            resumePrompt: [parent.resumePrompt?.trim(), prompt]
              .filter(Boolean)
              .join('\n\n---\n\n'),
          },
        );
        if (!updated.affected) continue;
        await this.workerInbox.markQueued(entry.id);
        continue;
      }

      let updated: { affected?: number | null } | null = null;
      if (
        parent.status === TaskStatus.WAITING &&
        parent.subStatus === TaskSubStatus.PENDING_APPLY
      ) {
        if (entry.status !== 'pending') {
          const reopened = await this.workerInbox.reopen(
            entry.id,
            '父任务待申请验收时收到子任务事件，重新排队',
          );
          if (!reopened) continue;
          entry.status = 'pending';
        }
        updated = await this.tasks.update(
          {
            id: parent.id,
            status: TaskStatus.WAITING,
            subStatus: TaskSubStatus.PENDING_APPLY,
          },
          {
            subStatus: TaskSubStatus.PENDING_RESUME,
            resumePrompt: prompt,
            remindCount: 0,
            firstRemindedAt: null,
            lastRemindedAt: null,
          },
        );
      } else if (
        parent.status === TaskStatus.WAITING &&
        parent.subStatus === TaskSubStatus.PENDING_ACCEPT
      ) {
        if (entry.status !== 'pending') {
          const reopened = await this.workerInbox.reopen(
            entry.id,
            '父任务验收阶段遗留未消费事件，重新排队',
          );
          if (!reopened) continue;
          entry.status = 'pending';
        }
        updated = await this.tasks.update(
          {
            id: parent.id,
            status: TaskStatus.WAITING,
            subStatus: TaskSubStatus.PENDING_ACCEPT,
          },
          {
            subStatus: TaskSubStatus.PENDING_RESUME,
            resumePrompt: prompt,
            remindCount: 0,
            firstRemindedAt: null,
            lastRemindedAt: null,
          },
        );
      } else if (
        parent.status === TaskStatus.RUNNING &&
        parent.subStatus === TaskSubStatus.EXECUTING
      ) {
        // 会话已结束但任务仍停在执行中（历史/竞态兜底）时，机器人实际空闲，
        // 可以把子任务事件排入待继续并唤醒；当前回合仍在输出时保持 pending。
        if (this.dispatchService.taskChatRunning(parent.id)) {
          continue;
        }
        if (entry.status !== 'pending') {
          const reopened = await this.workerInbox.reopen(
            entry.id,
            '父任务回合已结束但事件未被处理，重新排队',
          );
          if (!reopened) continue;
          entry.status = 'pending';
        }
        updated = await this.tasks.update(
          {
            id: parent.id,
            status: TaskStatus.RUNNING,
            subStatus: TaskSubStatus.EXECUTING,
          },
          {
            status: TaskStatus.WAITING,
            subStatus: TaskSubStatus.PENDING_RESUME,
            resumePrompt: prompt,
            remindCount: 0,
            firstRemindedAt: null,
            lastRemindedAt: null,
          },
        );
      } else {
        // 父任务自身的待分配、待接受、待反馈等状态不能被覆盖；
        // 保持事件排队并退避重试，等待父任务进入可处理状态。
        await this.deferInboxEntry(
          entry,
          parent,
          child,
          `父任务当前为 ${parent.status}-${parent.subStatus}，暂不能处理子任务事件`,
        );
        continue;
      }
      if (!updated?.affected) continue;
      await this.workerInbox.markQueued(entry.id);
      await this.tasksService.addEvent(
        parent.id,
        '系统',
        `子任务 ${child.code} 的 ${entry.kind} 事件已入队，父任务转入等待中-待继续`,
        null,
        { childTaskId: child.id, inboxId: entry.id, kind: entry.kind },
      );
    }
  }

  /** 根任务执行方消息：调用需求方机器人一次性会话回复，不覆盖任务状态。 */
  private async queueRootRequesterMessage(
    task: Task,
    entry: TaskWorkerInbox,
  ): Promise<void> {
    if (
      task.parentId ||
      task.requesterType !== 'worker' ||
      task.requesterId !== entry.workerId
    ) {
      await this.workerInbox.markDead(entry.id);
      return;
    }
    if (entry.kind !== 'message') {
      await this.workerInbox.markDead(entry.id);
      return;
    }
    if (task.status === TaskStatus.FINISHED) {
      await this.workerInbox.markDone(entry.id);
      return;
    }
    if (this.requesterReply.isActive(task.id)) return;
    await this.requesterReply.reply(task, entry);
  }

  /** 根任务机器人需求方自动验收：每 30s 扫描待验收的根任务。 */
  private async queueRootRequesterVerification(): Promise<void> {
    const now = Date.now();
    if (now - this.lastRequesterVerifyScanAt < REQUESTER_VERIFY_SCAN_MS) return;
    this.lastRequesterVerifyScanAt = now;
    const rows = await this.tasks.find({
      where: {
        status: TaskStatus.WAITING,
        subStatus: TaskSubStatus.PENDING_ACCEPT,
        parentId: IsNull(),
        requesterType: 'worker',
      },
      order: { id: 'ASC' },
      take: 20,
    });
    for (const task of rows) {
      if (!task.requesterId) continue;
      if (this.requesterVerify.isActive(task.id)) continue;
      void this.requesterVerify.verify(task);
    }
  }

  /** 子任务事件是否仍需要父机器人通过动作接口处理。 */
  private childEventNeedsAction(entry: TaskWorkerInbox, child: Task): boolean {
    if (entry.kind === 'question') {
      return (
        child.status === TaskStatus.WAITING &&
        child.subStatus === TaskSubStatus.PENDING_FEEDBACK
      );
    }
    if (entry.kind === 'handoff') {
      return (
        child.status === TaskStatus.WAITING &&
        child.subStatus === TaskSubStatus.PENDING_ACCEPT
      );
    }
    if (entry.kind === 'message') {
      // 任务未结束时执行方都可能等待需求方回复；结束后无需再回。
      return child.status !== TaskStatus.FINISHED;
    }
    return true;
  }

  /** 父任务暂时无法消费事件时按指数退避记录一次失败尝试。 */
  private async deferInboxEntry(
    entry: TaskWorkerInbox,
    parent: Task,
    child: Task,
    reason: string,
  ): Promise<void> {
    const attempts = entry.attempts ?? 0;
    const delay = nextInboxRetryDelay(attempts);
    const nextRetryAt = new Date(Date.now() + delay);
    await this.workerInbox.defer(entry.id, nextRetryAt, reason);
    if (attempts > 0) return;
    await this.tasksService.addEvent(
      child.id,
      '系统',
      `子任务协同事件暂时无法处理：${reason}；平台将在 ${Math.round(delay / 60_000)} 分钟后继续重试`,
      null,
      {
        watchdog: true,
        parentTaskId: parent.id,
        inboxId: entry.id,
        kind: entry.kind,
        nextRetryAt: nextRetryAt.toISOString(),
      },
    );
  }

  // ===== 待反馈 / 待验收提醒 =====

  private async processReminders(kind: 'feedback' | 'accept'): Promise<void> {
    const subStatus =
      kind === 'feedback'
        ? TaskSubStatus.PENDING_FEEDBACK
        : TaskSubStatus.PENDING_ACCEPT;
    const list = await this.tasks.find({
      where: { status: TaskStatus.WAITING, subStatus },
      select: {
        id: true,
        code: true,
        title: true,
        status: true,
        subStatus: true,
        remindCount: true,
        firstRemindedAt: true,
        lastRemindedAt: true,
        missingItems: true,
        agentId: true,
        schedulerId: true,
        createdById: true,
        requesterType: true,
        requesterId: true,
        parentId: true,
        rootId: true,
      },
      order: { id: 'ASC' },
      take: REMIND_BATCH_SIZE,
    });
    const now = Date.now();
    for (const task of list) {
      if (this.reminding.has(task.id)) continue;
      const action = nextReminderAction(
        task.firstRemindedAt,
        task.lastRemindedAt,
        now,
      );
      if (action === 'wait') continue;
      if (action === 'terminate') {
        await this.terminateByTimeout(task.id, kind);
        continue;
      }
      await this.sendReminder(task, kind);
    }
  }

  private async sendReminder(
    task: Task,
    kind: 'feedback' | 'accept',
  ): Promise<void> {
    this.reminding.add(task.id);
    try {
      const now = new Date();
      const count = (task.remindCount ?? 0) + 1;
      const firstRemindedAt = task.firstRemindedAt ?? now;
      const title =
        kind === 'feedback'
          ? `任务待反馈：${task.code} ${task.title}`
          : `任务待验收：${task.code} ${task.title}`;
      const feedbackText = (task.missingItems ?? [])
        .map((item) => item.item)
        .join('、');
      const description =
        kind === 'feedback'
          ? `请答复任务提问或补充资料。待反馈事项：${feedbackText || '见任务详情'}`
          : '机器人已完成执行，请需求方验收产出。';
      const result = await this.taskNotify.notifyTaskRequester(
        task,
        kind,
        title,
        description,
      );
      await this.tasks.update(
        { id: task.id, status: TaskStatus.WAITING, subStatus: task.subStatus },
        { remindCount: count, firstRemindedAt, lastRemindedAt: now },
      );
      await this.tasksService.addEvent(
        task.id,
        '系统',
        `第 ${count} 次提醒${result.sent ? `已发送${result.ownerName ? `给「${result.ownerName}」` : ''}` : '未发送（机器人需求方由收件箱驱动或未找到接收人）'}；首次提醒满 ${TASK_REMIND_TIMEOUT_DAYS} 天未处理将自动${kind === 'feedback' ? '标记为失败（已结束-取消）' : '按成功完成（已结束-完成）'}`,
        null,
        { remindCount: count, firstRemindedAt: firstRemindedAt.toISOString() },
      );
    } finally {
      this.reminding.delete(task.id);
    }
  }

  private async terminateByTimeout(
    taskId: number,
    kind: 'feedback' | 'accept',
  ): Promise<void> {
    const now = new Date();
    const subStatus =
      kind === 'feedback'
        ? TaskSubStatus.PENDING_FEEDBACK
        : TaskSubStatus.PENDING_ACCEPT;
    const patch =
      kind === 'feedback'
        ? {
            status: TaskStatus.FINISHED,
            subStatus: TaskSubStatus.CANCELED,
            canceledAt: now,
          }
        : {
            status: TaskStatus.FINISHED,
            subStatus: TaskSubStatus.COMPLETED,
            acceptedAt: now,
            acceptedBy: '系统（超时自动验收）',
            deliveredAt: now,
          };
    const updated = await this.tasks.update(
      { id: taskId, status: TaskStatus.WAITING, subStatus },
      patch,
    );
    if (!updated.affected) return;
    await this.tasksService.addEvent(
      taskId,
      '状态变更',
      kind === 'feedback'
        ? `状态变更：等待中-待反馈 → 已结束-取消（首次提醒已超过 ${TASK_REMIND_TIMEOUT_DAYS} 天未处理）`
        : `状态变更：等待中-待验收 → 已结束-完成（首次提醒已超过 ${TASK_REMIND_TIMEOUT_DAYS} 天未处理）`,
      null,
    );
    await this.workerInbox.completeForChild(taskId);
    if (kind === 'feedback') {
      // 提问超时取消后，父机器人不能继续保留失效问题。
      const child = await this.tasks.findOne({ where: { id: taskId } });
      if (child) {
        await this.workerInbox.enqueue(child, 'cancelled', {
          payload: { reason: '提问等待超时，任务自动取消' },
        });
      }
    }
  }

  // ===== 启动迁移 =====

  private async migrateLegacyStatuses(): Promise<void> {
    const rows = await this.tasks.find();
    const byId = new Map(rows.map((row) => [row.id, row]));
    let migrated = 0;
    for (const row of rows) {
      const patch: Partial<Task> = {};
      const mapped = mapLegacyTaskStatus(row.status, row.subStatus);
      if (mapped) {
        patch.status = mapped.status;
        patch.subStatus = mapped.subStatus;
        patch.remindCount = 0;
        patch.firstRemindedAt = null;
        patch.lastRemindedAt = null;
      }
      if (!row.requesterType) {
        const parent = row.parentId ? byId.get(row.parentId) : null;
        const root = row.rootId ? byId.get(row.rootId) : null;
        if (parent?.agentId) {
          patch.requesterType = 'worker';
          patch.requesterId = parent.agentId;
        } else if (row.createdById) {
          patch.requesterType = 'user';
          patch.requesterId = row.createdById;
        } else if (root?.createdById) {
          patch.requesterType = 'user';
          patch.requesterId = root.createdById;
        }
      }
      if (Object.keys(patch).length === 0) continue;
      await this.tasks.update(row.id, patch);
      migrated += 1;
    }
    if (migrated > 0) {
      this.logger.log(`任务协同状态/需求方迁移完成：${migrated} 条`);
    }
  }
}
