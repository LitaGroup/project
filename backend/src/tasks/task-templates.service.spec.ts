import { Repository } from 'typeorm';
import { WorkerRole } from '../common/enums';
import { Task } from './task.entity';
import { TaskTemplateFollow } from './task-template-follow.entity';
import { TaskTemplate } from './task-template.entity';
import { TaskTemplatesService } from './task-templates.service';
import { Worker } from '../workers/worker.entity';

/** 任务定义服务：创建人归属与关注关系 */
describe('TaskTemplatesService', () => {
  const templates = {
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn((input: Partial<TaskTemplate>) => input),
    remove: jest.fn(),
    query: jest.fn(),
  };
  const tasks = {
    find: jest.fn(),
  };
  const follows = {
    find: jest.fn(),
    createQueryBuilder: jest.fn(),
    delete: jest.fn(),
  };
  const workers = {
    find: jest.fn(),
    findOne: jest.fn(),
  };
  let service: TaskTemplatesService;

  const template = (id: number): TaskTemplate => ({
    id,
    name: `定义 ${id}`,
    description: null,
    agentIds: [],
    createdById: null,
    createdByName: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    workers.find.mockResolvedValue([]);
    templates.query.mockResolvedValue(undefined);
    service = new TaskTemplatesService(
      templates as unknown as Repository<TaskTemplate>,
      tasks as unknown as Repository<Task>,
      workers as unknown as Repository<Worker>,
      follows as unknown as Repository<TaskTemplateFollow>,
    );
  });

  it('启动时幂等补齐未知任务、项目开发交付与用户反馈处理系统定义', async () => {
    templates.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...template(6), name: '未知任务' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        ...template(7),
        name: '技术-项目开发交付',
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...template(8), name: '用户反馈处理' });

    await service.onModuleInit();

    expect(templates.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO task_templates'),
      [6, '未知任务', expect.any(String), '[]'],
    );
    expect(templates.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO task_templates'),
      [7, '技术-项目开发交付', expect.any(String), '[2]'],
    );
    expect(templates.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO task_templates'),
      [8, '用户反馈处理', expect.any(String), '[4]'],
    );
    expect(templates.query).toHaveBeenCalledWith(
      expect.stringContaining("pg_get_serial_sequence('task_templates', 'id')"),
      [999],
    );
  });

  it('项目开发交付系统定义不可删除', async () => {
    await expect(service.remove(7)).rejects.toThrow(
      '系统任务定义（ID=7）由平台保留，不能删除',
    );
    expect(templates.findOne).not.toHaveBeenCalled();
  });

  it('用户反馈处理系统定义不可删除', async () => {
    await expect(service.remove(8)).rejects.toThrow(
      '系统任务定义（ID=8）由平台保留，不能删除',
    );
    expect(templates.findOne).not.toHaveBeenCalled();
  });

  it('列表返回当前用户是否已关注', async () => {
    templates.find.mockResolvedValue([template(1), template(2)]);
    follows.find.mockResolvedValue([{ templateId: 2, userId: 7 }]);

    const result = await service.findAll(7);

    expect(result.map((item) => [item.id, item.followedByMe])).toEqual([
      [1, false],
      [2, true],
    ]);
  });

  it('未登录用户列表全部标记未关注', async () => {
    templates.find.mockResolvedValue([template(1)]);

    const result = await service.findAll(null);

    expect(result[0].followedByMe).toBe(false);
    expect(follows.find).not.toHaveBeenCalled();
  });

  it('关注使用 ON CONFLICT DO NOTHING 保证幂等', async () => {
    templates.findOne.mockResolvedValue(template(3));
    const execute = jest.fn().mockResolvedValue({});
    const orIgnore = jest.fn().mockReturnValue({ execute });
    const values = jest.fn().mockReturnValue({ orIgnore });
    const insert = jest.fn().mockReturnValue({ values });
    follows.createQueryBuilder.mockReturnValue({ insert });

    const result = await service.follow(3, 7);

    expect(insert).toHaveBeenCalled();
    expect(values).toHaveBeenCalledWith({ templateId: 3, userId: 7 });
    expect(orIgnore).toHaveBeenCalled();
    expect(execute).toHaveBeenCalled();
    expect(result.followedByMe).toBe(true);
  });

  it('创建任务定义时记录创建人', async () => {
    templates.findOne.mockResolvedValue(null);
    templates.save.mockResolvedValue({ ...template(4), createdById: 7 });

    await service.create({ name: '新定义' }, { id: 7, name: '张三' });

    expect(templates.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: '新定义',
        createdById: 7,
        createdByName: '张三',
      }),
    );
  });

  it('删除任务定义时同步清理关注关系', async () => {
    const target = template(5);
    templates.findOne.mockResolvedValue(target);
    templates.remove.mockResolvedValue(target);

    await service.remove(5);

    expect(follows.delete).toHaveBeenCalledWith({ templateId: 5 });
  });

  it('最近任务按定义过滤并最多返回 5 条', async () => {
    templates.findOne.mockResolvedValue(template(9));
    tasks.find.mockResolvedValue([{ id: 1 }, { id: 2 }]);

    const result = await service.findRecentTasks(9);

    expect(tasks.find).toHaveBeenCalledWith({
      where: { templateId: 9 },
      order: { updatedAt: 'DESC', id: 'DESC' },
      take: 5,
    });
    expect(result).toHaveLength(2);
  });

  it('定义不存在时最近任务查询直接 404 且不查任务', async () => {
    templates.findOne.mockResolvedValue(null);

    await expect(service.findRecentTasks(999)).rejects.toThrow();

    expect(tasks.find).not.toHaveBeenCalled();
  });

  it('保存任务定义时剔除个人 AGENT 处理机器人', async () => {
    templates.findOne.mockResolvedValue(null);
    templates.save.mockImplementation((value: TaskTemplate) =>
      Promise.resolve({ ...value, id: 1001 }),
    );
    workers.findOne.mockImplementation(({ where }: { where: { id: number } }) =>
      Promise.resolve(
        where.id === 2001
          ? {
              id: 2001,
              name: '张三的AGENT',
              enabled: true,
              role: WorkerRole.WORKER,
              personalAgentUserId: 7,
            }
          : {
              id: 2002,
              name: '机器人',
              enabled: true,
              role: WorkerRole.WORKER,
              personalAgentUserId: null,
            },
      ),
    );

    await service.create({ name: '新定义', agentIds: [2001, 2002] });

    expect(templates.create).toHaveBeenCalledWith(
      expect.objectContaining({ agentIds: [2002] }),
    );
  });

  describe('Agent Markdown', () => {
    it('清单展示关联机器人名称和系统来源', async () => {
      templates.find.mockResolvedValue([
        {
          ...template(6),
          name: '未知任务',
          agentIds: [1001, 9999],
        },
      ]);
      workers.find.mockResolvedValue([{ id: 1001, name: '小王' }]);

      const markdown = await service.listMarkdown();

      expect(markdown).toContain('[6](/api/task-templates/6.md)');
      expect(markdown).toContain('小王#1001');
      expect(markdown).toContain('#9999');
      expect(markdown).toContain('系统');
      expect(markdown).toContain('POST /api/task-templates/create.md');
    });

    it('详情包含任务定义描述与系统限制', async () => {
      templates.findOne.mockResolvedValue({
        ...template(6),
        name: '未知任务',
        description: '任务范围\n交付要求',
      });

      const markdown = await service.findOneMarkdown(6);

      expect(markdown).toContain('系统（不可改名、不可删除）');
      expect(markdown).toContain('任务范围');
      expect(markdown).toContain('交付要求');
    });

    it('退役的工单调度定义 ID 视为自定义定义', async () => {
      templates.findOne.mockResolvedValue(template(10));

      const markdown = await service.findOneMarkdown(10);

      expect(markdown).toContain('- 来源：自定义');
    });

    it('机器人 Token 创建时记录机器人名称但不伪造用户 ID', async () => {
      templates.findOne.mockResolvedValue(null);
      templates.save.mockImplementation((value: TaskTemplate) =>
        Promise.resolve({ ...value, id: 1000 }),
      );

      const markdown = await service.createMarkdown(
        { name: '机器人定义' },
        { id: null, name: '机器人 A' },
      );

      expect(templates.create).toHaveBeenCalledWith(
        expect.objectContaining({
          createdById: null,
          createdByName: '机器人 A',
        }),
      );
      expect(markdown).toContain('# 任务定义已创建');
      expect(markdown).toContain('GET /api/task-templates/1000.md');
    });

    it('删除结果不再返回失效的详情链接', async () => {
      const target = { ...template(1007), name: '待删除定义' };
      templates.findOne.mockResolvedValue(target);
      templates.remove.mockResolvedValue(target);

      const markdown = await service.removeMarkdown(1007);

      expect(markdown).toContain('# 任务定义已删除');
      expect(markdown).toContain('已创建的历史任务不受影响');
      expect(markdown).not.toContain('/api/task-templates/1007.md');
    });
  });
});
