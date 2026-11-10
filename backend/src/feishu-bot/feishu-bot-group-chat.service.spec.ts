import { EMPTY } from 'rxjs';
import { WorkerRuntime } from '../common/enums';
import type { FeishuBotConfig } from './feishu-bot-config.entity';
import {
  extractGroupMessageText,
  formatGroupMessageContent,
  groupBotMentioned,
  FeishuBotGroupChatService,
  isSilentReply,
  resolveGroupPolicy,
} from './feishu-bot-group-chat.service';
import type { FeishuInboundMessage } from './feishu-bot-p2p.service';

describe('群聊策略纯函数', () => {
  it('单群策略优先，否则跟随默认策略', () => {
    expect(resolveGroupPolicy('smart', 'at')).toBe('smart');
    expect(resolveGroupPolicy('record', 'at')).toBe('record');
    expect(resolveGroupPolicy(null, 'at')).toBe('at');
  });

  it('按机器人自身 open_id 识别 @', () => {
    const mentions = [
      { key: '@_user_1', openId: 'ou_other', name: '张三' },
      { key: '@_user_2', openId: 'ou_bot', name: '机器人' },
    ];
    expect(groupBotMentioned(mentions, 'ou_bot')).toBe(true);
    expect(groupBotMentioned(mentions, 'ou_unknown')).toBe(false);
    expect(groupBotMentioned(mentions, null)).toBe(false);
    expect(groupBotMentioned([], 'ou_bot')).toBe(false);
  });

  it('智能模式静默标记与空回复判定为不回复', () => {
    expect(isSilentReply('')).toBe(true);
    expect(isSilentReply('  [不回复]  ')).toBe(true);
    expect(isSilentReply('[不回复]\n')).toBe(true);
    expect(isSilentReply('【静默】')).toBe(true);
    expect(isSilentReply('好的，我来处理')).toBe(false);
    expect(isSilentReply('关于这个问题：[不回复] 因为...')).toBe(false);
  });

  it('抽取文本消息并去掉 @占位符', () => {
    const text = extractGroupMessageText(
      'text',
      JSON.stringify({ text: '@_user_1 你好，机器人' }),
    );
    expect(text).toEqual({ text: '你好，机器人', supported: true });
  });

  it('抽取富文本消息段落', () => {
    const post = extractGroupMessageText(
      'post',
      JSON.stringify({
        content: [
          [
            { tag: 'text', text: '第一段' },
            { tag: 'text', text: '，继续' },
          ],
          [{ tag: 'text', text: '第二段' }],
        ],
      }),
    );
    expect(post).toEqual({ text: '第一段，继续第二段', supported: true });
  });

  it('非文本消息标记为不支持', () => {
    expect(extractGroupMessageText('image', '{}')).toEqual({
      text: '',
      supported: false,
    });
  });

  it('群消息带发送者前缀', () => {
    expect(formatGroupMessageContent('张三', '帮忙看下')).toBe(
      '【张三】帮忙看下',
    );
  });
});

