import type { FeishuBotConfig } from '../../feishu-bot/feishu-bot-config.entity';
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
    const service = new WorkFeishuTools(
      configs as never,
      client as never,
      identities as never,
      groups as never,
    );
    return { service, configs, client, groups };
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
