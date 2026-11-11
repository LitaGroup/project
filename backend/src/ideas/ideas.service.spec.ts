import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { IdeaStatus, IdeaType, ProjectType } from '../common/enums';
import { Idea } from './idea.entity';
import { IdeasService, type IdeaActor } from './ideas.service';

function actor(overrides?: Partial<IdeaActor>): IdeaActor {
  return { userId: 7, userName: '小明', isAdmin: false, ...overrides };
}

function ideaRow(overrides?: Partial<Idea>): Idea {
  return {
    id: 1,
    title: '做一个灵感墙',
    type: IdeaType.IDEA,
    status: IdeaStatus.DRAFT,
    content: '收集全员的零散想法',
    images: null,
    creatorId: 7,
    creatorName: '小明',
    projectId: null,
    adoptedAt: null,
    createdAt: new Date('2026-11-11T02:00:00Z'),
    updatedAt: new Date('2026-11-11T02:00:00Z'),
    ...overrides,
  };
}

function makeService(
  row: Idea,
  projectCreate?: jest.Mock,
  llm: { generateTitle: jest.Mock } = {
    generateTitle: jest.fn().mockResolvedValue(null),
  },
) {
  const findOne = jest.fn().mockResolvedValue(row);
  const save = jest.fn().mockImplementation((v: Idea) => Promise.resolve(v));
  const remove = jest.fn().mockResolvedValue(undefined);
  const query = {
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const repository = {
    findOne,
    save,
    remove,
    createQueryBuilder: jest.fn().mockReturnValue(query),
  } as never;
  const projects = {
    create:
      projectCreate ?? jest.fn().mockResolvedValue({ id: 99, name: row.title }),
    findOne: jest.fn().mockResolvedValue({ id: 42, name: '已有需求' }),
  };
  const service = new IdeasService(repository, projects as never, llm as never);
  return { service, save, remove, projects, llm, query };
}

describe('IdeasService.create', () => {
  it('标题可省略，非法类型与图片地址仍拒绝', async () => {
    const create = jest.fn().mockImplementation((v: Idea): Idea => v);
    const save = jest.fn().mockImplementation((v: Idea) => Promise.resolve(v));
    const projects = { create: jest.fn(), findOne: jest.fn() };
    const llm = { generateTitle: jest.fn().mockResolvedValue(null) };
    const service = new IdeasService(
      { create, save } as never,
      projects as never,
      llm as never,
    );
    const saved = await service.create({ content: '一句话灵感' }, actor());
    expect(saved.title).toBe('一句话灵感');
    await expect(
      service.create({ title: 'ok', type: '不存在' as IdeaType }, actor()),
    ).rejects.toThrow('灵感类型仅允许');
    await expect(
      service.create({ title: 'ok', images: ['http://evil/x.png'] }, actor()),
    ).rejects.toThrow('/images/');
  });

  it('创建后默认构思状态并记录创建人（正文可空）', async () => {
    const create = jest.fn().mockImplementation((v: Idea): Idea => v);
    const save = jest.fn().mockImplementation((v: Idea) => Promise.resolve(v));
    const service = new IdeasService(
      { create, save } as never,
      { create: jest.fn(), findOne: jest.fn() } as never,
      { generateTitle: jest.fn().mockResolvedValue(null) } as never,
    );
    const saved = await service.create({ title: '一句话灵感' }, actor());
    expect(saved.status).toBe(IdeaStatus.DRAFT);
    expect(saved.content).toBe('');
    expect(saved.creatorId).toBe(7);
  });

  it('未填标题时用正文首行兜底并异步生成 AI 标题', async () => {
    const create = jest
      .fn()
      .mockImplementation((v: Idea): Idea => ({ ...v, id: 12 }));
    const save = jest.fn().mockImplementation((v: Idea) => Promise.resolve(v));
    const query = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const llm = { generateTitle: jest.fn().mockResolvedValue('灵感墙') };
    const service = new IdeasService(
      {
        create,
        save,
        createQueryBuilder: jest.fn().mockReturnValue(query),
      } as never,
      { create: jest.fn(), findOne: jest.fn() } as never,
      llm as never,
    );
    const saved = await service.create(
      { content: '做一个灵感墙\n收集零散想法' },
      actor(),
    );
    expect(saved.title).toBe('做一个灵感墙');
    await new Promise((resolve) => setImmediate(resolve));
    expect(llm.generateTitle).toHaveBeenCalledWith(
      '做一个灵感墙\n收集零散想法',
    );
    expect(query.where).toHaveBeenCalledWith('id = :id AND title = :original', {
      id: 12,
      original: '做一个灵感墙',
    });
  });
});

describe('IdeasService.update', () => {
  it('构思期任何登录用户可协作编辑', async () => {
    const { service, save } = makeService(ideaRow());
    const updated = await service.update(
      1,
      { content: '补充细节' },
      actor({ userId: 8, userName: '小红' }),
    );
    expect(updated.content).toBe('补充细节');
    expect(save).toHaveBeenCalled();
  });

  it('空正文的兜底标题在补充正文后触发 AI 命名', async () => {
    const llm = { generateTitle: jest.fn().mockResolvedValue('灵感墙') };
    const { service, query } = makeService(
      ideaRow({ title: '新灵感', content: '' }),
      undefined,
      llm,
    );
    await service.update(1, { content: '做一个灵感墙' }, actor());
    await new Promise((resolve) => setImmediate(resolve));
    expect(llm.generateTitle).toHaveBeenCalledWith('做一个灵感墙');
    expect(query.where).toHaveBeenCalledWith('id = :id AND title = :original', {
      id: 1,
      original: '新灵感',
    });
  });

  it('采纳/废弃后非管理员不可修改', async () => {
    const { service } = makeService(
      ideaRow({ status: IdeaStatus.ADOPTED, projectId: 42 }),
    );
    await expect(
      service.update(1, { title: 'x' }, actor({ userId: 8 })),
    ).rejects.toThrow(ForbiddenException);
  });

  it('管理员可修改已采纳的灵感', async () => {
    const { service } = makeService(ideaRow({ status: IdeaStatus.ABANDONED }));
    const updated = await service.update(
      1,
      { title: '新标题' },
      actor({ isAdmin: true }),
    );
    expect(updated.title).toBe('新标题');
  });
});

describe('IdeasService.changeStatus', () => {
  it('仅管理员可流转状态', async () => {
    const { service } = makeService(ideaRow());
    await expect(
      service.changeStatus(1, { status: IdeaStatus.ABANDONED }, actor()),
    ).rejects.toThrow('仅管理员可流转灵感状态');
  });

  it('采纳时必须新建或关联需求', async () => {
    const { service } = makeService(ideaRow());
    await expect(
      service.changeStatus(
        1,
        { status: IdeaStatus.ADOPTED },
        actor({ isAdmin: true }),
      ),
    ).rejects.toThrow('采纳灵感时需新建需求或关联已有需求');
  });

  it('采纳时在需求池新建需求并记录采纳时间', async () => {
    const projectCreate = jest.fn().mockResolvedValue({ id: 99 });
    const { service } = makeService(ideaRow(), projectCreate);
    const result = await service.changeStatus(
      1,
      {
        status: IdeaStatus.ADOPTED,
        createProject: true,
        projectType: ProjectType.FEATURE,
      },
      actor({ isAdmin: true }),
    );
    expect(projectCreate).toHaveBeenCalledWith({
      name: '做一个灵感墙',
      type: ProjectType.FEATURE,
      description: '收集全员的零散想法',
    });
    expect(result.projectId).toBe(99);
    expect(result.adoptedAt).toBeInstanceOf(Date);
  });

  it('采纳时可关联已有需求', async () => {
    const { service, projects } = makeService(ideaRow());
    const result = await service.changeStatus(
      1,
      { status: IdeaStatus.ADOPTED, projectId: 42 },
      actor({ isAdmin: true }),
    );
    expect(projects.findOne).toHaveBeenCalledWith(42);
    expect(result.projectId).toBe(42);
  });

  it('退回构思时清空采纳时间并保留历史关联', async () => {
    const { service } = makeService(
      ideaRow({
        status: IdeaStatus.ADOPTED,
        projectId: 42,
        adoptedAt: new Date('2026-11-01T02:00:00Z'),
      }),
    );
    const result = await service.changeStatus(
      1,
      { status: IdeaStatus.DRAFT },
      actor({ isAdmin: true }),
    );
    expect(result.adoptedAt).toBeNull();
    expect(result.projectId).toBe(42);
  });

  it('非法状态值直接拒绝', async () => {
    const { service } = makeService(ideaRow());
    await expect(
      service.changeStatus(
        1,
        { status: '不存在' as IdeaStatus },
        actor({ isAdmin: true }),
      ),
    ).rejects.toThrow('灵感状态仅允许');
  });
});

describe('IdeasService.remove', () => {
  it('创建人只能删除构思中的灵感', async () => {
    const draft = makeService(ideaRow());
    await draft.service.remove(1, actor());
    expect(draft.remove).toHaveBeenCalled();

    const adopted = makeService(
      ideaRow({ status: IdeaStatus.ADOPTED, projectId: 42 }),
    );
    await expect(adopted.service.remove(1, actor())).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('非创建人非管理员不可删除', async () => {
    const { service } = makeService(ideaRow());
    await expect(service.remove(1, actor({ userId: 8 }))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('管理员可删除任意状态', async () => {
    const { service, remove } = makeService(
      ideaRow({ status: IdeaStatus.ADOPTED, projectId: 42 }),
    );
    await service.remove(1, actor({ isAdmin: true }));
    expect(remove).toHaveBeenCalled();
  });

  it('灵感不存在时返回 404', async () => {
    const repository = {
      findOne: jest.fn().mockResolvedValue(null),
    } as never;
    const service = new IdeasService(
      repository,
      {
        create: jest.fn(),
        findOne: jest.fn(),
      } as never,
      { generateTitle: jest.fn() } as never,
    );
    await expect(service.findOne(404)).rejects.toThrow(NotFoundException);
  });
});
