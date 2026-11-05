import { TaskStatus, TaskSubStatus } from '../common/enums';
import { Task } from '../tasks/task.entity';
import { Worker } from '../workers/worker.entity';
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
});
