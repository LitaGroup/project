import { WorkerChatService } from './worker-chat.service';
import type { WorkerDebugOption } from './worker-debug.service';

function option(id: number, name = `机器人${id}`): WorkerDebugOption {
  return {
    id,
    name,
    intro: `${name}简介`,
    avatarUrl: null,
    executorName: '执行器',
    providerId: 'provider',
    modelId: 'model',
    variant: null,
  };
}

function createService(input?: {
  options?: WorkerDebugOption[];
  owners?: Array<{ id: number; personalAgentUserId: number | null }>;
  sessions?: Array<{ workerId: number; createdAt: Date }>;
}) {
  const debug = {
    listWorkers: jest.fn().mockResolvedValue(input?.options ?? []),
    snapshot: jest.fn().mockResolvedValue({ marker: 'snapshot' }),
    stream: jest.fn(),
    send: jest.fn().mockResolvedValue({ marker: 'send' }),
    replyQuestion: jest.fn().mockResolvedValue({ marker: 'reply' }),
    reset: jest.fn().mockResolvedValue({ marker: 'reset' }),
  };
  const workers = {
    find: jest.fn().mockResolvedValue(input?.owners ?? []),
    exists: jest.fn().mockResolvedValue(true),
  };
  const sessions = {
    find: jest.fn().mockResolvedValue(input?.sessions ?? []),
  };
  const service = new WorkerChatService(
    debug as never,
    workers as never,
    sessions as never,
  );
  return { service, debug, workers, sessions };
}

describe('WorkerChatService', () => {
  it('隐藏其他用户的个人 AGENT，仅保留公共机器人和自己的个人 AGENT', async () => {
    const { service } = createService({
      options: [
        option(1, '公共'),
        option(2, '我的代理'),
        option(3, '他人代理'),
      ],
      owners: [
        { id: 1, personalAgentUserId: null },
        { id: 2, personalAgentUserId: 10 },
        { id: 3, personalAgentUserId: 11 },
      ],
    });

    await expect(service.listWorkers(10)).resolves.toMatchObject([
      { id: 1 },
      { id: 2 },
    ]);
    await expect(service.listWorkers(10, '我的')).resolves.toMatchObject([
      { id: 2 },
    ]);
  });

  it('机器人搜索支持中文、全拼、首字母、英文与 ID', async () => {
    const { service } = createService({
      options: [
        option(1001, '活动开发机器人'),
        option(1002, 'Data Agent'),
        option(1003, '女武神'),
      ],
      owners: [
        { id: 1001, personalAgentUserId: null },
        { id: 1002, personalAgentUserId: null },
        { id: 1003, personalAgentUserId: null },
      ],
    });

    for (const query of [
      '开发',
      'huodongkaifa',
      'hdkfjqr',
      'agent',
      '1002',
      'nvwushen',
    ]) {
      await expect(service.listWorkers(10, query)).resolves.toHaveLength(1);
    }
    await expect(service.listWorkers(10, '不存在的机器人')).resolves.toEqual(
      [],
    );
  });

  it('会话按首条消息时间倒序并限制 20 条', async () => {
    const options = Array.from({ length: 22 }, (_, index) => option(index + 1));
    const sessions = options.map((worker, index) => ({
      workerId: worker.id,
      createdAt: new Date(2026, 0, 1, 0, index),
    }));
    const { service } = createService({
      options,
      owners: options.map((worker) => ({
        id: worker.id,
        personalAgentUserId: null,
      })),
      sessions,
    });

    const result = await service.listSessions(10);
    expect(result).toHaveLength(20);
    expect(result[0].worker.id).toBe(22);
    expect(result[19].worker.id).toBe(3);
  });

  it('快照、发送、提问与重置统一使用 chat scope', async () => {
    const { service, debug } = createService({
      options: [option(1)],
      owners: [{ id: 1, personalAgentUserId: null }],
    });
    const files = [{ name: 'a.txt', url: '/files/a.txt' }];

    await service.snapshot(10, 1);
    await service.send(10, 1, '你好', files);
    await service.replyQuestion(10, 1, 'q1', { answers: [['A']] });
    await service.reset(10, 1);

    expect(debug.snapshot).toHaveBeenCalledWith(10, 1, 'chat');
    expect(debug.send).toHaveBeenCalledWith(
      10,
      1,
      '你好',
      expect.objectContaining({ scope: 'chat', files }),
    );
    expect(debug.replyQuestion).toHaveBeenCalledWith(
      10,
      1,
      'q1',
      { answers: [['A']] },
      'chat',
    );
    expect(debug.reset).toHaveBeenCalledWith(10, 1, 'chat');
  });

  it('拒绝访问其他用户的个人 AGENT', async () => {
    const { service } = createService({
      options: [option(3)],
      owners: [{ id: 3, personalAgentUserId: 11 }],
    });

    await expect(service.snapshot(10, 3)).rejects.toThrow('机器人当前不可对话');
  });
});
