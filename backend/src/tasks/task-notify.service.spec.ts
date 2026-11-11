import { TaskStatus, TaskSubStatus, WorkerRuntime } from '../common/enums';
import { Task } from './task.entity';
import { TaskNotifyService } from './task-notify.service';

let botClient: { sendCard: jest.Mock; updateCard: jest.Mock };

describe('TaskNotifyService 飞书任务通知（平台官方机器人）', () => {
  const baseTask = (over: Partial<Task> = {}): Task =>
    ({
      id: 42,
      code: 'TK-0042',
      title: '活动页开发',
      status: TaskStatus.WAITING,
      subStatus: TaskSubStatus.PENDING_ACCEPT,
      requesterType: 'user',
      requesterId: 7,
      agentId: 1001,
      ...over,
    }) as Task;

  let workers: { findOne: jest.Mock };
  let tasks: { findOne: jest.Mock };
  let users: { findOne: jest.Mock };
  let approvalCards: {
    save: jest.Mock;
    create: jest.Mock;
    find: jest.Mock;
    update: jest.Mock;
  };
  let workersService: { ownerOpenId: jest.Mock };
  let tickets: { findOne: jest.Mock };
  let ticketRuns: { findOne: jest.Mock };
  let botConfig: {
    loadEnabledOfficial: jest.Mock;
    loadWithSecrets: jest.Mock;
    secretsOf: jest.Mock;
  };
  let botIdentities: { openIdFor: jest.Mock };
  let config: { get: jest.Mock };
  let service: TaskNotifyService;

  beforeEach(() => {
    workers = { findOne: jest.fn() };
    tasks = { findOne: jest.fn() };
    users = {
      findOne: jest.fn().mockResolvedValue({
        id: 7,
        name: '张三',
        feishuOpenId: 'ou_requester',
      }),
    };
    approvalCards = {
      save: jest.fn().mockResolvedValue({ id: 1 }),
      create: jest.fn().mockImplementation((row: unknown) => row),
      find: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    workersService = { ownerOpenId: jest.fn() };
    tickets = { findOne: jest.fn().mockResolvedValue(null) };
    ticketRuns = { findOne: jest.fn().mockResolvedValue(null) };
    botConfig = {
      loadEnabledOfficial: jest
        .fn()
        .mockResolvedValue({ id: 9, kind: 'official', enabled: true }),
      loadWithSecrets: jest
        .fn()
        .mockResolvedValue({ id: 9, kind: 'official', enabled: true }),
      secretsOf: jest.fn().mockReturnValue({
        appId: 'app',
        appSecret: 'secret',
        verificationToken: null,
        encryptKey: null,
      }),
    };
    botClient = {
      sendCard: jest.fn().mockResolvedValue({ messageId: 'om_card_1' }),
      updateCard: jest.fn().mockResolvedValue(undefined),
    };
    botIdentities = { openIdFor: jest.fn().mockResolvedValue(null) };
    config = {
      get: jest
        .fn()
        .mockImplementation((key: string) =>
          key === 'APP_URL' ? 'https://project.example/' : undefined,
        ),
    };
    service = new TaskNotifyService(
      workers as never,
      tasks as never,
      users as never,
      approvalCards as never,
      tickets as never,
      ticketRuns as never,
      workersService as never,
      botConfig as never,
      botClient as never,
      botIdentities as never,
      config as never,
    );
  });

  it('待验收通知打开工作台中的对应任务', async () => {
    await expect(
      service.notifyTaskRequester(
        baseTask(),
        'accept',
        '任务待验收：TK-0042 活动页开发',
        '机器人已完成执行，请需求方验收产出。',
      ),
    ).resolves.toEqual({ sent: true, ownerName: '张三' });

    expect(botClient.sendCard).toHaveBeenCalledWith(
      9,
      expect.any(Object),
      'open_id',
      'ou_requester',
      expect.any(Object),
    );
    expect(sentCardUrl()).toBe('https://project.example/workbench/tasks/42');
  });

  it('非待验收通知继续打开任务详情页', async () => {
    await service.notifyTaskRequester(
      baseTask({
        status: TaskStatus.WAITING,
        subStatus: TaskSubStatus.PENDING_FEEDBACK,
      }),
      'feedback',
      '任务待反馈：TK-0042 活动页开发',
      '请补充活动页素材。',
    );

    expect(sentCardUrl()).toBe('https://project.example/tasks/42');
  });

  it('真人执行机器人收到新任务通知并打开工作台任务', async () => {
    workers.findOne.mockResolvedValueOnce({
      id: 1001,
      name: '李四',
      runtime: WorkerRuntime.HUMAN,
      humanUserId: 8,
    });
    users.findOne.mockResolvedValueOnce({
      id: 8,
      name: '李四',
      feishuOpenId: 'ou_executor',
    });

    await expect(
      service.notifyTaskHumanAssignee(
        baseTask({ subStatus: TaskSubStatus.PENDING_ACCEPTANCE }),
        'notice',
        '新任务待处理：TK-0042 活动页开发',
        '任务已分配给你，请前往工作台确认是否接受。',
      ),
    ).resolves.toEqual({ sent: true, ownerName: '李四' });

    expect(sentCardUrl()).toBe('https://project.example/workbench/tasks/42');
    expect(sentCardActionText()).toBe('打开工作台');
  });

  it('优先使用官方机器人应用下的 open_id 发送', async () => {
    botIdentities.openIdFor.mockResolvedValueOnce('ou_bot_mapped');

    await service.notifyTaskRequester(
      baseTask(),
      'accept',
      '任务待验收：TK-0042 活动页开发',
      '请验收。',
    );

    expect(botIdentities.openIdFor).toHaveBeenCalledWith(9, 7);
    expect(botClient.sendCard).toHaveBeenCalledWith(
      9,
      expect.any(Object),
      'open_id',
      'ou_bot_mapped',
      expect.any(Object),
    );
  });

  it('负责人通知正文包含任务状态', async () => {
    workers.findOne.mockResolvedValueOnce({
      id: 1001,
      name: '前端工程师',
      ownerName: '王五',
    });
    workersService.ownerOpenId.mockResolvedValueOnce('ou_owner');

    await service.notifyTaskAgentOwner(
      baseTask({ subStatus: TaskSubStatus.PENDING_RESUME }),
      'notice',
      '任务未申请验收：TK-0042 活动页开发',
      '平台已 3 次重新唤醒机器人。',
    );

    expect(sentCardText()).toContain('**状态**：等待中-待继续');
  });

  it('任务字段不完整时不渲染 undefined 状态', async () => {
    workers.findOne.mockResolvedValueOnce({
      id: 1001,
      name: '前端工程师',
      ownerName: '王五',
    });
    workersService.ownerOpenId.mockResolvedValueOnce('ou_owner');

    await service.notifyTaskAgentOwner(
      baseTask({ status: undefined, subStatus: undefined }),
      'notice',
      '任务未申请验收：TK-0042 活动页开发',
      '平台已 3 次重新唤醒机器人。',
    );

    const text = sentCardText();
    expect(text).toContain('**状态**：未知');
    expect(text).not.toContain('undefined');
  });

  it('未配置平台官方机器人时不回退旧应用通道', async () => {
    botConfig.loadEnabledOfficial.mockResolvedValueOnce(null);

    await expect(
      service.notifyTaskRequester(
        baseTask(),
        'accept',
        '任务待验收：TK-0042 活动页开发',
        '请验收。',
      ),
    ).resolves.toEqual({ sent: false, ownerName: '张三' });
    expect(botClient.sendCard).not.toHaveBeenCalled();
  });

  it('AI 执行机器人不发送真人任务通知', async () => {
    workers.findOne.mockResolvedValueOnce({
      id: 1001,
      name: '前端工程师',
      runtime: WorkerRuntime.OPENCODE,
      humanUserId: null,
    });

    await expect(
      service.notifyTaskHumanAssignee(
        baseTask({ subStatus: TaskSubStatus.PENDING_ACCEPTANCE }),
        'notice',
        '新任务待处理：TK-0042 活动页开发',
        '任务已分配给你，请前往工作台确认是否接受。',
      ),
    ).resolves.toEqual({ sent: false });
    expect(botClient.sendCard).not.toHaveBeenCalled();
  });

  it('普通 AI 机器人需求方不向负责人发送正常待验收通知', async () => {
    workers.findOne.mockResolvedValueOnce({
      id: 1002,
      name: '技术-后端架构师',
      runtime: WorkerRuntime.OPENCODE,
      humanUserId: null,
      personalAgentUserId: null,
      ownerUserId: 9,
      ownerName: '胡峰',
    });

    await expect(
      service.notifyTaskRequester(
        baseTask({
          requesterType: 'worker',
          requesterId: 1002,
          agentId: 1035,
        }),
        'accept',
        '任务待验收：TK-0054 咱们APP的主要业务是什么',
        '执行机器人已提交验收申请。',
      ),
    ).resolves.toEqual({ sent: false });

    expect(workersService.ownerOpenId).not.toHaveBeenCalled();
    expect(botClient.sendCard).not.toHaveBeenCalled();
  });

  it('AI 需求方人工兜底时通知工单创建人（不标成需求方）', async () => {
    workers.findOne.mockResolvedValueOnce({
      id: 1002,
      name: '技术-后端架构师',
      runtime: WorkerRuntime.OPENCODE,
      humanUserId: null,
      personalAgentUserId: null,
      ownerUserId: 9,
      ownerName: '胡峰',
    });
    // 节点任务 → 最近一次工作流运行 → 工单
    ticketRuns.findOne.mockResolvedValueOnce({ id: 31, ticketId: 88 });
    tickets.findOne
      .mockResolvedValueOnce({ id: 88, createdById: 21 })
      // 工单查询只取 createdById，不再进第二层
      .mockResolvedValueOnce({ id: 88, createdById: 21 });
    users.findOne.mockResolvedValueOnce({
      id: 21,
      name: '王五',
      feishuOpenId: 'ou_ticket_creator',
    });

    await expect(
      service.notifyTaskRequester(
        baseTask({
          requesterType: 'worker',
          requesterId: 1002,
          agentId: 1035,
        }),
        'notice',
        '任务待验收：TK-0054 咱们APP的主要业务是什么',
        '需求方机器人自动验收失败，已通知工单创建人检查。',
        { fallbackToTicketOwner: true },
      ),
    ).resolves.toEqual({ sent: true, ownerName: '王五' });

    expect(ticketRuns.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { taskId: 42 } }),
    );
    expect(tickets.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 88 } }),
    );
    const text = sentCardText();
    expect(text).toContain('**工单创建人**：王五');
    expect(text).not.toContain('**需求方**：王五');
    // 不再回退机器人负责人
    expect(workersService.ownerOpenId).not.toHaveBeenCalled();
  });

  it('AI 需求方升级兜底：任务无工单关联时静默跳过', async () => {
    workers.findOne.mockResolvedValueOnce({
      id: 1002,
      name: '技术-后端架构师',
      runtime: WorkerRuntime.OPENCODE,
      humanUserId: null,
      personalAgentUserId: null,
      ownerUserId: 9,
      ownerName: '胡峰',
    });
    ticketRuns.findOne.mockResolvedValueOnce(null);
    tickets.findOne.mockResolvedValueOnce(null);

    await expect(
      service.notifyTaskRequester(
        baseTask({ requesterType: 'worker', requesterId: 1002 }),
        'notice',
        '任务执行失败：TK-0042 活动页开发',
        '执行器会话已失败。',
        { fallbackToTicketOwner: true },
      ),
    ).resolves.toEqual({ sent: false });

    expect(botClient.sendCard).not.toHaveBeenCalled();
  });

  it('AI 需求方升级兜底：兼容存量调度工单（tickets.taskId）', async () => {
    workers.findOne.mockResolvedValueOnce({
      id: 1002,
      name: '技术-后端架构师',
      runtime: WorkerRuntime.OPENCODE,
      humanUserId: null,
      personalAgentUserId: null,
      ownerUserId: 9,
      ownerName: '胡峰',
    });
    ticketRuns.findOne.mockResolvedValueOnce(null);
    tickets.findOne
      .mockResolvedValueOnce({ id: 77 })
      // 第一次按 taskId 查 id，第二次按 id 取创建人
      .mockResolvedValueOnce({ id: 77, createdById: 22 });
    users.findOne.mockResolvedValueOnce({
      id: 22,
      name: '赵六',
      feishuOpenId: 'ou_legacy_creator',
    });

    await expect(
      service.notifyTaskRequester(
        baseTask({ requesterType: 'worker', requesterId: 1002 }),
        'notice',
        '任务执行失败：TK-0042 活动页开发',
        '执行器会话已失败。',
        { fallbackToTicketOwner: true },
      ),
    ).resolves.toEqual({ sent: true, ownerName: '赵六' });

    expect(tickets.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { taskId: 42 } }),
    );
  });

  it('AI 需求方升级兜底：工单创建人无飞书 openId 时静默跳过', async () => {
    workers.findOne.mockResolvedValueOnce({
      id: 1002,
      name: '技术-后端架构师',
      runtime: WorkerRuntime.OPENCODE,
      humanUserId: null,
      personalAgentUserId: null,
      ownerUserId: 9,
      ownerName: '胡峰',
    });
    ticketRuns.findOne.mockResolvedValueOnce({ id: 31, ticketId: 88 });
    tickets.findOne.mockResolvedValueOnce({ id: 88, createdById: 21 });
    users.findOne.mockResolvedValueOnce({
      id: 21,
      name: '王五',
      feishuOpenId: null,
    });

    await expect(
      service.notifyTaskRequester(
        baseTask({ requesterType: 'worker', requesterId: 1002 }),
        'notice',
        '任务执行失败：TK-0042 活动页开发',
        '执行器会话已失败。',
        { fallbackToTicketOwner: true },
      ),
    ).resolves.toEqual({ sent: false });

    expect(botClient.sendCard).not.toHaveBeenCalled();
  });

  it('审批任务卡片包含工单链接、关键正文与通过/驳回/查看按钮', async () => {
    workers.findOne.mockResolvedValueOnce({
      id: 1001,
      name: '李四',
      runtime: WorkerRuntime.HUMAN,
      humanUserId: 8,
    });
    users.findOne.mockResolvedValueOnce({
      id: 8,
      name: '李四',
      feishuOpenId: 'ou_executor',
    });

    await expect(
      service.notifyApprovalTask({
        task: baseTask({
          type: '审批' as Task['type'],
          status: TaskStatus.RUNNING,
          subStatus: TaskSubStatus.EXECUTING,
        }),
        ticket: { id: 11, code: 'WO-0011', title: '发布申请' },
        nodeName: '主管审批',
        summaryLines: ['- 版本：v1.2.0', '- 环境：生产'],
        initiatorName: '王五',
      }),
    ).resolves.toEqual({ sent: true, ownerName: '李四' });

    const text = sentCardText();
    expect(text).toContain(
      '**工单**：[WO-0011 发布申请](https://project.example/tickets/11)',
    );
    expect(text).toContain('**审批节点**：主管审批');
    expect(text).toContain('- 版本：v1.2.0');
    expect(text).toContain('**发起人**：王五');
    const actions = cardActions();
    expect(actions?.map((action) => action.text?.content)).toEqual([
      '通过',
      '驳回',
      '查看',
    ]);
    expect(actions?.[0].value).toEqual({
      k: 'approval',
      a: 'approve',
      t: 42,
    });
    expect(actions?.[1].url).toBe(
      'https://project.example/tickets/11?approval=reject',
    );
    expect(actions?.[2].url).toBe('https://project.example/tickets/11');
    expect(approvalCards.save).toHaveBeenCalledWith(
      expect.objectContaining({
        configId: 9,
        ticketId: 11,
        taskId: 42,
        messageId: 'om_card_1',
        state: 'pending',
      }),
    );
  });

  it('审批通过后回写卡片为只读结果卡片并登记状态', async () => {
    approvalCards.find.mockResolvedValueOnce([pendingApprovalCard()]);

    await service.syncApprovalCardResult({
      taskId: 42,
      ticket: { id: 11, code: 'WO-0011', title: '发布申请' },
      state: 'approved',
      operator: { id: 7, name: '王五' },
      remark: '同意发布',
    });

    expect(botClient.updateCard).toHaveBeenCalledWith(
      9,
      expect.any(Object),
      'om_card_1',
      expect.any(Object),
    );
    const card = updatedCard();
    expect(cardTemplate(card)).toBe('green');
    expect(updatedCardText()).toContain(
      '**工单**：[WO-0011 发布申请](https://project.example/tickets/11)',
    );
    expect(updatedCardText()).toContain('**操作人**：王五');
    expect(updatedCardText()).toContain('**意见**：同意发布');
    expect(updatedCardText()).toContain('该审批已通过');
    expect(updatedCardActions().map((action) => action.text?.content)).toEqual([
      '查看工单',
    ]);
    expect(approvalCards.update).toHaveBeenCalledWith(
      { id: 3, state: 'pending' },
      expect.objectContaining({
        state: 'approved',
        actedById: 7,
        actedByName: '王五',
      }),
    );
  });

  it('网页驳回后卡片替换为红色结果卡片并保留驳回意见', async () => {
    approvalCards.find.mockResolvedValueOnce([pendingApprovalCard()]);

    await service.syncApprovalCardResult({
      taskId: 42,
      ticket: { id: 11, code: 'WO-0011', title: '发布申请' },
      state: 'rejected',
      operator: { id: 8, name: '赵六' },
      remark: '材料不全',
    });

    const card = updatedCard();
    expect(cardTemplate(card)).toBe('red');
    expect(updatedCardText()).toContain('**意见**：材料不全');
    expect(updatedCardText()).toContain('该审批已驳回');
    expect(updatedCardActions().map((action) => action.text?.content)).toEqual([
      '查看工单',
    ]);
    expect(approvalCards.update).toHaveBeenCalledWith(
      { id: 3, state: 'pending' },
      expect.objectContaining({ state: 'rejected', actedById: 8 }),
    );
  });

  it('没有待处理卡片登记时不更新飞书卡片', async () => {
    approvalCards.find.mockResolvedValueOnce([]);

    await service.syncApprovalCardResult({
      taskId: 42,
      ticket: { id: 11, code: 'WO-0011', title: '发布申请' },
      state: 'approved',
      operator: { id: 7, name: '王五' },
    });

    expect(botClient.updateCard).not.toHaveBeenCalled();
    expect(approvalCards.update).not.toHaveBeenCalled();
  });

  it('卡片更新失败仍登记状态且不影响审批结果', async () => {
    approvalCards.find.mockResolvedValueOnce([pendingApprovalCard()]);
    botClient.updateCard.mockRejectedValueOnce(new Error('飞书接口调用失败'));

    await expect(
      service.syncApprovalCardResult({
        taskId: 42,
        ticket: { id: 11, code: 'WO-0011', title: '发布申请' },
        state: 'approved',
        operator: { id: 7, name: '王五' },
      }),
    ).resolves.toBeUndefined();
    expect(approvalCards.update).toHaveBeenCalledWith(
      { id: 3, state: 'pending' },
      expect.objectContaining({ state: 'approved' }),
    );
  });
});

