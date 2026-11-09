import { McpLogsService } from './mcp-logs.service';

/** 链式 QueryBuilder mock */
function qbMock(overrides?: Record<string, jest.Mock>) {
  const qb: Record<string, jest.Mock> = {
    andWhere: jest.fn().mockReturnThis(),
    getCount: jest.fn().mockResolvedValue(2),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([{ id: 1 }]),
    ...overrides,
  };
  return qb;
}

function buildService(qb: Record<string, jest.Mock>): {
  service: McpLogsService;
  save: jest.Mock;
} {
  const save = jest.fn().mockResolvedValue(undefined);
  const repo = {
    create: jest.fn((input: unknown) => input),
    save,
    createQueryBuilder: jest.fn(() => qb),
  };
  const service = new McpLogsService(repo as never);
  return { service, save };
}

describe('McpLogsService', () => {
  it('record 落库成功', async () => {
    const qb = qbMock();
    const { service, save } = buildService(qb);
    await service.record({
      userId: 3,
      userName: '张三',
      workerId: 7,
      workerName: '测试机器人',
      sessionId: 'mcp:s123',
      tool: 'bot_call',
      status: 'complete',
      durationMs: 1200,
      messageLength: 10,
      contentLength: 99,
    });
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'complete', contentLength: 99 }),
    );
  });

  it('record 失败不抛错（仅告警）', async () => {
    const repo = {
      create: jest.fn((input: unknown) => input),
      save: jest.fn().mockRejectedValue(new Error('db down')),
      createQueryBuilder: jest.fn(() => qbMock()),
    };
    const broken = new McpLogsService(repo as never);
    await expect(
      broken.record({
        userId: 3,
        userName: '张三',
        workerId: 7,
        workerName: '测试机器人',
        sessionId: 'mcp:s123',
        tool: 'bot_call',
        status: 'error',
        durationMs: 0,
        messageLength: 1,
        error: 'boom',
      }),
    ).resolves.toBeUndefined();
  });

  it('list 分页与 q 过滤', async () => {
    const qb = qbMock();
    const { service } = buildService(qb);
    const result = await service.list({ q: '机器人', page: 2, pageSize: 20 });
    expect(qb.andWhere).toHaveBeenCalled();
    expect(qb.skip).toHaveBeenCalledWith(20);
    expect(qb.take).toHaveBeenCalledWith(20);
    expect(result).toEqual({
      items: [{ id: 1 }],
      total: 2,
      page: 2,
      pageSize: 20,
    });
  });

  it('list 无 q 时不加过滤、pageSize 封顶 200', async () => {
    const qb = qbMock();
    const { service } = buildService(qb);
    await service.list({ page: 1, pageSize: 9999 });
    expect(qb.andWhere).not.toHaveBeenCalled();
    expect(qb.take).toHaveBeenCalledWith(200);
  });
});
