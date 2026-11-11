import type { User } from '../auth/user.entity';
import { FeedbackSource } from '../common/enums';
import type {
  FeishuBotConfig,
  FeishuBotSecrets,
} from './feishu-bot-config.entity';
import type { FeishuBotGroup } from './feishu-bot-group.entity';
import {
  deriveTitle,
  FeishuBotFeedbackService,
  imageKeysOf,
  placeholderOf,
} from './feishu-bot-feedback.service';
import type { FeishuInboundMessage } from './feishu-bot-p2p.service';

const config = { id: 2, appId: 'cli_app' } as FeishuBotConfig;
const secrets = { appId: 'cli_app' } as FeishuBotSecrets;
const group = { id: 11, chatId: 'oc_group' } as FeishuBotGroup;
const user = { id: 7, name: '张三' } as User;

const message = (
  over: Partial<FeishuInboundMessage> = {},
): FeishuInboundMessage => ({
  messageId: 'om_1',
  chatId: 'oc_group',
  chatType: 'group',
  messageType: 'text',
  content: JSON.stringify({ text: '登录页白屏' }),
  ...over,
});

function setup() {
  const insertExecute = jest
    .fn()
    .mockResolvedValue({ identifiers: [{ id: 101 }] });
  const repliesQb = {
    insert: jest.fn().mockReturnThis(),
    into: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    orIgnore: jest.fn().mockReturnThis(),
    execute: insertExecute,
  };
  const replies = {
    createQueryBuilder: jest.fn(() => repliesQb),
  };
  let existing: unknown = null;
  const feedbacks = {
    findOne: jest.fn(() => Promise.resolve(existing)),
    create: jest.fn((value: unknown) => value),
    save: jest.fn((value: unknown) =>
      Promise.resolve({ ...(value as object), id: 50 }),
    ),
    update: jest.fn(() => Promise.resolve({ affected: 1 })),
  };
  const client = { downloadImage: jest.fn() };
  const service = new FeishuBotFeedbackService(
    client as never,
    feedbacks as never,
    replies as never,
  );
  const setExisting = (row: unknown) => {
    existing = row;
  };
  return {
    service,
    feedbacks,
    replies,
    repliesQb,
    insertExecute,
    client,
    setExisting,
  };
}

describe('反馈采集纯函数', () => {
  it('解析 image / post 消息中的图片 key', () => {
    expect(
      imageKeysOf('image', JSON.stringify({ image_key: 'img_1' })),
    ).toEqual(['img_1']);
    expect(
      imageKeysOf(
        'post',
        JSON.stringify({
          content: [
            [
              { tag: 'text', text: '截图如下' },
              { tag: 'img', image_key: 'img_2' },
            ],
          ],
        }),
      ),
    ).toEqual(['img_2']);
    expect(imageKeysOf('text', JSON.stringify({ text: 'x' }))).toEqual([]);
    expect(imageKeysOf('image', 'not-json')).toEqual([]);
  });

  it('标题取首行并截断；无文字给类型占位', () => {
    expect(deriveTitle('登录页白屏\n补充说明', 'text')).toBe('登录页白屏');
    expect(deriveTitle('', 'image')).toBe('飞书群反馈（[图片]）');
    expect(deriveTitle('x'.repeat(100), 'text')).toBe(`${'x'.repeat(80)}…`);
  });

  it('非文本消息占位', () => {
    expect(placeholderOf('image')).toBe('[图片]');
    expect(placeholderOf('audio')).toBe('[语音]');
    expect(placeholderOf('merge_forward')).toBe('[merge_forward]');
  });
});

