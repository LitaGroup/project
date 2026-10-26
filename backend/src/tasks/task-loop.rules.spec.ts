import { TaskStatus, TaskSubStatus } from '../common/enums';
import {
  mapLegacyTaskStatus,
  nextReminderAction,
  TASK_MAX_REMINDERS,
  TASK_REMIND_INTERVAL_MS,
} from './task-loop.rules';

describe('nextReminderAction', () => {
  const now = new Date('2026-10-26T12:00:00+08:00').getTime();

  it('首次提醒立即发送', () => {
    expect(nextReminderAction(0, null, now)).toBe('send');
  });

  it('30 分钟内不重复提醒', () => {
    expect(
      nextReminderAction(1, new Date(now - TASK_REMIND_INTERVAL_MS + 1), now),
    ).toBe('wait');
  });

  it('超过 30 分钟再次提醒', () => {
    expect(
      nextReminderAction(1, new Date(now - TASK_REMIND_INTERVAL_MS), now),
    ).toBe('send');
    expect(
      nextReminderAction(2, new Date(now - TASK_REMIND_INTERVAL_MS - 1), now),
    ).toBe('send');
  });

  it('已提醒 3 次且再过一个间隔后收尾（不再发送第 4 次）', () => {
    expect(
      nextReminderAction(
        TASK_MAX_REMINDERS,
        new Date(now - TASK_REMIND_INTERVAL_MS + 1),
        now,
      ),
    ).toBe('wait');
    expect(
      nextReminderAction(
        TASK_MAX_REMINDERS,
        new Date(now - TASK_REMIND_INTERVAL_MS),
        now,
      ),
    ).toBe('terminate');
  });

  it('提醒次数已满但没有时间戳时直接收尾（防御历史脏数据）', () => {
    expect(nextReminderAction(TASK_MAX_REMINDERS, null, now)).toBe('terminate');
  });
});

describe('mapLegacyTaskStatus', () => {
  it('旧创建态 → 等待中-待识别', () => {
    expect(mapLegacyTaskStatus('待调度')).toEqual({
      status: TaskStatus.WAITING,
      subStatus: TaskSubStatus.PENDING_IDENTIFY,
    });
  });

  it('旧待补材料/待确认 → 等待中-待反馈', () => {
    expect(mapLegacyTaskStatus('待补材料')?.subStatus).toBe(
      TaskSubStatus.PENDING_FEEDBACK,
    );
    expect(mapLegacyTaskStatus('待确认')?.subStatus).toBe(
      TaskSubStatus.PENDING_FEEDBACK,
    );
  });

  it('旧执行态 → 进行中-执行中', () => {
    expect(mapLegacyTaskStatus('执行中')).toEqual({
      status: TaskStatus.RUNNING,
      subStatus: TaskSubStatus.EXECUTING,
    });
  });

  it('旧待验收 → 等待中-待验收', () => {
    expect(mapLegacyTaskStatus('待验收')).toEqual({
      status: TaskStatus.WAITING,
      subStatus: TaskSubStatus.PENDING_ACCEPT,
    });
  });

  it('旧终态 → 已结束-完成/取消', () => {
    expect(mapLegacyTaskStatus('已交付')?.subStatus).toBe(
      TaskSubStatus.COMPLETED,
    );
    expect(mapLegacyTaskStatus('已取消')?.subStatus).toBe(
      TaskSubStatus.CANCELED,
    );
  });

  it('已是新状态时返回 null', () => {
    expect(mapLegacyTaskStatus(TaskStatus.WAITING)).toBeNull();
    expect(mapLegacyTaskStatus(TaskStatus.RUNNING)).toBeNull();
    expect(mapLegacyTaskStatus(TaskStatus.FINISHED)).toBeNull();
  });
});
