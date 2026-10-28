import { ForbiddenException } from '@nestjs/common';
import type { User } from '../auth/user.entity';
import type { Worker } from '../workers/worker.entity';
import type { Task } from './task.entity';

/** 任务动作调用方：需求方可能是人类用户，也可能是父任务机器人。 */
export type TaskActor =
  { type: 'user'; user: User } | { type: 'worker'; worker: Worker };

export function actorName(actor: TaskActor): string {
  return actor.type === 'user'
    ? (actor.user.name ?? `用户#${actor.user.id}`)
    : actor.worker.name;
}

export function actorId(actor: TaskActor): number {
  return actor.type === 'user' ? actor.user.id : actor.worker.id;
}

/** 新数据按显式需求方校验；历史空值仅回退当前任务创建人。 */
export function assertTaskRequester(task: Task, actor: TaskActor): void {
  const matches = task.requesterType
    ? task.requesterType === actor.type && task.requesterId === actorId(actor)
    : actor.type === 'user' && task.createdById === actor.user.id;
  if (!matches) throw new ForbiddenException('仅任务需求方可以执行该操作');
}

export function isWorkerRequester(task: Task): boolean {
  return task.requesterType === 'worker' && Boolean(task.requesterId);
}
