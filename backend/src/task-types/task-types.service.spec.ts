import { BadRequestException } from '@nestjs/common';
import { TaskType } from './task-type.entity';
import { TaskTypesService, validateTaskTypeName } from './task-types.service';

describe('TaskTypesService', () => {
  let typesRepo: {
    count: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    remove: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let tasksRepo: {
    count: jest.Mock;
    update: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let workersRepo: { find: jest.Mock; save: jest.Mock };
  let taskTemplatesRepo: {
    count: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let nameQuery: { where: jest.Mock; getMany: jest.Mock };
  let renameQuery: {
    update: jest.Mock;
    set: jest.Mock;
    where: jest.Mock;
    execute: jest.Mock;
  };
  let service: TaskTypesService;

  const typeOf = (over: Partial<TaskType> = {}): TaskType => ({
    id: 1,
    name: '需求分析',
    description: '',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  });

  beforeEach(() => {
    nameQuery = {
      where: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };
    typesRepo = {
      count: jest.fn().mockResolvedValue(0),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((v: Partial<TaskType>) => v),
      save: jest.fn((v: TaskType) => Promise.resolve(v)),
      remove: jest.fn().mockResolvedValue(undefined),
      createQueryBuilder: jest.fn().mockReturnValue(nameQuery),
    };
    renameQuery = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue(undefined),
    };
    tasksRepo = {
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn().mockResolvedValue(undefined),
      createQueryBuilder: jest.fn().mockReturnValue(renameQuery),
    };
    workersRepo = {
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn((v: unknown) => Promise.resolve(v)),
    };
    taskTemplatesRepo = {
      count: jest.fn().mockResolvedValue(0),
      createQueryBuilder: jest.fn().mockReturnValue(renameQuery),
    };
    service = new TaskTypesService(
      typesRepo as never,
      tasksRepo as never,
      workersRepo as never,
      taskTemplatesRepo as never,
    );
  });

  describe('validateTaskTypeName', () => {
    it('允许 2-8 个中文或 1-64 个英文', () => {
      expect(validateTaskTypeName('需求分析')).toBe('需求分析');
      expect(validateTaskTypeName('UI')).toBe('UI');
      expect(validateTaskTypeName('Frontend')).toBe('Frontend');
      expect(validateTaskTypeName('A'.repeat(64))).toBe('A'.repeat(64));
      expect(validateTaskTypeName('  测试  ')).toBe('测试');
    });

    it('拒绝混合、空格、特殊字符和长度越界', () => {
      for (const name of [
        '',
        '开',
        'UI设计',
        'Frontend Development',
        'UI 设计',
        'A'.repeat(65),
        '需求-分析',
      ]) {
        expect(() => validateTaskTypeName(name)).toThrow(BadRequestException);
      }
    });
  });

  describe('create', () => {
    it('空表启动时补齐初始任务类型', async () => {
      const insertQuery = {
        insert: jest.fn().mockReturnThis(),
        into: jest.fn().mockReturnThis(),
        values: jest.fn().mockReturnThis(),
        orIgnore: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue(undefined),
      };
      typesRepo.createQueryBuilder.mockReturnValue(insertQuery);

      await service.onModuleInit();

      expect(insertQuery.values).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ name: '其它' }),
          expect.objectContaining({ name: 'UI' }),
        ]),
      );
      expect(insertQuery.execute).toHaveBeenCalled();
      expect(tasksRepo.update).toHaveBeenCalledWith(
        { type: 'UI设计' },
        { type: 'UI' },
      );
    });

    it('已有类型时只补齐缺失的「未知任务」系统类型', async () => {
      typesRepo.count.mockResolvedValue(3);
      typesRepo.findOne.mockResolvedValue(null);
      const insertQuery = {
        insert: jest.fn().mockReturnThis(),
        into: jest.fn().mockReturnThis(),
        values: jest.fn().mockReturnThis(),
        orIgnore: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue(undefined),
      };
      typesRepo.createQueryBuilder.mockReturnValue(insertQuery);

      await service.onModuleInit();

      expect(insertQuery.values).toHaveBeenCalledWith(
        expect.objectContaining({ name: '未知任务' }),
      );
      expect(insertQuery.execute).toHaveBeenCalled();
      expect(tasksRepo.update).toHaveBeenCalledWith(
        { type: 'UI设计' },
        { type: 'UI' },
      );
    });

    it('「未知任务」系统类型已存在时不重复写入', async () => {
      typesRepo.count.mockResolvedValue(3);
      typesRepo.findOne.mockResolvedValue(typeOf({ name: '未知任务' }));

      await service.onModuleInit();

      expect(typesRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('保存 trim 后的名称与描述', async () => {
      await service.create({ name: ' 前端开发 ', description: ' 页面实现 ' });
      expect(typesRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ name: '前端开发', description: '页面实现' }),
      );
    });

    it('名称重复（英文不区分大小写）返回 400', async () => {
      nameQuery.getMany.mockResolvedValue([
        typeOf({ id: 2, name: 'Frontend' }),
      ]);
      await expect(service.create({ name: 'frontend' })).rejects.toThrow(
        '类型名称「frontend」已存在',
      );
      expect(typesRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('默认类型「其它」不允许改名，但可改描述', async () => {
      typesRepo.findOne.mockResolvedValueOnce(typeOf({ name: '其它' }));
      await expect(service.update(1, { name: '通用' })).rejects.toThrow(
        '默认类型「其它」不允许改名',
      );

      typesRepo.findOne.mockResolvedValueOnce(typeOf({ name: '其它' }));
      const updated = await service.update(1, { description: '兜底分类' });
      expect(updated.description).toBe('兜底分类');
    });

    it('系统类型「未知任务」不允许改名', async () => {
      typesRepo.findOne.mockResolvedValueOnce(typeOf({ name: '未知任务' }));
      await expect(service.update(1, { name: 'Other' })).rejects.toThrow(
        '系统类型「未知任务」不允许改名',
      );
    });

    it('改名同步存量任务与机器人任务定义', async () => {
      const type = typeOf({ id: 2, name: '前端开发' });
      typesRepo.findOne.mockResolvedValue(type);
      const worker = {
        id: 3,
        taskDefs: [
          { type: '前端开发', inputs: [], outputs: [] },
          { type: '测试', inputs: [], outputs: [] },
        ],
      };
      workersRepo.find.mockResolvedValue([worker]);

      const updated = await service.update(2, { name: 'Frontend' });

      expect(updated.name).toBe('Frontend');
      expect(renameQuery.set).toHaveBeenCalledWith({ type: 'Frontend' });
      expect(renameQuery.where).toHaveBeenCalledWith('type = :from', {
        from: '前端开发',
      });
      expect(renameQuery.execute).toHaveBeenCalled();
      expect(workersRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          taskDefs: [
            { type: 'Frontend', inputs: [], outputs: [] },
            { type: '测试', inputs: [], outputs: [] },
          ],
        }),
      );
    });
  });

  describe('remove', () => {
    it('默认类型不可删除', async () => {
      typesRepo.findOne.mockResolvedValue(typeOf({ name: '其它' }));
      await expect(service.remove(1)).rejects.toThrow(
        '默认类型「其它」不可删除',
      );
    });

    it('系统类型「未知任务」不可删除', async () => {
      typesRepo.findOne.mockResolvedValue(typeOf({ name: '未知任务' }));
      await expect(service.remove(1)).rejects.toThrow(
        '系统类型「未知任务」不可删除',
      );
    });

    it('被任务使用时禁止删除', async () => {
      typesRepo.findOne.mockResolvedValue(typeOf({ name: '测试' }));
      tasksRepo.count.mockResolvedValue(3);
      await expect(service.remove(1)).rejects.toThrow('已被 3 个任务使用');
      expect(typesRepo.remove).not.toHaveBeenCalled();
    });

    it('被机器人任务定义使用时禁止删除', async () => {
      typesRepo.findOne.mockResolvedValue(typeOf({ name: '测试' }));
      workersRepo.find.mockResolvedValue([
        { id: 1, taskDefs: [{ type: '测试', inputs: [], outputs: [] }] },
      ]);
      await expect(service.remove(1)).rejects.toThrow('已被机器人任务定义使用');
    });

    it('未被引用时删除', async () => {
      const type = typeOf({ name: '测试' });
      typesRepo.findOne.mockResolvedValue(type);
      await service.remove(1);
      expect(typesRepo.remove).toHaveBeenCalledWith(type);
    });
  });

  describe('assertExists', () => {
    it('类型存在返回名称，空值返回 null', async () => {
      typesRepo.findOne.mockResolvedValue(typeOf({ name: '测试' }));
      await expect(service.assertExists('测试')).resolves.toBe('测试');
      await expect(service.assertExists('   ')).resolves.toBeNull();
    });

    it('类型不存在返回 400', async () => {
      await expect(service.assertExists('不存在')).rejects.toThrow(
        '任务类型「不存在」不存在',
      );
    });
  });
});
