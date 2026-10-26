import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TaskStatus, TaskSubStatus, WorkerRole } from '../common/enums';
import {
  TaskIdentification,
  TaskIdentifyService,
} from './task-identify.service';
import { WorkersService, WorkerView } from '../workers/workers.service';
import { Task, TaskMissingItem } from './task.entity';
import { TaskDispatchService } from './task-dispatch.service';
import { TaskNotifyService } from './task-notify.service';
import {
  mapLegacyTaskStatus,
  nextReminderAction,
  TASK_MAX_REMINDERS,
} from './task-loop.rules';
import { TasksService } from './tasks.service';

/** 同时进行中的识别任务上限（避免一次占用过多执行器会话） */
const MAX_CONCURRENT_IDENTIFY = 3;

/** 单次识别超时：超时按识别失败转待反馈 */
const IDENTIFY_TIMEOUT_MS = 5 * 60 * 1000;

/** 提醒收件查询上限（防止极端堆积时单轮过重） */
const REMIND_BATCH_SIZE = 100;

/**
 * 任务 LOOP（每秒一次）：按「主状态 + 子状态」推进任务。
 *
 * 等待中-待识别 → 分配系统调度机器人，置「进行中-识别中」，异步识别任务详情与工作计划；
 * 等待中-待反馈 → 每 30 分钟提醒负责人一次，3 次未处理标记失败（已结束-取消）；
 * 等待中-待验收 → 每 30 分钟提醒负责人一次，3 次未处理按成功完成（已结束-完成）；
 * 进行中 / 已结束 → 本轮不处理。
 */
