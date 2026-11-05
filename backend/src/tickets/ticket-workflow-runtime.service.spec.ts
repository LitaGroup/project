import { TaskStatus, TaskSubStatus } from '../common/enums';
import type { User } from '../auth/user.entity';
import { Task } from '../tasks/task.entity';
import { Worker } from '../workers/worker.entity';
import {
  WORKFLOW_END_NODE,
  type WorkflowDefinitionJson,
} from '../workflows/workflow.types';
import { TicketWorkflowRuntimeService } from './ticket-workflow-runtime.service';
import { TicketWorkflowRun } from './ticket-workflow-run.entity';
import { Ticket } from './ticket.entity';

describe('TicketWorkflowRuntimeService', () => {
  let tickets: { findOne: jest.Mock; update: jest.Mock };
  let runs: { find: jest.Mock; findOne: jest.Mock; update: jest.Mock };
  let definitions: { findOne: jest.Mock };
  let versions: { findOne: jest.Mock };
  let templates: { findOne: jest.Mock };
  let tasks: { findOne: jest.Mock; update: jest.Mock };
  let workers: { findOne: jest.Mock };
  let tasksService: { addEvent: jest.Mock };
  let service: TicketWorkflowRuntimeService;

  beforeEach(() => {
    tickets = {
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    runs = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    definitions = { findOne: jest.fn() };
    versions = { findOne: jest.fn() };
    templates = { findOne: jest.fn() };
    tasks = {
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    workers = { findOne: jest.fn() };
    tasksService = { addEvent: jest.fn().mockResolvedValue(undefined) };
    service = new TicketWorkflowRuntimeService(
      tickets as never,
      runs as never,
      definitions as never,
      versions as never,
      templates as never,
      tasks as never,
      workers as never,
      tasksService as never,
    );
  });

  it.each([
    ['operation', 'failed'],
    ['approval', 'rejected'],
  ])('节点任务被拒绝时按节点失败推进工单（%s）', async (kind, outcome) => {
    const task = {
      id: 30,
      status: TaskStatus.FINISHED,
      subStatus: TaskSubStatus.REFUSED,
    } as Task;
    const run = {
      id: 1,
      ticketId: 5,
      nodeKey: 'node-1',
      nodeKind: kind,
      taskId: task.id,
      status: '执行中',
    } as TicketWorkflowRun;
    runs.find.mockResolvedValue([run]);
    tasks.findOne.mockResolvedValue(task);
    const complete = jest
      .spyOn(
        service as unknown as {
          completeRunWithOutcome: (
            run: TicketWorkflowRun,
            task: Task,
            outcome: string,
          ) => Promise<void>;
        },
        'completeRunWithOutcome',
      )
      .mockResolvedValue(undefined);

    await service.pollNodeTasks();

    expect(complete).toHaveBeenCalledWith(run, task, outcome);
  });

  it.each([
    ['approval', 'approved', '已完成'],
    ['approval', 'rejected', '已失败'],
    ['operation', 'succeeded', '已完成'],
    ['operation', 'failed', '已失败'],
  ])(
    '%s 节点以 %s 直接结束流程时，工单状态为 %s',
    async (_kind, outcome, workflowStatus) => {
      const workflow: WorkflowDefinitionJson = {
        startNode: 'start',
        nodes: [],
        edges: [
          {
            from: 'node-1',
            to: WORKFLOW_END_NODE,
            outcome: outcome as 'succeeded',
            label: null,
          },
        ],
      };
      const advance = (
        service as unknown as {
          advance: (
            ticketId: number,
            workflow: WorkflowDefinitionJson,
            fromKey: string,
            outcome: string,
          ) => Promise<void>;
        }
      ).advance.bind(service);

      await advance(5, workflow, 'node-1', outcome);

      expect(tickets.update).toHaveBeenCalledWith(
        5,
        expect.objectContaining({
          workflowStatus,
          currentNodeKey: null,
          currentNodeName: null,
        }),
      );
    },
  );

  it('调用节点拒绝接口时把节点任务置为失败并按拒绝结果推进', async () => {
    const worker = { id: 1001, name: '审批机器人' } as Worker;
    const node = {
      key: 'approval',
      name: '发布审批',
      kind: 'approval',
    };
    const ticket = {
      id: 5,
      code: 'WO-0005',
      workflowDefinitionId: 1,
      workflowVersionId: 2,
      currentNodeKey: node.key,
    } as Ticket;
    const activeTask = {
      id: 30,
      status: TaskStatus.WAITING,
      subStatus: TaskSubStatus.PENDING_ACCEPTANCE,
    } as Task;
    const failedTask = {
      ...activeTask,
      status: TaskStatus.FINISHED,
      subStatus: TaskSubStatus.FAILED,
      failureReason: '材料不符合要求',
    } as Task;
    const run = {
      id: 1,
      ticketId: ticket.id,
      nodeKey: node.key,
      nodeKind: node.kind,
      taskId: activeTask.id,
      agentId: worker.id,
      status: '等待中',
    } as TicketWorkflowRun;
    tickets.findOne.mockResolvedValue(ticket);
    versions.findOne.mockResolvedValue({
      definition: { nodes: [node], edges: [] },
    });
    runs.findOne.mockResolvedValue(run);
    tasks.findOne
      .mockResolvedValueOnce(activeTask)
      .mockResolvedValueOnce(failedTask);
    const complete = jest
      .spyOn(
        service as unknown as {
          completeRunWithOutcome: (
            run: TicketWorkflowRun,
            task: Task,
            outcome: string,
          ) => Promise<void>;
        },
        'completeRunWithOutcome',
      )
      .mockResolvedValue(undefined);

    const result = await service.rejectNodeByWorker(
      ticket.id,
      worker,
      node.key,
      '材料不符合要求',
    );

    expect(tasks.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: activeTask.id }),
      expect.objectContaining({
        status: TaskStatus.FINISHED,
        subStatus: TaskSubStatus.FAILED,
        failureReason: '材料不符合要求',
      }),
    );
    expect(complete).toHaveBeenCalledWith(run, failedTask, 'rejected');
    expect(result.outcome).toBe('rejected');
  });

  it('当前审批节点的真人处理人可直接审批通过并推进工作流', async () => {
    const user = { id: 7, name: '审批人' } as User;
    const node = {
      key: 'approval',
      name: '发布审批',
      kind: 'approval',
    };
    const ticket = {
      id: 5,
      code: 'WO-0005',
      workflowDefinitionId: 1,
      workflowVersionId: 2,
      currentNodeKey: node.key,
    } as Ticket;
    const activeTask = {
      id: 30,
      status: TaskStatus.WAITING,
      subStatus: TaskSubStatus.PENDING_ACCEPTANCE,
    } as Task;
    const completedTask = {
      ...activeTask,
      status: TaskStatus.FINISHED,
      subStatus: TaskSubStatus.COMPLETED,
      acceptedBy: user.name,
    } as Task;
    const run = {
      id: 1,
      ticketId: ticket.id,
      nodeKey: node.key,
      nodeKind: node.kind,
      taskId: activeTask.id,
      agentId: 1001,
      status: '等待中',
    } as TicketWorkflowRun;
    tickets.findOne.mockResolvedValue(ticket);
    versions.findOne.mockResolvedValue({
      definition: { nodes: [node], edges: [] },
    });
    runs.findOne.mockResolvedValue(run);
    workers.findOne.mockResolvedValue({ id: run.agentId });
    tasks.findOne
      .mockResolvedValueOnce(activeTask)
      .mockResolvedValueOnce(completedTask);
    const complete = jest
      .spyOn(
        service as unknown as {
          completeRunWithOutcome: (
            run: TicketWorkflowRun,
            task: Task,
            outcome: string,
          ) => Promise<void>;
        },
        'completeRunWithOutcome',
      )
      .mockResolvedValue(undefined);

    await service.approveNodeByUser(ticket.id, user);

    expect(tasks.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: activeTask.id }),
      expect.objectContaining({
        status: TaskStatus.FINISHED,
        subStatus: TaskSubStatus.COMPLETED,
        acceptedBy: user.name,
        missingItems: null,
        resumePrompt: null,
      }),
    );
    expect(complete).toHaveBeenCalledWith(run, completedTask, 'approved');
  });

  it('非当前审批任务处理人不能直接审批', async () => {
    const user = { id: 7, name: '其他用户' } as User;
    const node = {
      key: 'approval',
      name: '发布审批',
      kind: 'approval',
    };
    const ticket = {
      id: 5,
      code: 'WO-0005',
      workflowDefinitionId: 1,
      workflowVersionId: 2,
      currentNodeKey: node.key,
    } as Ticket;
    const run = {
      id: 1,
      ticketId: ticket.id,
      nodeKey: node.key,
      nodeKind: node.kind,
      taskId: 30,
      agentId: 1002,
      status: '等待中',
    } as TicketWorkflowRun;
    tickets.findOne.mockResolvedValue(ticket);
    versions.findOne.mockResolvedValue({
      definition: { nodes: [node], edges: [] },
    });
    runs.findOne.mockResolvedValue(run);
    workers.findOne.mockResolvedValue({ id: 1001 });

    await expect(service.approveNodeByUser(ticket.id, user)).rejects.toThrow(
      '仅工单发起人、当前审批处理人或管理员可以审批',
    );
    expect(tasks.update).not.toHaveBeenCalled();
  });
});
