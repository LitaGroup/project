import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { BacklogStatus, IterationType } from '../common/enums';
import { backlogChatName } from '../feishu-bot/feishu-bot-backlog-chat.service';
import { Backlog } from './backlog.entity';
import { BacklogsService } from './backlogs.service';
import { isIterationCurrent, summarizeBacklogs } from './iterations.service';
import type { IterationActor } from './iteration.types';

function actor(overrides?: Partial<IterationActor>): IterationActor {
  return { userId: 7, userName: '小明', isAdmin: false, ...overrides };
}

function backlogRow(overrides?: Partial<Backlog>): Backlog {
  return {
    id: 1,
    code: 'BL-0001',
    iterationId: 10,
    projectId: 100,
    title: '需求 A',
    status: BacklogStatus.WAITING,
    ownerWorkerId: 2,
    ownerName: '机器人 A',
    members: null,
    taskId: 500,
    statusBy: null,
    startedAt: null,
    testingAt: null,
    releasingAt: null,
    completedAt: null,
    canceledAt: null,
    createdAt: new Date('2026-11-01T02:00:00Z'),
    updatedAt: new Date('2026-11-01T02:00:00Z'),
    ...overrides,
  };
}

function makeService(row: Backlog) {
  const findOne = jest.fn().mockResolvedValue(row);
  const save = jest
    .fn()
    .mockImplementation((value: Backlog) => Promise.resolve(value));
  const repository = { findOne, save } as never;
  const tasks = { cancel: jest.fn().mockResolvedValue(undefined) };
  const chat = {
    notifyBacklog: jest.fn().mockResolvedValue(undefined),
    ensureForBacklog: jest.fn().mockResolvedValue(undefined),
  };
  const service = new BacklogsService(
    repository,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    tasks as never,
    chat as never,
  );
  return { service, save, tasks, chat };
}

describe('summarizeBacklogs', () => {
  it('统计总数、完成数与百分比', () => {
    const progress = summarizeBacklogs([
      { status: BacklogStatus.COMPLETED },
      { status: BacklogStatus.WAITING },
      { status: BacklogStatus.COMPLETED },
      { status: BacklogStatus.TESTING },
    ]);
    expect(progress.total).toBe(4);
    expect(progress.done).toBe(2);
    expect(progress.percent).toBe(50);
    expect(progress.statusCounts[BacklogStatus.WAITING]).toBe(1);
  });

  it('空列表完成率为 0', () => {
    expect(summarizeBacklogs([]).percent).toBe(0);
  });
});

describe('isIterationCurrent', () => {
  it('T0 恒为当前迭代', () => {
    expect(
      isIterationCurrent({
        type: IterationType.T0,
        startAt: null,
        endAt: null,
      }),
    ).toBe(true);
  });

  it('W1 今天落在起止区间内时为当前', () => {
    expect(
      isIterationCurrent({
        type: IterationType.W1,
        startAt: '2000-01-01',
        endAt: '2999-12-31',
      }),
    ).toBe(true);
    expect(
      isIterationCurrent({
        type: IterationType.W1,
        startAt: '2000-01-01',
        endAt: '2000-01-02',
      }),
    ).toBe(false);
  });
});

describe('backlogChatName', () => {
  it('保留固定前后缀并截断超长标题', () => {
    const name = backlogChatName('很长的迭代项标题'.repeat(30));
    expect(name.startsWith('LitaWork-迭代-')).toBe(true);
    expect(name.endsWith(' 沟通群')).toBe(true);
    expect(name.length).toBeLessThanOrEqual(80);
  });
});

describe('BacklogsService.updateStatus', () => {
  it('推进到执行记录开始时间与操作人', async () => {
    const { service, save } = makeService(backlogRow());
    const updated = await service.updateStatus(
      1,
      BacklogStatus.EXECUTING,
      actor({ isAdmin: true }),
    );
    expect(updated.status).toBe(BacklogStatus.EXECUTING);
    expect(updated.startedAt).toBeInstanceOf(Date);
    expect(updated.statusBy).toBe('小明');
    expect(save).toHaveBeenCalled();
  });

  it('回退到等待清空后续阶段时间', async () => {
    const { service } = makeService(
      backlogRow({
        status: BacklogStatus.TESTING,
        startedAt: new Date(),
        testingAt: new Date(),
      }),
    );
    const updated = await service.updateStatus(
      1,
      BacklogStatus.WAITING,
      actor({ isAdmin: true }),
    );
    expect(updated.startedAt).toBeNull();
    expect(updated.testingAt).toBeNull();
  });

  it('终态不可再变更', async () => {
    const { service } = makeService(
      backlogRow({ status: BacklogStatus.COMPLETED }),
    );
    await expect(
      service.updateStatus(
        1,
        BacklogStatus.EXECUTING,
        actor({ isAdmin: true }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('取消时联动取消交付任务并通知沟通群', async () => {
    const { service, tasks, chat } = makeService(
      backlogRow({ status: BacklogStatus.EXECUTING, startedAt: new Date() }),
    );
    const updated = await service.updateStatus(
      1,
      BacklogStatus.CANCELED,
      actor({ isAdmin: true }),
    );
    expect(updated.canceledAt).toBeInstanceOf(Date);
    expect(tasks.cancel).toHaveBeenCalledWith(500, '小明');
    expect(chat.notifyBacklog).toHaveBeenCalledWith(1);
  });

  it('非成员非管理员不可推进状态', async () => {
    const { service } = makeService(backlogRow());
    await expect(
      service.updateStatus(1, BacklogStatus.EXECUTING, actor()),
    ).rejects.toThrow(ForbiddenException);
  });

  it('成员可推进状态', async () => {
    const { service } = makeService(
      backlogRow({ members: [{ role: '产品', userId: 7, name: '小明' }] }),
    );
    const updated = await service.updateStatus(
      1,
      BacklogStatus.EXECUTING,
      actor(),
    );
    expect(updated.status).toBe(BacklogStatus.EXECUTING);
  });
});
