import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThanOrEqual, Repository } from 'typeorm';
import { TaskStatus, TaskSubStatus } from '../common/enums';
import { beijingTime } from '../common/frontmatter';
import { Task } from './task.entity';
import { TaskExternalEvent } from './task-external-event.entity';
import { TaskDispatchService } from './task-dispatch.service';
import { nextInboxRetryDelay } from './task-loop.rules';

/** 当前唯一的外部事件来源 */
const SOURCE_PROXY = 'lita-proxy';
/** 单次补投扫描条数 */
const RETRY_SCAN_LIMIT = 20;
/** 最多尝试次数（按 2/10/30 分钟退避约 2 天后放弃，避免永久重试） */
const MAX_ATTEMPTS = 96;
/** 回调事件在任务聊天中的发送者（任务事件展示用） */
const OPERATOR_LABEL = '外部工单回调';

export interface TaskExternalEventReceipt {
  accepted: boolean;
  duplicate: boolean;
}

interface NormalizedProxyEvent {
  ticketId: number;
  status: string;
  eventType: string;
  payload: Record<string, unknown>;
}

/** 校验并归一化 proxy 工单回调报文：ticketId 与 status 必填。 */
function normalizeProxyEvent(body: unknown): NormalizedProxyEvent | null {
  if (!body || typeof body !== 'object') return null;
  const raw = body as Record<string, unknown>;
  const ticketId = Number(raw.ticketId);
  const status = typeof raw.status === 'string' ? raw.status.trim() : '';
  if (!Number.isInteger(ticketId) || ticketId <= 0 || !status) return null;
  const event =
    typeof raw.event === 'string' && raw.event.trim()
      ? raw.event.trim().slice(0, 60)
      : 'ticket.status_changed';
  return {
    ticketId,
    status: status.slice(0, 30),
    eventType: event,
    payload: raw,
  };
}

/** 唯一键冲突（并发重复回调） */
function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    (error as { code?: string }).code === '23505',
  );
}

