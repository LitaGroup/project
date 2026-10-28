import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, Repository } from 'typeorm';
import { TaskStatus, TaskSubStatus } from '../common/enums';
import { Task, TaskMissingItem } from './task.entity';
import {
  TaskAssignmentService,
  type TaskAssignmentResult,
} from './task-assignment.service';
import { TaskDispatchService } from './task-dispatch.service';
import {
  TaskNotifyService,
  type TaskNotifyResult,
} from './task-notify.service';
import {
  mapLegacyTaskStatus,
  nextReminderAction,
  TASK_REMIND_TIMEOUT_DAYS,
} from './task-loop.rules';
import { TasksService } from './tasks.service';
import {
  taskInboxPrompt,
  TaskWorkerInboxService,
} from './task-worker-inbox.service';

const REMIND_BATCH_SIZE = 100;
const OFFER_RETRY_MS = 30_000;

/**
 * 多机器人任务 LOOP（每秒）：
 * 待分配→分配；待接受→任务邀约；待继续→机器人空闲后恢复；
 * 机器人需求方收件箱→父任务待继续；待反馈/待验收仅提醒，不占用机器人。
 */
@Injectable()
export class TaskLoopService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TaskLoopService.name);
  private ready = false;
  private running = false;
  private readonly reminding = new Set<number>();
  private readonly offering = new Set<number>();
  private readonly resuming = new Set<number>();

  constructor(
    @InjectRepository(Task)
    private readonly tasks: Repository<Task>,
    private readonly tasksService: TasksService,
    private readonly assignmentService: TaskAssignmentService,
    private readonly dispatchService: TaskDispatchService,
    private readonly taskNotify: TaskNotifyService,
    private readonly workerInbox: TaskWorkerInboxService,
  ) {}

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
      await this.queueWorkerInbox();
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
            item: '任务分配失败，请检查任务定义或任务类型',
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
      // 忙碌机器人继续等待；待接受邀约也只在空闲后发送。
      if (await this.dispatchService.isWorkerBusy(result.agentId)) continue;
      const updated = await this.tasks.update(
        {
          id: task.id,
          status: TaskStatus.WAITING,
          subStatus: TaskSubStatus.PENDING_ASSIGNMENT,
        },
        {
          subStatus: TaskSubStatus.PENDING_ACCEPTANCE,
          type: result.type,
          templateId: result.templateId,
          templateName: result.templateName,
          agentId: result.agentId,
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
        'type-definition': '同类型任务定义',
        'type-worker': '机器人任务定义',
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
      if (this.offering.has(task.id) || !task.agentId) continue;
      if (task.offerAttemptAt) {
        const attemptedAt = new Date(task.offerAttemptAt).getTime();
        if (now - attemptedAt < OFFER_RETRY_MS) continue;
      }
      if (this.dispatchService.taskChatRunning(task.id)) continue;
      if (await this.dispatchService.isWorkerBusy(task.agentId)) continue;
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
      try {
        await this.dispatchService.offer(task.id);
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
    }
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
    for (const task of pending) {
      if (this.resuming.has(task.id) || !task.agentId) continue;
      if (this.dispatchService.taskChatRunning(task.id)) continue;
      if (await this.dispatchService.isWorkerBusy(task.agentId)) continue;
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
      } catch (e) {
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
          `恢复执行失败，任务回到等待中-待继续：${(e as Error).message}`,
          null,
        );
      } finally {
        this.resuming.delete(task.id);
      }
    }
  }

  // ===== 父机器人收件箱 =====

  private async queueWorkerInbox(): Promise<void> {
    const entries = await this.workerInbox.listPending();
    for (const entry of entries) {
      const [parent, child] = await Promise.all([
        this.tasks.findOne({ where: { id: entry.parentTaskId } }),
        this.tasks.findOne({ where: { id: entry.childTaskId } }),
      ]);
      if (!child) {
        await this.workerInbox.markDead(entry.id);
        continue;
      }
      if (
        !parent ||
        parent.status === TaskStatus.FINISHED ||
        parent.agentId !== entry.workerId
      ) {
        await this.workerInbox.markDead(entry.id);
        // 父机器人不可用时把需求方回退给根任务创建人，避免子任务永久卡住。
        const root =
          child.rootId && child.rootId !== child.id
            ? await this.tasks.findOne({ where: { id: child.rootId } })
            : null;
        if (root?.createdById) {
          await this.tasks.update(
            { id: child.id },
            { requesterType: 'user', requesterId: root.createdById },
          );
          child.requesterType = 'user';
          child.requesterId = root.createdById;
          await this.tasksService.addEvent(
            child.id,
            '系统',
            '父任务已结束或无法唤醒，需求方自动回退为根任务创建人',
            null,
            { parentTaskId: parent?.id ?? entry.parentTaskId },
          );
        }
        const notified = await this.taskNotify.notifyTaskRequester(
          child,
          'notice',
          `子任务需要人工介入：${child.code} ${child.title}`,
          '父任务已结束或需求方机器人已变化，请到任务详情处理提问或验收。',
        );
        if (!notified.sent) {
          await this.taskNotify.notifyTaskAgentOwner(
            child,
            'notice',
            `子任务需要人工介入：${child.code} ${child.title}`,
            '父任务已结束或需求方机器人已变化，请人工处理子任务。',
          );
        }
        continue;
      }
      if (parent.status !== TaskStatus.WAITING) continue;
      const prompt = taskInboxPrompt(entry, child);
      if (parent.subStatus === TaskSubStatus.PENDING_RESUME) {
        if (parent.resumePrompt?.includes(`事件收件箱 ID：${entry.id}`)) {
          await this.workerInbox.markQueued(entry.id);
          continue;
        }
        await this.tasks.update(
          { id: parent.id, status: TaskStatus.WAITING },
          {
            resumePrompt: [parent.resumePrompt?.trim(), prompt]
              .filter(Boolean)
              .join('\n\n---\n\n'),
          },
        );
        await this.workerInbox.markQueued(entry.id);
        continue;
      }
      const updated = await this.tasks.update(
        { id: parent.id, status: TaskStatus.WAITING },
        {
          subStatus: TaskSubStatus.PENDING_RESUME,
          resumePrompt: prompt,
          remindCount: 0,
          firstRemindedAt: null,
          lastRemindedAt: null,
        },
      );
      if (!updated.affected) continue;
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
        ownerTakeoverAt: true,
        ownerTakeoverUserId: true,
        ownerTakeoverName: true,
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
          ? task.ownerTakeoverAt
            ? `验收不通过已达阈值，请任务负责人「${task.ownerTakeoverName ?? '未配置'}」补充处理意见。待处理事项：${feedbackText || '见任务详情'}`
            : `请答复任务提问或补充资料。待反馈事项：${feedbackText || '见任务详情'}`
          : '机器人已完成执行，请需求方验收产出。';
      let result: TaskNotifyResult;
      if (kind === 'accept') {
        result = await this.taskNotify.notifyTaskRequester(
          task,
          kind,
          title,
          description,
        );
      } else if (task.ownerTakeoverAt) {
        result = await this.taskNotify.notifyTaskAgentOwner(
          task,
          kind,
          title,
          description,
        );
        if (!result.sent) {
          result = await this.taskNotify.notifyTaskRequester(
            task,
            kind,
            title,
            description,
          );
        }
      } else {
        result = await this.taskNotify.notifyTaskRequester(
          task,
          kind,
          title,
          description,
        );
      }
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
