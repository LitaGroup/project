import { Task } from './task.entity';
import { TasksService } from './tasks.service';

describe('TasksService 标题命名', () => {
  let tasksRepo: {
    create: jest.Mock;
    save: jest.Mock;
    createQueryBuilder: jest.Mock;
    findOne: jest.Mock;
  };
  let dispatchService: { addEvent: jest.Mock };
  let llm: { generateTitle: jest.Mock };
  let service: TasksService;

  beforeEach(() => {
    tasksRepo = {
      create: jest.fn((value: Partial<Task>) => value),
      save: jest.fn((value: Task) => {
        if (!value.id) value.id = 77;
        return Promise.resolve(value);
      }),
      createQueryBuilder: jest.fn(),
      findOne: jest.fn(),
    };
    dispatchService = { addEvent: jest.fn().mockResolvedValue(undefined) };
    llm = { generateTitle: jest.fn().mockResolvedValue(null) };
    service = new TasksService(
      tasksRepo as never,
      { save: jest.fn() } as never,
      {} as never,
      { findOne: jest.fn() } as never,
      { findOne: jest.fn() } as never,
      {} as never,
      {} as never,
      dispatchService as never,
      {} as never,
      { taskChanged: jest.fn() } as never,
      llm as never,
    );
  });

  const createInput = (titleNaming: boolean) => ({
    title: '登录问题',
    description: '登录页面点击即崩溃',
    requesterType: 'user' as const,
    requesterId: 1,
    titleNaming,
  });

  it('显式开启时异步生成「T-{id}」标题并乐观更新', async () => {
    const execute = jest.fn().mockResolvedValue({ affected: 1 });
    const qb = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute,
    };
    tasksRepo.createQueryBuilder.mockReturnValue(qb);
    llm.generateTitle.mockResolvedValue('修复登录页崩溃');

    const created = await service.create(createInput(true));
    // 等待 fire-and-forget 的标题任务完成
    await new Promise((resolve) => setImmediate(resolve));

    expect(created.title).toBe('登录问题');
    expect(llm.generateTitle).toHaveBeenCalledWith(
      expect.stringContaining('登录页面点击即崩溃'),
    );
    expect(qb.set).toHaveBeenCalledWith({
      title: '「T-77」修复登录页崩溃',
    });
    expect(qb.where).toHaveBeenCalledWith('id = :id AND title = :original', {
      id: 77,
      original: '登录问题',
    });
    expect(dispatchService.addEvent).toHaveBeenCalledWith(
      77,
      '操作',
      'AI 命名标题：登录问题 → 「T-77」修复登录页崩溃',
      null,
      undefined,
    );
  });

  it('未开启标题命名的入口不触发模型调用', async () => {
    await service.create(createInput(false));
    await new Promise((resolve) => setImmediate(resolve));
    expect(llm.generateTitle).not.toHaveBeenCalled();
    expect(tasksRepo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('模型失败只告警，不影响任务创建', async () => {
    llm.generateTitle.mockRejectedValue(new Error('timeout'));

    await expect(service.create(createInput(true))).resolves.toMatchObject({
      title: '登录问题',
    });
    await new Promise((resolve) => setImmediate(resolve));
  });

  it('标题被人工修改（乐观条件不命中）时不写入事件', async () => {
    const execute = jest.fn().mockResolvedValue({ affected: 0 });
    tasksRepo.createQueryBuilder.mockReturnValue({
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute,
    });
    llm.generateTitle.mockResolvedValue('修复登录页崩溃');

    await service.create(createInput(true));
    await new Promise((resolve) => setImmediate(resolve));

    expect(dispatchService.addEvent).not.toHaveBeenCalledWith(
      expect.anything(),
      '操作',
      expect.stringContaining('AI 命名标题'),
      null,
      undefined,
    );
  });
});