describe('FeishuBotFeedbackService.collect', () => {
  it('话题首帖自动创建反馈（来源=飞书群，记录话题与提交人）', async () => {
    const { service, feedbacks } = setup();
    const result = await service.collect({
      config,
      secrets,
      group,
      message: message({ threadId: 'omt_1' }),
      threadId: 'omt_1',
      user,
      senderOpenId: 'ou_user',
      text: '登录页白屏',
    });
    expect(result.isNew).toBe(true);
    expect(result.duplicated).toBe(false);
    expect(feedbacks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '登录页白屏',
        source: FeedbackSource.FEISHU_GROUP,
        sourceChatId: 'oc_group',
        sourceThreadId: 'omt_1',
        sourceMessageId: 'om_1',
        reporterId: 7,
        reporterName: '张三',
      }),
    );
  });

  it('未识别平台用户时提交人落群成员快照', async () => {
    const { service, feedbacks } = setup();
    await service.collect({
      config,
      secrets,
      group,
      message: message({ threadId: 'omt_1' }),
      threadId: 'omt_1',
      user: null,
      senderOpenId: 'ou_x',
      text: '白屏',
    });
    expect(feedbacks.create).toHaveBeenCalledWith(
      expect.objectContaining({ reporterId: null, reporterName: '群成员' }),
    );
  });

  it('已有反馈：追加跟帖并推进 updatedAt', async () => {
    const { service, feedbacks, insertExecute, setExisting } = setup();
    setExisting({
      id: 50,
      source: FeedbackSource.FEISHU_GROUP,
      sourceThreadId: 'omt_1',
    });
    const collected = await service.collect({
      config,
      secrets,
      group,
      message: message({ messageId: 'om_2', threadId: 'omt_1' }),
      threadId: 'omt_1',
      user,
      senderOpenId: 'ou_user',
      text: '我也遇到了',
    });
    expect(collected.isNew).toBe(false);
    expect(collected.duplicated).toBe(false);
    expect(insertExecute).toHaveBeenCalled();
    const updateCalls = (feedbacks.update as unknown as jest.Mock).mock
      .calls as Array<[{ id: number }, { updatedAt: Date }]>;
    expect(updateCalls[0]?.[0]).toEqual({ id: 50 });
    expect(updateCalls[0]?.[1]?.updatedAt).toBeInstanceOf(Date);
    expect(feedbacks.save).not.toHaveBeenCalled();
  });

  it('跟帖消息 id 重复：判定为事件重复不再唤起', async () => {
    const { service, repliesQb, setExisting } = setup();
    setExisting({ id: 50, source: FeedbackSource.FEISHU_GROUP });
    repliesQb.execute.mockResolvedValue({ identifiers: [] });
    const result = await service.collect({
      config,
      secrets,
      group,
      message: message({ messageId: 'om_2', threadId: 'omt_1' }),
      threadId: 'omt_1',
      user,
      senderOpenId: 'ou_user',
      text: '重复消息',
    });
    expect(result).toEqual({
      feedback: { id: 50, source: FeedbackSource.FEISHU_GROUP },
      isNew: false,
      duplicated: true,
    });
  });

  it('并发首帖唯一索引冲突：重查后按跟帖收录', async () => {
    const { service, feedbacks, setExisting } = setup();
    feedbacks.save.mockRejectedValue(
      new Error(
        'duplicate key value violates unique constraint "UQ_feedbacks_feishu_thread"',
      ),
    );
    let firstCall = true;
    (feedbacks.findOne as jest.Mock).mockImplementation(() => {
      if (firstCall) {
        firstCall = false;
        return Promise.resolve(null);
      }
      return Promise.resolve({ id: 51 });
    });
    setExisting(null);
    const result = await service.collect({
      config,
      secrets,
      group,
      message: message({ threadId: 'omt_1' }),
      threadId: 'omt_1',
      user,
      senderOpenId: 'ou_user',
      text: '并发首帖',
    });
    expect(result.isNew).toBe(false);
    expect(result.feedback.id).toBe(51);
  });

  it('回执文案包含反馈编号', () => {
    const { service } = setup();
    expect(service.receiptText({ id: 50 } as never)).toContain(
      '已收录为反馈 #50',
    );
  });
});
