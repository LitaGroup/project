import { DefectStatus, ReleaseStatus } from '../common/enums';
import type { Project } from '../projects/project.entity';
import type { ProjectRelease } from '../releases/project-release.entity';
import type { User } from '../auth/user.entity';
import type { Worker } from '../workers/worker.entity';
import { DefectsService } from './defects.service';

describe('DefectsService 机器人提测缺陷派单', () => {
  const project = {
    id: 3,
    name: '活动项目',
  } as Project;
  const release = {
    id: 5,
    projectId: 3,
    status: ReleaseStatus.IN_PROGRESS,
    workerId: 7,
    sourceTaskId: 88,
    operator: '活动开发机器人',
    testers: ['测试张三'],
    content: '登录流程改造',
    createdAt: new Date('2026-11-01T10:00:00Z'),
  } as ProjectRelease;
  const worker = {
    id: 7,
    name: '活动开发机器人',
    enabled: true,
    role: '工作者',
    personalAgentUserId: null,
    humanUserId: null,
    ownerUserId: null,
  } as unknown as Worker;
  const user = { id: 9, name: '测试张三' } as User;

  let defectsSave: jest.Mock;
  let defectsFind: jest.Mock;
  let defectsFindOne: jest.Mock;
  let recordsSave: jest.Mock;
  let releaseFindOne: jest.Mock;
  let workerFindOne: jest.Mock;
  let userFindOne: jest.Mock;
  let taskFindOne: jest.Mock;
  let taskCreate: jest.Mock;
  let service: DefectsService;

  beforeEach(() => {
    let defectRow: Record<string, unknown> | null = null;
    defectsSave = jest.fn((value: Record<string, unknown>) => {
      defectRow = {
        id: 21,
        createdAt: new Date('2026-11-02T10:00:00Z'),
        updatedAt: new Date('2026-11-02T10:00:00Z'),
        ...(defectRow ?? {}),
        ...value,
      };
      return Promise.resolve(defectRow);
    });
    defectsFind = jest.fn().mockResolvedValue([]);
    defectsFindOne = jest.fn();
    let recordId = 0;
    recordsSave = jest.fn((value: Record<string, unknown>) =>
      Promise.resolve({
        id: ++recordId,
        createdAt: new Date(),
        ...value,
      }),
    );
    releaseFindOne = jest.fn().mockResolvedValue(release);
    workerFindOne = jest.fn((args: { where?: Record<string, unknown> }) => {
      if (args?.where?.id === 7) return Promise.resolve(worker);
      return Promise.resolve(null);
    });
    userFindOne = jest.fn().mockResolvedValue(user);
    taskFindOne = jest.fn().mockResolvedValue({
      id: 88,
      code: 'TK-0088',
      title: '改造登录流程',
      createdById: 9,
      requesterType: 'user',
      requesterId: 9,
    });
    taskCreate = jest.fn().mockResolvedValue({
      id: 101,
      code: 'TK-0101',
      title: '修复缺陷 #21：登录按钮无响应',
    });

    service = new DefectsService(
      {
        create: (value: Record<string, unknown>) => value,
        save: defectsSave,
        findOne: defectsFindOne,
        find: defectsFind,
        delete: jest.fn(),
        remove: jest.fn(),
      } as never,
      {
        create: (value: Record<string, unknown>) => value,
        save: recordsSave,
        find: jest.fn(),
      } as never,
      {
        findOne: jest.fn().mockResolvedValue(project),
      } as never,
      { findOne: releaseFindOne } as never,
      { findOne: workerFindOne } as never,
      { findOne: userFindOne } as never,
      { findOne: taskFindOne } as never,
      { onRunFinalized: jest.fn() } as never,
      { create: taskCreate } as never,
    );
  });

  const createDefect = (extra: Record<string, unknown> = {}) =>
    service.create(
      {
        projectId: 3,
        expected: '登录按钮点击后进入首页',
        actual: '登录按钮无响应',
        platform: '前端',
        priority: '高',
        ...extra,
      },
      '录入',
      '测试张三',
      { user },
    );

  const lastAutoRecord = (): { source: string; content: string } => {
    const calls = recordsSave.mock.calls;
    return (
      calls[calls.length - 1] as Array<{ source: string; content: string }>
    )[0];
  };

  it('未通过提测的新缺陷自动关联提测并创建原提测机器人的处理任务', async () => {
    const defect = await createDefect();

    expect(defect.releaseId).toBe(5);
    expect(defect.followupTaskId).toBe(101);
    expect(taskCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 7,
        title: '修复缺陷 #21：登录按钮点击后进入首页',
        requesterType: 'user',
        requesterId: 9,
      }),
    );
    const taskInput = (
      taskCreate.mock.calls[0] as Array<{ description: string }>
    )[0];
    expect(taskInput.description).toContain('缺陷处理任务');
    expect(taskInput.description).toContain('登录按钮无响应');
    expect(lastAutoRecord().source).toBe('自动');
    expect(lastAutoRecord().content).toContain('自动创建处理任务 TK-0101');
  });

  it('没有有效提测时不创建处理任务', async () => {
    releaseFindOne.mockResolvedValue(null);

    const defect = await createDefect();

    expect(defect.releaseId).toBeNull();
    expect(defect.followupTaskId).toBeNull();
    expect(taskCreate).not.toHaveBeenCalled();
  });

  it('最新提测已通过时不回退到更早的有效提测', async () => {
    releaseFindOne.mockResolvedValue({
      ...release,
      id: 6,
      status: ReleaseStatus.PASSED,
    });

    const defect = await createDefect();

    expect(defect.releaseId).toBeNull();
    expect(defect.followupTaskId).toBeNull();
    expect(taskCreate).not.toHaveBeenCalled();
  });

  it('最新提测由人工发起时不派回更早的机器人', async () => {
    releaseFindOne.mockResolvedValue({
      ...release,
      id: 7,
      workerId: null,
      sourceTaskId: null,
    });

    const defect = await createDefect();

    expect(defect.releaseId).toBe(7);
    expect(defect.followupTaskId).toBeNull();
    expect(taskCreate).not.toHaveBeenCalled();
  });

  it('提测机器人已停用时保留缺陷并记录未派单原因', async () => {
    workerFindOne.mockResolvedValue(null);

    const defect = await createDefect();

    expect(defect.followupTaskId).toBeNull();
    expect(taskCreate).not.toHaveBeenCalled();
    expect(lastAutoRecord().source).toBe('自动');
    expect(lastAutoRecord().content).toContain('已停用或不可用');
  });

  it('任务创建失败不回滚缺陷，并记录失败原因', async () => {
    taskCreate.mockRejectedValue(new Error('task insert failed'));

    const defect = await createDefect();

    expect(defect.id).toBe(21);
    expect(defect.followupTaskId).toBeNull();
    expect(defect.status).toBe(DefectStatus.OPEN);
    expect(lastAutoRecord().source).toBe('自动');
    expect(lastAutoRecord().content).toContain('task insert failed');
  });

  it('显式关联提测时以选择的提测为准，且不自动派单', async () => {
    const defect = await createDefect({ releaseId: 5 });

    expect(releaseFindOne).toHaveBeenCalledWith({
      where: { id: 5, projectId: 3 },
      select: { id: true },
    });
    expect(defect.releaseId).toBe(5);
    expect(taskCreate).not.toHaveBeenCalled();
  });

  it('显式传 null 时跳过最新提测自动关联与派单', async () => {
    const defect = await createDefect({ releaseId: null });

    expect(defect.releaseId).toBeNull();
    expect(releaseFindOne).not.toHaveBeenCalled();
    expect(taskCreate).not.toHaveBeenCalled();
  });

  it('显式关联不存在或跨项目提测时拒绝创建', async () => {
    releaseFindOne.mockResolvedValue(null);

    await expect(createDefect({ releaseId: 99 })).rejects.toThrow(
      '提测记录 #99 不存在或不属于该项目',
    );
    expect(defectsSave).not.toHaveBeenCalled();
  });

  it('按提测 ID 查询缺陷', async () => {
    await service.findByProject(3, 5);

    expect(defectsFind).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: 3, releaseId: 5 },
      }),
    );
  });

  it('按非法提测 ID 查询时返回参数错误', async () => {
    await expect(service.findByProject(undefined, 0)).rejects.toThrow(
      '提测 ID 必须是正整数',
    );
    expect(defectsFind).not.toHaveBeenCalled();
  });

  it('更新缺陷可清除提测关联', async () => {
    defectsFindOne.mockResolvedValue({
      id: 21,
      projectId: 3,
      releaseId: 5,
      status: DefectStatus.OPEN,
      platform: null,
      priority: '中',
      expected: '登录按钮点击后进入首页',
      actual: '登录按钮无响应',
      images: null,
      testScript: null,
    });

    const defect = await service.update(
      21,
      { releaseId: null },
      '录入',
      '测试张三',
    );

    expect(defect.releaseId).toBeNull();
    expect(releaseFindOne).not.toHaveBeenCalled();
  });
});
