import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import type { Task } from './task.entity';
import {
  TaskWorkerInbox,
  type TaskWorkerInboxKind,
} from './task-worker-inbox.entity';
import { isWorkerRequester } from './task-requester';

const OPEN_STATUSES = ['pending', 'queued', 'delivered'] as const;

/** 父子任务机器人事件的持久化收件箱，LOOP 负责把 pending 事件排入父任务。 */
@Injectable()
export class TaskWorkerInboxService {
  constructor(
    @InjectRepository(TaskWorkerInbox)
    private readonly inbox: Repository<TaskWorkerInbox>,
  ) {}

  /** 仅机器人需求方需要收件箱；同一开放事件幂等。 */
  async enqueue(
    child: Task,
    kind: TaskWorkerInboxKind,
    options?: {
      referenceId?: string | null;
      payload?: Record<string, unknown>;
    },
  ): Promise<TaskWorkerInbox | null> {
    if (!isWorkerRequester(child) || !child.parentId || !child.requesterId) {
      return null;
    }
    const referenceId = options?.referenceId ?? null;
    const existing = await this.inbox.findOne({
      where: {
        childTaskId: child.id,
        kind,
        referenceId: referenceId ?? IsNull(),
        status: In([...OPEN_STATUSES]),
      },
    });
    if (existing) return existing;
    return this.inbox.save(
      this.inbox.create({
        parentTaskId: child.parentId,
        workerId: child.requesterId,
        childTaskId: child.id,
        kind,
        referenceId,
        payload: options?.payload ?? null,
        status: 'pending',
      }),
    );
  }

  listPending(take = 20): Promise<TaskWorkerInbox[]> {
    return this.inbox.find({
      where: { status: 'pending' },
      order: { id: 'ASC' },
      take,
    });
  }

  async markQueued(id: number): Promise<void> {
    await this.inbox.update({ id, status: 'pending' }, { status: 'queued' });
  }

  async markDelivered(parentTaskId: number): Promise<void> {
    await this.inbox.update(
      { parentTaskId, status: 'queued' },
      { status: 'delivered', deliveredAt: new Date() },
    );
  }

  /**
   * 父会话结束但未处理的事件：提问/验收需要显式动作，重新排队；
   * 拒绝/取消提醒已在会话中送达，不要求固定动作，直接视为处理完成。
   */
  async requeueDelivered(parentTaskId: number): Promise<void> {
    await this.inbox.update(
      {
        parentTaskId,
        kind: In(['question', 'handoff']),
        status: 'delivered',
      },
      { status: 'pending', deliveredAt: null },
    );
    await this.inbox.update(
      {
        parentTaskId,
        kind: In(['refused', 'cancelled']),
        status: 'delivered',
      },
      { status: 'done', processedAt: new Date() },
    );
  }

  async completeForChild(
    childTaskId: number,
    kind?: TaskWorkerInboxKind,
    referenceId?: string,
  ): Promise<void> {
    await this.inbox.update(
      {
        childTaskId,
        ...(kind ? { kind } : {}),
        ...(referenceId ? { referenceId } : {}),
        status: In([...OPEN_STATUSES]),
      },
      { status: 'done', processedAt: new Date() },
    );
  }

  async markDead(id: number): Promise<void> {
    await this.inbox.update(
      { id, status: In([...OPEN_STATUSES]) },
      { status: 'dead', processedAt: new Date() },
    );
  }

  async deleteForTasks(taskIds: number[]): Promise<void> {
    if (taskIds.length === 0) return;
    await this.inbox.delete([
      { parentTaskId: In(taskIds) },
      { childTaskId: In(taskIds) },
    ]);
  }
}

/** 发给父任务机器人的结构化事件说明。 */
export function taskInboxPrompt(entry: TaskWorkerInbox, child: Task): string {
  const action =
    entry.kind === 'question'
      ? `请读取子任务待答提问 ${entry.referenceId ?? ''}，调用 task-question-answer 答复。`
      : entry.kind === 'handoff'
        ? '请检查子任务交付物，调用 task-handoff-accept 通过、task-handoff-refuse 返工，或 task-fail 判定失败。'
        : entry.kind === 'refused'
          ? `子机器人拒绝承接。理由：${child.refusalReason ?? '未填写'}；分发建议：${child.dispatchSuggestion ?? '无'}。请决定是否创建新的子任务。`
          : '子任务已取消，请评估对父任务的影响并继续处理。';
  return [
    '# 子任务协同事件',
    '',
    `- 子任务：${child.code} ${child.title}（ID=${child.id}）`,
    `- 状态：${child.status}-${child.subStatus}`,
    `- 事件：${entry.kind}`,
    `- 事件收件箱 ID：${entry.id}`,
    '',
    action,
    '',
    '处理完成后继续当前父任务；不要代替子任务执行机器人调用接受、提问或验收申请接口。',
  ].join('\n');
}
