import type { FeishuBotConfig } from './feishu-bot-config.entity';
import { FeishuBotOfficialMessageService } from './feishu-bot-official-message.service';

describe('FeishuBotOfficialMessageService', () => {
  const official = {
    id: 1,
    kind: 'official',
    workerId: null,
    enabled: true,
  } as FeishuBotConfig;

  const sender = { type: 'worker' as const, id: 5, name: '技术-实施' };

  function setup() {
    const configs = {
      loadEnabledOfficial: jest.fn(() => Promise.resolve(official)),
      secretsOf: jest.fn(() => ({
        appId: 'cli_app',
        appSecret: 's',
        verificationToken: null,
        encryptKey: null,
      })),
    };
    const messages = {
      sendMarkdown: jest.fn(() =>
        Promise.resolve([{ messageId: 'om_1' }, { messageId: 'om_2' }]),
      ),
    };
    const identities = {
      openIdFor: jest.fn(() => Promise.resolve('ou_official')),
    };
    const audits = {
      create: jest.fn((row: Record<string, unknown>) => row),
      save: jest.fn(() => Promise.resolve({})),
    };
    const users = {
      findOne: jest.fn(() =>
        Promise.resolve({
          id: 7,
          name: '张三',
          feishuOpenId: 'ou_login',
        }),
      ),
    };
    const service = new FeishuBotOfficialMessageService(
      configs as never,
      messages as never,
      identities as never,
      audits as never,
      users as never,
    );
    return { service, configs, messages, identities, audits, users };
  }

  it('官方机器人未配置时明确报错', async () => {
    const { service, configs } = setup();
    configs.loadEnabledOfficial.mockResolvedValue(null);
    await expect(
      service.send({ chatId: 'oc_group', content: '你好' }, sender),
    ).rejects.toThrow('平台官方机器人未配置或未启用');
  });

  it('目标必须三选一', async () => {
    const { service } = setup();
    await expect(service.send({ content: '你好' }, sender)).rejects.toThrow(
      '三选一',
    );
    await expect(
      service.send({ userId: 7, openId: 'ou_x', content: '你好' }, sender),
    ).rejects.toThrow('三选一');
  });

  it('空正文拒绝发送', async () => {
    const { service } = setup();
    await expect(
      service.send({ chatId: 'oc_group', content: '   ' }, sender),
    ).rejects.toThrow('不能为空');
  });

  it('userId 优先使用官方应用下的 open_id 并写成功审计', async () => {
    const { service, messages, audits } = setup();
    const result = await service.send(
      { userId: 7, content: '**你好**', title: '通知' },
      sender,
    );
    expect(messages.sendMarkdown).toHaveBeenCalledWith(
      1,
      expect.anything(),
      'open_id',
      'ou_official',
      '**你好**',
      undefined,
      '通知',
    );
    expect(result).toMatchObject({
      messageIds: ['om_1', 'om_2'],
      receiveIdType: 'open_id',
      receiveId: 'ou_official',
    });
    expect(audits.save).toHaveBeenCalledWith(
      expect.objectContaining({
        senderType: 'worker',
        senderId: 5,
        senderName: '技术-实施',
        targetType: 'user',
        targetId: 'ou_official',
        targetUserId: 7,
        targetName: '张三',
        title: '通知',
        content: '**你好**',
        contentLength: 6,
        status: 'success',
        messageIds: ['om_1', 'om_2'],
      }),
    );
  });

  it('无应用映射时回退登录 open_id', async () => {
    const { service, identities, messages } = setup();
    identities.openIdFor.mockResolvedValue(null);
    await service.send({ userId: 7, content: '你好' }, sender);
    expect(messages.sendMarkdown).toHaveBeenCalledWith(
      1,
      expect.anything(),
      'open_id',
      'ou_login',
      '你好',
      undefined,
      undefined,
    );
  });

  it('用户不存在或无 open_id 时拒绝', async () => {
    const { service, users, identities } = setup();
    users.findOne.mockResolvedValueOnce(null);
    await expect(
      service.send({ userId: 99, content: '你好' }, sender),
    ).rejects.toThrow('不存在');
    users.findOne.mockResolvedValueOnce({
      id: 8,
      name: '李四',
      feishuOpenId: '',
    });
    identities.openIdFor.mockResolvedValueOnce(null);
    await expect(
      service.send({ userId: 8, content: '你好' }, sender),
    ).rejects.toThrow('未绑定飞书 open_id');
  });

  it('指定 chat_id 直发并支持话题回复', async () => {
    const { service, messages } = setup();
    await service.send(
      {
        chatId: 'oc_group',
        content: '群通知',
        replyToMessageId: 'om_parent',
      },
      sender,
    );
    expect(messages.sendMarkdown).toHaveBeenCalledWith(
      1,
      expect.anything(),
      'chat_id',
      'oc_group',
      '群通知',
      'om_parent',
      undefined,
    );
  });

  it('发送失败也写审计并抛出原因', async () => {
    const { service, messages, audits } = setup();
    messages.sendMarkdown.mockRejectedValue(new Error('飞书接口调用失败'));
    await expect(
      service.send({ chatId: 'oc_group', content: '你好' }, sender),
    ).rejects.toThrow('飞书接口调用失败');
    expect(audits.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        error: '飞书接口调用失败',
        messageIds: null,
      }),
    );
  });

  it('审计写入失败不影响发送结果', async () => {
    const { service, audits } = setup();
    audits.save.mockRejectedValue(new Error('db down'));
    await expect(
      service.send({ chatId: 'oc_group', content: '你好' }, sender),
    ).resolves.toMatchObject({ messageIds: ['om_1', 'om_2'] });
  });
});