function payloadText(
  payload: Record<string, unknown> | null,
  key: string,
): string {
  const value = payload?.[key];
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * 任务外部事件（lita-proxy 工单状态回调）：
 * - 回调先持久化，重复回调按「任务 + 工单 + 状态」幂等；
 * - 任务回合仍在输出时直接投递当前 opencode 会话；
 * - 回合已结束（待申请验收/待验收）转「待继续」写入 resumePrompt，由 LOOP 恢复；
 * - 任务当前不便接收（待反馈等）时按退避对账重试；任务结束只记录不复活。
 */
@Injectable()
export class TaskExternalEventService {
  private readonly logger = new Logger(TaskExternalEventService.name);
  private readonly apiUrl: string;
  private scanning = false;

  constructor(
    @InjectRepository(Task)
    private readonly tasks: Repository<Task>,
    @InjectRepository(TaskExternalEvent)
    private readonly events: Repository<TaskExternalEvent>,
    private readonly dispatch: TaskDispatchService,
    config: ConfigService,
  ) {
    this.apiUrl = (
      config.get<string>('API_URL') ?? 'http://localhost:3100/api'
    ).replace(/\/+$/, '');
  }

  /**
   * 接收回调：校验报文与任务、幂等落库后异步唤醒。
   * 端点本身免鉴权（纯内网信任），这里只做最基本的存在性与格式校验。
   */
  async receive(
    taskId: number,
    body: unknown,
  ): Promise<TaskExternalEventReceipt> {
    const task = await this.tasks.findOne({ where: { id: taskId } });
    if (!task) throw new NotFoundException(`任务 ${taskId} 不存在`);
    const normalized = normalizeProxyEvent(body);
    if (!normalized) {
      throw new BadRequestException('回调报文无效：ticketId 与 status 必填');
    }
    const existing = await this.events.findOne({
      where: {
        taskId,
        source: SOURCE_PROXY,
        externalTicketId: normalized.ticketId,
        externalStatus: normalized.status,
      },
    });
    if (existing) return { accepted: true, duplicate: true };

    let event: TaskExternalEvent;
    try {
      event = await this.events.save(
        this.events.create({
          taskId,
          source: SOURCE_PROXY,
          externalTicketId: normalized.ticketId,
          eventType: normalized.eventType,
          externalStatus: normalized.status,
          payload: normalized.payload,
          deliveryStatus: 'queued',
        }),
      );
    } catch (error) {
      // 并发重复回调命中唯一键：与已有事件视为同一次事件。
      if (isUniqueViolation(error)) return { accepted: true, duplicate: true };
      throw error;
    }
    void this.deliver(event.id).catch((error: unknown) => {
      this.logger.warn(
        `任务 #${taskId} 外部事件 #${event.id} 唤醒失败: ${(error as Error).message}`,
      );
    });
    return { accepted: true, duplicate: false };
  }

  /** 对账补投：新建事件未及时投递、任务状态变化后重试。 */
  @Interval(30_000)
  async retryPending(): Promise<void> {
    if (this.scanning) return;
    this.scanning = true;
    try {
      const due = await this.events.find({
        where: [
          { deliveryStatus: 'queued', nextRetryAt: IsNull() },
          {
            deliveryStatus: 'queued',
            nextRetryAt: LessThanOrEqual(new Date()),
          },
        ],
        order: { id: 'ASC' },
        take: RETRY_SCAN_LIMIT,
      });
      for (const event of due) {
        await this.deliver(event.id);
      }
    } catch (error) {
      this.logger.warn(`外部事件对账失败: ${(error as Error).message}`);
    } finally {
      this.scanning = false;
    }
  }

  /** 投递单条事件：任务可接收时唤醒会话，否则退避重试。 */
  async deliver(eventId: number): Promise<void> {
    const event = await this.events.findOne({ where: { id: eventId } });
    if (!event || event.deliveryStatus !== 'queued') return;
    const task = await this.tasks.findOne({ where: { id: event.taskId } });
    if (!task) {
      await this.markDead(event.id, '任务不存在');
      return;
    }
    if (task.status === TaskStatus.FINISHED) {
      await this.markRecorded(event.id);
      return;
    }
    if (!this.canWake(task)) {
      await this.retryLater(event.id, '任务当前状态暂不接收外部事件');
      return;
    }
    // 原子认领，避免端点内联投递与对账扫描并发重复唤醒。
    const claimed = await this.events.update(
      { id: event.id, deliveryStatus: 'queued' },
      { deliveryStatus: 'delivered', lastAttemptAt: new Date() },
    );
    if (!claimed.affected) return;
    try {
      await this.wake(task, event);
      await this.events.update(event.id, {
        deliveredAt: new Date(),
        processedAt: new Date(),
        lastError: null,
        nextRetryAt: null,
      });
    } catch (error) {
      await this.retryLater(event.id, (error as Error).message);
    }
  }

  /** 任务是否处于可接收外部事件的状态。 */
  private canWake(task: Task): boolean {
    if (task.status === TaskStatus.RUNNING) {
      return task.subStatus === TaskSubStatus.EXECUTING;
    }
    if (task.status !== TaskStatus.WAITING) return false;
    return [
      TaskSubStatus.PENDING_APPLY,
      TaskSubStatus.PENDING_ACCEPT,
      TaskSubStatus.PENDING_RESUME,
    ].includes(task.subStatus);
  }

  /**
   * 唤醒任务：
   * - 回合在跑 → 直投当前会话；
   * - 回合已结束/待继续 → 写入 resumePrompt，由 LOOP 按执行容量恢复。
   */
  private async wake(task: Task, event: TaskExternalEvent): Promise<void> {
    const prompt = this.buildPrompt(task, event);
    if (
      task.status === TaskStatus.RUNNING &&
      task.subStatus === TaskSubStatus.EXECUTING
    ) {
      if (this.dispatch.taskChatRunning(task.id)) {
        await this.dispatch.continueConversation(
          task.id,
          prompt,
          OPERATOR_LABEL,
        );
        return;
      }
      // 会话已结束但任务仍停在执行中的竞态兜底：转待继续交给 LOOP。
      const updated = await this.tasks.update(
        {
          id: task.id,
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
      if (!updated.affected) throw new Error('任务状态已变化，稍后重试');
      return;
    }

    if (
      task.subStatus === TaskSubStatus.PENDING_APPLY ||
      task.subStatus === TaskSubStatus.PENDING_ACCEPT
    ) {
      const updated = await this.tasks.update(
        {
          id: task.id,
          status: TaskStatus.WAITING,
          subStatus: task.subStatus,
        },
        {
          subStatus: TaskSubStatus.PENDING_RESUME,
          resumePrompt: prompt,
          remindCount: 0,
          firstRemindedAt: null,
          lastRemindedAt: null,
        },
      );
      if (!updated.affected) throw new Error('任务状态已变化，稍后重试');
      return;
    }

    // 已在待继续：同一事件只追加一次，避免重试反复写入。
    if (task.resumePrompt?.includes(`事件记录 ID：${event.id}`)) return;
    const merged = [task.resumePrompt?.trim(), prompt]
      .filter(Boolean)
      .join('\n\n---\n\n');
    const updated = await this.tasks.update(
      {
        id: task.id,
        status: TaskStatus.WAITING,
        subStatus: TaskSubStatus.PENDING_RESUME,
      },
      { resumePrompt: merged },
    );
    if (!updated.affected) throw new Error('任务状态已变化，稍后重试');
  }

  /** 投递给机器人的结构化事件说明。 */
  private buildPrompt(task: Task, event: TaskExternalEvent): string {
    const payload = event.payload;
    const lines = [
      '# 外部工单状态回调',
      '',
      `- 任务：${task.code}「${task.title}」`,
      `- 来源：lita-proxy 线上操作工单 #${event.externalTicketId}`,
      `- 工单类型：${payloadText(payload, 'kind') || '-'}（环境：${
        payloadText(payload, 'env') || '-'
      }）`,
      `- 目标资源：${payloadText(payload, 'resourceName') || '-'}`,
      `- 操作：${payloadText(payload, 'operation') || '-'}`,
      `- 当前状态：${event.externalStatus}`,
      `- 操作人：${payloadText(payload, 'operator') || '-'}`,
      `- 结果说明：${payloadText(payload, 'message') || '-'}`,
      `- 事件时间：${
        payloadText(payload, 'updatedAt') || beijingTime(event.createdAt)
      }`,
      '',
      '请继续处理当前任务：',
      '- 工单成功：确认执行结果符合预期后继续原任务，按需申请验收；',
      '- 工单失败/被拒绝/被取消：评估影响，调整方案或向需求方提问；',
      '- 需要更多细节时，用 lita-proxy 的 `query_tickets` 查询该工单。',
      '',
      `> 事件记录 ID：${event.id}（同一工单同一状态只处理一次）`,
    ];
    return lines.join('\n');
  }

  /** 当前不可投递：按 2/10/30 分钟退避重试，超过上限标记 dead。 */
  private async retryLater(eventId: number, reason: string): Promise<void> {
    const event = await this.events.findOne({ where: { id: eventId } });
    if (!event) return;
    const attempts = (event.attempts ?? 0) + 1;
    if (attempts >= MAX_ATTEMPTS) {
      await this.markDead(eventId, reason, attempts);
      return;
    }
    await this.events.update(eventId, {
      deliveryStatus: 'queued',
      attempts,
      lastAttemptAt: new Date(),
      lastError: reason.slice(0, 500),
      nextRetryAt: new Date(Date.now() + nextInboxRetryDelay(attempts - 1)),
    });
  }

  private async markDead(
    eventId: number,
    reason: string,
    attempts?: number,
  ): Promise<void> {
    await this.events.update(eventId, {
      deliveryStatus: 'dead',
      lastError: reason.slice(0, 500),
      lastAttemptAt: new Date(),
      processedAt: new Date(),
      ...(attempts === undefined ? {} : { attempts }),
    });
    this.logger.warn(`外部事件 #${eventId} 放弃投递：${reason}`);
  }

  /** 任务已结束：只记录，不唤醒、不复活。 */
  private async markRecorded(eventId: number): Promise<void> {
    await this.events.update(eventId, {
      deliveryStatus: 'recorded',
      processedAt: new Date(),
      lastError: null,
      nextRetryAt: null,
    });
  }

  /** 回调地址（供 MCP 工具展示与联调）。 */
  callbackUrl(taskId: number): string {
    return `${this.apiUrl}/tasks/${taskId}/external-event`;
  }
}
