import { WorkerRole } from '../common/enums';
import { TaskAssignmentService } from './task-assignment.service';
import { Task } from './task.entity';

describe('TaskAssignmentService', () => {
  const task = (over: Partial<Task> = {}): Task =>
    ({
      id: 1,
      code: 'TK-0001',
      title: '活动页开发',
      type: '其它',
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
    taskDefs: null,
    ...over,
  });

  let templates: { findOne: jest.Mock; find: jest.Mock };
  let workers: { find: jest.Mock };
  let service: TaskAssignmentService;

  const unknownTemplate = (agentIds: number[] = [1002]) => ({
    id: 6,
    name: '未知任务',
    type: '其它',
    agentIds,
  });

  beforeEach(() => {
    templates = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
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
      type: '前端开发',
      agentIds: [5, 6],
    });
    workers.find.mockResolvedValue([worker(6), worker(5)]);

    const result = await service.assign(task({ templateId: 11 }));

    expect(result).toMatchObject({
      type: '前端开发',
      agentId: 5,
      agentName: '机器人5',
      templateId: 11,
      templateName: '前端任务定义',
      source: 'definition',
    });
  });

  it('未选定义时按任务类型匹配同类型任务定义', async () => {
    templates.find.mockResolvedValue([
      {
        id: 12,
        name: '前端定义二',
        type: '前端开发',
        agentIds: [7],
      },
    ]);
    workers.find.mockResolvedValue([worker(7)]);

    const result = await service.assign(task({ type: '前端开发' }));

    expect(result).toMatchObject({
      type: '前端开发',
      agentId: 7,
      templateId: 12,
      templateName: '前端定义二',
      source: 'type-definition',
    });
  });

  it('没有可用任务定义时按机器人的任务定义类型匹配', async () => {
    workers.find.mockResolvedValue([
      worker(8, {
        taskDefs: [{ type: '前端开发', inputs: [], outputs: [] }],
      }),
    ]);

    const result = await service.assign(task({ type: '前端开发' }));

    expect(result).toMatchObject({
      type: '前端开发',
      agentId: 8,
      source: 'type-worker',
    });
  });

  it('无法匹配时标记未知任务并交给系统未知任务定义（ID=6）的启用机器人', async () => {
    templates.findOne.mockResolvedValue(unknownTemplate([2, 1002]));
    workers.find.mockResolvedValue([worker(1002, { name: '技术-后端架构师' })]);

    const result = await service.assign(task());

    expect(result).toMatchObject({
      type: '未知任务',
      agentId: 1002,
      agentName: '技术-后端架构师',
      templateId: 6,
      templateName: '未知任务',
      source: 'unknown',
      originalType: '其它',
    });
    expect(templates.findOne).toHaveBeenCalledWith({ where: { id: 6 } });
  });

  it('系统未知任务定义没有启用机器人 → 不分配机器人', async () => {
    templates.findOne.mockResolvedValue(unknownTemplate([2]));
    workers.find.mockResolvedValue([]);

    const result = await service.assign(task());

    expect(result).toMatchObject({
      type: '未知任务',
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
      type: '未知任务',
      agentId: null,
      templateId: null,
      source: 'unknown',
    });
  });

  it('默认类型「其它」不参与同类型匹配，直接进入未知任务', async () => {
    templates.find.mockResolvedValue([
      {
        id: 13,
        name: '通用任务定义',
        type: '其它',
        agentIds: [5],
      },
    ]);
    workers.find.mockResolvedValue([
      worker(5),
      worker(1002, { name: '技术-后端架构师' }),
    ]);
    templates.findOne.mockResolvedValue(unknownTemplate());

    const result = await service.assign(task({ type: '其它' }));

    expect(result).toMatchObject({
      type: '未知任务',
      agentId: 1002,
      templateId: 6,
      source: 'unknown',
    });
    expect(templates.find).not.toHaveBeenCalled();
  });

  it('人工预分配的启用机器人优先保留', async () => {
    workers.find.mockResolvedValue([worker(9)]);

    const result = await service.assign(
      task({
        agentId: 9,
        type: '其它',
      }),
    );

    expect(result).toMatchObject({
      agentId: 9,
      source: 'manual',
    });
  });
});
