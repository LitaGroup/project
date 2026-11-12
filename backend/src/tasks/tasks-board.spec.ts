import { TaskStatus, TaskSubStatus } from '../common/enums';
import { Task } from './task.entity';
import { TasksService } from './tasks.service';

/** 看板快照/增量只查轻量投影字段，避免把 Markdown 正文与实时输出推给列表页 */
describe('TasksService 看板列表投影', () => {
  const boardRow = (over: Partial<Task> = {}): Task =>
    ({
      id: 1,
      code: 'TK-0001',
      title: '任务标题',
      parentId: null,
      status: TaskStatus.RUNNING,
      subStatus: TaskSubStatus.EXECUTING,
      requesterType: 'user' as const,
      requesterId: 7,
      createdById: 7,
      agentId: 1001,
      updatedAt: new Date('2026-11-12T00:00:00Z'),
      ...over,
    }) as Task;

  let query: {
    select: jest.Mock;
    where: jest.Mock;
    orderBy: jest.Mock;
    getMany: jest.Mock;
    getOne: jest.Mock;
  };
  let tasksRepo: { createQueryBuilder: jest.Mock };
  let usersRepo: { find: jest.Mock };
  let workersRepo: { find: jest.Mock };
  let service: TasksService;

  beforeEach(() => {
    query = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn(),
      getOne: jest.fn(),
    };
    tasksRepo = { createQueryBuilder: jest.fn(() => query) };
    usersRepo = { find: jest.fn().mockResolvedValue([]) };
    workersRepo = { find: jest.fn().mockResolvedValue([]) };
    service = new TasksService(
      tasksRepo as never,
      {} as never,
      {} as never,
      {} as never,
      usersRepo as never,
      workersRepo as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
  });

  it('findAllForBoard 只 select 列表字段，不包含大文本与实时输出', async () => {
    query.getMany.mockResolvedValue([boardRow()]);
    usersRepo.find.mockResolvedValue([{ id: 7, name: '张三' }]);

    const result = await service.findAllForBoard();

    const selected = (query.select.mock.calls[0] as [string[]])[0];
    expect(selected).toEqual(
      expect.arrayContaining([
        't.id',
        't.code',
        't.title',
        't.parentId',
        't.status',
        't.subStatus',
        't.requesterType',
        't.requesterId',
        't.createdById',
        't.agentId',
        't.updatedAt']),
    );
    for (const heavy of [
      'description',
      'input',
      'content',
      'outputSpec',
      'workPlan',
      'resumePrompt',
      'result',
      'refusalReason',
      'dispatchSuggestion',
      'failureReason',
    ]) {
      expect(selected).not.toContain(heavy);
    }
    expect(query.orderBy).toHaveBeenCalledWith('t.updatedAt', 'DESC');
    expect(result).toEqual([
      expect.objectContaining({ id: 1, requesterName: '张三' }),
    ]);
    expect(result[0]).not.toHaveProperty('liveLines');
  });

  it('findOneForList 使用同一投影并按 id 查询', async () => {
    query.getOne.mockResolvedValue(boardRow({ id: 2 }));
    workersRepo.find.mockResolvedValue([{ id: 7, name: '机器人' }]);

    const result = await service.findOneForList(2);

    expect(query.where).toHaveBeenCalledWith('t.id = :id', { id: 2 });
    const selected = (query.select.mock.calls[0] as [string[]])[0];
    expect(selected).not.toContain('description');
    expect(result).toEqual(expect.objectContaining({ id: 2 }));
    expect(result).not.toHaveProperty('liveLines');
  });

  it('findOneForList 任务不存在返回 null', async () => {
    query.getOne.mockResolvedValue(null);

    await expect(service.findOneForList(99)).resolves.toBeNull();
  });
});
