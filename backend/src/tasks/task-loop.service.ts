import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TaskStatus, TaskSubStatus } from '../common/enums';
import { Task, TaskMissingItem } from './task.entity';
import {
  TaskAssignmentService,
  type TaskAssignmentResult,
} from './task-assignment.service';
import { TaskDispatchService } from './task-dispatch.service';
import { TaskNotifyService } from './task-notify.service';
import {
  mapLegacyTaskStatus,
  nextReminderAction,
  TASK_REMIND_TIMEOUT_DAYS,
} from './task-loop.rules';
import { TasksService } from './tasks.service';

/** 提醒收件查询上限（防止极端堆积时单轮过重） */
const REMIND_BATCH_SIZE = 100;

/**
 * 任务 LOOP（每秒一次）：按「主状态 + 子状态」推进任务。
 *
 * 等待中-待识别 → 置「进行中-识别中」，平台按任务定义/类型直接识别分配处理机器人；
 * 无法匹配时归入「未知任务」并交给系统未知任务定义（ID=6）的处理机器人；
 * 等待中-待反馈 → 每 30 分钟提醒负责人一次，首次提醒满 7 天未处理标记失败（已结束-取消）；
 * 等待中-待验收 → 每 30 分钟提醒需求方一次，首次提醒满 7 天未处理按成功完成（已结束-完成）；
 * 进行中 / 已结束 → 本轮不处理。
 */
