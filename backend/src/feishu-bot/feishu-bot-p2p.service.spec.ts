import { EMPTY } from 'rxjs';
import { WorkerRuntime } from '../common/enums';
import type { FeishuBotConfig } from './feishu-bot-config.entity';
import {
  FeishuBotP2PService,
  type FeishuInboundMessage,
} from './feishu-bot-p2p.service';

// 附件落盘走真实目录，单测里屏蔽文件系统副作用
jest.mock('fs/promises', () => ({
  mkdir: jest.fn(() => Promise.resolve()),
  writeFile: jest.fn(() => Promise.resolve()),
}));

describe('FeishuBotP2PService 私聊消息', () => {
  const config = (over: Partial<FeishuBotConfig> = {}): FeishuBotConfig =>
    ({
      id: 2,
      kind: 'worker',
      workerId: 5,
      appId: 'cli_app',
      policy: {},
      ...over,
    }) as FeishuBotConfig;

  const user = () => ({ id: 7, name: '张三' }) as never;

  const message = (over: Partial<FeishuInboundMessage> = {}) => ({
    messageId: 'om_1',
    chatId: 'oc_p2p',
    chatType: 'p2p',
    messageType: 'image',
    content: JSON.stringify({ image_key: 'img_1' }),
    ...over,
  });

  function setup() {
    const client = {
      sendText: jest.fn(() => Promise.resolve({ messageId: null })),
      sendCard: jest.fn(() => Promise.resolve({ messageId: null })),
      react: jest.fn(() => Promise.resolve({ reactionId: 'r1' })),
      unreact: jest.fn(() => Promise.resolve()),
      downloadImage: jest.fn(() => Promise.resolve(Buffer.from('img'))),
      downloadFile: jest.fn(() => Promise.resolve(Buffer.from('file'))),
      uploadLocalImage: jest.fn(() => Promise.resolve('img_key')),
      uploadLocalFile: jest.fn(() => Promise.resolve('file_key')),
      sendImage: jest.fn(() => Promise.resolve({ messageId: null })),
      sendFile: jest.fn(() => Promise.resolve({ messageId: null })),
    };
    const messages = {
      sendMarkdown: jest.fn(() => Promise.resolve([])),
      sendQuestionCard: jest.fn(() => Promise.resolve({ messageId: null })),
    };
    const debug = {
      send: jest.fn(() => Promise.resolve({})),
      stream: jest.fn(() => EMPTY),
      replyQuestion: jest.fn(() => Promise.resolve({})),
      interrupt: jest.fn(() => Promise.resolve({})),
    };
    const personalAgents = {
      ensureForUser: jest.fn(() => Promise.resolve({ id: 8 })),
      send: jest.fn(() => Promise.resolve({})),
    };
    const cards = {
      findOne: jest.fn(() => Promise.resolve(null)),
      create: jest.fn((value: unknown) => value),
      save: jest.fn((value: { id?: number }) =>
        Promise.resolve({ ...value, id: 99 }),
      ),
      update: jest.fn(() => Promise.resolve({ affected: 1 })),
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
    const service = new FeishuBotP2PService(
      client as never,
      messages as never,
      debug as never,
      personalAgents as never,
      cards as never,
      workers as never,
    );
    return { service, client, messages, debug, personalAgents, cards, workers };
  }

  it('图片下载失败时显式回执，不再静默', async () => {
    const { service, client, debug, personalAgents } = setup();
    client.downloadImage.mockRejectedValueOnce(
      new Error('飞书素材下载失败：HTTP 403'),
    );

    await expect(
      service.handleMessage(config(), {} as never, user(), message()),
    ).resolves.toBeUndefined();

    expect(client.sendText).toHaveBeenCalledWith(
      2,
      expect.anything(),
      'chat_id',
      'oc_p2p',
      expect.stringContaining('附件接收失败'),
    );
    expect(client.sendText).toHaveBeenCalledWith(
      2,
      expect.anything(),
      'chat_id',
      'oc_p2p',
      expect.stringContaining('飞书素材下载失败：HTTP 403'),
    );
    expect(client.sendText).toHaveBeenCalledWith(
      2,
      expect.anything(),
      'chat_id',
      'oc_p2p',
      expect.stringContaining('im:message'),
    );
    // 失败发生在表情回应与会话投递之前
    expect(client.react).not.toHaveBeenCalled();
    expect(debug.send).not.toHaveBeenCalled();
    expect(personalAgents.send).not.toHaveBeenCalled();
  });

  it('图片正常下载后作为附件投递机器人会话', async () => {
    const { service, client, debug } = setup();

    await service.handleMessage(config(), {} as never, user(), message());

    expect(client.downloadImage).toHaveBeenCalledWith(
      2,
      expect.anything(),
      'om_1',
      'img_1',
    );
    expect(client.sendText).not.toHaveBeenCalled();
    expect(debug.send).toHaveBeenCalledWith(
      7,
      5,
      '',
      expect.objectContaining({ scope: 'feishu:p2p:oc_p2p' }),
    );
    const sentOptions = debug.send.mock.calls[0][3] as unknown as {
      files?: Array<{ name: string; mime: string; url: string }>;
    };
    expect(sentOptions.files).toHaveLength(1);
    expect(sentOptions.files?.[0]).toMatchObject({
      name: '飞书图片.png',
      mime: 'image/png',
    });
    expect(sentOptions.files?.[0]?.url).toContain('/files/feishu/');
  });

  it('官方机器人图片下载失败同样显式回执', async () => {
    const { service, client, personalAgents } = setup();
    client.downloadImage.mockRejectedValueOnce(
      new Error('飞书素材下载失败：HTTP 403'),
    );

    await service.handleMessage(
      config({ kind: 'official', workerId: null }),
      {} as never,
      user(),
      message(),
    );

    expect(client.sendText).toHaveBeenCalledWith(
      2,
      expect.anything(),
      'chat_id',
      'oc_p2p',
      expect.stringContaining('附件接收失败'),
    );
    expect(personalAgents.send).not.toHaveBeenCalled();
  });
});
