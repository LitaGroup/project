import { TaskStatus, TaskSubStatus } from '../common/enums';
import {
  mapLegacyTaskStatus,
  nextReminderAction,
  TASK_REMIND_INTERVAL_MS,
  TASK_REMIND_TIMEOUT_MS,
} from './task-loop.rules';

describe('nextReminderAction', () => {
  const now = new Date('2026-10-26T12:00:00+08:00').getTime();

  it('首次提醒立即发送', () => {
    expect(nextReminderAction(null, null, now)).toBe('send');
  });

  it('30 分钟内不重复提醒', () => {
    expect(
      nextReminderAction(
        new Date(now - TASK_REMIND_INTERVAL_MS * 2),
        new Date(now - TASK_REMIND_INTERVAL_MS + 1),
        now,
      ),
    ).toBe('wait');
  });

  it('超过 30 分钟再次提醒', () => {
    expect(
      nextReminderAction(
        new Date(now - TASK_REMIND_INTERVAL_MS * 2),
        new Date(now - TASK_REMIND_INTERVAL_MS),
        now,
      ),
    ).toBe('send');
    expect(
      nextReminderAction(
        new Date(now - TASK_REMIND_INTERVAL_MS * 2),
        new Date(now - TASK_REMIND_INTERVAL_MS - 1),
        now,
      ),
    ).toBe('send');
  });

  it('首次提醒不足 7 天时继续提醒', () => {
    expect(
      nextReminderAction(
        new Date(now - TASK_REMIND_TIMEOUT_MS + 1),
        new Date(now - TASK_REMIND_INTERVAL_MS - 1),
        now,
      ),
    ).toBe('send');
  });

  it('首次提醒满 7 天后收尾，后续提醒不延长截止时间', () => {
    expect(
      nextReminderAction(
        new Date(now - TASK_REMIND_TIMEOUT_MS),
        new Date(now - TASK_REMIND_INTERVAL_MS + 1),
        now,
      ),
    ).toBe('terminate');
    expect(
      nextReminderAction(
        new Date(now - TASK_REMIND_TIMEOUT_MS - 1),
        new Date(now),
        now,
      ),
    ).toBe('terminate');
  });

  it('历史数据只有最近提醒时间时以它作为首次提醒时间兜底', () => {
    expect(
      nextReminderAction(null, new Date(now - TASK_REMIND_TIMEOUT_MS), now),
    ).toBe('terminate');
  });
});

describe('mapLegacyTaskStatus', () => {
  it('旧创建态 → 等待中-待分配', () => {
    expect(mapLegacyTaskStatus('待调度')).toEqual({
      status: TaskStatus.WAITING,
      subStatus: TaskSubStatus.PENDING_ASSIGNMENT,
    });
  });

  it('旧识别子状态 → 等待中-待分配', () => {
    expect(mapLegacyTaskStatus('进行中', TaskSubStatus.IDENTIFYING)).toEqual({
      status: TaskStatus.WAITING,
      subStatus: TaskSubStatus.PENDING_ASSIGNMENT,
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
