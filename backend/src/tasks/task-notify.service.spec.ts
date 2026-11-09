import { TaskStatus, TaskSubStatus, WorkerRuntime } from '../common/enums';
import { Task } from './task.entity';
import { TaskNotifyService } from './task-notify.service';

describe('TaskNotifyService 飞书任务通知', () => {
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
  let workersService: { ownerOpenId: jest.Mock };
  let feishuService: { sendUserCard: jest.Mock };
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
    workersService = { ownerOpenId: jest.fn() };
    feishuService = { sendUserCard: jest.fn().mockResolvedValue(undefined) };
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
      workersService as never,
      feishuService as never,
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

    expect(feishuService.sendUserCard).toHaveBeenCalledWith(
      'ou_requester',
      expect.any(Object),
    );
    expect(sentCardUrl(feishuService.sendUserCard)).toBe(
      'https://project.example/workbench/tasks/42',
    );
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

    expect(sentCardUrl(feishuService.sendUserCard)).toBe(
      'https://project.example/tasks/42',
    );
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

    expect(feishuService.sendUserCard).toHaveBeenCalledWith(
      'ou_executor',
      expect.any(Object),
    );
    expect(sentCardUrl(feishuService.sendUserCard)).toBe(
      'https://project.example/workbench/tasks/42',
    );
    expect(sentCardActionText(feishuService.sendUserCard)).toBe('打开工作台');
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

    expect(sentCardText(feishuService.sendUserCard)).toContain(
      '**状态**：等待中-待继续',
    );
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

    const text = sentCardText(feishuService.sendUserCard);
    expect(text).toContain('**状态**：未知');
    expect(text).not.toContain('undefined');
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
    expect(feishuService.sendUserCard).not.toHaveBeenCalled();
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
    expect(feishuService.sendUserCard).not.toHaveBeenCalled();
  });

  it('AI 需求方人工兜底时通知负责人且不标记为需求方', async () => {
    workers.findOne.mockResolvedValueOnce({
      id: 1002,
      name: '技术-后端架构师',
      runtime: WorkerRuntime.OPENCODE,
      humanUserId: null,
      personalAgentUserId: null,
      ownerUserId: 9,
      ownerName: '胡峰',
    });
    workersService.ownerOpenId.mockResolvedValueOnce('ou_owner');

    await expect(
      service.notifyTaskRequester(
        baseTask({
          requesterType: 'worker',
          requesterId: 1002,
          agentId: 1035,
        }),
        'notice',
        '任务待验收：TK-0054 咱们APP的主要业务是什么',
        '需求方机器人自动验收失败，已通知负责人检查。',
        { fallbackToRequesterOwner: true },
      ),
    ).resolves.toEqual({ sent: true, ownerName: '胡峰' });

    expect(feishuService.sendUserCard).toHaveBeenCalledWith(
      'ou_owner',
      expect.any(Object),
    );
    const text = sentCardText(feishuService.sendUserCard);
    expect(text).toContain('**负责人**：胡峰');
    expect(text).not.toContain('**需求方**：胡峰');
  });
});

function sentCardUrl(sendUserCard: jest.Mock): string | undefined {
  return sentCardAction(sendUserCard)?.url;
}

function sentCardActionText(sendUserCard: jest.Mock): string | undefined {
  return sentCardAction(sendUserCard)?.text?.content;
}

function sentCardText(sendUserCard: jest.Mock): string {
  const call = sendUserCard.mock.calls[0] as
    [string, Record<string, unknown>] | undefined;
  if (!call) return '';
  const elements = call[1].elements as
    Array<{ tag?: string; text?: { content?: string } }> | undefined;
  return (
    elements
      ?.filter((element) => element.tag === 'div')
      .map((element) => element.text?.content ?? '')
      .join('\n') ?? ''
  );
}

function sentCardAction(
  sendUserCard: jest.Mock,
): { url?: string; text?: { content?: string } } | undefined {
  const call = sendUserCard.mock.calls[0] as
    [string, Record<string, unknown>] | undefined;
  return call ? cardAction(call[1]) : undefined;
}

function cardAction(
  card: Record<string, unknown>,
): { url?: string; text?: { content?: string } } | undefined {
  const elements = card.elements as
    | Array<{
        tag?: string;
        actions?: Array<{ url?: string; text?: { content?: string } }>;
      }>
    | undefined;
  return elements?.find((element) => element.tag === 'action')?.actions?.[0];
}