@Injectable()
export class TaskLoopService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TaskLoopService.name);

  /** 启动迁移完成后才开始循环 */
  private ready = false;

  /** 单轮互斥：通知/识别启动串行执行，避免重叠 */
  private running = false;

  /** 进程内正在发送提醒的任务 */
  private readonly reminding = new Set<number>();

  constructor(
    @InjectRepository(Task)
    private readonly tasks: Repository<Task>,
    private readonly tasksService: TasksService,
    private readonly assignmentService: TaskAssignmentService,
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
      await this.assignPending();
      await this.processReminders('feedback');
      await this.processReminders('accept');
    } catch (e) {
      this.logger.warn(`任务 LOOP 执行失败: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  // ===== 待识别分配 =====

  /** 领取待识别任务 → 进行中-识别中 → 平台直接识别分配 */
  private async assignPending(): Promise<void> {
    const pending = await this.tasks.find({
      where: {
        status: TaskStatus.WAITING,
        subStatus: TaskSubStatus.PENDING_IDENTIFY,
      },
      order: { id: 'ASC' },
      take: 20,
    });
    for (const task of pending) {
      // 原子领取：仅当仍是「等待中-待识别」时推进，避免并发重复处理
      const claimed = await this.tasks.update(
        {
          id: task.id,
          status: TaskStatus.WAITING,
          subStatus: TaskSubStatus.PENDING_IDENTIFY,
        },
        {
          status: TaskStatus.RUNNING,
          subStatus: TaskSubStatus.IDENTIFYING,
          missingItems: null,
          remindCount: 0,
          firstRemindedAt: null,
          lastRemindedAt: null,
        },
      );
      if (!claimed.affected) continue;
      await this.tasksService
        .addEvent(
          task.id,
          '系统',
          '开始识别分配（平台按任务定义/类型直接匹配，不调用机器人）',
          null,
        )
        .catch((e: Error) =>
          this.logger.warn(
            `任务 #${task.id} 记录识别分配开始事件失败: ${e.message}`,
          ),
        );
      void this.assignTask(task.id).catch((e: Error) => {
        this.logger.warn(`任务 #${task.id} 识别分配异常: ${e.message}`);
      });
    }
  }

  /** 平台本地识别并分配处理机器人，成功后进入任务处理 */
  private async assignTask(taskId: number): Promise<void> {
    const task = await this.tasks.findOne({ where: { id: taskId } });
    if (
      !task ||
      task.status !== TaskStatus.RUNNING ||
      task.subStatus !== TaskSubStatus.IDENTIFYING
    ) {
      return;
    }

    let result: TaskAssignmentResult;
    try {
      result = await this.assignmentService.assign(task);
    } catch (e) {
      await this.toFeedback(
        task.id,
        [
          {
            item: '任务识别分配失败，请补充任务定义或任务类型后重试',
            reason: (e as Error).message,
          },
        ],
        '识别分配失败',
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
        type: result.type,
        templateId: result.templateId,
        templateName: result.templateName,
        agentId: result.agentId,
        missingItems: null,
        remindCount: 0,
        firstRemindedAt: null,
        lastRemindedAt: null,
      },
    );
    if (!updated.affected) return;

    if (result.agentId && result.agentId !== task.agentId) {
      await this.tasksService.addEvent(
        task.id,
        '分配',
        `自动分配：${task.agentId ? `#${task.agentId}` : '未分配'} → ${
          result.agentName ?? `#${result.agentId}`
        }`,
        null,
        {
          fromAgentId: task.agentId,
          toAgentId: result.agentId,
          automatic: true,
          source: result.source,
        },
      );
    }

    const sourceLabel = {
      manual: '人工预分配',
      definition: '任务定义',
      'type-definition': '同类型任务定义',
      'type-worker': '机器人任务定义',
      unknown: '系统未知任务定义（ID=6）',
    }[result.source];
    await this.tasksService.addEvent(
      task.id,
      '系统',
      `识别分配完成：${result.type}${
        result.agentName ? `，分配给「${result.agentName}」` : ''
      }（${sourceLabel}）`,
      null,
      {
        source: result.source,
        originalType: result.originalType ?? null,
        templateId: result.templateId,
        templateName: result.templateName,
        agentId: result.agentId,
        agentName: result.agentName,
      },
    );

    if (!result.agentId) {
      await this.toFeedback(
        task.id,
        [
          {
            item: '未找到可承接任务的机器人，请联系管理员配置系统未知任务定义（ID=6）的处理机器人',
            reason:
              '平台未匹配到任务定义/类型对应机器人，且系统未知任务定义（ID=6）未配置启用中的处理机器人',
          },
        ],
        '无可用处理机器人',
      );
      return;
    }

    // 分配完成 → 机器人接管任务（派发失败转待反馈，由负责人处理）
    try {
      await this.dispatchService.dispatch(task.id, null);
    } catch (e) {
      await this.toFeedback(
        task.id,
        [
          {
            item: '任务已识别分配，但派发失败，请确认处理机器人/执行器配置',
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
        firstRemindedAt: null,
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
        firstRemindedAt: true,
        lastRemindedAt: true,
        missingItems: true,
        agentId: true,
        schedulerId: true,
        createdById: true,
        parentId: true,
        rootId: true,
      },
      order: { id: 'ASC' },
      take: REMIND_BATCH_SIZE,
    });
    if (list.length === 0) return;
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
          ? `请补充资料或确认信息后重新提交识别。待反馈事项：${feedbackText || '见任务详情'}`
          : '机器人已完成执行，请到平台验收产出。';
      const result =
        kind === 'accept'
          ? await this.taskNotify.notifyTaskRequester(
              task,
              kind,
              title,
              description,
            )
          : await this.taskNotify.notifyTaskOwner(
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
        { remindCount: count, firstRemindedAt, lastRemindedAt: now },
      );
      await this.tasksService.addEvent(
        task.id,
        '系统',
        `第 ${count} 次提醒${
          result.sent
            ? `已发送给${kind === 'accept' ? '需求方' : '负责人'}${
                result.ownerName ? `「${result.ownerName}」` : ''
              }`
            : `未发送（未找到${kind === 'accept' ? '需求方' : '负责人'}）`
        }；首次提醒满 ${TASK_REMIND_TIMEOUT_DAYS} 天未处理将自动${
          kind === 'feedback'
            ? '标记为失败（已结束-取消）'
            : '按成功完成（已结束-完成）'
        }`,
        null,
        {
          remindCount: count,
          firstRemindedAt: firstRemindedAt.toISOString(),
        },
      );
    } finally {
      this.reminding.delete(task.id);
    }
  }

  /** 首次提醒满 7 天仍未处理：待反馈→失败取消；待验收→成功完成 */
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
        ? `状态变更：等待中-待反馈 → 已结束-取消（首次提醒已超过 ${TASK_REMIND_TIMEOUT_DAYS} 天未处理，任务标记为失败）`
        : `状态变更：等待中-待验收 → 已结束-完成（首次提醒已超过 ${TASK_REMIND_TIMEOUT_DAYS} 天未处理，超时按成功完成）`,
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
        firstRemindedAt: null,
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
}
