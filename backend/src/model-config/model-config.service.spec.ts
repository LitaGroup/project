import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ModelThinkingLevel } from '../common/enums';
import { ModelScenario } from './model-scenario.entity';
import {
  ModelConfigService,
  normalizeBaseUrl,
  parseModelIds,
} from './model-config.service';

describe('ModelConfigService', () => {
  let rows: ModelScenario[];
  let qb: {
    addSelect: jest.Mock;
    where: jest.Mock;
    getOne: jest.Mock;
    getMany: jest.Mock;
  };
  let repo: {
    create: jest.Mock;
    save: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let service: ModelConfigService;

  beforeEach(() => {
    rows = [];
    qb = {
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn(() => Promise.resolve(rows[0] ?? null)),
      getMany: jest.fn(() => Promise.resolve(rows)),
    };
    repo = {
      create: jest.fn((value: Partial<ModelScenario>) => value),
      save: jest.fn((value: ModelScenario) => {
        rows = [value];
        return Promise.resolve(value);
      }),
      createQueryBuilder: jest.fn(() => qb),
    };
    service = new ModelConfigService(repo as never);
  });

  it('归一化 Base URL：去空白与末尾斜杠', () => {
    expect(normalizeBaseUrl('  https://api.example.com/v1///  ')).toBe(
      'https://api.example.com/v1',
    );
    expect(normalizeBaseUrl('')).toBeNull();
    expect(normalizeBaseUrl(null)).toBeNull();
  });

  it('解析模型列表：兼容 data[].id 与字符串数组', () => {
    expect(
      parseModelIds({
        data: [{ id: 'glm-4.6' }, { id: 'glm-4.5' }, { id: 'glm-4.6' }],
      }),
    ).toEqual(['glm-4.5', 'glm-4.6']);
    expect(parseModelIds(['b', 'a'])).toEqual(['a', 'b']);
    expect(parseModelIds(null)).toEqual([]);
  });

  it('列表按固定场景返回未配置视图，不回显 apiKey', async () => {
    const views = await service.list();
    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({
      scenario: 'title-naming',
      name: '工单和任务标题命名',
      configured: false,
      baseUrl: null,
      model: null,
      thinking: ModelThinkingLevel.LOW,
      hasApiKey: false,
    });
    expect(JSON.stringify(views)).not.toContain('apiKey');
  });

  it('保存：apiKey 未传保持原值，空串清除，非法值拒绝', async () => {
    rows = [
      {
        id: 1,
        scenario: 'title-naming',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'sk-old',
        model: 'glm-4.6',
        thinking: ModelThinkingLevel.LOW,
      } as ModelScenario,
    ];

    await service.save('title-naming', {
      baseUrl: 'https://api.example.com/v1',
      model: 'glm-4.6',
      thinking: ModelThinkingLevel.OFF,
    });
    const savedCalls = repo.save.mock.calls as Array<[ModelScenario]>;
    expect(savedCalls[0][0]).toMatchObject({
      apiKey: 'sk-old',
      thinking: ModelThinkingLevel.OFF,
    });

    await service.save('title-naming', { apiKey: '' });
    expect(savedCalls[1][0]).toMatchObject({ apiKey: null });

    await expect(
      service.save('title-naming', { thinking: 'extreme' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.save('title-naming', { baseUrl: 'ftp://example.com' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.save('unknown-scenario', {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('运行时解析：baseUrl 与 model 缺一返回 null', async () => {
    expect(await service.resolve('title-naming')).toBeNull();
    rows = [
      {
        id: 1,
        scenario: 'title-naming',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'sk-1',
        model: 'glm-4.6',
        thinking: ModelThinkingLevel.LOW,
      } as ModelScenario,
    ];
    expect(await service.resolve('title-naming')).toEqual({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-1',
      model: 'glm-4.6',
      thinking: ModelThinkingLevel.LOW,
    });
  });

  it('拉取模型列表走后端代理并支持临时覆盖', async () => {
    rows = [
      {
        id: 1,
        scenario: 'title-naming',
        baseUrl: 'https://saved.example.com/v1',
        apiKey: 'sk-saved',
        model: 'glm-4.6',
        thinking: ModelThinkingLevel.LOW,
      } as ModelScenario,
    ];
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({ data: [{ id: 'model-b' }, { id: 'model-a' }] }),
    });
    const original = global.fetch;
    global.fetch = fetchMock;

    try {
      const models = await service.fetchModels('title-naming', {
        baseUrl: 'https://temp.example.com/v1',
        apiKey: 'sk-temp',
      });
      expect(models).toEqual(['model-a', 'model-b']);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://temp.example.com/v1/models',
        expect.objectContaining({
          headers: { Authorization: 'Bearer sk-temp' },
        }),
      );

      // 未传临时值时使用已保存配置
      await service.fetchModels('title-naming');
      expect(fetchMock).toHaveBeenLastCalledWith(
        'https://saved.example.com/v1/models',
        expect.objectContaining({
          headers: { Authorization: 'Bearer sk-saved' },
        }),
      );

      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: () => Promise.resolve('unauthorized'),
      });
      await expect(service.fetchModels('title-naming')).rejects.toThrow(
        'HTTP 401',
      );
    } finally {
      global.fetch = original;
    }
  });
});
