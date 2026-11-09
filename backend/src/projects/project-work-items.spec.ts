import { TaskStatus, TaskSubStatus } from '../common/enums';
import { Defect } from '../defects/defect.entity';
import { Task } from '../tasks/task.entity';
import { TaskEvent } from '../tasks/task-event.entity';
import { Ticket } from '../tickets/ticket.entity';
import { TicketWorkflowRun } from '../tickets/ticket-workflow-run.entity';
import { Worker } from '../workers/worker.entity';
import { ProjectsService } from './projects.service';

describe('ProjectsService 项目任务板块', () => {
  const task = (over: Partial<Task>): Task =>
    ({
      id: 1,
      code: 'TK-0001',
      title: '项目交付',
      projectId: 3708,
      parentId: null,
      rootId: 1,
      status: TaskStatus.RUNNING,
      subStatus: TaskSubStatus.EXECUTING,
      agentId: 1001,
      updatedAt: new Date('2026-11-09T10:00:00+08:00'),
      ...over,
    }) as Task;

  const createService = (find: jest.Mock, latestLine: jest.Mock) =>
    new ProjectsService(
      { manager: { find } } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { latestProjectProgressLine: latestLine } as never,
      { ensureForProjectTask: jest.fn() } as never,
    );

  it('归集主任务、子任务、缺陷处理任务和关联工单', async () => {
    const root = task({});
    const defectTask = task({
      id: 2,
      code: 'TK-0002',
      title: '修复缺陷 #9',
      projectId: null,
      rootId: 2,
      updatedAt: new Date('2026-11-09T08:00:00+08:00'),
    });
    const child = task({
      id: 3,
      code: 'TK-0003',
      title: '子任务',
      parentId: 1,
      rootId: 1,
      subStatus: TaskSubStatus.PENDING_ACCEPT,
      updatedAt: new Date('2026-11-09T12:00:00+08:00'),
    });
    const tickets = [
      {
        id: 20,
        code: 'WO-0020',
        title: '历史工单',
        taskId: 1,
        assigneeId: 1001,
        assigneeName: '项目机器人',
        workflowStatus: null,
        currentNodeName: null,
        updatedAt: new Date('2026-11-09T09:00:00+08:00'),
      },
      {
        id: 21,
        code: 'WO-0021',
        title: '工作流工单',
        taskId: null,
        assigneeId: 1001,
        assigneeName: '项目机器人',
        workflowStatus: '待验收',
        currentNodeName: '人工验收',
        updatedAt: new Date('2026-11-09T11:00:00+08:00'),
      },
    ] as unknown as Ticket[];

    let taskCalls = 0;
    const find = jest.fn(
      (entity: unknown, options?: Record<string, unknown>) => {
        if (entity === Task) {
          taskCalls += 1;
          if (taskCalls === 1) return [root];
          if (taskCalls === 2) return [defectTask];
          if (taskCalls === 3) return [child];
          return [];
        }
        if (entity === Defect) {
          expect(options?.where).toEqual({ projectId: 3708 });
          return [{ id: 9, followupTaskId: 2 }];
        }
        if (entity === TaskEvent) {
          return [
            {
              id: 3,
              taskId: 1,
              content: '状态变更：进行中-执行中',
              createdAt: new Date(),
            },
          ];
        }
        if (entity === TicketWorkflowRun) {
          return [{ id: 1, ticketId: 21 }];
        }
        if (entity === Ticket) return tickets;
        if (entity === Worker) {
          return [
            {
              id: 1001,
              name: '项目机器人',
              ownerName: null,
              personalAgentUserId: null,
            },
          ];
        }
        return [];
      },
    );
    const latestLine = jest.fn((id: number) =>
      id === 2 ? '正在执行修复' : null,
    );
    const service = createService(find, latestLine);

    const items = await service.findProjectWorkItems(3708);

    expect(items).toHaveLength(5);
    expect(items.map((item) => `${item.kind}-${item.id}`)).toEqual([
      'task-3',
      'ticket-21',
      'task-1',
      'ticket-20',
      'task-2',
    ]);
    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'task',
          id: 1,
          agentName: '项目机器人',
          progress: '状态变更：进行中-执行中',
        }),
        expect.objectContaining({
          kind: 'task',
          id: 2,
          progress: '正在执行修复',
        }),
        expect.objectContaining({
          kind: 'task',
          id: 3,
          parentTaskId: 1,
          subStatus: TaskSubStatus.PENDING_ACCEPT,
        }),
        expect.objectContaining({
          kind: 'ticket',
          id: 21,
          status: '待验收',
          progress: '当前节点：人工验收',
        }),
      ]),
    );
  });

  it('没有项目任务时返回空列表', async () => {
    const find = jest.fn((entity: unknown) => {
      if (entity === Task || entity === Defect) return [];
      return [];
    });
    const service = createService(find, jest.fn());

    await expect(service.findProjectWorkItems(3708)).resolves.toEqual([]);
  });
});
