import { ReleaseStatus, WorkerRole, WorkerRuntime } from '../common/enums';
import type { Executor } from '../executors/executor.entity';
import type { Worker } from '../workers/worker.entity';
import type { Task } from './task.entity';
import { releaseNotificationPrompt } from './task-release-notification.service';
import { TaskReleaseNotificationService } from './task-release-notification.service';
import type { TaskWorkerInbox } from './task-worker-inbox.entity';

jest.mock('../executors/opencode-run', () => ({
  runOpencodePrompt: jest.fn(),
}));

jest.mock('../executors/opencode-client', () => ({
  OpencodeClient: jest.fn().mockImplementation(() => ({
    shell: jest.fn().mockResolvedValue(undefined),
    deleteSession: jest.fn().mockResolvedValue(undefined),
  })),
}));

import { runOpencodePrompt } from '../executors/opencode-run';

describe('TaskReleaseNotificationService 提测状态通知', () => {
  const runPrompt = runOpencodePrompt as jest.Mock;
  let tasksRepo: { exists: jest.Mock; findOne: jest.Mock };
  let executorsRepo: { findOne: jest.Mock };
  let workersRepo: { findOne: jest.Mock };
  let workersService: {
    ensureWorkToken: jest.Mock;
    workdirOf: jest.Mock;
    ownerOpenId: jest.Mock;
  };
  let inbox: {
    markEventDelivered: jest.Mock;
    markDone: jest.Mock;
    markDead: jest.Mock;
    defer: jest.Mock;
  };
  let feishu: { sendUserCard: jest.Mock };
  let service: TaskReleaseNotificationService;

  const worker = {
    id: 101,
    name: '活动开发机器人',
    enabled: true,
    role: WorkerRole.WORKER,
    runtime: WorkerRuntime.OPENCODE,
    executorId: 8,
    providerId: 'zhipu',
    modelId: 'glm',
    variant: null,
    personalAgentUserId: null,
    ownerUserId: 9,
    ownerName: '机器人负责人',
  } as unknown as Worker;

  const executor = {
    id: 8,
    online: true,
    providersCache: [],
  } as unknown as Executor;

  const entry = {
    id: 31,
    parentTaskId: 12,
    workerId: 101,
    childTaskId: 12,
    kind: 'release',
    referenceId: 'release:5:待冒烟:已通过:1',
    status: 'pending',
    attempts: 0,
    payload: {
      releaseId: 5,
      projectId: 2,
      projectName: '活动项目',
      fromStatus: ReleaseStatus.PENDING,
      toStatus: ReleaseStatus.PASSED,
      verifier: '测试同学',
      testers: ['王五'],
      sourceTaskId: 12,
    },
  } as unknown as TaskWorkerInbox;

  beforeEach(() => {
    runPrompt.mockReset().mockResolvedValue('已了解提测状态');
    tasksRepo = {
      exists: jest.fn().mockResolvedValue(false),
      findOne: jest.fn().mockResolvedValue({
        id: 12,
        code: 'TK-0012',
        title: '开发活动页',
        status: '已结束',
        subStatus: '完成',
        description: '做一个活动页',
      }),
    };
    executorsRepo = { findOne: jest.fn().mockResolvedValue(executor) };
    workersRepo = { findOne: jest.fn().mockResolvedValue(worker) };
    workersService = {
      ensureWorkToken: jest.fn().mockResolvedValue('token'),
      workdirOf: jest.fn().mockReturnValue('/tmp/worker/101'),
      ownerOpenId: jest.fn().mockResolvedValue('ou_owner'),
    };
    inbox = {
      markEventDelivered: jest.fn().mockResolvedValue(true),
      markDone: jest.fn().mockResolvedValue(undefined),
      markDead: jest.fn().mockResolvedValue(undefined),
      defer: jest.fn().mockResolvedValue(undefined),
    };
    feishu = { sendUserCard: jest.fn().mockResolvedValue(undefined) };
    service = new TaskReleaseNotificationService(
      tasksRepo as never,
      executorsRepo as never,
      workersRepo as never,
      workersService as never,
      inbox as never,
      feishu as never,
      {
        get: jest.fn((key: string) =>
          key === 'API_URL' ? 'http://api.example/api' : undefined,
        ),
      } as never,
    );
  });

  it('机器人忙碌时保持 pending，不启动会话', async () => {
    tasksRepo.exists.mockResolvedValue(true);

    await service.handle(entry);

    expect(inbox.markEventDelivered).not.toHaveBeenCalled();
    expect(runPrompt).not.toHaveBeenCalled();
  });

  it('空闲机器人收到事件上下文；会话成功后事件关闭', async () => {
    await service.handle(entry);

    expect(tasksRepo.exists).toHaveBeenCalledWith({
      where: { agentId: 101, status: '进行中' },
    });
    expect(inbox.markEventDelivered).toHaveBeenCalledWith(31);
    expect(runPrompt).toHaveBeenCalledTimes(1);
    const calls = runPrompt.mock.calls as unknown as unknown[][];
    const input = (calls[0]?.[1] ?? null) as unknown;
    const prompt =
      typeof input === 'object' && input !== null && 'prompt' in input
        ? String(input.prompt)
        : '';
    expect(prompt).toContain('状态变化：待冒烟 → 已通过');
    expect(prompt).toContain('GET http://api.example/api/projects/2.md');
    expect(prompt).toContain(
      'GET http://api.example/api/defects.md?projectId=2&releaseId=5',
    );
    expect(prompt).toContain('GET http://api.example/api/tasks/12.md');
    expect(prompt).toContain('TK-0012');
    expect(inbox.markDone).toHaveBeenCalledWith(31);
    expect(inbox.defer).not.toHaveBeenCalled();
  });

  it('会话失败按收件箱退避重试', async () => {
    runPrompt.mockRejectedValue(new Error('executor timeout'));

    await service.handle(entry);

    expect(inbox.markDone).not.toHaveBeenCalled();
    expect(inbox.defer).toHaveBeenCalledWith(
      31,
      expect.any(Date),
      'executor timeout',
    );
    expect(inbox.markDead).not.toHaveBeenCalled();
  });

  it('连续失败达到上限后关闭事件并通知负责人', async () => {
    runPrompt.mockRejectedValue(new Error('executor down'));
    const failed = { ...entry, attempts: 2 };

    await service.handle(failed);

    expect(inbox.markDead).toHaveBeenCalledWith(31);
    expect(inbox.defer).not.toHaveBeenCalled();
    expect(feishu.sendUserCard).toHaveBeenCalledTimes(1);
    const cardCalls = feishu.sendUserCard.mock.calls as unknown as unknown[][];
    const card = (cardCalls[0]?.[1] ?? {}) as {
      header?: { title?: { content?: string } };
    };
    expect(card.header?.title?.content).toBe('提测通知处理失败');
  });

  it('真人机器人不是自动收件人，事件直接关闭', async () => {
    workersRepo.findOne.mockResolvedValue({
      ...worker,
      runtime: WorkerRuntime.HUMAN,
    });

    await service.handle(entry);

    expect(inbox.markDone).toHaveBeenCalledWith(31);
    expect(runPrompt).not.toHaveBeenCalled();
  });

  it('提示词不要求固定回执接口', () => {
    const prompt = releaseNotificationPrompt(
      entry,
      worker,
      {
        id: 12,
        code: 'TK-0012',
        title: '开发活动页',
        status: '已结束',
        subStatus: '完成',
      } as Task,
      'http://api.example/api/',
    );

    expect(prompt).toContain('没有固定回执接口');
    expect(prompt).toContain('不要重复创建');
  });
});
