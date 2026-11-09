import { Subject } from 'rxjs';
import { TaskStatus, TaskSubStatus } from '../common/enums';
import { Task } from '../tasks/task.entity';
import { FeishuBotProjectChat } from './feishu-bot-project-chat.entity';
import {
  FeishuBotProjectChatService,
  projectChatName,
  projectStakeholderNames,
} from './feishu-bot-project-chat.service';

describe('项目沟通群命名与成员', () => {
  it('群名使用固定标题并仅截断项目名', () => {
    expect(projectChatName('登录改版')).toBe('LitaWork-需求-登录改版 沟通群');
    const name = projectChatName('长'.repeat(200));
    expect(name).toHaveLength(80);
    expect(name.startsWith('LitaWork-需求-')).toBe(true);
    expect(name.endsWith(' 沟通群')).toBe(true);
  });

  it('相关方按前端/后端/测试/产品/客户端顺序拆分去重', () => {
    expect(
      projectStakeholderNames({
        frontend: '张三、李四',
        backend: '王五',
        qa: '赵六 张三',
        product: '钱七',
        client: '孙八',
      }),
    ).toEqual(['张三', '李四', '王五', '赵六', '钱七', '孙八']);
  });
});

describe('FeishuBotProjectChatService', () => {
  const root = (over: Partial<Task> = {}): Task =>
    ({
      id: 42,
      code: 'TK-0042',
      title: '技术-项目开发交付',
      templateId: 7,
      projectId: 3708,
      parentId: null,
      rootId: 42,
      status: TaskStatus.RUNNING,
      subStatus: TaskSubStatus.EXECUTING,
      agentId: null,
      acceptedAt: null,
      result: null,
      createdAt: new Date('2026-11-01T10:00:00+08:00'),
      updatedAt: new Date('2026-11-09T10:00:00+08:00'),
      ...over,
    }) as Task;

  const child = (over: Partial<Task> = {}): Task =>
    root({
      id: 43,
      code: 'TK-0043',
      title: '前端开发',
      templateId: 1001,
      parentId: 42,
      rootId: 42,
      subStatus: TaskSubStatus.PENDING_ACCEPT,
      agentId: 1001,
      acceptedAt: null,
      ...over,
    });

  function setup(
    initialRow: FeishuBotProjectChat | null = null,
    task = root(),
  ) {
    let row = initialRow;
    const official = { id: 1, appId: 'cli_official' };
    const chats = {
      findOne: jest.fn(() => Promise.resolve(row)),
      find: jest.fn(() => Promise.resolve(row ? [row] : [])),
      update: jest.fn(
        (_where: unknown, patch: Partial<FeishuBotProjectChat>) => {
          if (row) Object.assign(row, patch);
          return Promise.resolve({ affected: 1 });
        },
      ),
      increment: jest.fn((_where: unknown, _column: string, amount: number) => {
        if (row) row.attempts += amount;
        return Promise.resolve({ affected: 1 });
      }),
      createQueryBuilder: jest.fn(() => {
        const builder = {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return
          insert: jest.fn(() => builder),
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return
          into: jest.fn(() => builder),
          values: jest.fn((value: Partial<FeishuBotProjectChat>) => {
            row = {
              id: 1,
              attempts: 0,
              lastStatuses: {},
              memberUserIds: [],
              memberNames: [],
              botIds: [],
              finishedNotified: false,
              finishedAt: null,
              destroyAfter: null,
              lastError: null,
              ...value,
            } as FeishuBotProjectChat;
            // eslint-disable-next-line @typescript-eslint/no-unsafe-return
            return builder;
          }),
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return
          orIgnore: jest.fn(() => builder),
          execute: jest.fn(() => Promise.resolve({ identifiers: [{ id: 1 }] })),
        };
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        return builder;
      }),
    };
    const projects = {
      findOne: jest.fn().mockResolvedValue({
        id: 3708,
        name: '登录改版',
        resources: {
          frontend: '张三',
          backend: '李四',
          qa: '王五',
          product: '钱七',
          client: '未登录用户',
        },
      }),
      find: jest.fn().mockResolvedValue([
        {
          id: 3708,
          name: '登录改版',
          resources: {},
        },
      ]),
    };
    const tasks = {
      findOne: jest.fn().mockResolvedValue(task),
      find: jest.fn((options: { where: Record<string, unknown> }) => {
        if ('id' in options.where) return [task];
        if ('templateId' in options.where) return [];
        if ('parentId' in options.where) return [];
        return [];
      }),
    };
    const users = {
      find: jest.fn().mockResolvedValue([
        { id: 7, name: '张三', feishuOpenId: 'ou_zhangsan', enabled: true },
        { id: 8, name: '李四', feishuOpenId: 'ou_lisi', enabled: true },
        { id: 9, name: '王五', feishuOpenId: 'ou_wangwu', enabled: true },
        { id: 10, name: '钱七', feishuOpenId: 'ou_qianqi', enabled: true },
      ]),
    };
    const workers = { findOne: jest.fn().mockResolvedValue(null) };
    const configs = {
      loadEnabledOfficial: jest.fn().mockResolvedValue(official),
      loadEnabledWithSecrets: jest.fn().mockResolvedValue(official),
      secretsOf: jest.fn(() => ({
        appId: official.appId,
        appSecret: 'secret',
        verificationToken: null,
        encryptKey: null,
      })),
      findEnabledWorkerConfig: jest.fn().mockResolvedValue(null),
    };
    const client = {
      appUrl: 'http://localhost:5273',
      createChat: jest.fn().mockResolvedValue('oc_project'),
      sendCard: jest.fn().mockResolvedValue({ messageId: 'om_1' }),
      addChatMembers: jest.fn().mockResolvedValue(undefined),
      dissolveChat: jest.fn().mockResolvedValue(undefined),
    };
    const identities = {
      openIdFor: jest.fn(
        (_configId: number, userId: number) =>
          ({
            7: 'ou_zhangsan',
            8: 'ou_lisi',
            9: 'ou_wangwu',
            10: 'ou_qianqi',
          })[userId] ?? null,
      ),
    };
    const realtime = {
      events$: new Subject<never>().asObservable(),
    };
    const service = new FeishuBotProjectChatService(
      configs as never,
      client as never,
      identities as never,
      realtime as never,
      chats as never,
      projects as never,
      tasks as never,
      users as never,
      workers as never,
    );
    return {
      service,
      chat: () => row,
      chats,
      tasks,
      client,
      configs,
      projects,
    };
  }

  it('点击创建任务后幂等建群并拉入可识别的项目相关方', async () => {
    const { service, chat, client, chats } = setup();

    await service.ensureForProjectTask(3708, 42);
    await service.ensureForProjectTask(3708, 42);

    expect(client.createChat).toHaveBeenCalledTimes(1);
    expect(client.createChat).toHaveBeenCalledWith(
      1,
      expect.any(Object),
      'LitaWork-需求-登录改版 沟通群',
      expect.any(String),
      ['ou_zhangsan', 'ou_lisi', 'ou_wangwu', 'ou_qianqi'],
      expect.objectContaining({ idempotencyKey: 'project-chat-1' }),
    );
    expect(chat()).toMatchObject({
      state: 'active',
      chatId: 'oc_project',
      memberUserIds: [7, 8, 9, 10],
      memberNames: ['张三', '李四', '王五', '钱七'],
      lastStatuses: { 42: '进行中-执行中' },
    });
    expect(chats.update).toHaveBeenCalled();
    expect(client.sendCard).toHaveBeenCalledWith(
      1,
      expect.any(Object),
      'chat_id',
      'oc_project',
      expect.any(Object),
    );
  });

  it('机器人拉入失败时降级为仅拉用户，不阻断建群', async () => {
    const { service, chat, client, configs } = setup(
      null,
      root({ agentId: 1001 }),
    );
    configs.findEnabledWorkerConfig.mockResolvedValue({ appId: 'cli_agent' });
    client.createChat
      .mockRejectedValueOnce(new Error('bot unavailable'))
      .mockResolvedValueOnce('oc_without_bot');

    await service.ensureForProjectTask(3708, 42);

    expect(client.createChat).toHaveBeenCalledTimes(2);
    expect(client.createChat).toHaveBeenNthCalledWith(
      2,
      1,
      expect.any(Object),
      'LitaWork-需求-登录改版 沟通群',
      expect.any(String),
      expect.any(Array),
      { idempotencyKey: 'project-chat-1' },
    );
    expect(chat()).toMatchObject({
      state: 'active',
      chatId: 'oc_without_bot',
      botIds: [],
    });
  });

  it('对账只推送根任务与直接子任务，根任务终态锁定 7 天解散且不重复推送', async () => {
    const acceptedAt = new Date('2026-11-09T12:00:00+08:00');
    const finishedRoot = root({
      status: TaskStatus.FINISHED,
      subStatus: TaskSubStatus.COMPLETED,
      acceptedAt,
      updatedAt: acceptedAt,
    });
    const directChild = child();
    const grandChild = child({
      id: 44,
      code: 'TK-0044',
      parentId: 43,
    });
    const existing = {
      id: 1,
      projectId: 3708,
      taskId: 42,
      officialConfigId: 1,
      chatId: 'oc_project',
      state: 'active',
      name: 'LitaWork-需求-登录改版 沟通群',
      projectName: '登录改版',
      memberUserIds: [],
      memberNames: [],
      botIds: [],
      lastStatuses: { 42: '进行中-执行中' },
      finishedAt: null,
      finishedNotified: false,
      destroyAfter: null,
      attempts: 0,
      lastError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as FeishuBotProjectChat;
    const { service, chat, client, tasks } = setup(existing, finishedRoot);
    tasks.find.mockImplementation(
      (options: { where: Record<string, unknown> }) => {
        if ('id' in options.where) return [finishedRoot];
        if ('templateId' in options.where) return [];
        if ('parentId' in options.where) return [directChild, grandChild];
        return [];
      },
    );

    await service.reconcile();
    await service.reconcile();

    expect(client.sendCard).toHaveBeenCalledTimes(2);
    expect(chat()).toMatchObject({
      finishedNotified: true,
      lastStatuses: {
        42: '已结束-完成',
        '43': '进行中-待验收',
      },
    });
    expect(chat()?.lastStatuses).not.toHaveProperty('44');
    expect(chat()?.destroyAfter?.toISOString()).toBe(
      new Date(acceptedAt.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    );

    if (chat()) chat()!.destroyAfter = new Date(Date.now() - 1000);
    await service.reconcile();
    expect(client.dissolveChat).toHaveBeenCalledWith(
      1,
      expect.any(Object),
      'oc_project',
    );
    expect(chat()?.state).toBe('destroyed');
  });

  it('执行机器人分配后补拉其飞书应用，成功一次后不重复拉入', async () => {
    const assigned = root({ agentId: 1001 });
    const existing = {
      id: 1,
      projectId: 3708,
      taskId: 42,
      officialConfigId: 1,
      chatId: 'oc_project',
      state: 'active',
      name: 'LitaWork-需求-登录改版 沟通群',
      projectName: '登录改版',
      memberUserIds: [],
      memberNames: [],
      botIds: [],
      lastStatuses: { 42: '进行中-执行中' },
      finishedAt: null,
      finishedNotified: false,
      destroyAfter: null,
      attempts: 0,
      lastError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as FeishuBotProjectChat;
    const { service, chat, client, configs } = setup(existing, assigned);
    configs.findEnabledWorkerConfig.mockResolvedValue({ appId: 'cli_agent' });

    await service.reconcile();
    await service.reconcile();

    expect(client.addChatMembers).toHaveBeenCalledTimes(1);
    expect(client.addChatMembers).toHaveBeenCalledWith(
      1,
      expect.any(Object),
      'oc_project',
      ['cli_agent'],
    );
    expect(chat()?.botIds).toEqual(['cli_agent']);
  });

  it('建群失败不回滚任务，记录错误供后续重试', async () => {
    const { service, chat, client } = setup();
    client.createChat.mockRejectedValue(new Error('feishu down'));

    await expect(
      service.ensureForProjectTask(3708, 42),
    ).resolves.toBeUndefined();

    expect(chat()).toMatchObject({
      state: 'error',
      attempts: 1,
      lastError: 'feishu down',
    });
  });
});
