import { TaskStatus, TaskSubStatus } from '../common/enums';

/** 待反馈/待验收提醒间隔：30 分钟 */
export const TASK_REMIND_INTERVAL_MS = 30 * 60 * 1000;

/** 最多提醒 3 次，仍未处理则自动收尾（待反馈→失败取消 / 待验收→完成） */
export const TASK_MAX_REMINDERS = 3;

export type ReminderAction = 'send' | 'wait' | 'terminate';

/**
 * 计算下一次提醒动作：
 * - 未提醒过 → send
 * - 距上次提醒不足 30 分钟 → wait
 * - 已提醒 3 次且又过一个间隔 → terminate（不再发送第 4 次）
 * - 其余 → send
 */
export function nextReminderAction(
  remindCount: number | null | undefined,
  lastRemindedAt: Date | string | null | undefined,
  now: number = Date.now(),
): ReminderAction {
  const count = remindCount ?? 0;
  const last = lastRemindedAt ? new Date(lastRemindedAt).getTime() : null;
  if (count >= TASK_MAX_REMINDERS) {
    if (last === null || Number.isNaN(last)) return 'terminate';
    return now - last >= TASK_REMIND_INTERVAL_MS ? 'terminate' : 'wait';
  }
  if (last === null || Number.isNaN(last)) return 'send';
  return now - last >= TASK_REMIND_INTERVAL_MS ? 'send' : 'wait';
}

export interface MappedTaskStatus {
  status: TaskStatus;
  subStatus: TaskSubStatus;
}

/**
 * 历史状态（FEATURE-02 初版状态机）→ 新「主状态 + 子状态」映射。
 * 返回 null 表示已是新状态，无需迁移。
 */
export function mapLegacyTaskStatus(
  legacyStatus: string,
): MappedTaskStatus | null {
  switch (legacyStatus) {
    case '草稿':
    case '待调度':
      return {
        status: TaskStatus.WAITING,
        subStatus: TaskSubStatus.PENDING_IDENTIFY,
      };
    case '待补材料':
    case '待确认':
      return {
        status: TaskStatus.WAITING,
        subStatus: TaskSubStatus.PENDING_FEEDBACK,
      };
    case '已派发':
    case '执行中':
      return {
        status: TaskStatus.RUNNING,
        subStatus: TaskSubStatus.EXECUTING,
      };
    case '待验收':
      return {
        status: TaskStatus.WAITING,
        subStatus: TaskSubStatus.PENDING_ACCEPT,
      };
    case '内部完成':
    case '已交付':
    case '维护中':
      return {
        status: TaskStatus.FINISHED,
        subStatus: TaskSubStatus.COMPLETED,
      };
    case '已取消':
      return {
        status: TaskStatus.FINISHED,
        subStatus: TaskSubStatus.CANCELED,
      };
    default:
      return null;
  }
}

/** 主状态 + 子状态组合的展示文案（事件/通知用） */
export function taskStateLabel(
  status: TaskStatus,
  subStatus: TaskSubStatus,
): string {
  return `${status}-${subStatus}`;
}
