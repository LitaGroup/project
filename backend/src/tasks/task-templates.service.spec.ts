import { Repository } from 'typeorm';
import { TaskTemplateFollow } from './task-template-follow.entity';
import { TaskTemplate } from './task-template.entity';
import { TaskTemplatesService } from './task-templates.service';
import { TaskTypesService } from '../task-types/task-types.service';
import { Worker } from '../workers/worker.entity';

/** 任务定义服务：创建人归属与关注关系 */
describe('TaskTemplatesService', () => {
  const templates = {
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn((input: Partial<TaskTemplate>) => input),
    remove: jest.fn(),
  };
  const follows = {
    find: jest.fn(),
    createQueryBuilder: jest.fn(),
    delete: jest.fn(),
  };
  const taskTypes = {
    assertExists: jest.fn(),
  };
  let service: TaskTemplatesService;

  const template = (id: number): TaskTemplate => ({
    id,
    name: `定义 ${id}`,
    type: '其它',
    description: null,
    agentIds: [],
    createdById: null,
    createdByName: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TaskTemplatesService(
      templates as unknown as Repository<TaskTemplate>,
      {} as Repository<Worker>,
      follows as unknown as Repository<TaskTemplateFollow>,
      taskTypes as unknown as TaskTypesService,
    );
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
    taskTypes.assertExists.mockResolvedValue('其它');
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
});
