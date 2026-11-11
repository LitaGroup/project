import { EMPTY } from 'rxjs';
import { WorkerRuntime } from '../common/enums';
import type { FeishuHistoryMessage } from './feishu-bot-client.service';
import type { FeishuBotConfig } from './feishu-bot-config.entity';
import {
  buildGroupFirstPrompt,
  extractGroupMessageText,
  formatGroupMessageContent,
  formatHistoryPrompt,
  groupBotMentioned,
  groupScopeOf,
  historyMessageText,
  historySinceBotReply,
  FeishuBotGroupChatService,
  isSilentReply,
  parseBatchReplySegments,
  replyTargetOf,
  resolveGroupPolicy,
  SMART_BATCH_MAX_MESSAGES,
  threadIdOfGroupScope,
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

  it('话题会话 scope 按话题隔离', () => {
    expect(groupScopeOf('oc_group')).toBe('feishu:group:oc_group');
    expect(groupScopeOf('oc_group', 'omt_1')).toBe(
      'feishu:group:oc_group:t:omt_1',
    );
    expect(groupScopeOf('oc_group', null)).toBe('feishu:group:oc_group');
    expect(threadIdOfGroupScope('feishu:group:oc_group:t:omt_1')).toBe('omt_1');
    expect(threadIdOfGroupScope('feishu:group:oc_group')).toBeNull();
  });

  it('话题消息/引用回复回给触发消息，普通消息走群发', () => {
    const base: FeishuInboundMessage = {
      messageId: 'om_1',
      chatId: 'oc_group',
      chatType: 'group',
      messageType: 'text',
      content: '{}',
    };
    expect(replyTargetOf({ ...base, threadId: 'omt_1' })).toBe('om_1');
    expect(replyTargetOf({ ...base, rootId: 'om_root' })).toBe('om_1');
    expect(replyTargetOf({ ...base, parentId: 'om_parent' })).toBe('om_1');
    expect(replyTargetOf(base)).toBeNull();
  });

  it('上文格式化区分话题/群聊标题', () => {
    expect(formatHistoryPrompt('【话题上文】', [])).toBe('');
    expect(
      formatHistoryPrompt('【话题上文】', [
        { senderName: '张三', text: '第一问' },
        { senderName: '李四', text: '第二问' },
      ]),
    ).toBe('【话题上文】\n张三：第一问\n李四：第二问\n【当前消息】');
    expect(
      formatHistoryPrompt('【群聊上文】', [
        { senderName: '张三', text: '你好' },
      ]),
    ).toBe('【群聊上文】\n张三：你好\n【当前消息】');
  });

  it('只保留机器人最后一次回复之后的消息', () => {
    const rows: FeishuHistoryMessage[] = [
      {
        messageId: 'om_1',
        messageType: 'text',
        content: '{}',
        senderOpenId: 'ou_user',
        senderType: 'user',
      },
      {
        messageId: 'om_2',
        messageType: 'text',
        content: '{}',
        senderOpenId: 'cli_app',
        senderType: 'app',
      },
      {
        messageId: 'om_3',
        messageType: 'text',
        content: '{}',
        senderOpenId: 'ou_user',
        senderType: 'user',
      },
    ];
    expect(
      historySinceBotReply(rows, 'cli_app').map((row) => row.messageId),
    ).toEqual(['om_3']);
    // 其它机器人的消息不当作自身回复
    expect(
      historySinceBotReply(rows, 'cli_other').map((row) => row.messageId),
    ).toEqual(['om_1', 'om_2', 'om_3']);
  });

  it('历史消息非文本类型给占位', () => {
    expect(historyMessageText('text', JSON.stringify({ text: '你好' }))).toBe(
      '你好',
    );
    expect(historyMessageText('image', '{}')).toBe('[图片]');
    expect(historyMessageText('file', '{}')).toBe('[文件]');
    expect(historyMessageText('interactive', '{}')).toBe('[卡片]');
  });

  it('会话首条上下文包含通道/场景/群/话题与回复方式', () => {
    const prompt = buildGroupFirstPrompt({
      chatName: '测试群',
      chatId: 'oc_group',
      threadId: 'omt_1',
      policy: 'smart',
    });
    expect(prompt).toContain('- 通道：飞书');
    expect(prompt).toContain('- 场景：群聊话题（话题 ID：omt_1）');
    expect(prompt).toContain('- 群：测试群（chat_id：oc_group）');
    expect(prompt).toContain('>>> 消息ID');
    expect(prompt).toContain('[不回复]');

    const atPrompt = buildGroupFirstPrompt({
      chatName: null,
      chatId: 'oc_group',
      threadId: null,
      policy: 'at',
    });
    expect(atPrompt).toContain('- 场景：群聊');
    expect(atPrompt).toContain('- 群：chat_id：oc_group');
    expect(atPrompt).not.toContain('>>>');
  });

  it('解析批量定向回复', () => {
    expect(parseBatchReplySegments('普通回复')).toEqual([
      { targetMessageId: null, content: '普通回复' },
    ]);
    expect(
      parseBatchReplySegments(
        ['>>> om_1', '回复张三', '', '>>> om_2 回复李四', '第二行'].join('\n'),
      ),
    ).toEqual([
      { targetMessageId: 'om_1', content: '回复张三' },
      { targetMessageId: 'om_2', content: '回复李四\n第二行' },
    ]);
    expect(parseBatchReplySegments('   ')).toEqual([]);
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
      replyText: jest.fn(() => Promise.resolve({ messageId: null })),
      replyCard: jest.fn(() => Promise.resolve({ messageId: null })),
      listThreadMessages: jest.fn(() =>
        Promise.resolve([] as FeishuHistoryMessage[]),
      ),
      listChatMessages: jest.fn(() =>
        Promise.resolve([] as FeishuHistoryMessage[]),
      ),
      downloadImage: jest.fn(() => Promise.resolve(Buffer.from(''))),
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
      {
        sendMarkdown: jest.fn(() => Promise.resolve([])),
        sendQuestionCard: jest.fn(),
      } as never,
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

  it('话题内 @ 机器人：使用话题独立会话并拼入话题上文', async () => {
    const { service, client, debug } = setup('at');
    client.listThreadMessages.mockResolvedValue([
      {
        messageId: 'om_prev',
        messageType: 'text',
        content: JSON.stringify({ text: '话题第一问' }),
        senderOpenId: 'ou_user',
        senderType: 'user',
      },
    ]);
    await service.handleGroupMessage(
      config(),
      { appId: 'cli_app' } as never,
      { openId: 'ou_user', unionId: null },
      message({
        messageId: 'om_2',
        threadId: 'omt_1',
        rootId: 'om_1',
        parentId: 'om_1',
        mentions: [{ key: '@_user_1', openId: 'ou_bot', name: '机器人' }],
      }),
    );
    expect(client.listThreadMessages).toHaveBeenCalledWith(
      2,
      expect.anything(),
      'omt_1',
      expect.any(Number),
    );
    expect(debug.send).toHaveBeenCalledWith(
      -1,
      5,
      expect.stringContaining('【话题上文】'),
      expect.objectContaining({ scope: 'feishu:group:oc_group:t:omt_1' }),
    );
    const calls = (debug.send as jest.Mock).mock.calls as unknown[][];
    expect(calls[0]?.[2]).toEqual(expect.stringContaining('话题第一问'));
  });

  it('普通群 @ 机器人：群级会话并拼入群聊上文（跳过自身回复之前）', async () => {
    const { service, client, debug } = setup('at');
    client.listChatMessages.mockResolvedValue([
      {
        messageId: 'om_old',
        messageType: 'text',
        content: JSON.stringify({ text: '很早以前的讨论' }),
        senderOpenId: 'ou_user',
        senderType: 'user',
      },
      {
        messageId: 'om_bot',
        messageType: 'interactive',
        content: '{}',
        senderOpenId: 'cli_app',
        senderType: 'app',
      },
      {
        messageId: 'om_recent',
        messageType: 'text',
        content: JSON.stringify({ text: '刚聊到的新话题' }),
        senderOpenId: 'ou_user',
        senderType: 'user',
      },
    ]);
    await service.handleGroupMessage(
      config(),
      { appId: 'cli_app' } as never,
      { openId: 'ou_user', unionId: null },
      message({
        mentions: [{ key: '@_user_1', openId: 'ou_bot', name: '机器人' }],
      }),
    );
    expect(client.listThreadMessages).not.toHaveBeenCalled();
    expect(client.listChatMessages).toHaveBeenCalledWith(
      2,
      expect.anything(),
      'oc_group',
      expect.any(Number),
    );
    expect(debug.send).toHaveBeenCalledWith(
      -1,
      5,
      expect.stringContaining('【群聊上文】'),
      expect.objectContaining({ scope: 'feishu:group:oc_group' }),
    );
    const calls = (debug.send as jest.Mock).mock.calls as unknown[][];
    expect(calls[0]?.[2]).toEqual(expect.stringContaining('刚聊到的新话题'));
    // 机器人最后一次回复之前的旧消息不再重复注入
    expect(calls[0]?.[2]).not.toEqual(
      expect.stringContaining('很早以前的讨论'),
    );
  });

  it('普通群消息行为不变：群级会话', async () => {
    const { service, client, debug } = setup('at');
    await service.handleGroupMessage(
      config(),
      { appId: 'cli_app' } as never,
      { openId: 'ou_user', unionId: null },
      message({
        mentions: [{ key: '@_user_1', openId: 'ou_bot', name: '机器人' }],
      }),
    );
    expect(client.listThreadMessages).not.toHaveBeenCalled();
    expect(client.listChatMessages).toHaveBeenCalled();
    expect(debug.send).toHaveBeenCalledWith(
      -1,
      5,
      '【张三】大家好',
      expect.objectContaining({ scope: 'feishu:group:oc_group' }),
    );
  });

  it('话题内非文本消息提示以回复形式落回话题', async () => {
    const { service, client } = setup('at');
    await service.handleGroupMessage(
      config(),
      { appId: 'cli_app' } as never,
      { openId: 'ou_user', unionId: null },
      message({
        messageType: 'image',
        content: '{}',
        threadId: 'omt_1',
        mentions: [{ key: '@_user_1', openId: 'ou_bot', name: '机器人' }],
      }),
    );
    expect(client.replyText).toHaveBeenCalledWith(
      2,
      expect.anything(),
      'om_1',
      '群聊暂只支持文本消息；图片/文件请到平台页面处理。',
    );
    expect(client.sendText).not.toHaveBeenCalled();
  });

  it('智能模式：5 秒窗口后批量投递，消息带 ID', async () => {
    jest.useFakeTimers();
    try {
      const { service, debug } = setup('smart');
      const send = (messageId: string, text: string) =>
        service.handleGroupMessage(
          config(),
          { appId: 'cli_app' } as never,
          { openId: 'ou_user', unionId: null },
          message({
            messageId,
            content: JSON.stringify({ text }),
          }),
        );
      await send('om_1', '第一条');
      await send('om_2', '第二条');
      expect(debug.send).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(5_000);
      expect(debug.send).toHaveBeenCalledTimes(1);
      const calls = (debug.send as jest.Mock).mock.calls as unknown[][];
      const content = calls[0]?.[2];
      expect(content).toEqual(expect.stringContaining('[张三|om_1] 第一条'));
      expect(content).toEqual(expect.stringContaining('---'));
      expect(content).toEqual(expect.stringContaining('[张三|om_2] 第二条'));
      expect(debug.send).toHaveBeenCalledWith(
        -1,
        5,
        expect.any(String),
        expect.objectContaining({ scope: 'feishu:group:oc_group' }),
      );
      const options = calls[0]?.[3] as { firstPrompt?: string };
      expect(options.firstPrompt).toContain('智能反馈');
    } finally {
      jest.useRealTimers();
    }
  });

  it(`智能模式：达到 ${SMART_BATCH_MAX_MESSAGES} 条立即处理`, async () => {
    jest.useFakeTimers();
    try {
      const { service, debug } = setup('smart');
      for (let index = 1; index <= SMART_BATCH_MAX_MESSAGES; index += 1) {
        await service.handleGroupMessage(
          config(),
          { appId: 'cli_app' } as never,
          { openId: 'ou_user', unionId: null },
          message({
            messageId: `om_${index}`,
            content: JSON.stringify({ text: `消息${index}` }),
          }),
        );
      }
      expect(debug.send).toHaveBeenCalledTimes(1);
      const calls = (debug.send as jest.Mock).mock.calls as unknown[][];
      expect(String(calls[0]?.[2]).split('\n---\n')).toHaveLength(
        SMART_BATCH_MAX_MESSAGES,
      );
      expect(calls[0]?.[2]).toEqual(
        expect.stringContaining(`[张三|om_${SMART_BATCH_MAX_MESSAGES}]`),
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('智能模式：非文本消息以占位进入批次', async () => {
    jest.useFakeTimers();
    try {
      const { service, debug, client } = setup('smart');
      client.downloadImage.mockRejectedValue(new Error('no permission'));
      await service.handleGroupMessage(
        config(),
        { appId: 'cli_app' } as never,
        { openId: 'ou_user', unionId: null },
        message({
          messageId: 'om_img',
          messageType: 'image',
          content: JSON.stringify({ image_key: 'img_key' }),
        }),
      );
      await jest.advanceTimersByTimeAsync(5_000);
      expect(debug.send).toHaveBeenCalledTimes(1);
      const calls = (debug.send as jest.Mock).mock.calls as unknown[][];
      expect(calls[0]?.[2]).toEqual(
        expect.stringContaining('[张三|om_img] [图片]'),
      );
    } finally {
      jest.useRealTimers();
    }
  });
});
