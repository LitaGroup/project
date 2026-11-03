import type { User } from '../auth/user.entity';
import type { Worker } from '../workers/worker.entity';
import type { Task } from './task.entity';

/**
 * 工作台角色：我执行（真人）/ 我是需求方 / 我是负责人。
 * 其中 responsible 仅表示我负责的机器人执行或由我接管，不授予任务沟通身份。
 */
export type WorkbenchRole = 'agent' | 'requester' | 'responsible';

/** 计算工作台角色所需的任务字段（便于单元测试，不依赖完整实体） */
export type WorkbenchRoleTask = Pick<
  Task,
  | 'agentId'
  | 'requesterType'
  | 'requesterId'
  | 'createdById'
  | 'ownerTakeoverUserId'
>;

export interface WorkbenchRoleContext {
  /** 当前登录用户的真人机器人 */
  humanWorker: Pick<Worker, 'id'>;
  /** 当前登录用户的个人 AGENT（workers.id），未创建时为 null */
  personalAgentId: number | null;
  /** 当前登录用户名下的其他机器人（workers.id） */
  ownedWorkerIds: number[];
}

/**
 * 解析当前用户在工作台任务中的角色。
 *
 * 需求方优先：自己发起的任务即使由自己名下的机器人执行，也不叠加「执行方」，
 * 避免同一任务同时出现需求方/执行方两个 TAB 而误以执行方身份发言。
 * 个人 AGENT 不再是执行方，仅保留其作为历史任务需求方的兼容识别。
 */
export function deriveWorkbenchRoles(
  task: WorkbenchRoleTask,
  user: Pick<User, 'id'>,
  context: WorkbenchRoleContext,
): WorkbenchRole[] {
  const { humanWorker, personalAgentId, ownedWorkerIds } = context;
  const roles: WorkbenchRole[] = [];
  if (task.agentId === humanWorker.id) roles.push('agent');
  const isRequester =
    (task.requesterType === 'worker' &&
      (task.requesterId === humanWorker.id ||
        (personalAgentId !== null && task.requesterId === personalAgentId))) ||
    (task.requesterType === 'user' && task.requesterId === user.id) ||
    (!task.requesterType && task.createdById === user.id);
  if (isRequester) roles.push('requester');
  // 我负责的机器人执行，或验收升级后由我接管：视为「负责者」。
  // 我的真人机器人执行时已有 agent 角色，不重复标记；
  // 我已经是需求方时也不再叠加，身份由需求方 TAB 承担。
  if (
    !roles.includes('agent') &&
    !roles.includes('requester') &&
    ((task.agentId !== null && ownedWorkerIds.includes(task.agentId)) ||
      task.ownerTakeoverUserId === user.id)
  ) {
    roles.push('responsible');
  }
  return roles;
}
