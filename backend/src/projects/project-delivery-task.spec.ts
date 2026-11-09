import { ProjectsService } from './projects.service';

describe('ProjectsService 项目交付任务', () => {
  const createService = (
    projects: { findOne: jest.Mock },
    tasksService: { ensureProjectDeliveryTask: jest.Mock },
    projectChats: { ensureForProjectTask: jest.Mock },
  ) =>
    new ProjectsService(
      projects as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      tasksService as never,
      projectChats as never,
    );

  it('创建交付任务时把项目名称传给任务服务，并绑定项目沟通群', async () => {
    const projects = {
      findOne: jest.fn().mockResolvedValue({ id: 3708, name: '需求池项目' }),
    };
    const tasksService = {
      ensureProjectDeliveryTask: jest
        .fn()
        .mockResolvedValue({ task: { id: 88 } }),
    };
    const projectChats = {
      ensureForProjectTask: jest.fn().mockResolvedValue(undefined),
    };
    const service = createService(projects, tasksService, projectChats);

    await service.ensureProjectDeliveryTask(3708, {
      userId: 7,
      userName: '张三',
    });

    expect(projects.findOne).toHaveBeenCalledWith({
      where: { id: 3708 },
      select: { id: true, name: true },
    });
    expect(tasksService.ensureProjectDeliveryTask).toHaveBeenCalledWith(
      3708,
      { userId: 7, userName: '张三' },
      '需求池项目',
    );
    expect(projectChats.ensureForProjectTask).toHaveBeenCalledWith(3708, 88);
  });
});