@Injectable()
export class TaskLoopService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TaskLoopService.name);

  /** 启动迁移完成后才开始循环 */
  private ready = false;

  /** 单轮互斥：通知/识别启动串行执行，避免重叠 */
  private running = false;

  /** 进程内正在识别的任务（防止重复调用） */
  private readonly identifying = new Set<number>();

  /** 进程内正在发送提醒的任务 */
  private readonly reminding = new Set<number>();

  /** 无可用调度机器人的告警节流 */
  private lastNoSchedulerLogAt = 0;

  constructor(
    @InjectRepository(Task)
    private readonly tasks: Repository<Task>,
    private readonly tasksService: TasksService,
    private readonly workersService: WorkersService,
    private readonly identifyService: TaskIdentifyService,
    private readonly dispatchService: TaskDispatchService,
    private readonly taskNotify: TaskNotifyService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.migrateLegacyStatuses();
      await this.recoverInterruptedIdentifying();
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
      await this.identifyPending();
      await this.processReminders('feedback');
      await this.processReminders('accept');
    } catch (e) {
      this.logger.warn(`任务 LOOP 执行失败: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  // ===== 待识别 =====

  /** 领取待识别任务 → 进行中-识别中 → 异步识别 */
  private async identifyPending(): Promise<void> {
    if (this.identifying.size >= MAX_CONCURRENT_IDENTIFY) return;
    const pending = await this.tasks.find({
      where: {
        status: TaskStatus.WAITING,
        subStatus: TaskSubStatus.PENDING_IDENTIFY,
      },
      order: { id: 'ASC' },
      take: 20,
    });
    if (pending.length === 0) return;

    const roster = (
      await this.workersService.findAll({ role: WorkerRole.WORKER })
    ).filter((w) => w.enabled);
    for (const task of pending) {
      if (this.identifying.size >= MAX_CONCURRENT_IDENTIFY) break;
      if (this.identifying.has(task.id)) continue;
      const scheduler = await this.tasksService.findScheduler(
        task.schedulerId ?? null,
      );
      if (!scheduler) {
        this.warnNoScheduler();
        continue;
      }
      // 原子领取：仅当仍是「等待中-待识别」时推进，避免并发重复识别
      const claimed = await this.tasks.update(
        {
          id: task.id,
          status: TaskStatus.WAITING,
          subStatus: TaskSubStatus.PENDING_IDENTIFY,
        },
        {
          status: TaskStatus.RUNNING,
          subStatus: TaskSubStatus.IDENTIFYING,
          schedulerId: scheduler.id,
          missingItems: null,
          remindCount: 0,
          lastRemindedAt: null,
        },
      );
      if (!claimed.affected) continue;
      await this.tasksService
        .addEvent(
          task.id,
          '系统',
          `开始识别（调度机器人：${scheduler.name}）`,
          null,
          { schedulerId: scheduler.id },
        )
        .catch((e: Error) =>
          this.logger.warn(
            `任务 #${task.id} 记录识别开始事件失败: ${e.message}`,
          ),
        );
      this.identifying.add(task.id);
      void this.identifyTask(task.id, scheduler, roster)
        .catch((e: Error) => {
          this.logger.warn(`任务 #${task.id} 识别异常: ${e.message}`);
        })
        .finally(() => this.identifying.delete(task.id));
    }
  }

  /** 调用系统调度机器人识别单个任务 */
  private async identifyTask(
    taskId: number,
    scheduler: WorkerView,
    roster: WorkerView[],
  ): Promise<void> {
    const task = await this.tasks.findOne({ where: { id: taskId } });
    if (
      !task ||
      task.status !== TaskStatus.RUNNING ||
      task.subStatus !== TaskSubStatus.IDENTIFYING
    ) {
      return;
    }
    let result: TaskIdentification;
    try {
      result = await this.withTimeout(
        this.identifyService.identify(
          task,
          scheduler,
          roster,
          IDENTIFY_TIMEOUT_MS,
        ),
        IDENTIFY_TIMEOUT_MS + 5_000,
        '任务识别超时（超过 5 分钟）',
      );
    } catch (e) {
      await this.toFeedback(
        task.id,
        [
          {
            item: '任务识别失败，请补充任务描述或确认任务信息',
            reason: (e as Error).message,
          },
        ],
        '识别失败',
      );
      return;
    }
    await this.applyIdentification(task.id, scheduler, roster, result);
  }

  /** 应用识别结果：反馈 → 待反馈；成功 → 落任务详情并自动派发 */
  private async applyIdentification(
    taskId: number,
    scheduler: WorkerView,
    roster: WorkerView[],
    result: TaskIdentification,
  ): Promise<void> {
    const task = await this.tasks.findOne({ where: { id: taskId } });
    if (
      !task ||
      task.status !== TaskStatus.RUNNING ||
      task.subStatus !== TaskSubStatus.IDENTIFYING
    ) {
      return;
    }
    // 人工预先分配的机器人优先；否则用调度机器人建议，再兜底第一个可用机器人
    const agentId = task.agentId ?? result.agentId ?? roster[0]?.id ?? null;
    const agentName =
      roster.find((w) => w.id === agentId)?.name ??
      (result.agentId === agentId ? result.agentName : undefined) ??
      (agentId ? `#${agentId}` : null);
    const fields = {
      title: (result.title ?? task.title).slice(0, 200),
      type: result.type,
      input: result.input ?? task.input,
      outputSpec: result.outputSpec ?? task.outputSpec,
      workPlan: result.workPlan ?? task.workPlan,
      schedulerId: scheduler.id,
      agentId,
    };

    const feedback = [...result.feedback];
    if (feedback.length === 0 && !agentId) {
      feedback.push({
        item: '未匹配到可执行机器人，请配置/启用机器人后重新识别',
        reason:
          '调度机器人没有从候选机器人中选出执行者，且系统没有可用的工作者',
      });
    }
    if (feedback.length > 0) {
      const updated = await this.tasks.update(
        {
          id: task.id,
          status: TaskStatus.RUNNING,
          subStatus: TaskSubStatus.IDENTIFYING,
        },
        {
          ...fields,
          // 待反馈阶段不锁定调度机器人的机器人建议（保留人工预先分配），补齐后重新识别再分配
          agentId: task.agentId,
          status: TaskStatus.WAITING,
          subStatus: TaskSubStatus.PENDING_FEEDBACK,
          missingItems: feedback,
          remindCount: 0,
          lastRemindedAt: null,
        },
      );
      if (!updated.affected) return;
      await this.tasksService.addEvent(
        task.id,
        '状态变更',
        `状态变更：进行中-识别中 → 等待中-待反馈（需用户补充/确认 ${feedback.length} 项：${feedback
          .map((f) => f.item)
          .join('、')}）`,
        null,
        { schedulerId: scheduler.id },
      );
      return;
    }

    const updated = await this.tasks.update(
      {
        id: task.id,
        status: TaskStatus.RUNNING,
        subStatus: TaskSubStatus.IDENTIFYING,
      },
      {
        ...fields,
        missingItems: null,
        remindCount: 0,
        lastRemindedAt: null,
      },
    );
    if (!updated.affected) return;
    await this.tasksService.addEvent(
      task.id,
      '系统',
      `识别完成：${result.type}${agentName ? `，分配给「${agentName}」` : ''}${result.workPlan ? '，已生成工作计划' : ''}`,
      null,
      {
        schedulerId: scheduler.id,
        workPlan: result.workPlan ?? null,
        title: fields.title,
        input: fields.input,
        outputSpec: fields.outputSpec,
        agentId: fields.agentId,
        agentName,
      },
    );

    // 识别成功 → 进入执行中（派发失败转待反馈，由负责人处理）
    try {
      await this.dispatchService.dispatch(task.id, null);
    } catch (e) {
      await this.toFeedback(
        task.id,
        [
          {
            item: '任务已识别，但派发失败，请确认机器人/执行器配置后重新识别',
            reason: (e as Error).message,
          },
        ],
        '派发失败',
      );
    }
  }

  /** 识别失败 → 等待中-待反馈（条件更新，避免覆盖用户取消等并发状态） */
  private async toFeedback(
    taskId: number,
    items: TaskMissingItem[],
    reason: string,
  ): Promise<void> {
    const updated = await this.tasks.update(
      {
        id: taskId,
        status: TaskStatus.RUNNING,
        subStatus: TaskSubStatus.IDENTIFYING,
      },
      {
        status: TaskStatus.WAITING,
        subStatus: TaskSubStatus.PENDING_FEEDBACK,
        missingItems: items,
        remindCount: 0,
        lastRemindedAt: null,
      },
    );
    if (!updated.affected) return;
    await this.tasksService.addEvent(
      taskId,
      '状态变更',
      `状态变更：进行中-识别中 → 等待中-待反馈（${reason}：${items
        .map((i) => i.item)
        .join('、')}）`,
      null,
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
        lastRemindedAt: true,
        missingItems: true,
        agentId: true,
        schedulerId: true,
      },
      order: { id: 'ASC' },
      take: REMIND_BATCH_SIZE,
    });
    if (list.length === 0) return;
    const now = Date.now();
    for (const task of list) {
      if (this.reminding.has(task.id)) continue;
      const action = nextReminderAction(
        task.remindCount,
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
      const count = (task.remindCount ?? 0) + 1;
      const title =
        kind === 'feedback'
          ? `任务待反馈：${task.code} ${task.title}`
          : `任务待验收：${task.code} ${task.title}`;
      const feedbackText = (task.missingItems ?? [])
        .map((item) => item.item)
        .join('、');
      const description =
        kind === 'feedback'
          ? `请补充资料或确认信息后重新提交识别。待反馈事项：${feedbackText || '见任务详情'}`
          : '机器人已完成执行，请到平台验收产出。';
      const result = await this.taskNotify.notifyTaskOwner(
        task,
        kind,
        title,
        description,
      );
      const subStatus =
        kind === 'feedback'
          ? TaskSubStatus.PENDING_FEEDBACK
          : TaskSubStatus.PENDING_ACCEPT;
      await this.tasks.update(
        { id: task.id, status: TaskStatus.WAITING, subStatus },
        { remindCount: count, lastRemindedAt: new Date() },
      );
      await this.tasksService.addEvent(
        task.id,
        '系统',
        `第 ${count}/${TASK_MAX_REMINDERS} 次提醒${
          result.sent
            ? `已发送给负责人${result.ownerName ? `「${result.ownerName}」` : ''}`
            : '未发送（未找到负责人）'
        }；${TASK_MAX_REMINDERS} 次未处理将自动${
          kind === 'feedback'
            ? '标记为失败（已结束-取消）'
            : '按成功完成（已结束-完成）'
        }`,
        null,
        { remindCount: count },
      );
    } finally {
      this.reminding.delete(task.id);
    }
  }

  /** 3 次提醒后仍未处理：待反馈→失败取消；待验收→成功完成 */
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
        ? `状态变更：等待中-待反馈 → 已结束-取消（已提醒 ${TASK_MAX_REMINDERS} 次仍未处理，任务标记为失败）`
        : `状态变更：等待中-待验收 → 已结束-完成（已提醒 ${TASK_MAX_REMINDERS} 次仍未处理，超时按成功完成）`,
      null,
    );
  }

  // ===== 启动迁移 / 恢复 =====

  /** 历史状态值 → 新「主状态 + 子状态」（幂等） */
  private async migrateLegacyStatuses(): Promise<void> {
    const rows = await this.tasks.find();
    let migrated = 0;
    for (const row of rows) {
      const mapped = mapLegacyTaskStatus(row.status);
      if (!mapped) continue;
      const patch: Partial<Task> = {
        status: mapped.status,
        subStatus: mapped.subStatus,
        remindCount: 0,
        lastRemindedAt: null,
      };
      if (
        mapped.subStatus === TaskSubStatus.PENDING_FEEDBACK &&
        !row.missingItems?.length
      ) {
        patch.missingItems = [
          {
            item: '任务信息待补充/确认',
            reason: '历史待补材料任务迁移，请补充资料后重新识别',
          },
        ];
      }
      await this.tasks.update(row.id, patch);
      migrated++;
    }
    if (migrated > 0) {
      this.logger.log(
        `任务状态迁移完成：${migrated} 条历史任务转为「主状态 + 子状态」`,
      );
    }
  }

  /** 服务重启后，进程内的识别任务已中断：识别中 → 待识别，重新排队 */
  private async recoverInterruptedIdentifying(): Promise<void> {
    const interrupted = await this.tasks.find({
      where: {
        status: TaskStatus.RUNNING,
        subStatus: TaskSubStatus.IDENTIFYING,
      },
      select: { id: true },
    });
    for (const task of interrupted) {
      await this.tasks.update(
        {
          id: task.id,
          status: TaskStatus.RUNNING,
          subStatus: TaskSubStatus.IDENTIFYING,
        },
        {
          status: TaskStatus.WAITING,
          subStatus: TaskSubStatus.PENDING_IDENTIFY,
        },
      );
      await this.tasksService.addEvent(
        task.id,
        '系统',
        '服务重启导致识别中断，已重新排队识别',
        null,
      );
    }
    if (interrupted.length > 0) {
      this.logger.log(`重新排队识别任务 ${interrupted.length} 个`);
    }
  }

  private warnNoScheduler(): void {
    const now = Date.now();
    if (now - this.lastNoSchedulerLogAt < 60_000) return;
    this.lastNoSchedulerLogAt = now;
    this.logger.warn(
      '有任务待识别，但没有可用的调度机器人（请在「机器人」页配置并启用系统调度机器人）',
    );
  }

  /** Promise 超时包装（超时后原调用即使返回也会因状态已变更而被忽略） */
  private withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    message: string,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error: Error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }
}
