import { TaskStatus, TaskSubStatus } from '../common/enums';

/** 待反馈/待验收提醒间隔：30 分钟 */
export const TASK_REMIND_INTERVAL_MS = 30 * 60 * 1000;

/** 从首次提醒起最多等待 7 天，仍未处理则自动收尾（待反馈→失败取消 / 待验收→完成） */
export const TASK_REMIND_TIMEOUT_DAYS = 7;
export const TASK_REMIND_TIMEOUT_MS =
  TASK_REMIND_TIMEOUT_DAYS * 24 * 60 * 60 * 1000;

export type ReminderAction = 'send' | 'wait' | 'terminate';

/**
 * 计算下一次提醒动作：
 * - 从未提醒过 → send
 * - 距首次提醒已满 7 天 → terminate（后续提醒不延长截止时间）
 * - 距最近一次提醒不足 30 分钟 → wait
 * - 其余 → send
 *
 * 历史数据可能只有 lastRemindedAt，此时以它作为首次提醒时间兜底。
 */
export function nextReminderAction(
  firstRemindedAt: Date | string | null | undefined,
  lastRemindedAt: Date | string | null | undefined,
  now: number = Date.now(),
): ReminderAction {
  const last = parseTime(lastRemindedAt);
  const first = parseTime(firstRemindedAt) ?? last;
  if (first === null) return 'send';
  if (now - first >= TASK_REMIND_TIMEOUT_MS) return 'terminate';
  if (last !== null && now - last < TASK_REMIND_INTERVAL_MS) return 'wait';
  return 'send';
}

function parseTime(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
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
  legacySubStatus?: string,
): MappedTaskStatus | null {
  if (
    legacySubStatus === TaskSubStatus.PENDING_IDENTIFY ||
    legacySubStatus === TaskSubStatus.IDENTIFYING
  ) {
    return {
      status: TaskStatus.WAITING,
      subStatus: TaskSubStatus.PENDING_ASSIGNMENT,
    };
  }
  switch (legacyStatus) {
    case '草稿':
    case '待调度':
      return {
        status: TaskStatus.WAITING,
        subStatus: TaskSubStatus.PENDING_ASSIGNMENT,
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
