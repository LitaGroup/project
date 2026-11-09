import { ForbiddenException } from '@nestjs/common';
import type { User } from '../auth/user.entity';
import type { Worker } from '../workers/worker.entity';
import type { Task } from './task.entity';

/** 任务动作调用方：需求方可能是人类用户，也可能是父任务机器人。 */
export type TaskActor =
  | { type: 'user'; user: User }
  | {
      type: 'worker';
      worker: Worker;
      /**
       * 同一账号下的历史需求方 Worker（仅用于需求方归属校验）。
       * 例如个人 AGENT 收敛后，历史任务仍记录个人 AGENT 为需求方，
       * 但后续操作统一由主人的真人机器人执行。
       */
      historicalRequesterWorkerId?: number | null;
    };

export function actorName(actor: TaskActor): string {
  return actor.type === 'user'
    ? (actor.user.name ?? `用户#${actor.user.id}`)
    : actor.worker.name;
}

export function actorId(actor: TaskActor): number {
  return actor.type === 'user' ? actor.user.id : actor.worker.id;
}

/** 机器人身份执行需求方动作，可携带同一账号验证过的历史需求方 Worker。 */
export function workerRequesterActor(
  worker: Worker,
  historicalRequester?: Pick<Worker, 'id' | 'personalAgentUserId'> | null,
): TaskActor {
  // 只接受同一账号绑定的个人 AGENT，避免调用方借用其他机器人的需求方身份。
  const sameOwner =
    historicalRequester &&
    historicalRequester.id !== worker.id &&
    worker.humanUserId != null &&
    historicalRequester.personalAgentUserId === worker.humanUserId;
  return {
    type: 'worker',
    worker,
    historicalRequesterWorkerId: sameOwner ? historicalRequester.id : null,
  };
}

/** 当前操作身份是否匹配任务需求方（含同账号历史 Worker）。 */
export function isTaskRequester(task: Task, actor: TaskActor): boolean {
  if (!task.requesterType) {
    return actor.type === 'user' && task.createdById === actor.user.id;
  }
  if (task.requesterType !== actor.type) return false;
  if (task.requesterId === actorId(actor)) return true;
  return (
    actor.type === 'worker' &&
    actor.historicalRequesterWorkerId != null &&
    task.requesterId === actor.historicalRequesterWorkerId
  );
}

/**
 * 登录用户是否为任务发起者（需求方）。
 * 真人需求方归属其绑定机器人；历史个人 AGENT 需求方仍归属同一用户。
 */
export function isTaskRequesterUser(
  task: Pick<Task, 'requesterType' | 'requesterId' | 'createdById'>,
  userId: number,
  workerIds: {
    humanWorkerId?: number | null;
    personalAgentId?: number | null;
  },
): boolean {
  if (!task.requesterType) return task.createdById === userId;
  if (task.requesterType === 'user') return task.requesterId === userId;
  return (
    (workerIds.humanWorkerId != null &&
      task.requesterId === workerIds.humanWorkerId) ||
    (workerIds.personalAgentId != null &&
      task.requesterId === workerIds.personalAgentId)
  );
}

/** 新数据按显式需求方校验；历史空值仅回退当前任务创建人。 */
export function assertTaskRequester(task: Task, actor: TaskActor): void {
  if (!isTaskRequester(task, actor)) {
    throw new ForbiddenException('仅任务需求方可以执行该操作');
  }
}

export function isWorkerRequester(task: Task): boolean {
  return task.requesterType === 'worker' && Boolean(task.requesterId);
}
