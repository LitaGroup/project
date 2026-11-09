import { TaskStatus, TaskSubStatus, WorkerRuntime } from '../common/enums';
import type { Task } from './task.entity';
import {
  normalizeAgentPageContext,
  WorkbenchService,
} from './workbench.service';

describe('normalizeAgentPageContext', () => {
  it('未提供页面类型时沿用任务/通用会话', () => {
    expect(normalizeAgentPageContext()).toBeNull();
    expect(normalizeAgentPageContext({})).toBeNull();
  });

  it('规范化文档上下文并仅保留站内读取接口', () => {
    expect(
      normalizeAgentPageContext({
        type: 'document',
        id: 'document:12',
        title: '  技术设计  ',
        summary: '  类型：技术  ',
        readUrl: '/api/documents/12.md',
      }),
    ).toEqual({
      type: 'document',
      id: 'document:12',
      title: '技术设计',
      summary: '类型：技术',
      readUrl: '/api/documents/12.md',
    });

    expect(
      normalizeAgentPageContext({
        type: 'script',
        id: 'script:path',
        readUrl: 'https://example.com/secret',
      }),
    ).toEqual({
      type: 'script',
      id: 'script:path',
      title: undefined,
      summary: undefined,
    });
  });

  it('规范化项目上下文并保留站内读取接口', () => {
    expect(
      normalizeAgentPageContext({
        type: 'project',
        id: 'project:3708',
        title: ' 项目详情  ',
        readUrl: '/api/projects/3708.md',
      }),
    ).toEqual({
      type: 'project',
      id: 'project:3708',
      title: '项目详情',
      summary: undefined,
      readUrl: '/api/projects/3708.md',
    });
  });

  it('拒绝不支持的类型或缺少 ID', () => {
    expect(() =>
      normalizeAgentPageContext({ type: 'ticket', id: '1' }),
    ).toThrow('不支持的 AI 页面上下文类型');
    expect(() => normalizeAgentPageContext({ type: 'document' })).toThrow(
      '缺少 AI 页面上下文 ID',
    );
  });

  it('标题和摘要做长度保护', () => {
    const context = normalizeAgentPageContext({
      type: 'document',
      id: 'document:1',
      title: 'x'.repeat(300),
      summary: 'y'.repeat(3000),
    });
    expect(context?.title).toHaveLength(200);
    expect(context?.summary).toHaveLength(2000);
  });
});

describe('WorkbenchService 个人 AGENT 任务上下文', () => {
  it('无工作台角色的可见任务也可作为上下文，并标记为只读', async () => {
    const task = {
      id: 42,
      code: 'TASK-042',
      title: '查询任务信息',
      status: TaskStatus.RUNNING,
      subStatus: TaskSubStatus.EXECUTING,
      agentId: 2001,
      requesterType: 'worker',
      requesterId: 2002,
      createdById: 8,
      ownerTakeoverUserId: null,
    } as Task;
    const send = jest.fn().mockResolvedValue({});
    const service = new WorkbenchService(
      { findOne: jest.fn().mockResolvedValue(task) } as never,
      { find: jest.fn().mockResolvedValue([]) } as never,
      {
        mustHumanWorker: jest.fn().mockResolvedValue({
          id: 1001,
          runtime: WorkerRuntime.HUMAN,
        }),
      } as never,
      {
        findForUser: jest.fn().mockResolvedValue(null),
        send,
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.agentSend({ id: 7, name: '张三' } as never, '查询一下', 42),
    ).resolves.toEqual({});
    expect(send).toHaveBeenCalledTimes(1);
    const options = (
      send.mock.calls as unknown as Array<
        [unknown, string, { taskContext?: string }]
      >
    )[0][2];
    expect(options.taskContext).toContain('# 当前任务');
    expect(options.taskContext).toContain('你在该任务中的角色：查看者（只读）');
    expect(options.taskContext).toContain(
      '只能查看和解释任务信息，不要调用会修改任务状态或文档的接口',
    );
  });
});