describe('FeishuBotGroupChatService 群消息策略', () => {
  const config = (over: Partial<FeishuBotConfig> = {}): FeishuBotConfig =>
    ({
      id: 2,
      kind: 'worker',
      workerId: 5,
      appId: 'cli_app',
      botOpenId: 'ou_bot',
      policy: {},
      ...over,
    }) as FeishuBotConfig;

  const group = () =>
    ({
      id: 11,
      configId: 2,
      chatId: 'oc_group',
      name: '测试群',
      policy: null,
      joinedAt: new Date('2026-11-01T10:00:00+08:00'),
      leftAt: null,
      lastMessageAt: null,
      messageCount: 0,
    }) as never;

  const message = (over: Partial<FeishuInboundMessage> = {}) =>
    ({
      messageId: 'om_1',
      chatId: 'oc_group',
      chatType: 'group',
      messageType: 'text',
      content: JSON.stringify({ text: '大家好' }),
      mentions: [],
      ...over,
    }) as FeishuInboundMessage;

  function setup(defaultPolicy: 'smart' | 'at' | 'record') {
    const groups = {
      findOne: jest.fn(() => Promise.resolve(group())),
      update: jest.fn(() => Promise.resolve({ affected: 1 })),
      increment: jest.fn(() => Promise.resolve({ affected: 1 })),
      createQueryBuilder: jest.fn(),
    };
    const records = {
      create: jest.fn((value: unknown) => value),
      save: jest.fn((value: { id?: number }) =>
        Promise.resolve({ ...value, id: 99 }),
      ),
      update: jest.fn(() => Promise.resolve({ affected: 1 })),
    };
    const configs = {
      groupDefaultPolicy: jest.fn(() => Promise.resolve(defaultPolicy)),
      saveBotOpenId: jest.fn(() => Promise.resolve()),
    };
    const client = {
      sendText: jest.fn(() => Promise.resolve({ messageId: null })),
      react: jest.fn(() => Promise.resolve({ reactionId: 'r1' })),
      unreact: jest.fn(() => Promise.resolve()),
      verify: jest.fn(() => Promise.resolve(null)),
      getChatInfo: jest.fn(() => Promise.resolve({ name: '测试群' })),
    };
    const debug = {
      send: jest.fn(() => Promise.resolve({})),
      stream: jest.fn(() => EMPTY),
      replyQuestion: jest.fn(() => Promise.resolve({})),
      interrupt: jest.fn(() => Promise.resolve({})),
    };
    const identities = {
      resolve: jest.fn(() =>
        Promise.resolve({ id: 7, name: '张三', enabled: true }),
      ),
    };
    const workers = {
      findOne: jest.fn(() =>
        Promise.resolve({
          id: 5,
          enabled: true,
          runtime: WorkerRuntime.OPENCODE,
        }),
      ),
    };
    const taskChats = { count: jest.fn(() => Promise.resolve(0)) };
    const projectChats = { count: jest.fn(() => Promise.resolve(0)) };
    const service = new FeishuBotGroupChatService(
      configs as never,
      client as never,
      { sendMarkdown: jest.fn(), sendQuestionCard: jest.fn() } as never,
      identities as never,
      debug as never,
      groups as never,
      records as never,
      {
        findOne: jest.fn(),
        save: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      } as never,
      taskChats as never,
      projectChats as never,
      workers as never,
    );
    return { service, groups, records, client, debug, configs, taskChats };
  }

  it('仅记录策略：消息入库但不投递机器人', async () => {
    const { service, records, debug, client } = setup('record');
    await service.handleGroupMessage(
      config(),
      { appId: 'cli_app' } as never,
      { openId: 'ou_user', unionId: null },
      message(),
    );
    expect(debug.send).not.toHaveBeenCalled();
    expect(client.react).not.toHaveBeenCalled();
    expect(records.update).toHaveBeenCalledWith(
      { id: 99 },
      { decision: 'record_only' },
    );
  });

  it('仅被@策略：未 @ 机器人只记录，不回复', async () => {
    const { service, records, debug, client } = setup('at');
    await service.handleGroupMessage(
      config(),
      { appId: 'cli_app' } as never,
      { openId: 'ou_user', unionId: null },
      message(),
    );
    expect(debug.send).not.toHaveBeenCalled();
    expect(client.react).not.toHaveBeenCalled();
    expect(records.update).toHaveBeenCalledWith(
      { id: 99 },
      { decision: 'not_mentioned' },
    );
  });

  it('仅被@策略：@ 机器人后敲键盘并投递群会话', async () => {
    const { service, debug, client } = setup('at');
    await service.handleGroupMessage(
      config(),
      { appId: 'cli_app' } as never,
      { openId: 'ou_user', unionId: null },
      message({
        mentions: [{ key: '@_user_1', openId: 'ou_bot', name: '机器人' }],
      }),
    );
    expect(client.react).toHaveBeenCalledWith(
      2,
      expect.anything(),
      'om_1',
      'Typing',
    );
    expect(debug.send).toHaveBeenCalledWith(
      -1,
      5,
      '【张三】大家好',
      expect.objectContaining({ scope: 'feishu:group:oc_group' }),
    );
  });

  it('平台自建任务群/项目群不进入外部群策略', async () => {
    const { service, records, debug, taskChats } = setup('smart');
    taskChats.count.mockResolvedValue(1);
    await service.handleGroupMessage(
      config(),
      { appId: 'cli_app' } as never,
      { openId: 'ou_user', unionId: null },
      message(),
    );
    expect(records.save).not.toHaveBeenCalled();
    expect(debug.send).not.toHaveBeenCalled();
  });
});
