import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ProjectStatus } from '../common/enums';
import { FeishuService } from '../feishu/feishu.service';
import { Project } from '../projects/project.entity';
import { User } from '../auth/user.entity';
import { ProjectRelease } from './project-release.entity';
import { ReleasesService } from './releases.service';

describe('ReleasesService', () => {
  let service: ReleasesService;
  let releasesSave: jest.Mock;
  let projectsSave: jest.Mock;
  let usersFind: jest.Mock;
  let sendUserCard: jest.Mock;
  let fetchMock: jest.Mock;
  const realFetch = globalThis.fetch;

  const project = (over: Partial<Project> = {}): Project =>
    ({
      id: 1,
      name: '活动项目',
      status: ProjectStatus.IN_PROGRESS,
      resources: { frontend: '张三', backend: '李四', qa: '王五' },
      ...over,
    }) as Project;

  beforeEach(async () => {
    releasesSave = jest.fn();
    releasesSave.mockImplementation((v: Partial<ProjectRelease>) =>
      Promise.resolve({ id: 9, createdAt: new Date(), ...v } as ProjectRelease),
    );
    projectsSave = jest.fn();
    projectsSave.mockImplementation((v: Project) => Promise.resolve(v));
    // where.name 为 TypeORM In() FindOperator，取其 .value 还原姓名数组
    usersFind = jest.fn();
    usersFind.mockImplementation(
      (args?: { where?: { name?: { value?: string[] } } }) =>
        Promise.resolve(
          (args?.where?.name?.value ?? []).map((n) => ({
            id: 1,
            name: n,
            feishuOpenId: `ou_${n}`,
          })),
        ),
    );
    sendUserCard = jest.fn();
    sendUserCard.mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [
        ReleasesService,
        {
          provide: getRepositoryToken(ProjectRelease),
          useValue: {
            create: (v: Partial<ProjectRelease>) => v,
            save: releasesSave,
            delete: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(Project),
          useValue: {
            findOne: () => Promise.resolve(project()),
            save: projectsSave,
          },
        },
        { provide: getRepositoryToken(User), useValue: { find: usersFind } },
        { provide: FeishuService, useValue: { sendUserCard } },
        { provide: ConfigService, useValue: { get: () => undefined } },
      ],
    }).compile();
    service = moduleRef.get(ReleasesService);
    // 群机器人 webhook 打桩：单测不应出网
    fetchMock = jest.fn();
    fetchMock.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ code: 0 }),
      } as Response),
    );
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('提测成功：创建记录 + 状态流转「测试中」+ 群与项目人员私聊通知', async () => {
    const release = await service.submit(1, {
      content: ' 修复了登录问题 ',
      urls: [' https://staging.example.com ', ''],
      branches: [
        { repo: ' LitaGroup/lita-h5 ', branch: ' test ' },
        { repo: '', branch: '' },
      ],
      testers: ['王五'],
    });
    expect(release.content).toBe('修复了登录问题');
    expect(release.urls).toEqual(['https://staging.example.com']);
    expect(release.branches).toEqual([
      { repo: 'LitaGroup/lita-h5', branch: 'test' },
    ]);
    expect(release.testers).toEqual(['王五']);
    expect(projectsSave).toHaveBeenCalledWith(
      expect.objectContaining({ status: ProjectStatus.IN_TEST }),
    );
    await Promise.resolve(); // 放行 fire-and-forget 通知
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sendUserCard).toHaveBeenCalledTimes(3); // 张三/李四/王五 去重后
  });

  it('已是「测试中」的重复提测：仅追加记录，不改状态', async () => {
    const inTest = {
      findOne: () =>
        Promise.resolve(project({ status: ProjectStatus.IN_TEST })),
    };
    // 覆盖 Project repo：项目已处于「测试中」
    const moduleRef = await Test.createTestingModule({
      providers: [
        ReleasesService,
        {
          provide: getRepositoryToken(ProjectRelease),
          useValue: {
            create: (v: Partial<ProjectRelease>) => v,
            save: releasesSave,
            delete: jest.fn(),
          },
        },
        { provide: getRepositoryToken(Project), useValue: inTest },
        { provide: getRepositoryToken(User), useValue: { find: usersFind } },
        { provide: FeishuService, useValue: { sendUserCard } },
        { provide: ConfigService, useValue: { get: () => undefined } },
      ],
    }).compile();
    const svc = moduleRef.get(ReleasesService);
    await svc.submit(1, { testers: ['王五'] }, '操作人');
    expect(projectsSave).not.toHaveBeenCalled();
  });

  it('测试人员为空 → 400', async () => {
    await expect(service.submit(1, { testers: [] })).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.submit(1, { testers: [' 、，'] })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('测试人员不存在于用户系统 → 400 并列出无效姓名', async () => {
    usersFind.mockResolvedValue([{ name: '王五' }]);
    await expect(
      service.submit(1, { testers: ['王五', '赵六'] }),
    ).rejects.toThrow(/赵六/);
  });

  it('项目不存在 → 404', async () => {
    const missing = {
      findOne: () => Promise.resolve(null),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        ReleasesService,
        {
          provide: getRepositoryToken(ProjectRelease),
          useValue: {
            create: jest.fn(),
            save: releasesSave,
            delete: jest.fn(),
          },
        },
        { provide: getRepositoryToken(Project), useValue: missing },
        { provide: getRepositoryToken(User), useValue: { find: usersFind } },
        { provide: FeishuService, useValue: { sendUserCard } },
        { provide: ConfigService, useValue: { get: () => undefined } },
      ],
    }).compile();
    const svc = moduleRef.get(ReleasesService);
    await expect(svc.submit(99, { testers: ['王五'] })).rejects.toThrow(
      NotFoundException,
    );
  });

  it('通知失败不影响提测结果', async () => {
    globalThis.fetch = jest
      .fn()
      .mockImplementation(() => Promise.reject(new Error('network')));
    sendUserCard.mockRejectedValue(new Error('feishu down'));
    const release = await service.submit(1, { testers: ['王五'] });
    expect(release.id).toBe(9);
    await new Promise((r) => setTimeout(r, 0));
    expect(sendUserCard).toHaveBeenCalled();
  });

  it('人员姓名按常见分隔符拆分去重（testers 单条串写多人也支持）', async () => {
    await service.submit(1, { testers: ['王五、赵六, 孙七 王五'] });
    const saved = (
      releasesSave.mock.calls as Partial<ProjectRelease>[][]
    )[0][0];
    expect(saved.testers).toEqual(['王五', '赵六', '孙七']);
  });

  it('removeByProject 按项目删除提测记录', async () => {
    const del = jest.fn();
    del.mockResolvedValue(undefined);
    const moduleRef = await Test.createTestingModule({
      providers: [
        ReleasesService,
        {
          provide: getRepositoryToken(ProjectRelease),
          useValue: { create: jest.fn(), save: releasesSave, delete: del },
        },
        {
          provide: getRepositoryToken(Project),
          useValue: { findOne: jest.fn() },
        },
        { provide: getRepositoryToken(User), useValue: { find: usersFind } },
        { provide: FeishuService, useValue: { sendUserCard } },
        { provide: ConfigService, useValue: { get: () => undefined } },
      ],
    }).compile();
    const svc = moduleRef.get(ReleasesService);
    await svc.removeByProject(7);
    expect(del).toHaveBeenCalledWith({ projectId: 7 });
  });
});
