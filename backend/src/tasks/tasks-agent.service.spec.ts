import { ForbiddenException } from '@nestjs/common';
import { TaskStatus, TaskSubStatus } from '../common/enums';
import { TasksAgentService, type AgentTaskScope } from './tasks-agent.service';

function buildTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    code: 'TK-0042',
    title: '查询任务信息',
    templateName: null,
    status: TaskStatus.RUNNING,
    subStatus: TaskSubStatus.EXECUTING,
    agentId: null,
    requesterType: null,
    requesterId: null,
    createdById: null,
    ownerTakeoverUserId: null,
    assignedAt: null,
    handoffPath: null,
    handoffVersion: 0,
    handoffSubmittedVersion: null,
    description: '任务描述',
    input: null,
    content: null,
    outputSpec: null,
    workPlan: null,
    missingItems: [],
    result: null,
    children: [],
    events: [],
    createdAt: new Date('2026-11-05T01:00:00.000Z'),
    updatedAt: new Date('2026-11-05T02:00:00.000Z'),
    ...overrides,
  };
}

function buildService(task: ReturnType<typeof buildTask>) {
  const taskDocuments = {
    listTaskDocuments: jest.fn().mockResolvedValue([]),
    taskDirectory: jest.fn().mockReturnValue('/task/20261105/TK-0042'),
  };
  const service = new TasksAgentService(
    { find: jest.fn() } as never,
    { find: jest.fn() } as never,
    { find: jest.fn().mockResolvedValue([]) } as never,
    { find: jest.fn().mockResolvedValue([]) } as never,
    { findOneDetail: jest.fn().mockResolvedValue(task) } as never,
    taskDocuments as never,
    {
      findByHumanUserId: jest.fn().mockResolvedValue(null),
    } as never,
    { findForUser: jest.fn().mockResolvedValue(null) } as never,
  );
  return { service, taskDocuments };
}

function scopeWith(overrides: Partial<AgentTaskScope> = {}): AgentTaskScope {
  return {
    userIds: [7],
    workerIds: [],
    responsibleWorkerIds: [],
    canReadVisibleTasks: true,
    label: '张三',
    ...overrides,
  };
}

describe('TasksAgentService 可见任务读取', () => {
  it('用户可读取非自己参与的任务，详情标记为只读', async () => {
    const { service } = buildService(buildTask());

    const markdown = await service.detailMarkdown(scopeWith(), 42);

    expect(markdown).toContain('我的角色：查看者（只读）');
    expect(markdown).toContain('## 只读访问');
    expect(markdown).not.toContain('## 可用操作');
  });

  it('普通执行机器人仍不能读取自己未参与的任务', async () => {
    const { service } = buildService(buildTask());

    await expect(
      service.detailMarkdown(
        scopeWith({ workerIds: [2001], canReadVisibleTasks: false }),
        42,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('任务参与方保留自己的角色和操作清单', async () => {
    const { service } = buildService(buildTask({ agentId: 2001 }));

    const markdown = await service.detailMarkdown(
      scopeWith({
        workerIds: [2001],
        canReadVisibleTasks: false,
      }),
      42,
    );

    expect(markdown).toContain('我的角色：执行方');
    expect(markdown).toContain('## 可用操作');
    expect(markdown).not.toContain('## 只读访问');
  });

  it('仅用户本人与真人/个人 AGENT 可读取全部可见任务', async () => {
    const { service } = buildService(buildTask());

    await expect(
      service.resolveScope({ user: { id: 7, name: '张三' } } as never),
    ).resolves.toMatchObject({ canReadVisibleTasks: true });

    await expect(
      service.resolveScope({
        worker: {
          id: 2001,
          name: '执行机器人',
          humanUserId: null,
          personalAgentUserId: null,
        },
      } as never),
    ).resolves.toMatchObject({ canReadVisibleTasks: false });

    await expect(
      service.resolveScope({
        worker: {
          id: 2002,
          name: '张三的机器人',
          humanUserId: 7,
          personalAgentUserId: null,
        },
      } as never),
    ).resolves.toMatchObject({ canReadVisibleTasks: true });
  });
});
