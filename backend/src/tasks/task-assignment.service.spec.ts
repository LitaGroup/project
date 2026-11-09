import { WorkerRole } from '../common/enums';
import { TaskAssignmentService } from './task-assignment.service';
import { Task } from './task.entity';

describe('TaskAssignmentService', () => {
  const task = (over: Partial<Task> = {}): Task =>
    ({
      id: 1,
      code: 'TK-0001',
      title: '活动页开发',
      templateId: null,
      templateName: null,
      description: '开发活动页',
      agentId: null,
      ...over,
    }) as Task;

  const worker = (id: number, over: Record<string, unknown> = {}) => ({
    id,
    name: `机器人${id}`,
    role: WorkerRole.WORKER,
    enabled: true,
    ...over,
  });

  let templates: { findOne: jest.Mock };
  let workers: { find: jest.Mock };
  let service: TaskAssignmentService;

  const unknownTemplate = (agentIds: number[] = [1002]) => ({
    id: 6,
    name: '未知任务',
    agentIds,
  });

  beforeEach(() => {
    templates = {
      findOne: jest.fn().mockResolvedValue(null),
    };
    workers = {
      find: jest.fn().mockResolvedValue([]),
    };
    service = new TaskAssignmentService(templates as never, workers as never);
  });

  it('优先使用所选任务定义绑定的启用机器人', async () => {
    templates.findOne.mockResolvedValue({
      id: 11,
      name: '前端任务定义',
      agentIds: [5, 6],
    });
    workers.find.mockResolvedValue([worker(6), worker(5)]);

    const result = await service.assign(task({ templateId: 11 }));

    expect(result).toMatchObject({
      agentId: 5,
      agentName: '机器人5',
      templateId: 11,
      templateName: '前端任务定义',
      source: 'definition',
    });
  });

  it('任务分配查询排除个人 AGENT', async () => {
    await service.assign(task());

    const calls = workers.find.mock.calls as unknown[][];
    const query = calls[0][0] as { where: Record<string, unknown> };
    const filter = query.where.personalAgentUserId;
    expect(filter).toBeDefined();
    expect(filter).not.toBeNull();
  });

  it('未选任务定义时直接归入未知任务定义', async () => {
    templates.findOne.mockImplementation(
      ({ where }: { where: { id: number } }) =>
        Promise.resolve(where.id === 6 ? unknownTemplate() : null),
    );
    workers.find.mockResolvedValue([worker(1002)]);

    const result = await service.assign(task());

    expect(result).toMatchObject({
      agentId: 1002,
      templateId: 6,
      templateName: '未知任务',
      source: 'unknown',
    });
    expect(templates.findOne).toHaveBeenCalledWith({ where: { id: 6 } });
  });

  it('无法匹配时标记未知任务并交给系统未知任务定义（ID=6）的启用机器人', async () => {
    templates.findOne.mockResolvedValue(unknownTemplate([2, 1002]));
    workers.find.mockResolvedValue([worker(1002, { name: '技术-后端架构师' })]);

    const result = await service.assign(task());

    expect(result).toMatchObject({
      agentId: 1002,
      agentName: '技术-后端架构师',
      templateId: 6,
      templateName: '未知任务',
      source: 'unknown',
    });
    expect(templates.findOne).toHaveBeenCalledWith({ where: { id: 6 } });
  });

  it('系统未知任务定义没有启用机器人 → 不分配机器人', async () => {
    templates.findOne.mockResolvedValue(unknownTemplate([2]));
    workers.find.mockResolvedValue([]);

    const result = await service.assign(task());

    expect(result).toMatchObject({
      agentId: null,
      agentName: null,
      templateId: 6,
      templateName: '未知任务',
      source: 'unknown',
    });
  });

  it('系统未知任务定义不存在 → 不分配机器人', async () => {
    templates.findOne.mockResolvedValue(null);

    const result = await service.assign(task());

    expect(result).toMatchObject({
      agentId: null,
      templateId: null,
      source: 'unknown',
    });
  });

  it('项目开发交付项目经理未启用时保持待分配', async () => {
    templates.findOne.mockResolvedValue({
      id: 7,
      name: '技术-项目开发交付',
      agentIds: [2],
    });

    const result = await service.assign(task({ templateId: 7 }));

    expect(result).toMatchObject({
      agentId: null,
      templateId: 7,
      templateName: '技术-项目开发交付',
      source: 'definition',
    });
    expect(templates.findOne).toHaveBeenCalledTimes(1);
  });

  it('人工预分配的启用机器人优先保留', async () => {
    workers.find.mockResolvedValue([worker(9)]);

    const result = await service.assign(task({ agentId: 9 }));

    expect(result).toMatchObject({
      agentId: 9,
      source: 'manual',
    });
  });
});