interface SentCardAction {
  url?: string;
  value?: Record<string, unknown>;
  text?: { content?: string };
}

function sentCard(): Record<string, unknown> {
  const call = botClient.sendCard.mock.calls.at(-1) as
    [number, unknown, string, string, Record<string, unknown>] | undefined;
  return call?.[4] ?? {};
}

function sentCardUrl(): string | undefined {
  return cardActions()?.[0]?.url;
}

function sentCardActionText(): string | undefined {
  return cardActions()?.[0]?.text?.content;
}

function sentCardText(): string {
  const elements = sentCard().elements as
    Array<{ tag?: string; text?: { content?: string } }> | undefined;
  return (
    elements
      ?.filter((element) => element.tag === 'div')
      .map((element) => element.text?.content ?? '')
      .join('\n') ?? ''
  );
}

function cardActions(): SentCardAction[] | undefined {
  const elements = sentCard().elements as
    Array<{ tag?: string; actions?: SentCardAction[] }> | undefined;
  return elements?.find((element) => element.tag === 'action')?.actions;
}

function pendingApprovalCard(): Record<string, unknown> {
  return {
    id: 3,
    configId: 9,
    ticketId: 11,
    taskId: 42,
    messageId: 'om_card_1',
    state: 'pending',
  };
}

function updatedCard(): Record<string, unknown> {
  const call = botClient.updateCard.mock.calls.at(-1) as
    [number, unknown, string, Record<string, unknown>] | undefined;
  return call?.[3] ?? {};
}

function cardTemplate(card: Record<string, unknown>): string | undefined {
  return (card.header as { template?: string } | undefined)?.template;
}

function updatedCardText(): string {
  const elements = updatedCard().elements as
    Array<{ tag?: string; text?: { content?: string } }> | undefined;
  return (
    elements
      ?.filter((element) => element.tag === 'div')
      .map((element) => element.text?.content ?? '')
      .join('\n') ?? ''
  );
}

function updatedCardActions(): SentCardAction[] | undefined {
  const elements = updatedCard().elements as
    Array<{ tag?: string; actions?: SentCardAction[] }> | undefined;
  return elements?.find((element) => element.tag === 'action')?.actions;
}
