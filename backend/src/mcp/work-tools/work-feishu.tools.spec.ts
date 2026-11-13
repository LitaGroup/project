import type { FeishuBotConfig } from '../../feishu-bot/feishu-bot-config.entity';
import { UserRole } from '../../common/enums';
import { WorkFeishuTools } from './work-feishu.tools';

/** 解析工具返回的 JSON 文本 */
function payloadOf(result: { content: { type: string; text?: string }[] }) {
  const first = result.content[0];
  return JSON.parse(first?.text ?? '{}') as {
    chat_id: string;
    thread_id: string | null;
    count: number;
    messages: {
      message_id: string;
      sender: string;
      time: string | null;
      type: string;
      text: string;
    }[];
  };
}

describe('WorkFeishuTools 飞书历史查询', () => {
  const config = {
    id: 3,
    appId: 'cli_app',
    workerId: 5,
    kind: 'worker',
    enabled: true,
  } as FeishuBotConfig;

  function setup() {
    const configs = {
      findEnabledWorkerConfig: jest.fn(() => Promise.resolve(config)),
      loadWithSecrets: jest.fn(() => Promise.resolve(config)),
      secretsOf: jest.fn(() => ({ appId: 'cli_app', appSecret: 's' })),
    };
    const client = {
      listChatMessages: jest.fn(() => Promise.resolve([])),
      listThreadMessages: jest.fn(() => Promise.resolve([])),
    };
    const identities = {
      resolve: jest.fn(() =>
        Promise.resolve({ id: 7, name: '张三', enabled: true }),
      ),
    };
    const groups = { findOne: jest.fn(() => Promise.resolve(null)) };
    const officialMessages = {
      send: jest.fn(() =>
        Promise.resolve({
          messageIds: ['om_1'],
          receiveIdType: 'open_id',
          receiveId: 'ou_x',
        }),
      ),
    };
    const service = new WorkFeishuTools(
      configs as never,
      client as never,
      identities as never,
      officialMessages as never,
      groups as never,
    );
    return { service, configs, client, groups, officialMessages };
  }

  it('非机器人身份拒绝查询', async () => {
    const { service } = setup();
    await expect(service.queryHistory({}, { chat_id: 'oc_1' })).rejects.toThrow(
      '仅接受机器人身份',
    );
  });

  it('未绑定飞书应用时拒绝查询', async () => {
    const { service, configs } = setup();
    configs.findEnabledWorkerConfig.mockResolvedValue(null);
    await expect(
      service.queryHistory({ worker: { id: 5 } as never }, { chat_id: 'oc_1' }),
    ).rejects.toThrow('未绑定启用的飞书应用');
  });

  it('机器人已退群的会话拒绝查询', async () => {
    const { service, groups } = setup();
    groups.findOne.mockResolvedValue({ leftAt: new Date() });
    await expect(
      service.queryHistory({ worker: { id: 5 } as never }, { chat_id: 'oc_1' }),
    ).rejects.toThrow('已退出该群');
  });

  it('群聊历史只保留 7 天内消息并输出结构化结果', async () => {
    const { service, client } = setup();
    const now = Date.now();
    client.listChatMessages.mockResolvedValue([
      {
        messageId: 'om_old',
        messageType: 'text',
        content: JSON.stringify({ text: '八天前' }),
        senderOpenId: 'ou_a',
        senderType: 'user',
        createTime: now - 8 * 24 * 60 * 60 * 1000,
      },
      {
        messageId: 'om_1',
        messageType: 'text',
        content: JSON.stringify({ text: '你好' }),
        senderOpenId: 'ou_a',
        senderType: 'user',
        createTime: now - 60_000,
      },
    ]);
    const result = await service.queryHistory(
      { worker: { id: 5 } as never },
      { chat_id: 'oc_1', limit: 20 },
    );
    expect(client.listChatMessages).toHaveBeenCalledWith(
      3,
      expect.anything(),
      'oc_1',
      20,
      expect.any(Number),
    );
    const payload = payloadOf(result);
    expect(payload.count).toBe(1);
    expect(payload.messages[0]).toMatchObject({
      message_id: 'om_1',
      sender: '张三',
      text: '你好',
    });
  });

  it('话题历史走 thread 容器并按 7 天过滤', async () => {
    const { service, client } = setup();
    const now = Date.now();
    client.listThreadMessages.mockResolvedValue([
      {
        messageId: 'om_old',
        messageType: 'text',
        content: '{}',
        senderOpenId: 'ou_a',
        senderType: 'user',
        createTime: now - 8 * 24 * 60 * 60 * 1000,
      },
      {
        messageId: 'om_2',
        messageType: 'text',
        content: JSON.stringify({ text: '话题回复' }),
        senderOpenId: 'ou_a',
        senderType: 'user',
        createTime: now - 1_000,
      },
    ]);
    const result = await service.queryHistory(
      { worker: { id: 5 } as never },
      { chat_id: 'oc_1', thread_id: 'omt_1', limit: 10 },
    );
    expect(client.listThreadMessages).toHaveBeenCalledWith(
      3,
      expect.anything(),
      'omt_1',
      50,
    );
    const payload = payloadOf(result);
    expect(payload.thread_id).toBe('omt_1');
    expect(payload.messages.map((item) => item.message_id)).toEqual(['om_2']);
  });
});

describe('WorkFeishuTools 平台名义发送', () => {
  const worker = { id: 5, name: '技术-实施' };

  function setup() {
    const officialMessages = { send: jest.fn() };
    officialMessages.send.mockResolvedValue({
      messageIds: ['om_9'],
      receiveIdType: 'open_id',
      receiveId: 'ou_x',
    });
    const service = new WorkFeishuTools(
      {} as never,
      {} as never,
      {} as never,
      officialMessages as never,
      {} as never,
    );
    return { service, officialMessages };
  }

  it('普通成员身份拒绝发送', async () => {
    const { service } = setup();
    await expect(
      service.sendMessage(
        { user: { id: 9, name: '张三', role: UserRole.MEMBER } as never },
        { content: '你好' },
      ),
    ).rejects.toThrow('仅机器人令牌或管理员');
  });

  it('机器人身份发送并映射入参', async () => {
    const { service, officialMessages } = setup();
    const result = await service.sendMessage(
      { worker: worker as never },
      {
        user_id: 7,
        content: '**你好**',
        title: '通知',
        reply_to_message_id: 'om_parent',
      },
    );
    expect(officialMessages.send).toHaveBeenCalledWith(
      {
        userId: 7,
        openId: undefined,
        chatId: undefined,
        content: '**你好**',
        title: '通知',
        replyToMessageId: 'om_parent',
      },
      { type: 'worker', id: 5, name: '技术-实施' },
    );
    const first = result.content[0] as { text?: string };
    expect(JSON.parse(first.text ?? '{}')).toMatchObject({
      messageIds: ['om_9'],
    });
  });

  it('管理员身份允许发送', async () => {
    const { service, officialMessages } = setup();
    await service.sendMessage(
      { user: { id: 1, name: '管理员', role: UserRole.ADMIN } as never },
      { chat_id: 'oc_group', content: '广播' },
    );
    expect(officialMessages.send).toHaveBeenCalledWith(
      expect.objectContaining({ chatId: 'oc_group' }),
      { type: 'user', id: 1, name: '管理员' },
    );
  });
});
