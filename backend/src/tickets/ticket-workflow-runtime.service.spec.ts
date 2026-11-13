import {
  TaskStatus,
  TaskSubStatus,
  TaskType,
  WorkerRole,
  WorkerRuntime,
} from '../common/enums';
import type { User } from '../auth/user.entity';
import { Task } from '../tasks/task.entity';
import { Worker } from '../workers/worker.entity';
import {
  WORKFLOW_END_NODE,
  type WorkflowConditionRule,
  type WorkflowDefinitionJson,
  type WorkflowInputField,
  type WorkflowNodeDefinition,
} from '../workflows/workflow.types';
import { TicketWorkflowRuntimeService } from './ticket-workflow-runtime.service';
import { TicketWorkflowRun } from './ticket-workflow-run.entity';
import { Ticket } from './ticket.entity';

describe('TicketWorkflowRuntimeService', () => {
  let tickets: {
    findOne: jest.Mock;
    update: jest.Mock;
    createQueryBuilder: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    delete: jest.Mock;
  };
  let runs: {
    find: jest.Mock;
    findOne: jest.Mock;
    update: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    insert: jest.Mock;
    count: jest.Mock;
  };
  let definitions: { findOne: jest.Mock };
  let versions: { findOne: jest.Mock };
  let templates: { findOne: jest.Mock };
  let tasks: { findOne: jest.Mock; update: jest.Mock };
  let workers: { findOne: jest.Mock };
  let tasksService: { addEvent: jest.Mock; create: jest.Mock };
  let dispatchService: {
    claimExecution: jest.Mock;
    dispatch: jest.Mock;
    isHumanWorker: jest.Mock;
  };
  let taskNotify: {
    notifyApprovalTask: jest.Mock;
    syncApprovalCardResult: jest.Mock;
  };
  let llm: { generateTitle: jest.Mock };
  let backlogs: { findOne: jest.Mock };
  let service: TicketWorkflowRuntimeService;

  beforeEach(() => {
    tickets = {
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn(),
      create: jest.fn((value: Partial<Ticket>) => value),
      save: jest.fn((value: Partial<Ticket>) =>
        Promise.resolve({ id: 11, ...value } as Ticket),
      ),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    runs = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      save: jest.fn().mockResolvedValue({ id: 1 }),
      create: jest.fn().mockImplementation((row: unknown) => row),
      insert: jest.fn().mockResolvedValue({ identifiers: [{ id: 1 }] }),
      count: jest.fn().mockResolvedValue(0),
    };
    definitions = { findOne: jest.fn() };
    versions = { findOne: jest.fn() };
    templates = { findOne: jest.fn() };
    tasks = {
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    workers = { findOne: jest.fn() };
    tasksService = {
      addEvent: jest.fn().mockResolvedValue(undefined),
      create: jest.fn(),
    };
    dispatchService = {
      claimExecution: jest.fn().mockResolvedValue({ id: 1 }),
      dispatch: jest.fn().mockResolvedValue({ id: 1 }),
      isHumanWorker: jest.fn().mockResolvedValue(true),
    };
    taskNotify = {
      notifyApprovalTask: jest.fn().mockResolvedValue({ sent: true }),
      syncApprovalCardResult: jest.fn().mockResolvedValue(undefined),
    };
    llm = { generateTitle: jest.fn().mockResolvedValue(null) };
    backlogs = { findOne: jest.fn().mockResolvedValue({ id: 1 }) };
    service = new TicketWorkflowRuntimeService(
      tickets as never,
      runs as never,
      definitions as never,
      versions as never,
      templates as never,
      tasks as never,
      backlogs as never,
      workers as never,
      tasksService as never,
      dispatchService as never,
      taskNotify as never,
      llm as never,
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
    expect(taskNotify.syncApprovalCardResult).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: activeTask.id,
        state: 'approved',
        operator: { id: user.id, name: user.name },
      }),
    );
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

  it('审批通过时记录可选审批意见', async () => {
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
      status: TaskStatus.RUNNING,
      subStatus: TaskSubStatus.EXECUTING,
    } as Task;
    const completedTask = {
      ...activeTask,
      status: TaskStatus.FINISHED,
      subStatus: TaskSubStatus.COMPLETED,
      result: '同意发布',
    } as Task;
    const run = {
      id: 1,
      ticketId: ticket.id,
      nodeKey: node.key,
      nodeKind: node.kind,
      taskId: activeTask.id,
      agentId: 1001,
      status: '执行中',
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

    await service.approveNodeByUser(ticket.id, user, '同意发布');

    expect(tasks.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: activeTask.id }),
      expect.objectContaining({
        status: TaskStatus.FINISHED,
        subStatus: TaskSubStatus.COMPLETED,
        result: '同意发布',
      }),
    );
    expect(tasksService.addEvent).toHaveBeenCalledWith(
      activeTask.id,
      '状态变更',
      expect.stringContaining('意见：同意发布'),
      user.name,
      expect.objectContaining({ approval: true, remark: '同意发布' }),
    );
    expect(complete).toHaveBeenCalledWith(run, completedTask, 'approved');
    expect(taskNotify.syncApprovalCardResult).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: activeTask.id,
        state: 'approved',
        remark: '同意发布',
      }),
    );
  });

  it('审批驳回必须填写意见并按 rejected 推进', async () => {
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
      status: TaskStatus.RUNNING,
      subStatus: TaskSubStatus.EXECUTING,
    } as Task;
    const failedTask = {
      ...activeTask,
      status: TaskStatus.FINISHED,
      subStatus: TaskSubStatus.FAILED,
      failureReason: '材料不全',
    } as Task;
    const run = {
      id: 1,
      ticketId: ticket.id,
      nodeKey: node.key,
      nodeKind: node.kind,
      taskId: activeTask.id,
      agentId: 1001,
      status: '执行中',
    } as TicketWorkflowRun;
    tickets.findOne.mockResolvedValue(ticket);
    versions.findOne.mockResolvedValue({
      definition: { nodes: [node], edges: [] },
    });
    runs.findOne.mockResolvedValue(run);
    workers.findOne.mockResolvedValue({ id: run.agentId });
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

    await expect(
      service.rejectNodeByUser(ticket.id, user, '  '),
    ).rejects.toThrow('驳回意见不能为空');

    await service.rejectNodeByUser(ticket.id, user, '材料不全');

    expect(tasks.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: activeTask.id }),
      expect.objectContaining({
        status: TaskStatus.FINISHED,
        subStatus: TaskSubStatus.FAILED,
        failureReason: '材料不全',
      }),
    );
    expect(complete).toHaveBeenCalledWith(run, failedTask, 'rejected');
    expect(taskNotify.syncApprovalCardResult).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: activeTask.id,
        state: 'rejected',
        operator: { id: user.id, name: user.name },
        remark: '材料不全',
      }),
    );
  });

  it('审批节点创建审批类型任务并自动接受（真人处理人）', async () => {
    const ticket = {
      id: 5,
      code: 'WO-0005',
      title: '发布申请',
      description: null,
      createdById: 2,
      createdByName: '王五',
      initiatorWorkerId: 1001,
      inputValues: {},
    } as unknown as Ticket;
    const node = {
      key: 'approval',
      name: '主管审批',
      kind: 'approval',
      taskTemplateId: 1001,
      responsibleWorkerId: 1002,
      inputFields: null,
      autoAccept: false,
      description: null,
    };
    const workflow = {
      startNode: 'start',
      nodes: [node],
      edges: [],
    } as WorkflowDefinitionJson;
    templates.findOne.mockResolvedValue({
      id: 1001,
      name: '审批定义',
      agentIds: [],
    });
    workers.findOne.mockResolvedValue({
      id: 1002,
      name: '审批机器人',
      enabled: true,
      runtime: WorkerRuntime.HUMAN,
      personalAgentUserId: null,
    });
    tasksService.create.mockResolvedValue({
      id: 30,
      code: 'TK-0030',
      title: 'WO-0005 主管审批',
      type: TaskType.APPROVAL,
      subStatus: TaskSubStatus.PENDING_ASSIGNMENT,
    });
    const notify = jest
      .spyOn(
        service as unknown as {
          notifyApprovalAssignee: (
            task: Task,
            node: unknown,
            ticket: Ticket,
          ) => Promise<void>;
        },
        'notifyApprovalAssignee',
      )
      .mockResolvedValue(undefined);

    await (
      service as unknown as {
        createNodeTask: (
          ticket: Ticket,
          workflow: WorkflowDefinitionJson,
          node: unknown,
        ) => Promise<void>;
      }
    ).createNodeTask(ticket, workflow, node);

    expect(tasksService.create).toHaveBeenCalledWith(
      expect.objectContaining({ type: TaskType.APPROVAL }),
    );
    expect(dispatchService.claimExecution).toHaveBeenCalledWith(
      30,
      TaskSubStatus.PENDING_ACCEPTANCE,
      { nullIfStateChanged: true },
    );
    expect(dispatchService.dispatch).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ id: 30 }),
      node,
      ticket,
    );
  });

  describe('判断节点', () => {
    const conditionNode = {
      key: 'judge',
      name: '判断',
      kind: 'condition',
      taskTemplateId: null,
      responsibleWorkerId: null,
      inputFields: null,
      autoAccept: false,
      description: null,
    } as WorkflowNodeDefinition;

    const inputField = (
      key: string,
      type: WorkflowInputField['type'],
      options?: string[],
    ): WorkflowInputField => ({
      key,
      label: key,
      type,
      required: false,
      ...(options ? { options } : {}),
      placeholder: null,
      defaultValue: null,
    });

    const startNode = (
      fields: WorkflowInputField[],
    ): WorkflowNodeDefinition => ({
      key: 'start',
      name: 'start',
      kind: 'start',
      taskTemplateId: null,
      responsibleWorkerId: null,
      inputFields: fields,
      autoAccept: false,
      description: null,
    });

    const judgeWorkflow = (
      rules: WorkflowConditionRule[],
      fields: WorkflowInputField[],
    ): WorkflowDefinitionJson => ({
      startNode: 'start',
      nodes: [startNode(fields), conditionNode],
      edges: [
        {
          from: 'judge',
          to: 'hit',
          outcome: null,
          conditions: rules,
          label: null,
        },
        { from: 'judge', to: 'miss', outcome: null, label: null },
      ],
    });

    const advanceCondition = (
      ticket: Ticket,
      workflow: WorkflowDefinitionJson,
      depth = 0,
    ) =>
      (
        service as unknown as {
          advanceConditionNode: (
            ticket: Ticket,
            workflow: WorkflowDefinitionJson,
            node: WorkflowNodeDefinition,
            depth: number,
          ) => Promise<void>;
        }
      ).advanceConditionNode(ticket, workflow, conditionNode, depth);

    const spyEnterNode = () =>
      jest
        .spyOn(
          service as unknown as {
            enterNode: (
              ticket: Ticket,
              workflow: WorkflowDefinitionJson,
              nodeKey: string,
              depth?: number,
            ) => Promise<void>;
          },
          'enterNode',
        )
        .mockResolvedValue(undefined);

    it('进入判断节点时记录运行并执行条件分发', async () => {
      const ticket = {
        id: 5,
        inputValues: { title: '紧急发布' },
      } as unknown as Ticket;
      const workflow = judgeWorkflow(
        [{ field: 'title', operator: 'contains', value: '紧急' }],
        [inputField('title', 'text')],
      );
      const advance = jest
        .spyOn(
          service as unknown as {
            advanceConditionNode: (
              ticket: Ticket,
              workflow: WorkflowDefinitionJson,
              node: WorkflowNodeDefinition,
              depth: number,
            ) => Promise<void>;
          },
          'advanceConditionNode',
        )
        .mockResolvedValue(undefined);

      await (
        service as unknown as {
          enterNode: (
            ticket: Ticket,
            workflow: WorkflowDefinitionJson,
            nodeKey: string,
          ) => Promise<void>;
        }
      ).enterNode(ticket, workflow, 'judge');

      expect(runs.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          nodeKind: 'condition',
          status: '已完成',
        }),
      );
      expect(advance).toHaveBeenCalledWith(ticket, workflow, conditionNode, 0);
    });

    it.each([
      [
        '文本包含',
        { title: '紧急发布' },
        [{ field: 'title', operator: 'contains', value: '紧急' }],
        [inputField('title', 'text')],
        'hit',
      ],
      [
        '文本不包含走默认分支',
        { title: '普通发布' },
        [{ field: 'title', operator: 'contains', value: '紧急' }],
        [inputField('title', 'text')],
        'miss',
      ],
      [
        '数字大于',
        { amount: '1200' },
        [{ field: 'amount', operator: 'gt', value: '1000' }],
        [inputField('amount', 'number')],
        'hit',
      ],
      [
        '数字大于不满足',
        { amount: '800' },
        [{ field: 'amount', operator: 'gt', value: '1000' }],
        [inputField('amount', 'number')],
        'miss',
      ],
      [
        '数字相等按数值比较',
        { amount: '1200.0' },
        [{ field: 'amount', operator: 'eq', value: '1200' }],
        [inputField('amount', 'number')],
        'hit',
      ],
      [
        '日期大于等于',
        { day: '2026-06-01' },
        [{ field: 'day', operator: 'gte', value: '2026-06-01' }],
        [inputField('day', 'date')],
        'hit',
      ],
      [
        '日期小于',
        { day: '2026-06-01' },
        [{ field: 'day', operator: 'lt', value: '2026-01-01' }],
        [inputField('day', 'date')],
        'miss',
      ],
      [
        '单选等于',
        { priority: '高' },
        [{ field: 'priority', operator: 'eq', value: '高' }],
        [inputField('priority', 'select', ['高', '低'])],
        'hit',
      ],
      [
        '多选包含选中项',
        { tags: '前端,后端' },
        [{ field: 'tags', operator: 'contains', value: '后端' }],
        [inputField('tags', 'multiselect', ['前端', '后端'])],
        'hit',
      ],
      [
        '多选不包含时走默认分支',
        { tags: '前端' },
        [{ field: 'tags', operator: 'contains', value: '后端' }],
        [inputField('tags', 'multiselect', ['前端', '后端'])],
        'miss',
      ],
      [
        '多选按选项精确匹配而非子串',
        { tags: '前端页面' },
        [{ field: 'tags', operator: 'contains', value: '前端' }],
        [inputField('tags', 'multiselect', ['前端', '前端页面'])],
        'miss',
      ],
      [
        '为空',
        { remark: '' },
        [{ field: 'remark', operator: 'empty' }],
        [inputField('remark', 'text')],
        'hit',
      ],
      [
        '不为空不满足',
        { remark: '' },
        [{ field: 'remark', operator: 'notEmpty' }],
        [inputField('remark', 'text')],
        'miss',
      ],
      [
        '多个条件全部满足',
        { title: '紧急发布', priority: '高' },
        [
          { field: 'title', operator: 'contains', value: '紧急' },
          { field: 'priority', operator: 'ne', value: '低' },
        ],
        [
          inputField('title', 'text'),
          inputField('priority', 'select', ['高', '低']),
        ],
        'hit',
      ],
    ] as Array<
      [
        string,
        Record<string, unknown>,
        WorkflowConditionRule[],
        WorkflowInputField[],
        string,
      ]
    >)('条件求值：%s', async (_name, inputValues, rules, fields, target) => {
      const ticket = { id: 5, inputValues } as unknown as Ticket;
      const workflow = judgeWorkflow(rules, fields);
      const enter = spyEnterNode();

      await advanceCondition(ticket, workflow);

      expect(enter).toHaveBeenCalledWith(ticket, workflow, target, 1);
    });

    it('判断分支可以直接结束流程', async () => {
      const ticket = {
        id: 5,
        inputValues: { title: '紧急发布' },
      } as unknown as Ticket;
      const workflow: WorkflowDefinitionJson = {
        startNode: 'start',
        nodes: [startNode([inputField('title', 'text')]), conditionNode],
        edges: [
          {
            from: 'judge',
            to: WORKFLOW_END_NODE,
            outcome: null,
            conditions: [
              { field: 'title', operator: 'contains', value: '紧急' },
            ],
            label: null,
          },
          { from: 'judge', to: 'miss', outcome: null, label: null },
        ],
      };
      const enter = spyEnterNode();

      await advanceCondition(ticket, workflow);

      expect(tickets.update).toHaveBeenCalledWith(
        5,
        expect.objectContaining({
          workflowStatus: '已完成',
          currentNodeKey: null,
          currentNodeName: null,
        }),
      );
      expect(enter).not.toHaveBeenCalled();
    });

    it('判断节点连续流转超过上限时工单失败', async () => {
      const ticket = { id: 5, inputValues: {} } as unknown as Ticket;
      const workflow = judgeWorkflow([], [inputField('title', 'text')]);

      await advanceCondition(ticket, workflow, 50);

      expect(tickets.update).toHaveBeenCalledWith(
        5,
        expect.objectContaining({ workflowStatus: '已失败' }),
      );
    });
  });

  describe('多选输入归一化', () => {
    type Normalizer = {
      normalizeInputValues: (
        fields: WorkflowInputField[],
        input: Record<string, unknown>,
      ) => Record<string, unknown>;
    };

    const normalize = (
      fields: WorkflowInputField[],
      input: Record<string, unknown>,
    ) => (service as unknown as Normalizer).normalizeInputValues(fields, input);

    const tagsField = (
      options: string[],
      patch: Partial<WorkflowInputField> = {},
    ): WorkflowInputField => ({
      key: 'tags',
      label: '标签',
      type: 'multiselect',
      required: false,
      options,
      placeholder: null,
      defaultValue: null,
      ...patch,
    });

    it('接受字符串数组并去重后保存为逗号拼接串', () => {
      expect(
        normalize([tagsField(['A', 'B'])], { tags: ['A', 'B', 'A'] }),
      ).toEqual({ tags: 'A,B' });
    });

    it('接受英文逗号分隔字符串并忽略空项', () => {
      expect(normalize([tagsField(['A', 'B'])], { tags: ' A, ,B ' })).toEqual({
        tags: 'A,B',
      });
    });

    it('拒绝不在选项内取值', () => {
      expect(() => normalize([tagsField(['A'])], { tags: ['A', 'C'] })).toThrow(
        '包含无效选项「C」',
      );
    });

    it('必填多选不能为空', () => {
      expect(() =>
        normalize([tagsField(['A'], { required: true })], { tags: [] }),
      ).toThrow('不能为空');
    });

    it('空值回落到默认值', () => {
      expect(
        normalize([tagsField(['A', 'B'], { defaultValue: 'A' })], {}),
      ).toEqual({ tags: 'A' });
    });
  });

  describe('工单标题命名（异步）', () => {
    type TitleNaming = {
      generateTitle(ticket: Ticket): Promise<void>;
      scheduleTitleNaming(ticket: Ticket): void;
    };

    it('按「T-{id}」格式乐观更新，期间标题被改则不覆盖', async () => {
      const execute = jest.fn().mockResolvedValue({ affected: 1 });
      const qb = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute,
      };
      tickets.createQueryBuilder = jest.fn(() => qb);
      llm.generateTitle.mockResolvedValue('修复登录页崩溃');
      const ticket = {
        id: 42,
        code: 'WO-0042',
        title: '新工单',
        category: '技术工单',
        description: '登录页点击即崩溃',
        inputValues: {},
      } as unknown as Ticket;

      await (service as unknown as TitleNaming).generateTitle(ticket);

      expect(qb.set).toHaveBeenCalledWith({
        title: '「T-42」修复登录页崩溃',
      });
      expect(qb.where).toHaveBeenCalledWith('id = :id AND title = :original', {
        id: 42,
        original: '新工单',
      });

      // 乐观条件不命中（期间被人工改过标题）时放弃更新
      execute.mockResolvedValue({ affected: 0 });
      await (service as unknown as TitleNaming).generateTitle(ticket);
      expect(qb.set).toHaveBeenCalledTimes(2);
    });

    it('模型未配置时跳过更新', async () => {
      const qb = { update: jest.fn() };
      tickets.createQueryBuilder = jest.fn(() => qb);
      llm.generateTitle.mockResolvedValue(null);
      const ticket = { id: 1, code: 'WO-0001', title: 't' } as Ticket;

      await (service as unknown as TitleNaming).generateTitle(ticket);

      expect(qb.update).not.toHaveBeenCalled();
    });

    it('生成失败只告警，不影响调用方', async () => {
      llm.generateTitle.mockRejectedValue(new Error('timeout'));
      const ticket = { id: 2, code: 'WO-0002', title: 't' } as Ticket;

      expect(() =>
        (service as unknown as TitleNaming).scheduleTitleNaming(ticket),
      ).not.toThrow();
      // 等待异步 catch 完成，避免未处理拒绝
      await new Promise((resolve) => setImmediate(resolve));
    });
  });

  describe('创建工单身份', () => {
    const startNode: WorkflowNodeDefinition = {
      key: 'start',
      name: '发起工单',
      kind: 'start',
      taskTemplateId: null,
      responsibleWorkerId: null,
      inputFields: [
        { key: 'title', label: '标题', type: 'text', required: true },
      ],
      autoAccept: false,
      description: null,
    };

    beforeEach(() => {
      definitions.findOne.mockResolvedValue({
        id: 5,
        name: '发布申请',
        category: '发布',
        enabled: true,
        latestPublishedVersion: 1,
      });
      versions.findOne.mockResolvedValue({
        id: 9,
        version: 1,
        definition: {
          startNode: 'start',
          nodes: [startNode],
          edges: [],
        } as WorkflowDefinitionJson,
      });
      jest
        .spyOn(
          service as unknown as {
            enterNode: (
              ticket: Ticket,
              workflow: WorkflowDefinitionJson,
              key: string | null,
            ) => Promise<void>;
          },
          'enterNode',
        )
        .mockResolvedValue(undefined);
      jest
        .spyOn(
          service as unknown as {
            scheduleTitleNaming: (ticket: Ticket) => void;
          },
          'scheduleTitleNaming',
        )
        .mockImplementation(() => undefined);
      tickets.findOne.mockResolvedValue({ id: 11 });
    });

    it('真人身份以绑定真人机器人为发起机器人', async () => {
      workers.findOne.mockResolvedValue({
        id: 1001,
        name: '张三-真人',
        enabled: true,
      });

      await service.create(
        { workflowDefinitionId: 5, inputValues: { title: '发布 v1' } },
        { user: { id: 2, name: '张三' } as User },
      );

      expect(tickets.create).toHaveBeenCalledWith(
        expect.objectContaining({
          createdById: 2,
          createdByName: '张三',
          initiatorWorkerId: 1001,
          initiatorWorkerName: '张三-真人',
          assigneeId: 1001,
        }),
      );
      expect(workers.findOne).toHaveBeenCalled();
    });

    it('AI 机器人身份以自身为发起机器人，创建人为空', async () => {
      await service.create(
        { workflowDefinitionId: 5, inputValues: { title: '发布 v1' } },
        {
          worker: {
            id: 2001,
            name: 'AI 机器人',
            enabled: true,
            role: WorkerRole.WORKER,
            personalAgentUserId: null,
          } as Worker,
        },
      );

      expect(workers.findOne).not.toHaveBeenCalled();
      expect(tickets.create).toHaveBeenCalledWith(
        expect.objectContaining({
          createdById: null,
          createdByName: 'AI 机器人',
          initiatorWorkerId: 2001,
          initiatorWorkerName: 'AI 机器人',
          assigneeId: 2001,
        }),
      );
    });

    it('个人 AGENT 与无身份调用被拒绝', async () => {
      await expect(
        service.create(
          { workflowDefinitionId: 5, inputValues: {} },
          {
            worker: {
              id: 3001,
              name: '个人 AGENT',
              enabled: true,
              role: WorkerRole.WORKER,
              personalAgentUserId: 2,
            } as Worker,
          },
        ),
      ).rejects.toThrow('当前机器人不能发起工单');

      await expect(
        service.create({ workflowDefinitionId: 5, inputValues: {} }, {}),
      ).rejects.toThrow('创建工单需要用户或机器人身份');
      expect(tickets.create).not.toHaveBeenCalled();
    });
  });
});
